from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Any, Dict, List
from services.face_service import get_face_service
from services.liveness_service import liveness_service

router = APIRouter(prefix="/api/v1/face", tags=["Face ID"])

# Request/Response schemas
class FaceRegisterRequest(BaseModel):
    image_base64: str | None = None
    images_base64: list[str] | None = None

class FaceRegisterResponse(BaseModel):
    encrypted_embedding: str

class Candidate(BaseModel):
    id: str
    encrypted_embedding: str

class FaceVerifyRequest(BaseModel):
    query_image: str | None = None
    query_images: list[str] | None = None
    candidates: list[Candidate]

class FaceVerifyResponse(BaseModel):
    matched: bool
    user_id: str | None
    confidence: float

class EnrollmentStartResponse(BaseModel):
    session_id: str
    expires_at: float
    steps: List[str]
    nonce: str

class EnrollmentCompleteRequest(BaseModel):
    session_id: str
    frames: Dict[str, str]
    metadata: Dict[str, Any] = {}

class EnrollmentCompleteResponse(BaseModel):
    success: bool
    session_id: str
    encrypted_embedding: str
    thumbnail_image: str
    liveness_verified: bool
    poses_completed: List[str]
    yaw_delta: float
    pitch_delta: float

@router.post("/enrollment/start", response_model=EnrollmentStartResponse)
def start_face_enrollment():
    try:
        session = liveness_service.start_session()
        return EnrollmentStartResponse(**session)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start enrollment session: {str(e)}")

@router.post("/enrollment/complete", response_model=EnrollmentCompleteResponse)
def complete_face_enrollment(payload: EnrollmentCompleteRequest, face_svc = Depends(get_face_service)):
    try:
        result = liveness_service.verify_and_complete_enrollment(
            session_id=payload.session_id,
            frames=payload.frames,
            client_metadata=payload.metadata,
            face_service=face_svc
        )
        return EnrollmentCompleteResponse(**result)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Face enrollment verification failed: {str(e)}")

@router.post("/register", response_model=FaceRegisterResponse)
def register_face(payload: FaceRegisterRequest, face_svc = Depends(get_face_service)):
    try:
        if payload.images_base64 and len(payload.images_base64) > 0:
            encrypted_emb = face_svc.register_multiple_faces(payload.images_base64)
        elif payload.image_base64:
            encrypted_emb = face_svc.register_face(payload.image_base64)
        else:
            raise HTTPException(status_code=400, detail="Either image_base64 or images_base64 list must be provided.")
        return FaceRegisterResponse(encrypted_embedding=encrypted_emb)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Registration biometric processing failed: {str(e)}")

@router.post("/verify", response_model=FaceVerifyResponse)
def verify_face(payload: FaceVerifyRequest, face_svc = Depends(get_face_service)):
    try:
        cand_list = [c.model_dump() for c in payload.candidates]
        result = face_svc.verify_face(
            query_image_base64=payload.query_image,
            candidates=cand_list,
            query_images_base64=payload.query_images
        )
        return FaceVerifyResponse(
            matched=result["matched"],
            user_id=result["user_id"],
            confidence=result["confidence"]
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Biometric verification failed: {str(e)}")

