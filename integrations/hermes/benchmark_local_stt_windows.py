import sys
import time

from faster_whisper import WhisperModel

audio_path = sys.argv[1]
model_name = sys.argv[2] if len(sys.argv) > 2 else "small"
started = time.perf_counter()
device = sys.argv[3] if len(sys.argv) > 3 else "cpu"
compute_type = "float16" if device == "cuda" else "int8"
model = WhisperModel(model_name, device=device, compute_type=compute_type)
loaded = time.perf_counter()

for run in range(1, 4):
    begin = time.perf_counter()
    segments, info = model.transcribe(
        audio_path,
        language="pt",
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    elapsed = time.perf_counter() - begin
    print(f"RUN={run} STT_SECONDS={elapsed:.3f} TEXT={text}")

print(f"MODEL_LOAD_SECONDS={loaded - started:.3f} MODEL={model_name} DEVICE={device}")
