import logging
from typing import Optional
from fastapi import APIRouter, File, UploadFile, Form, Query, HTTPException
from services.whisper_service import transcribe_audio_bytes

logger = logging.getLogger("TranscribeAPI")

router = APIRouter(prefix="/api/v1/transcribe", tags=["Audio Transcription"])

@router.post("")
@router.post("/")
async def transcribe_audio(
    file: UploadFile = File(None),
    audio_file: UploadFile = File(None),
    language: Optional[str] = Form(None),
    lang: Optional[str] = Query(None)
):
    """
    Transcribes uploaded audio file to text using faster-whisper.
    Accepts 'file' or 'audio_file' multipart form field, plus optional language via Form or Query.
    """
    target_file = file or audio_file
    if not target_file:
        raise HTTPException(status_code=400, detail="Audio file ('file' or 'audio_file') is required.")

    selected_language = language or lang

    try:
        content = await target_file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        filename = target_file.filename or "voice.webm"
        text, detected_language = transcribe_audio_bytes(content, filename, language=selected_language)
        return {
            "status": "success",
            "text": text,
            "detected_language": detected_language
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Transcribe API Error]: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
