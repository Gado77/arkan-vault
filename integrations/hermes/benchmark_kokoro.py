"""Benchmark Kokoro Portuguese TTS on the target Linux host."""

from __future__ import annotations

import resource
import time

import numpy as np
import soundfile as sf
from kokoro import KPipeline


TEXT = (
    "Olá, Vitor. Este é um teste de velocidade da voz do assistente Hermes, "
    "conectado à memória do Arkan Vault."
)
SAMPLE_RATE = 24_000


def generate(pipeline: KPipeline, output_path: str, run: int) -> None:
    started = time.perf_counter()
    chunks: list[np.ndarray] = []
    for _graphemes, _phonemes, audio in pipeline(
        TEXT,
        voice="pf_dora",
        speed=1.0,
    ):
        chunks.append(np.asarray(audio, dtype=np.float32))

    waveform = np.concatenate(chunks)
    elapsed = time.perf_counter() - started
    duration = len(waveform) / SAMPLE_RATE
    sf.write(output_path, waveform, SAMPLE_RATE)
    peak_ram_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(
        f"RUN={run} GENERATION_SECONDS={elapsed:.3f} "
        f"AUDIO_SECONDS={duration:.3f} RTF={elapsed / duration:.3f} "
        f"PEAK_RAM_MB={peak_ram_mb:.0f} OUTPUT={output_path}",
        flush=True,
    )


def main() -> None:
    init_started = time.perf_counter()
    pipeline = KPipeline(lang_code="p")
    print(f"PIPELINE_INIT_SECONDS={time.perf_counter() - init_started:.3f}", flush=True)
    generate(pipeline, "/home/vitor/kokoro-test-first.wav", 1)
    generate(pipeline, "/home/vitor/kokoro-test-warm.wav", 2)


if __name__ == "__main__":
    main()
