import json
import sys
import time

from tools.transcription_tools import transcribe_audio

started = time.perf_counter()
result = transcribe_audio(sys.argv[1])
print(json.dumps(result, ensure_ascii=False, default=str))
print(f"STT_SECONDS={time.perf_counter() - started:.3f}")
