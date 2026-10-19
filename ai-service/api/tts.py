import asyncio
import io
import edge_tts
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

VOICE_MAP = {
    # English
    "FEMALE_JENNY": "en-US-JennyNeural",
    "FEMALE_AVA": "en-US-AvaNeural",
    "MALE_GUY": "en-US-GuyNeural",
    "MALE_CHRISTOPHER": "en-US-ChristopherNeural",
    "FEMALE": "en-US-JennyNeural",
    "MALE": "en-US-GuyNeural",
    
    # Multilingual support
    "zh": "zh-CN-XiaoxiaoNeural",
    "ms": "ms-MY-YasminNeural",
    "ta": "ta-IN-PallaviNeural",
    "bn": "bn-BD-NabanitaNeural",
    "te": "te-IN-ShrutiNeural",
}

class TtsRequest(BaseModel):
    text: str
    voice: Optional[str] = "en-US-JennyNeural"
    gender: Optional[str] = "FEMALE"
    rate: Optional[float] = 1.0
    pitch: Optional[float] = 1.0

def resolve_voice(voice_name: Optional[str], gender: Optional[str]) -> str:
    if voice_name:
        v_upper = voice_name.upper().strip()
        if v_upper in VOICE_MAP:
            return VOICE_MAP[v_upper]
        if "neural" in voice_name.lower():
            return voice_name
        if "male" in v_upper:
            return "en-US-GuyNeural"
        if "female" in v_upper:
            return "en-US-JennyNeural"
            
    g_upper = (gender or "FEMALE").upper().strip()
    return "en-US-GuyNeural" if g_upper == "MALE" else "en-US-JennyNeural"

def format_rate(rate: float) -> str:
    # edge-tts expects e.g. "+10%", "-5%", "+0%"
    pct = int(round((rate - 1.0) * 100))
    return f"{pct:+d}%"

def format_pitch(pitch: float) -> str:
    # edge-tts expects e.g. "+0Hz", "+20Hz", "-15Hz"
    hz = int(round((pitch - 1.0) * 50))
    return f"{hz:+d}Hz"

@router.get("/speak")
async def speak_get(
    text: str = Query(..., description="Text to speak"),
    voice: Optional[str] = Query(None, description="Voice identifier"),
    gender: Optional[str] = Query("FEMALE", description="Voice gender (FEMALE or MALE)"),
    rate: Optional[float] = Query(1.0, description="Speech rate (0.8 - 1.3)"),
    pitch: Optional[float] = Query(1.0, description="Voice pitch (0.8 - 1.2)")
):
    clean_text = text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Text parameter cannot be empty.")
        
    selected_voice = resolve_voice(voice, gender)
    rate_str = format_rate(rate or 1.0)
    pitch_str = format_pitch(pitch or 1.0)
    
    try:
        communicate = edge_tts.Communicate(
            text=clean_text,
            voice=selected_voice,
            rate=rate_str,
            pitch=pitch_str
        )
        
        audio_stream = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_stream.write(chunk["data"])
                
        audio_bytes = audio_stream.getvalue()
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="Failed to synthesize audio stream.")
            
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": "inline; filename=speech.mp3",
                "Cache-Control": "public, max-age=86400",
                "X-Voice-Used": selected_voice
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS synthesis error: {str(e)}")

@router.post("/speak")
async def speak_post(req: TtsRequest):
    return await speak_get(
        text=req.text,
        voice=req.voice,
        gender=req.gender,
        rate=req.rate,
        pitch=req.pitch
    )
