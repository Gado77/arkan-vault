import sys
import time

from tools.transcription_tools import transcribe_audio, warm_groq_stt_connection

warm_started = time.perf_counter()
warm_groq_stt_connection()
print(f"WARMUP_SECONDS={time.perf_counter() - warm_started:.3f}")

for run in range(1, 5):
    started = time.perf_counter()
    result = transcribe_audio(sys.argv[1])
    elapsed = time.perf_counter() - started
    print(
        f"RUN={run} SECONDS={elapsed:.3f} SUCCESS={result.get('success')} "
        f"TEXT={result.get('transcript', '')}"
    )
