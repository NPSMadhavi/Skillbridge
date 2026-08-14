import os
import tempfile
from typing import Optional

_whisper_model = None

def get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        print("[WhisperService] Initializing faster-whisper Model ('base' on CPU, int8)...")
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
        print("[WhisperService] Model loaded successfully.")
    return _whisper_model

def transcribe_audio_bytes(file_bytes: bytes, filename: str = "voice.webm") -> str:
    """
    Saves audio bytes to a temporary file and transcribes it using faster-whisper.
    """
    model = get_whisper_model()
    
    # Determine extension
    ext = os.path.splitext(filename)[1] or ".webm"
    
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    temp_path = temp_file.name
    try:
        temp_file.write(file_bytes)
        temp_file.close()
        
        print(f"[WhisperService] Transcribing audio file ({len(file_bytes)} bytes): {temp_path}")
        segments, info = model.transcribe(temp_path, beam_size=5)
        
        transcription = " ".join([segment.text for segment in segments]).strip()
        print(f"[WhisperService] Result: \"{transcription}\" (language: {info.language}, probability: {info.language_probability:.2f})")
        return transcription
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"[WhisperService] Warning: Could not remove temp file {temp_path}: {e}")
