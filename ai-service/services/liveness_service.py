import time
import uuid
import cv2
import numpy as np
from PIL import Image
import io
import base64
from typing import Dict, Any, List, Tuple
from services.crypto_service import crypto_service

class LivenessService:
    def __init__(self):
        # In-memory session store: session_id -> { created_at, expires_at, steps, nonce, consumed }
        self.sessions: Dict[str, Dict[str, Any]] = {}
        self.session_ttl_seconds = 300  # 5 minutes lifespan

    def cleanup_expired_sessions(self):
        now = time.time()
        expired = [sid for sid, s in self.sessions.items() if now > s["expires_at"] or s.get("consumed")]
        for sid in expired:
            self.sessions.pop(sid, None)

    def start_session(self) -> Dict[str, Any]:
        self.cleanup_expired_sessions()
        session_id = str(uuid.uuid4())
        now = time.time()
        session = {
            "session_id": session_id,
            "created_at": now,
            "expires_at": now + self.session_ttl_seconds,
            "steps": ["look_straight", "look_up", "turn_left", "turn_right", "look_down"],
            "nonce": uuid.uuid4().hex[:16],
            "consumed": False
        }
        self.sessions[session_id] = session
        return {
            "session_id": session_id,
            "expires_at": session["expires_at"],
            "steps": session["steps"],
            "nonce": session["nonce"]
        }

    def decode_base64_image(self, base64_str: str) -> Tuple[Image.Image, np.ndarray]:
        try:
            if ',' in base64_str:
                base64_str = base64_str.split(',')[1]
            base64_str = base64_str.strip()
            padding_needed = len(base64_str) % 4
            if padding_needed:
                base64_str += '=' * (4 - padding_needed)

            image_data = base64.b64decode(base64_str)
            pil_image = Image.open(io.BytesIO(image_data)).convert('RGB')
            # OpenCV image (BGR)
            np_image = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
            return pil_image, np_image
        except Exception as e:
            raise ValueError(f"Failed to decode base64 image: {str(e)}")

    def check_quality(self, np_image: np.ndarray) -> Dict[str, Any]:
        """
        Validates brightness, contrast, and sharpness (Laplacian variance).
        """
        gray = cv2.cvtColor(np_image, cv2.COLOR_BGR2GRAY)
        
        # Brightness / Illumination
        mean_brightness = float(np.mean(gray))
        if mean_brightness < 40:
            return {"valid": False, "reason": "Frame is underexposed / too dark."}
        if mean_brightness > 230:
            return {"valid": False, "reason": "Frame is overexposed / excessive glare."}

        # Sharpness / Blur
        laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if laplacian_var < 30.0:
            return {"valid": False, "reason": "Frame is blurry. Please hold steady."}

        return {"valid": True, "brightness": mean_brightness, "sharpness": laplacian_var}

    def check_passive_anti_spoofing(self, np_image: np.ndarray, face_box: np.ndarray) -> Dict[str, Any]:
        """
        Detects screen replay / printed paper attacks using:
        1. 2D Fast Fourier Transform (FFT) high-frequency Moiré pattern detection.
        2. Color chrominance standard deviation across skin regions.
        """
        h, w = np_image.shape[:2]
        x1, y1, x2, y2 = [int(v) for v in face_box]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w, x2), min(h, y2)
        
        face_crop = np_image[y1:y2, x1:x2]
        if face_crop.size == 0 or face_crop.shape[0] < 40 or face_crop.shape[1] < 40:
            return {"valid": True, "score": 1.0}

        # 1. FFT Moiré / Screen Grid Peak Analysis
        gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
        resized_gray = cv2.resize(gray_crop, (128, 128))
        
        f = np.fft.fft2(resized_gray)
        fshift = np.fft.fftshift(f)
        magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-7)
        
        # Mask out center DC component
        center_x, center_y = 64, 64
        radius = 16
        y_coords, x_coords = np.ogrid[:128, :128]
        mask = (x_coords - center_x)**2 + (y_coords - center_y)**2 <= radius**2
        magnitude_spectrum[mask] = 0

        # Screen grid and high-resolution halftone prints display sharp harmonic frequency peaks
        high_freq_peaks = np.max(magnitude_spectrum)
        high_freq_mean = np.mean(magnitude_spectrum)
        peak_to_mean_ratio = high_freq_peaks / (high_freq_mean + 1e-7)

        # 2. Chrominance variation (genuine human skin has natural Subsurface Scattering in Cr/Cb)
        ycrcb = cv2.cvtColor(face_crop, cv2.COLOR_BGR2YCrCb)
        _, cr, cb = cv2.split(ycrcb)
        chroma_std = (float(np.std(cr)) + float(np.std(cb))) / 2.0

        is_spoof = False
        reasons = []

        if peak_to_mean_ratio > 4.6 and high_freq_peaks > 220:
            is_spoof = True
            reasons.append("Screen pixel grid / Moiré pattern detected.")

        if chroma_std < 3.2:
            is_spoof = True
            reasons.append("Unnatural flat color distribution (printed paper / grayscale replica).")

        return {
            "valid": not is_spoof,
            "reasons": reasons,
            "peak_to_mean_ratio": float(peak_to_mean_ratio),
            "chroma_std": float(chroma_std)
        }

    def estimate_pose_mtcnn(self, pil_image: Image.Image, detector) -> Dict[str, Any]:
        """
        Uses MTCNN detector to locate face and 5 landmarks:
        landmarks: [[x, y] for left_eye, right_eye, nose, left_mouth, right_mouth]
        Computes normalized horizontal (yaw) and vertical (pitch) landmark ratios.
        """
        boxes, probs, landmarks = detector.detect(pil_image, landmarks=True)
        if boxes is None or len(boxes) == 0:
            raise ValueError("No face detected in frame.")

        if len(boxes) > 1:
            # Check if there is only 1 confident face or multiple
            confident = [b for i, b in enumerate(boxes) if probs[i] and probs[i] > 0.75]
            if len(confident) > 1:
                raise ValueError("Multiple faces detected in frame. Exactly one person must be present.")

        box = boxes[0]
        lm = landmarks[0] # (5, 2): [left_eye, right_eye, nose, left_mouth, right_mouth]
        
        le, re, nose, lm_corner, rm_corner = lm[0], lm[1], lm[2], lm[3], lm[4]

        # Horizontal yaw ratio: position of nose between left and right eyes
        # Note: In standard camera image: le is subject's right eye (viewer's left), re is subject's left eye (viewer's right)
        eye_width = float(re[0] - le[0])
        if eye_width < 1e-4:
            eye_width = 1.0

        yaw_ratio = float((nose[0] - le[0]) / eye_width)

        # Vertical pitch ratio: eye center to nose distance vs nose to mouth center distance
        eye_center_y = float((le[1] + re[1]) / 2.0)
        mouth_center_y = float((lm_corner[1] + rm_corner[1]) / 2.0)
        mouth_eye_dist = float(mouth_center_y - eye_center_y)
        if mouth_eye_dist < 1e-4:
            mouth_eye_dist = 1.0

        pitch_ratio = float((nose[1] - eye_center_y) / mouth_eye_dist)

        # Roll: angle between eyes in degrees
        dy = float(re[1] - le[1])
        dx = float(re[0] - le[0])
        roll_deg = float(np.degrees(np.arctan2(dy, dx)))

        return {
            "box": box,
            "landmarks": lm,
            "yaw_ratio": yaw_ratio,      # Neutral is ~0.45 - 0.55
            "pitch_ratio": pitch_ratio,  # Neutral is ~0.55 - 0.65
            "roll_deg": roll_deg
        }

    def verify_pose_requirement(self, pose_data: Dict[str, Any], expected_step: str) -> Tuple[bool, str]:
        """
        Verifies that pose_data matches the expected challenge step.
        """
        yaw = pose_data["yaw_ratio"]
        pitch = pose_data["pitch_ratio"]
        roll = abs(pose_data["roll_deg"])

        if roll > 24.0:
            return False, f"Head tilted too much sideways ({roll:.1f}°). Keep your head level."

        if expected_step == "look_straight":
            if 0.35 <= yaw <= 0.65 and 0.44 <= pitch <= 0.74:
                return True, "Valid straight pose."
            return False, f"Not looking straight (yaw={yaw:.2f}, pitch={pitch:.2f})."

        elif expected_step == "look_up":
            # Pitch ratio drops when looking up because nose moves closer to eye line
            if pitch <= 0.55:
                return True, "Valid look-up pose."
            return False, f"Head not tilted up enough (pitch={pitch:.2f}, expected <= 0.55)."

        elif expected_step == "turn_left":
            # Nose shifts to viewer's right or left depending on turn
            if yaw < 0.43 or yaw > 0.57:
                return True, "Valid left turn pose."
            return False, f"Head not turned left enough (yaw={yaw:.2f})."

        elif expected_step == "turn_right":
            if yaw < 0.43 or yaw > 0.57:
                return True, "Valid right turn pose."
            return False, f"Head not turned right enough (yaw={yaw:.2f})."

        elif expected_step == "look_down":
            # Pitch ratio increases when looking down because nose moves closer to mouth
            if pitch >= 0.63:
                return True, "Valid look-down pose."
            return False, f"Head not tilted down enough (pitch={pitch:.2f}, expected >= 0.63)."

        return False, f"Unknown step: {expected_step}"

    def verify_and_complete_enrollment(
        self,
        session_id: str,
        frames: Dict[str, str],
        client_metadata: Dict[str, Any],
        face_service
    ) -> Dict[str, Any]:
        """
        Orchestrates full server-side validation:
        1. Session freshness & validity.
        2. Presence of all 5 ordered frames.
        3. Image quality & passive anti-spoofing on each frame.
        4. Server-side pose verification for each frame.
        5. Parallax 3D head motion verification between left/right and up/down.
        6. Biometric identity consistency: 512-dim embedding similarity across all 5 frames.
        7. Multi-pose aggregated encrypted embedding generation.
        """
        self.cleanup_expired_sessions()
        session = self.sessions.get(session_id)
        if not session:
            raise ValueError("Enrollment session is invalid or has expired. Please restart face enrollment.")

        if session.get("consumed"):
            raise ValueError("Enrollment session has already been used. Please start a new enrollment.")

        now = time.time()
        if now > session["expires_at"]:
            raise ValueError("Enrollment session expired. Please restart.")

        required_steps = ["look_straight", "look_up", "turn_left", "turn_right", "look_down"]
        missing = [s for s in required_steps if not frames.get(s)]
        if missing:
            raise ValueError(f"Missing required challenge poses: {', '.join(missing)}")

        decoded_images: Dict[str, Tuple[Image.Image, np.ndarray]] = {}
        for step in required_steps:
            pil_img, np_img = self.decode_base64_image(frames[step])
            decoded_images[step] = (pil_img, np_img)

        # 1. Quality & Anti-spoofing check per frame
        poses: Dict[str, Dict[str, Any]] = {}
        embeddings: Dict[str, List[float]] = {}

        for step in required_steps:
            pil_img, np_img = decoded_images[step]
            
            # Basic quality
            q_res = self.check_quality(np_img)
            if not q_res["valid"]:
                raise ValueError(f"Pose '{step}' failed quality check: {q_res['reason']}")

            # Detect face & pose via MTCNN
            try:
                pose_info = self.estimate_pose_mtcnn(pil_img, face_service.detector)
            except ValueError as ve:
                raise ValueError(f"Pose '{step}' face detection failed: {str(ve)}")

            # Passive anti-spoofing
            spoof_res = self.check_passive_anti_spoofing(np_img, pose_info["box"])
            if not spoof_res["valid"]:
                raise ValueError(f"Liveness / anti-spoofing check failed on '{step}': {'; '.join(spoof_res['reasons'])}")

            # Verify step pose orientation
            valid_pose, reason = self.verify_pose_requirement(pose_info, step)
            if not valid_pose:
                raise ValueError(f"Pose verification failed for '{step}': {reason}")

            poses[step] = pose_info

            # Extract 512-dim embedding
            emb = face_service.get_embedding(pil_img)
            embeddings[step] = emb

        # 2. Verify 3D Parallax & Head Movement
        # Ensure left and right yaw differ significantly
        yaw_left = poses["turn_left"]["yaw_ratio"]
        yaw_right = poses["turn_right"]["yaw_ratio"]
        yaw_delta = abs(yaw_left - yaw_right)
        if yaw_delta < 0.07:
            raise ValueError(f"Insufficient horizontal head rotation between left and right poses (delta={yaw_delta:.2f}). A static photo cannot be accepted.")

        # Ensure up and down pitch differ significantly
        pitch_up = poses["look_up"]["pitch_ratio"]
        pitch_down = poses["look_down"]["pitch_ratio"]
        pitch_delta = abs(pitch_down - pitch_up)
        if pitch_delta < 0.07:
            raise ValueError(f"Insufficient vertical head tilt between up and down poses (delta={pitch_delta:.2f}). A static photo cannot be accepted.")

        # 3. Multi-frame Identity Consistency Check
        # Compare straight embedding with all other 4 pose embeddings
        straight_emb = embeddings["look_straight"]
        for step in ["look_up", "turn_left", "turn_right", "look_down"]:
            sim = face_service.compare_embeddings(straight_emb, embeddings[step])
            if sim < 0.50:
                raise ValueError(f"Identity mismatch between 'look_straight' and '{step}' (similarity={sim:.2f} < 0.50). All 5 poses must be of the same person.")

        # 4. Compute aggregated multi-pose embedding (L2 normalized mean vector)
        all_embs = [embeddings[s] for s in required_steps]
        mean_emb = np.mean(all_embs, axis=0)
        norm = np.linalg.norm(mean_emb)
        if norm > 0:
            mean_emb = mean_emb / norm
        
        final_embedding_list = mean_emb.tolist()
        encrypted_embedding = crypto_service.encrypt_embedding(final_embedding_list)

        # 5. Create clean front-facing thumbnail from look_straight frame
        straight_pil = decoded_images["look_straight"][0]
        box = poses["look_straight"]["box"]
        # Crop square around face
        w, h = straight_pil.size
        bw = box[2] - box[0]
        bh = box[3] - box[1]
        cx = (box[0] + box[2]) / 2.0
        cy = (box[1] + box[3]) / 2.0
        size = max(bw, bh) * 1.35
        x1 = max(0, int(cx - size / 2.0))
        y1 = max(0, int(cy - size / 2.0))
        x2 = min(w, int(cx + size / 2.0))
        y2 = min(h, int(cy + size / 2.0))
        
        thumbnail_crop = straight_pil.crop((x1, y1, x2, y2)).resize((180, 180), Image.Resampling.LANCZOS)
        thumb_buffer = io.BytesIO()
        thumbnail_crop.save(thumb_buffer, format="JPEG", quality=88)
        thumbnail_base64 = f"data:image/jpeg;base64,{base64.b64encode(thumb_buffer.getvalue()).decode('utf-8')}"

        # Mark session as consumed
        session["consumed"] = True

        return {
            "success": True,
            "session_id": session_id,
            "encrypted_embedding": encrypted_embedding,
            "thumbnail_image": thumbnail_base64,
            "liveness_verified": True,
            "poses_completed": required_steps,
            "yaw_delta": float(yaw_delta),
            "pitch_delta": float(pitch_delta)
        }

liveness_service = LivenessService()
