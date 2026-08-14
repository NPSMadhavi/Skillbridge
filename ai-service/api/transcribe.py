from fastapi import APIRouter, File, UploadFile, HTTPException
from services.whisper_service import transcribe_audio_bytes

router = APIRouter(prefix="/api/v1/transcribe", tags=["Audio Transcription"])

@router.post("")
@router.post("/")
async def transcribe_audio(file: UploadFile = File(None), audio_file: UploadFile = File(None)):
    """
    Transcribes uploaded audio file to text using faster-whisper.
    Accepts 'file' or 'audio_file' form field for maximum compatibility.
    """
    target_file = file or audio_file
    if not target_file:
        raise HTTPException(status_code=400, detail="Audio file ('file' or 'audio_file') is required.")
        
    try:
        content = await target_file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
            
        filename = target_file.filename or "voice.webm"
        text = transcribe_audio_bytes(content, filename)
        return {"status": "success", "text": text}
    except Exception as e:
        print(f"[Transcribe API Error]: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
