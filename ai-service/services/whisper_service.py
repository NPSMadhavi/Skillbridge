import io
import os
import re
import time
from typing import Optional, Tuple
import numpy as np

_whisper_model = None
_loaded_model_size = None

# Language-specific contextual prompts for ARIA AI Tutor domain
LANGUAGE_PROMPTS = {
    "en": "Hello Aria, questions and answers about course lessons and concepts.",
    "zh": "你好阿莉娅，关于课程和概念的学习问答。",
    "ms": "Hai Aria, soalan dan jawapan tentang pelajaran dan konsep kursus.",
    "ta": "வணக்கம் ஆரியா, பாடக் கேள்விகள் மற்றும் விளக்கங்கள்.",
    "bn": "নমস্কার আরিয়া, পাঠ সম্পর্কিত প্রশ্ন ও উত্তর।",
    "te": "నమస్కారం ఆరియా, పాఠ్యాంశాల ప్రశ్నలు మరియు వివరణలు.",
}

# Known non-speech tokens and subtitle hallucinations produced by Whisper on silence
HALLUCINATION_PATTERNS = [
    re.compile(r"^\s*\[?(?:blank[ _]audio|silence|applause|music|laughter)\]?\s*$", re.I),
    re.compile(r"^\s*(?:thank(?:s|\s+you)\s+for\s+watching|see\s+you\s+(?:in\s+the\s+)?next\s+(?:video|time)|like\s+and\s+subscribe|subscribe\s+to\s+(?:the\s+)?channel|subtitles\s+by)\b.*", re.I),
    re.compile(r"^\s*(?:thanks\s+for\s+listening|thank\s+you\s+very\s+much\s+for\s+watching)\.?\s*$", re.I),
]

def sniff_audio_format(data: bytes) -> str:
    """Detects audio container format from magic bytes."""
    if len(data) >= 4:
        if data[:4] == b"\x1a\x45\xdf\xa3":
            return "webm/mkv"
        if data[:4] == b"OggS":
            return "ogg"
        if data[:4] == b"RIFF" and len(data) >= 12 and data[8:12] == b"WAVE":
            return "wav"
        if data[:3] == b"ID3" or (data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
            return "mp3"
        if len(data) >= 8 and data[4:8] in (b"ftyp", b"moov"):
            return "mp4/m4a"
        if data[:4] == b"fLaC":
            return "flac"
    return "unknown"

def normalize_language_code(language: Optional[str]) -> Optional[str]:
    """Normalizes language name, BCP-47 tag, or ISO code to Whisper 2-letter code."""
    if not language:
        return None
    l = str(language).strip().lower()
    if l in ["en", "zh", "ms", "ta", "bn", "te"]:
        return l
    if l.startswith("en-") or "english" in l:
        return "en"
    if l.startswith("zh-") or "chinese" in l or "中文" in l or "mandarin" in l:
        return "zh"
    if l.startswith("ms-") or "malay" in l or "melayu" in l or "bahasa" in l:
        return "ms"
    if l.startswith("ta-") or "tamil" in l or "தமிழ்" in l:
        return "ta"
    if l.startswith("bn-") or "bangla" in l or "bengali" in l or "বাংলা" in l:
        return "bn"
    if l.startswith("te-") or "telugu" in l or "తెలుగు" in l:
        return "te"
    return None

def get_whisper_model(model_size: Optional[str] = None):
    """
    Initializes and caches the faster-whisper model.
    Defaults to 'small' on CPU int8 for superior multilingual accuracy without high latency.
    Falls back to 'base' if 'small' is unavailable.
    """
    global _whisper_model, _loaded_model_size
    target_size = model_size or os.environ.get("WHISPER_MODEL_SIZE", "small")

    if _whisper_model is not None and _loaded_model_size == target_size:
        return _whisper_model

    from faster_whisper import WhisperModel
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    cpu_threads = int(os.environ.get("WHISPER_CPU_THREADS", "4"))

    print(f"[WhisperService] Loading faster-whisper model '{target_size}' on {device.upper()} ({compute_type}, threads={cpu_threads})...")
    try:
        _whisper_model = WhisperModel(
            target_size,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
            num_workers=1
        )
        _loaded_model_size = target_size
        print(f"[WhisperService] Model '{target_size}' loaded successfully.")
    except Exception as e:
        print(f"[WhisperService] Notice: Failed to load '{target_size}' ({e}). Falling back to 'base'...")
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8", cpu_threads=cpu_threads)
        _loaded_model_size = "base"
        print("[WhisperService] Fallback 'base' model loaded successfully.")

    return _whisper_model

def preprocess_audio(file_bytes: bytes, filename: str = "voice.webm") -> Tuple[Optional[np.ndarray], dict]:
    """
    Decodes audio bytes in-memory and applies audio conditioning:
    - Format validation
    - In-memory decoding to 16kHz mono float32
    - DC offset removal
    - Energy calculation (RMS & peak)
    - Silence / dead mic detection
    - Peak-preserving gain normalization for quiet speech
    """
    from faster_whisper.audio import decode_audio

    meta = {
        "bytes": len(file_bytes),
        "sniffed_format": sniff_audio_format(file_bytes),
        "filename": filename,
        "duration_seconds": 0.0,
        "rms": 0.0,
        "peak": 0.0,
        "amplified": False,
        "gain": 1.0,
        "status": "ok"
    }

    if len(file_bytes) < 400:
        meta["status"] = "too_short_bytes"
        return None, meta

    # In-memory decoding using faster_whisper / PyAV
    try:
        audio = decode_audio(io.BytesIO(file_bytes), sampling_rate=16000)
    except Exception as e:
        # Retry with temporary file if BytesIO container probing failed for a niche format
        import tempfile
        ext = os.path.splitext(filename)[1] or ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tf:
            tf.write(file_bytes)
            tmp_path = tf.name
        try:
            audio = decode_audio(tmp_path, sampling_rate=16000)
        except Exception as tmp_err:
            meta["status"] = f"decode_error: {str(tmp_err)}"
            return None, meta
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    if audio is None or len(audio) == 0:
        meta["status"] = "empty_audio_frames"
        return None, meta

    # Check duration
    duration = len(audio) / 16000.0
    meta["duration_seconds"] = round(duration, 3)

    if duration < 0.35:
        meta["status"] = "too_short_duration"
        return None, meta

    # DC offset removal
    audio = audio - np.mean(audio)

    # RMS and peak amplitude calculation
    rms = float(np.sqrt(np.mean(audio ** 2)))
    peak = float(np.max(np.abs(audio)))
    meta["rms"] = round(rms, 5)
    meta["peak"] = round(peak, 5)

    # Dead mic / digital silence detection (RMS < 0.001 or Peak < 0.002)
    if rms < 0.001 or peak < 0.002:
        meta["status"] = "silence_detected"
        return None, meta

    # Gentle peak-preserving gain normalization for quiet microphones
    # Brings quiet speech (peak < 0.25) up to ~0.70 without clipping
    if peak > 0.005 and peak < 0.25:
        target_peak = 0.70
        gain = min(target_peak / (peak + 1e-6), 5.0)
        audio = audio * gain
        meta["amplified"] = True
        meta["gain"] = round(gain, 2)

    return audio, meta

def clean_hallucinations(text: str) -> str:
    """Removes non-speech tokens, subtitle loops, and silence artifacts."""
    if not text:
        return ""

    cleaned = text.strip()

    # Filter silence/token hallucinations
    for pattern in HALLUCINATION_PATTERNS:
        if pattern.search(cleaned):
            return ""

    # Detect repeating token / word loops (e.g., "Choco Choco Choco Choco")
    words = cleaned.split()
    if len(words) >= 4:
        # Check for 1-word repeated 3+ times consecutively
        for i in range(len(words) - 2):
            if words[i].lower() == words[i + 1].lower() == words[i + 2].lower():
                # Loop detected — deduplicate the repetitive run
                deduped = []
                last_w = None
                repeat_count = 0
                for w in words:
                    w_lower = w.lower()
                    if w_lower == last_w:
                        repeat_count += 1
                        if repeat_count < 2:
                            deduped.append(w)
                    else:
                        deduped.append(w)
                        last_w = w_lower
                        repeat_count = 0
                cleaned = " ".join(deduped).strip()
                break

    # Repeated sentence loops (Whisper loop bug from ambient background hum)
    sentences = [s.strip() for s in re.split(r"[.!?]+", cleaned) if len(s.strip()) > 5]
    if len(sentences) >= 2 and len(set(sentences)) == 1:
        # Same sentence repeated multiple times — return just one instance
        cleaned = sentences[0]
    elif len(sentences) >= 4 and len(set(sentences)) <= 2:
        cleaned = sentences[0]

    return cleaned

def transcribe_audio_bytes(
    file_bytes: bytes,
    filename: str = "voice.webm",
    language: Optional[str] = None
) -> Tuple[str, str]:
    """
    Decodes and transcribes audio bytes using faster-whisper.
    Applies audio preprocessing, Silero VAD, repetition penalties, and beam search.
    Returns (transcription_text, detected_language).
    """
    target_lang = normalize_language_code(language)

    # 1. Audio Preprocessing
    audio_array, meta = preprocess_audio(file_bytes, filename)
    if audio_array is None:
        print(f"[WhisperService] Preprocessing rejected audio: status='{meta['status']}', format={meta['sniffed_format']}, duration={meta['duration_seconds']}s, rms={meta['rms']}")
        return "", target_lang or "en"

    # 2. Get Model
    model = get_whisper_model()

    # 3. Silero VAD configuration
    vad_parameters = dict(
        threshold=0.40,
        min_speech_duration_ms=100,
        min_silence_duration_ms=400,
        speech_pad_ms=300
    )

    # 4. Contextual initial prompt for ARIA domain and target script
    prompt = LANGUAGE_PROMPTS.get(target_lang)

    # 5. Transcription parameters
    transcribe_kwargs = dict(
        beam_size=5,
        best_of=5,
        vad_filter=True,
        vad_parameters=vad_parameters,
        repetition_penalty=1.2,
        no_repeat_ngram_size=3,
        condition_on_previous_text=False,
        no_speech_threshold=0.6,
        compression_ratio_threshold=2.4,
        hallucination_silence_threshold=2.0,
    )
    if prompt:
        transcribe_kwargs["initial_prompt"] = prompt
    if target_lang:
        transcribe_kwargs["language"] = target_lang

    start_time = time.time()
    try:
        segments, info = model.transcribe(audio_array, **transcribe_kwargs)
        raw_text = " ".join([segment.text for segment in segments]).strip()
        detected_language = info.language or target_lang or "en"
        lang_prob = round(getattr(info, "language_probability", 1.0), 3)
    except Exception as err:
        print(f"[WhisperService] Transcription inference error: {err}")
        return "", target_lang or "en"

    inference_time = round(time.time() - start_time, 2)

    # 6. Post-processing clean-up (repetition loop reduction, non-speech token stripping)
    final_text = clean_hallucinations(raw_text)

    print(
        f"[WhisperService] Done in {inference_time}s | Model: '{_loaded_model_size}' | "
        f"Audio: {meta['duration_seconds']}s ({meta['sniffed_format']}, rms={meta['rms']}) | "
        f"Lang: {detected_language} (prob: {lang_prob}, requested: {target_lang or 'auto'}) | "
        f"Output: \"{final_text}\""
    )

    return final_text, detected_language
