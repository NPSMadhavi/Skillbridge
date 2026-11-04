import asyncio
import os
import wave
import numpy as np
import edge_tts

AUDIO_DIR = os.path.join(os.path.dirname(__file__), "test_audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

TEST_CASES = [
    # 1. Normal English conversation / questions
    ("en_normal_1.mp3", "en-US-JennyNeural", "Hello Aria, what is machine learning?"),
    ("en_normal_2.mp3", "en-US-GuyNeural", "Can you explain how neural networks work?"),
    
    # 2. Fast and slow English speech
    ("en_fast.mp3", "en-US-JennyNeural", "Could you quickly summarize the main points of this lecture?", "+30%"),
    ("en_slow.mp3", "en-US-JennyNeural", "Please explain the concept of recursion step by step.", "-25%"),

    # 3. Short question & wake word
    ("en_wake_question.mp3", "en-US-JennyNeural", "Hey Aria, what is a variable?"),
    ("en_short.mp3", "en-US-JennyNeural", "What is Python?"),

    # 4. Multilingual speech
    # Chinese
    ("zh_question.mp3", "zh-CN-XiaoxiaoNeural", "你好阿莉娅，什么是监督学习？"),
    # Malay
    ("ms_question.mp3", "ms-MY-YasminNeural", "Hai Aria, bolehkah anda terangkan maksud kecerdasan buatan?"),
    # Tamil
    ("ta_question.mp3", "ta-IN-PallaviNeural", "வணக்கம் ஆரியா, பைதான் என்றால் என்ன?"),
    # Bengali
    ("bn_question.mp3", "bn-BD-NabanitaNeural", "নমস্কার আরিয়া, মেশিন লার্নিং কী?"),
    # Telugu
    ("te_question.mp3", "te-IN-ShrutiNeural", "నమస్కారం ఆరియా, కృత్రిమ మేధస్సు అంటే ఏమిటి?"),
]

async def generate_speech_samples():
    print("[AudioGen] Generating speech test samples with edge-tts...")
    for item in TEST_CASES:
        filename, voice, text = item[0], item[1], item[2]
        rate = item[3] if len(item) > 3 else "+0%"
        filepath = os.path.join(AUDIO_DIR, filename)
        if not os.path.exists(filepath):
            print(f"Generating {filename} ({voice}, rate={rate}): \"{text}\"")
            communicate = edge_tts.Communicate(text, voice, rate=rate)
            await communicate.save(filepath)
    print("[AudioGen] Speech samples generated.")

def generate_synthetic_samples():
    print("[AudioGen] Generating synthetic audio samples (silence, noise, quiet speech)...")
    sample_rate = 16000
    
    # 1. Pure silence (3.0 seconds)
    silence_path = os.path.join(AUDIO_DIR, "silence_3s.wav")
    if not os.path.exists(silence_path):
        silence_data = np.zeros(sample_rate * 3, dtype=np.int16)
        with wave.open(silence_path, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(silence_data.tobytes())
            
    # 2. Ambient room hiss / white noise (3.0 seconds, RMS ~ 0.01)
    noise_path = os.path.join(AUDIO_DIR, "noise_ambient_3s.wav")
    if not os.path.exists(noise_path):
        noise = (np.random.normal(0, 0.015, sample_rate * 3) * 32767).astype(np.int16)
        with wave.open(noise_path, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(noise.tobytes())

    # 3. Low hum / microphone buzz (60Hz hum + noise, 3.0s)
    hum_path = os.path.join(AUDIO_DIR, "hum_60hz_3s.wav")
    if not os.path.exists(hum_path):
        t = np.linspace(0, 3, sample_rate * 3, endpoint=False)
        hum = 0.02 * np.sin(2 * np.pi * 60 * t) + np.random.normal(0, 0.005, sample_rate * 3)
        hum_data = (hum * 32767).astype(np.int16)
        with wave.open(hum_path, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(hum_data.tobytes())

    print("[AudioGen] Synthetic samples generated.")

if __name__ == "__main__":
    generate_synthetic_samples()
    asyncio.run(generate_speech_samples())

