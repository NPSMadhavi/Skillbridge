from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from services.face_service import get_face_service

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
    query_image: str
    candidates: list[Candidate]

class FaceVerifyResponse(BaseModel):
    matched: bool
    user_id: str | None
    confidence: float

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
        result = face_svc.verify_face(payload.query_image, cand_list)
        return FaceVerifyResponse(
            matched=result["matched"],
            user_id=result["user_id"],
            confidence=result["confidence"]
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Biometric verification failed: {str(e)}")
