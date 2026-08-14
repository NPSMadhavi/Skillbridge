import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api.face import router as face_router
from api.transcribe import router as transcribe_router
from services.face_service import get_face_service

app = FastAPI(
    title="SkillBridge AI Service",
    description="Python microservice for face biometrics and Whisper speech transcription",
    version="1.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(face_router)
app.include_router(transcribe_router)

@app.on_event("startup")
def startup_event():
    print("Warming up Face ID Models (MTCNN + FaceNet) during startup...")
    try:
        get_face_service()
        print("Model warming complete. Ready for biometric requests.")
    except Exception as e:
        print(f"CRITICAL: Failed to load Face ID Models: {str(e)}")

@app.get("/")
def read_root():
    return {"status": "online", "message": "SkillBridge AI Microservice is running."}

if __name__ == "__main__":
    import os
    from config.settings import settings
    port = int(os.environ.get("PORT", settings.PORT))
    # Bind to all interfaces (0.0.0.0) for containerization / network access
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
