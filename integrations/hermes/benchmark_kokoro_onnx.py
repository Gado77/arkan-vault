"""Benchmark quantized Kokoro ONNX with the Brazilian Portuguese voice."""

from __future__ import annotations

import resource
import time

import soundfile as sf
from kokoro_onnx import Kokoro


MODEL = "/home/vitor/.local/share/kokoro-onnx/kokoro-v1.0.int8.onnx"
VOICES = "/home/vitor/.local/share/kokoro-onnx/voices-v1.0.bin"
TEXT = (
    "Escute principalmente a amostra do Kokoro. Se a qualidade estiver "
    "aceitável, o próximo passo é instalar o Hermes no Linux e configurá-lo "
    "com essa voz."
)


def generate(kokoro: Kokoro, path: str, run: int) -> None:
    started = time.perf_counter()
    samples, sample_rate = kokoro.create(
        TEXT,
        voice="pf_dora",
        speed=1.0,
        lang="pt-br",
    )
    elapsed = time.perf_counter() - started
    duration = len(samples) / sample_rate
    sf.write(path, samples, sample_rate)
    peak_ram_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(
        f"RUN={run} GENERATION_SECONDS={elapsed:.3f} AUDIO_SECONDS={duration:.3f} "
        f"RTF={elapsed / duration:.3f} PEAK_RAM_MB={peak_ram_mb:.0f} OUTPUT={path}",
        flush=True,
    )


def main() -> None:
    started = time.perf_counter()
    kokoro = Kokoro(MODEL, VOICES)
    print(f"PIPELINE_INIT_SECONDS={time.perf_counter() - started:.3f}", flush=True)
    generate(kokoro, "/home/vitor/kokoro-onnx-first.wav", 1)
    generate(kokoro, "/home/vitor/kokoro-onnx-warm.wav", 2)


if __name__ == "__main__":
    main()
