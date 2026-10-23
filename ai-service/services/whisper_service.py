import os
import re
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
        if l in ['en', 'zh', 'ms', 'ta', 'bn', 'te']:
            whisper_lang = l
        elif 'chinese' in l or '中文' in l:
            whisper_lang = 'zh'
        elif 'malay' in l or 'melayu' in l:
            whisper_lang = 'ms'
        elif 'tamil' in l or 'தமிழ்' in l:
            whisper_lang = 'ta'
        elif 'bangla' in l or 'bengali' in l or 'বাংলা' in l:
            whisper_lang = 'bn'
        elif 'telugu' in l or 'తెలుగు' in l:
            whisper_lang = 'te'
        elif 'english' in l:
            whisper_lang = 'en'
    
    if len(file_bytes) < 500:
        return "", whisper_lang or "en"

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    temp_path = temp_file.name
    try:
        temp_file.write(file_bytes)
        temp_file.close()
        
        print(f"[WhisperService] Transcribing audio file ({len(file_bytes)} bytes, target_lang: {whisper_lang or 'auto'}): {temp_path}")
        try:
            # Softer VAD: strict no_speech was returning "" for valid short questions
            transcribe_kwargs = dict(
                beam_size=1,
                best_of=1,
                vad_filter=False,
                condition_on_previous_text=False,
                no_speech_threshold=0.45,
                compression_ratio_threshold=2.6,
            )
            if whisper_lang:
                segments, info = model.transcribe(temp_path, language=whisper_lang, **transcribe_kwargs)
            else:
                segments, info = model.transcribe(temp_path, **transcribe_kwargs)
            
            transcription = " ".join([segment.text for segment in segments]).strip()
            detected_language = info.language or whisper_lang or "en"
        except Exception as decode_err:
            print(f"[WhisperService] Audio decoding notice: {decode_err}. Returning empty text.")
            return "", whisper_lang or "en"

        # Suppress known exact Whisper silence/repetition hallucinations.
        # Greeting-only outputs ("hey", "hi") must not wake the tutor.
        exact_hallucinations = {
            "thank you", "thank you.", "thanks for watching", "thank you for watching",
            "see you next time", "see you in the next video", "see you later",
            "subtitles by", "like and subscribe", "subscribe", "subtitles",
            "you", "bye", "goodbye",
            "hey", "hi", "hello", "hai", "helo", "yo", "ok", "okay", "yes", "yeah",
            "heria", "hearia", "haria",  # common mis-hearings of "hey"
            "thank you very much", "you are very welcome", "youre very welcome",
            "i hope you have a nice day", "i think its done now right",
        }
        clean_lower = transcription.lower().strip().replace(".", "").replace("!", "").replace(",", "").replace("?", "").strip()
        if clean_lower in exact_hallucinations:
            print(f"[WhisperService] Suppressed silence/greeting hallucination: \"{transcription}\"")
            transcription = ""

        # Repeated-sentence Whisper loops from ambient noise
        parts = [p.strip() for p in re.split(r"[.!?]+", clean_lower) if len(p.strip()) > 8]
        if len(parts) >= 2 and len(set(parts)) == 1:
            print(f"[WhisperService] Suppressed repeated-sentence hallucination: \"{transcription}\"")
            transcription = ""
        elif len(parts) >= 3 and len(set(parts)) <= 2:
            print(f"[WhisperService] Suppressed low-variety sentence loop: \"{transcription}\"")
            transcription = ""

        print(f"[WhisperService] Result: \"{transcription}\" (detected_language: {detected_language}, probability: {info.language_probability:.2f})")
        return transcription, detected_language
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception as e:
                print(f"[WhisperService] Warning: Could not remove temp file {temp_path}: {e}")
