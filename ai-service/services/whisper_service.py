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

def transcribe_audio_bytes(file_bytes: bytes, filename: str = "voice.webm", language: Optional[str] = None) -> tuple[str, str]:
    """
    Saves audio bytes to a temporary file and transcribes it using faster-whisper.
    Supports multilingual transcription for en, zh, ms, ta, bn, or automatic detection.
    """
    model = get_whisper_model()
    
    # Determine extension
    ext = os.path.splitext(filename)[1] or ".webm"
    
    # Map language if provided
    whisper_lang = None
    if language:
        l = str(language).lower().strip()
        if l in ['en', 'zh', 'ms', 'ta', 'bn']:
            whisper_lang = l
        elif 'chinese' in l or '中文' in l:
            whisper_lang = 'zh'
        elif 'malay' in l or 'melayu' in l:
            whisper_lang = 'ms'
        elif 'tamil' in l or 'தமிழ்' in l:
            whisper_lang = 'ta'
        elif 'bangla' in l or 'bengali' in l or 'বাংলা' in l:
            whisper_lang = 'bn'
        elif 'english' in l:
            whisper_lang = 'en'
    
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    temp_path = temp_file.name
    try:
        temp_file.write(file_bytes)
        temp_file.close()
        
        print(f"[WhisperService] Transcribing audio file ({len(file_bytes)} bytes, target_lang: {whisper_lang or 'auto'}): {temp_path}")
        if whisper_lang:
            segments, info = model.transcribe(temp_path, beam_size=5, language=whisper_lang)
        else:
            segments, info = model.transcribe(temp_path, beam_size=5)
        
        transcription = " ".join([segment.text for segment in segments]).strip()
        detected_language = info.language or whisper_lang or "en"
        print(f"[WhisperService] Result: \"{transcription}\" (detected_language: {detected_language}, probability: {info.language_probability:.2f})")
        return transcription, detected_language
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"[WhisperService] Warning: Could not remove temp file {temp_path}: {e}")
