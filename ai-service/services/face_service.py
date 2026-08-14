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

class FaceService:
    def __init__(self):
        print("Initializing Face ID Models (MTCNN + FaceNet InceptionResnetV1)...")
        # MTCNN for face detection and cropping. Device set to CPU for universal compatibility.
        self.detector = MTCNN(
            keep_all=False, 
            image_size=160, 
            margin=14, 
            min_face_size=40,
            thresholds=[0.6, 0.7, 0.7],
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
            cropped_face = self.detector(image)
            if cropped_face is None:
                raise ValueError("No face detected in the image. Ensure proper lighting and look directly at the camera.")
            
            # Generate embedding by adding batch dim (1, 3, 160, 160)
            embedding_tensor = self.model(cropped_face.unsqueeze(0))
            embedding = embedding_tensor.squeeze(0).tolist()
            return embedding

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

    def verify_face(self, query_image_base64: str, candidates: list[dict]) -> dict:
        """
        Compares query image with candidates' encrypted embeddings.
        candidates: [{"id": str, "encrypted_embedding": str}]
        """
        # Decode and get embedding of query face
        query_pil = self.decode_base64_image(query_image_base64)
        query_emb = self.get_embedding(query_pil)

        best_match_id = None
        highest_similarity = -1.0
        threshold = 0.62  # Cosine similarity verification threshold for InceptionResnetV1 FaceNet

        for candidate in candidates:
            cand_id = candidate.get("id")
            encrypted_emb = candidate.get("encrypted_embedding")
            
            if not encrypted_emb:
                continue

            try:
                # Decrypt candidate embedding
                cand_emb = crypto_service.decrypt_embedding(encrypted_emb)
                # Compute similarity
                sim = self.compare_embeddings(query_emb, cand_emb)
                if sim > highest_similarity:
                    highest_similarity = sim
                    if sim >= threshold:
                        best_match_id = cand_id
            except Exception as e:
                print(f"Failed to process candidate {cand_id}: {str(e)}")
                continue

        matched = best_match_id is not None
        return {
            "matched": matched,
            "user_id": best_match_id,
            "confidence": highest_similarity
        }

# Global face service instance (will lazy-load models on import)
face_service = None

def get_face_service():
    global face_service
    if face_service is None:
        face_service = FaceService()
    return face_service
