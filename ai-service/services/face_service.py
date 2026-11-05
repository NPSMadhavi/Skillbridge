import base64
import cv2
import numpy as np
from PIL import Image
import io
import torch
import ssl

# Bypass SSL certificate verification for model weight downloads
ssl._create_default_https_context = ssl._create_unverified_context

from facenet_pytorch import MTCNN, InceptionResnetV1
from services.crypto_service import crypto_service
from config.settings import settings

class FaceService:
    def __init__(self):
        print("Initializing Face ID Models (MTCNN + FaceNet InceptionResnetV1)...")
        # MTCNN for face detection and cropping. Device set to CPU for universal compatibility.
        self.detector = MTCNN(
            keep_all=False, 
            image_size=160, 
            margin=14, 
            min_face_size=30,
            thresholds=[0.5, 0.6, 0.6],
            device='cpu'
        )
        # Pretrained FaceNet model on VGGFace2 to extract 512-dim embedding.
        self.model = InceptionResnetV1(pretrained='vggface2', device='cpu').eval()
        print("Face ID Models loaded successfully.")

    def decode_base64_image(self, base64_str: str) -> Image.Image:
        """
        Decodes a base64 Data URL (or raw base64) to a PIL RGB Image.
        """
        try:
            if ',' in base64_str:
                base64_str = base64_str.split(',')[1]
            base64_str = base64_str.strip()
            padding_needed = len(base64_str) % 4
            if padding_needed:
                base64_str += '=' * (4 - padding_needed)

            image_data = base64.b64decode(base64_str)
            image = Image.open(io.BytesIO(image_data)).convert('RGB')
            return image
        except Exception as e:
            raise ValueError(f"Failed to decode base64 image: {str(e)}")

    def get_embedding(self, image: Image.Image) -> list[float]:
        """
        Detects face, crops, aligns, and extracts 512-dim embedding vector.
        """
        # Run face detection and cropping. MTCNN returns aligned tensor (3, 160, 160).
        with torch.no_grad():
            cropped_face = None
            try:
                w, h = image.size
                if w >= 20 and h >= 20:
                    cropped_face = self.detector(image)
                    if cropped_face is None and (w > 640 or h > 480):
                        resized = image.resize((w // 2, h // 2))
                        cropped_face = self.detector(resized)
            except Exception as ex:
                print(f"Face detector caught error on input frame: {str(ex)}")
                cropped_face = None

            if cropped_face is None:
                # Fallback: check if resizing or contrast adjustment helps detect
                w, h = image.size
                if w > 640 or h > 480:
                    resized = image.resize((w // 2, h // 2))
                    cropped_face = self.detector(resized)
            if cropped_face is None:
                raise ValueError("No face detected in the image. Ensure proper lighting and look directly at the camera.")
            
            # Generate embedding by adding batch dim (1, 3, 160, 160)
            embedding_tensor = self.model(cropped_face.unsqueeze(0))
            embedding = embedding_tensor.squeeze(0).tolist()

            
            # Normalize to unit length
            vec = np.array(embedding)
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec = vec / norm
            return vec.tolist()

    def compare_embeddings(self, emb1: list[float], emb2: list[float]) -> float:
        """
        Calculates cosine similarity between two 512-dim embedding vectors.
        """
        vec1 = np.array(emb1)
        vec2 = np.array(emb2)
        dot_product = np.dot(vec1, vec2)
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(dot_product / (norm1 * norm2))

    def register_face(self, base64_image: str) -> str:
        """
        Processes face image, extracts embedding, encrypts and returns base64 payload.
        """
        pil_image = self.decode_base64_image(base64_image)
        embedding = self.get_embedding(pil_image)
        return crypto_service.encrypt_embedding(embedding)

    def register_multiple_faces(self, base64_images: list[str]) -> str:
        """
        Processes multiple face images, extracts embeddings, averages them, encrypts and returns base64 payload.
        """
        embeddings = []
        for img_str in base64_images:
            try:
                pil_image = self.decode_base64_image(img_str)
                emb = self.get_embedding(pil_image)
                embeddings.append(emb)
            except Exception as e:
                print(f"Skipping frame in multi-capture: {str(e)}")
                continue

        if not embeddings:
            raise ValueError("No face detected in any of the captured images.")

        # Compute the mean vector
        avg_emb = np.mean(embeddings, axis=0)
        # Re-normalize to unit length (L2 norm)
        norm = np.linalg.norm(avg_emb)
        if norm > 0:
            avg_emb = avg_emb / norm
            
        return crypto_service.encrypt_embedding(avg_emb.tolist())

    def get_face_embedding(self, base64_image: str) -> list[float]:
        """
        Processes face image and returns the raw 512-dim float list.
        """
        pil_image = self.decode_base64_image(base64_image)
        return self.get_embedding(pil_image)

    def get_multiple_faces_embedding(self, base64_images: list[str]) -> list[float]:
        """
        Processes multiple face images, averages them, L2 normalizes them and returns raw list.
        """
        embeddings = []
        for img_str in base64_images:
            try:
                pil_image = self.decode_base64_image(img_str)
                emb = self.get_embedding(pil_image)
                embeddings.append(emb)
            except Exception as e:
                print(f"Skipping frame in multi-capture: {str(e)}")
                continue

        if not embeddings:
            raise ValueError("No face detected in any of the captured images.")

        avg_emb = np.mean(embeddings, axis=0)
        norm = np.linalg.norm(avg_emb)
        if norm > 0:
            avg_emb = avg_emb / norm
        return avg_emb.tolist()

    def verify_face(self, query_image_base64: str | None = None, candidates: list[dict] = [], query_images_base64: list[str] | None = None) -> dict:
        """
        Compares query image or list of query images with candidates' encrypted embeddings.
        candidates: [{"id": str, "encrypted_embedding": str, "face_image": str}]
        """
        query_embeddings = []

        if query_images_base64 and len(query_images_base64) > 0:
            for img_str in query_images_base64:
                try:
                    pil_image = self.decode_base64_image(img_str)
                    emb = self.get_embedding(pil_image)
                    query_embeddings.append(emb)
                except Exception as e:
                    print(f"Skipping query frame in verify_face: {str(e)}")
                    continue

        if not query_embeddings and query_image_base64:
            try:
                query_pil = self.decode_base64_image(query_image_base64)
                query_emb = self.get_embedding(query_pil)
                query_embeddings.append(query_emb)
            except Exception as e:
                print(f"Failed to extract embedding from query_image: {str(e)}")

        if not query_embeddings:
            raise ValueError("No face detected in query image(s). Ensure proper lighting and look directly at the camera.")

        # Compute consensus query embedding (L2 normalized mean across all valid query frames)
        if len(query_embeddings) > 1:
            avg_emb = np.mean(query_embeddings, axis=0)
            norm = np.linalg.norm(avg_emb)
            if norm > 0:
                consensus_query = (avg_emb / norm).tolist()
            else:
                consensus_query = query_embeddings[0]
        else:
            consensus_query = query_embeddings[0]

        best_match_id = None
        best_sim = -1.0
        highest_similarity = -1.0
        # Calibrated threshold for InceptionResnetV1 VGGFace2 (default 0.70)
        threshold = float(getattr(settings, "FACE_MATCH_THRESHOLD", 0.70))

        for candidate in candidates:
            cand_id = candidate.get("id")
            encrypted_emb = candidate.get("encrypted_embedding")
            cand_face_img = candidate.get("face_image")
            cand_emb = None

            if encrypted_emb:
                try:
                    cand_emb = crypto_service.decrypt_embedding(encrypted_emb)
                except Exception:
                    cand_emb = None

            if cand_emb is None and cand_face_img:
                try:
                    pil_cand = self.decode_base64_image(cand_face_img)
                    cand_emb = self.get_embedding(pil_cand)
                except Exception as e:
                    print(f"Skipping candidate {cand_id} face_image embedding extraction: {str(e)}")
                    cand_emb = None

            if cand_emb is None:
                continue

            try:
                # Ensure candidate vector is unit-normalized
                cand_vec = np.array(cand_emb, dtype=np.float32)
                cand_norm = np.linalg.norm(cand_vec)
                if cand_norm > 0:
                    cand_emb = (cand_vec / cand_norm).tolist()

                # 1. Similarity against consensus query
                consensus_sim = self.compare_embeddings(consensus_query, cand_emb)

                # 2. Similarities against individual query frames
                frame_sims = [self.compare_embeddings(q, cand_emb) for q in query_embeddings]
                max_frame_sim = max(frame_sims) if frame_sims else consensus_sim

                # Composite score: consensus provides high stability against outliers;
                # max_frame gives slight bonus if one frame had optimal lighting/pose.
                if len(query_embeddings) > 1:
                    cand_score = (0.70 * consensus_sim) + (0.30 * max_frame_sim)
                else:
                    cand_score = consensus_sim

                if cand_score > highest_similarity:
                    highest_similarity = cand_score

                # Candidate qualifies only if:
                # 1. The composite score reaches the calibrated threshold (e.g. >= 0.73)
                # 2. Consensus similarity is also sufficiently high (prevents an outlier frame from spoofing)
                if cand_score >= threshold and consensus_sim >= (threshold - 0.05):
                    if cand_score > best_sim:
                        best_sim = cand_score
                        best_match_id = cand_id
                    print(f"[FaceID Matcher] Candidate {cand_id} QUALIFIED: composite={cand_score:.4f}, consensus={consensus_sim:.4f}, max_frame={max_frame_sim:.4f} >= threshold {threshold:.4f}")
                else:
                    if cand_score >= 0.50:
                        print(f"[FaceID Matcher] Candidate {cand_id} REJECTED: composite={cand_score:.4f}, consensus={consensus_sim:.4f} < threshold {threshold:.4f}")
            except Exception as e:
                print(f"Failed to process candidate {cand_id}: {str(e)}")
                continue

        matched = best_match_id is not None
        confidence = best_sim if matched else (highest_similarity if highest_similarity > 0 else 0.0)
        if matched:
            print(f"[Biometric Result] ACCEPTED: User '{best_match_id}' authenticated with confidence {confidence:.4f} (threshold={threshold:.4f})")
        else:
            print(f"[Biometric Result] REJECTED: Unauthorized individual. Highest score {confidence:.4f} < threshold {threshold:.4f}")

        return {
            "matched": matched,
            "user_id": best_match_id,
            "confidence": float(confidence)
        }

# Global face service instance (will lazy-load models on import)
face_service = None

def get_face_service():
    global face_service
    if face_service is None:
        face_service = FaceService()
    return face_service
