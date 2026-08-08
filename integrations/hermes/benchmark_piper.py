"""Benchmark Piper Brazilian Portuguese TTS on the target Linux host."""

from __future__ import annotations

import resource
import time
import wave

from piper import PiperVoice


MODEL = "/home/vitor/.local/share/piper/voices/pt_BR-faber-medium.onnx"
TEXT = (
    "Olá, Vitor. Este é um teste de velocidade da voz do assistente Hermes, "
    "conectado à memória do Arkan Vault."
)


def generate(voice: PiperVoice, output_path: str, run: int) -> None:
    started = time.perf_counter()
    with wave.open(output_path, "wb") as wav_file:
        voice.synthesize_wav(TEXT, wav_file)
    elapsed = time.perf_counter() - started

    with wave.open(output_path, "rb") as wav_file:
        duration = wav_file.getnframes() / wav_file.getframerate()

    peak_ram_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(
        f"RUN={run} GENERATION_SECONDS={elapsed:.3f} "
        f"AUDIO_SECONDS={duration:.3f} RTF={elapsed / duration:.3f} "
        f"PEAK_RAM_MB={peak_ram_mb:.0f} OUTPUT={output_path}",
        flush=True,
    )


def main() -> None:
    init_started = time.perf_counter()
    voice = PiperVoice.load(MODEL)
    print(f"PIPELINE_INIT_SECONDS={time.perf_counter() - init_started:.3f}", flush=True)
    generate(voice, "/home/vitor/piper-test-first.wav", 1)
    generate(voice, "/home/vitor/piper-test-warm.wav", 2)


if __name__ == "__main__":
    main()
