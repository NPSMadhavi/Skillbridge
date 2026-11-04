import os
import sys
import time
import re
from typing import Dict, Any, List

sys.stdout.reconfigure(encoding='utf-8')

# Ensure ai-service root is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from services.whisper_service import transcribe_audio_bytes, get_whisper_model

AUDIO_DIR = os.path.join(BASE_DIR, "test_audio")

def calculate_wer(reference: str, hypothesis: str) -> float:
    ref_words = re.sub(r"[^\w\s]", "", reference.lower()).split()
    hyp_words = re.sub(r"[^\w\s]", "", hypothesis.lower()).split()
    if not ref_words:
        return 0.0 if not hyp_words else 1.0
    # Levenshtein distance on word level
    d = [[0] * (len(hyp_words) + 1) for _ in range(len(ref_words) + 1)]
    for i in range(len(ref_words) + 1):
        d[i][0] = i
    for j in range(len(hyp_words) + 1):
        d[0][j] = j
    for i in range(1, len(ref_words) + 1):
        for j in range(1, len(hyp_words) + 1):
            if ref_words[i - 1] == hyp_words[j - 1]:
                d[i][j] = d[i - 1][j - 1]
            else:
                d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + 1)
    return d[len(ref_words)][len(hyp_words)] / len(ref_words)

def run_test_item(category: str, filename: str, lang: str, ref: str) -> Dict[str, Any]:
    filepath = os.path.join(AUDIO_DIR, filename)
    if not os.path.exists(filepath):
        return {"category": category, "file": filename, "error": "file_not_found"}

    with open(filepath, "rb") as f:
        audio_bytes = f.read()

    start = time.time()
    hyp, detected_lang = transcribe_audio_bytes(audio_bytes, filename=filename, language=lang)
    elapsed = round(time.time() - start, 2)

    wer = calculate_wer(ref, hyp) if ref else (0.0 if not hyp else 1.0)

    return {
        "category": category,
        "file": filename,
        "ref": ref,
        "hyp": hyp,
        "detected_lang": detected_lang,
        "requested_lang": lang,
        "elapsed_sec": elapsed,
        "wer": round(wer, 3)
    }

def main():
    print("=" * 90)
    print("SKILLBRIDGE AI TUTOR (ARIA) — COMPREHENSIVE WHISPER VALIDATION SUITE")
    print("=" * 90)

    # Pre-warm model
    print("[Suite] Warming up Whisper model...")
    get_whisper_model()
    print("[Suite] Model ready.\n")

    results: List[Dict[str, Any]] = []

    # 1. Normal English conversation
    print(">>> 1. Testing Normal English Conversation...")
    results.append(run_test_item("1. Normal English", "en_normal_1.mp3", "en", "Hello Aria, what is machine learning?"))
    results.append(run_test_item("1. Normal English", "en_normal_2.mp3", "en", "Can you explain how neural networks work?"))

    # 2. Slow and fast English speech
    print(">>> 2. Testing Slow and Fast English Speech...")
    results.append(run_test_item("2. Fast Speech", "en_fast.mp3", "en", "Could you quickly summarize the main points of this lecture?"))
    results.append(run_test_item("2. Slow Speech", "en_slow.mp3", "en", "Please explain the concept of recursion step by step."))

    # 3. Short questions and long sentences
    print(">>> 3. Testing Short Questions and Long Sentences...")
    results.append(run_test_item("3. Short Question", "en_sapi_short.wav", "en", "What is Python?"))
    results.append(run_test_item("3. Long Sentence", "en_slow.mp3", "en", "Please explain the concept of recursion step by step."))

    # 4. Quiet speech and background noise
    print(">>> 4. Testing Quiet Speech and Background Noise...")
    results.append(run_test_item("4. Quiet Speech + Noise", "en_quiet_noise.wav", "en", "Hello Aria, what is machine learning?"))

    # 5. English with pauses
    print(">>> 5. Testing English with Mid-Sentence Pauses...")
    results.append(run_test_item("5. Speech with Pauses", "en_pause_speech.wav", "en", "Hey Aria, what is a variable? What is Python?"))

    # 6. Multilingual speech (zh, ms, ta, bn, te)
    print(">>> 6. Testing Multilingual Speech (Chinese, Malay, Tamil, Bengali, Telugu)...")
    results.append(run_test_item("6. Chinese (zh)", "zh_question.mp3", "zh", "你好阿莉娅，什么是监督学习？"))
    results.append(run_test_item("6. Malay (ms)", "ms_question.mp3", "ms", "Hai Aria, bolehkah anda terangkan maksud kecerdasan buatan?"))
    results.append(run_test_item("6. Tamil (ta)", "ta_question.mp3", "ta", "வணக்கம் ஆரியா, பைதான் என்றால் என்ன?"))
    results.append(run_test_item("6. Bengali (bn)", "bn_question.mp3", "bn", "নমস্কার আরিয়া, মেশিন লার্নিং কী?"))
    results.append(run_test_item("6. Telugu (te)", "te_question.mp3", "te", "నమస్కారం ఆరియా, కృత్రిమ మేధస్సు అంటే ఏమిటి?"))

    # 7. Silence and background noise without speech (Expectation: empty output "")
    print(">>> 7. Testing Silence and Non-Speech Background Noise...")
    results.append(run_test_item("7. Pure Silence", "silence_3s.wav", None, ""))
    results.append(run_test_item("7. Ambient Room Noise", "noise_ambient_3s.wav", None, ""))
    results.append(run_test_item("7. 60Hz Electrical Hum", "hum_60hz_3s.wav", None, ""))

    # 8. Multiple consecutive questions (Verifying state isolation)
    print(">>> 8. Testing Multiple Consecutive Questions...")
    for i, q in enumerate(["en_normal_1.mp3", "en_normal_2.mp3", "en_sapi_short.wav"], 1):
        results.append(run_test_item(f"8. Consecutive Q{i}", q, "en", 
            "Hello Aria, what is machine learning?" if "normal_1" in q else
            ("Can you explain how neural networks work?" if "normal_2" in q else "What is Python?")
        ))

    # 9. Wake-word activation followed by a question
    print(">>> 9. Testing Wake-word Activation Followed by Question...")
    wake_res = run_test_item("9. Wake + Question", "en_wake_question.mp3", "en", "Hey Aria, what is a variable?")
    results.append(wake_res)
    # Validate wake word presence in transcription
    wake_found = bool(re.search(r"\b(?:hey|hi|hello)\s+aria\b", wake_res["hyp"], re.I))
    print(f"   [Wake Check] Found 'Hey Aria' in transcript: {wake_found} (Hyp: \"{wake_res['hyp']}\")")

    # 10. Follow-up question during ARIA interaction
    print(">>> 10. Testing Follow-up Interaction Question...")
    results.append(run_test_item("10. Follow-up Question", "en_normal_2.mp3", "en", "Can you explain how neural networks work?"))

    # Print summary table
    print("\n" + "=" * 90)
    print(f"{'Category':<24} | {'File':<20} | {'Lang':<5} | {'Sec':<5} | {'WER':<5} | {'Result':<10}")
    print("-" * 90)
    
    total_wer = 0.0
    speech_count = 0
    for r in results:
        status = "PASS" if (r["wer"] <= 0.35 if r["ref"] else r["hyp"] == "") else "REVIEW"
        print(f"{r['category']:<24} | {r['file']:<20} | {r['detected_lang']:<5} | {r['elapsed_sec']:<5.1f} | {r['wer']:<5.2f} | {status:<10}")
        if r["ref"]:
            total_wer += r["wer"]
            speech_count += 1
            
    avg_wer = (total_wer / speech_count) if speech_count else 0.0
    print("=" * 90)
    print(f"Average Word Error Rate (WER) across speech test cases: {avg_wer:.3f} ({avg_wer*100:.1f}%)")
    print(f"Total test cases executed: {len(results)}")
    print("=" * 90)

if __name__ == "__main__":
    main()

