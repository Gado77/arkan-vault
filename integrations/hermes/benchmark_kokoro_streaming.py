"""Measure clause-chunked Kokoro TTS as a producer/playback pipeline."""

from __future__ import annotations

import re
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline


TEXT = (
    "Escute principalmente a amostra do Kokoro. Se a qualidade estiver "
    "aceitável, o próximo passo é instalar o Hermes no Linux e configurá-lo "
    "com essa voz."
)
SAMPLE_RATE = 24_000
OUTPUT_DIR = Path("/home/vitor/kokoro-streaming")


def sentence_chunks(text: str) -> list[str]:
    return [part.strip() for part in re.findall(r"[^.!?]+[.!?]?", text) if part.strip()]


def bounded_chunks(text: str, max_words: int) -> list[str]:
    chunks: list[str] = []
    for sentence in sentence_chunks(text):
        words = sentence.split()
        while len(words) > max_words:
            cut = max_words
            # Prefer a natural punctuation boundary near the target size.
            for index in range(max_words - 1, 2, -1):
                if words[index - 1].endswith((",", ";", ":")):
                    cut = index
                    break
            chunks.append(" ".join(words[:cut]))
            words = words[cut:]
        if words:
            chunks.append(" ".join(words))
    return chunks


def synthesize(pipeline: KPipeline, text: str) -> tuple[np.ndarray, float]:
    started = time.perf_counter()
    pieces = [
        np.asarray(audio, dtype=np.float32)
        for _graphemes, _phonemes, audio in pipeline(
            text,
            voice="pf_dora",
            speed=1.0,
        )
    ]
    return np.concatenate(pieces), time.perf_counter() - started


def benchmark(pipeline: KPipeline, name: str, chunks: list[str]) -> None:
    generated_at = 0.0
    playback_end = 0.0
    total_gap = 0.0
    rendered: list[np.ndarray] = []

    print(f"STRATEGY={name} CHUNKS={len(chunks)}", flush=True)
    for index, chunk in enumerate(chunks, start=1):
        audio, generation_seconds = synthesize(pipeline, chunk)
        generated_at += generation_seconds
        duration = len(audio) / SAMPLE_RATE

        if index == 1:
            playback_start = generated_at
            first_audio_seconds = generated_at
        else:
            gap = max(0.0, generated_at - playback_end)
            total_gap += gap
            if gap:
                rendered.append(np.zeros(round(gap * SAMPLE_RATE), dtype=np.float32))
            playback_start = max(generated_at, playback_end)

        playback_end = playback_start + duration
        rendered.append(audio)
        print(
            f"CHUNK={index} GEN={generation_seconds:.3f} AUDIO={duration:.3f} "
            f"READY_AT={generated_at:.3f} PLAY_AT={playback_start:.3f} "
            f"TEXT={chunk}",
            flush=True,
        )

    output_path = OUTPUT_DIR / f"{name}.wav"
    sf.write(output_path, np.concatenate(rendered), SAMPLE_RATE)
    print(
        f"RESULT={name} FIRST_AUDIO={first_audio_seconds:.3f} "
        f"GAPS={total_gap:.3f} FINISH={playback_end:.3f} OUTPUT={output_path}",
        flush=True,
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    pipeline = KPipeline(lang_code="p")

    # Warm model kernels before measuring conversational turns.
    synthesize(pipeline, "Teste inicial.")

    benchmark(pipeline, "sentences", sentence_chunks(TEXT))
    benchmark(pipeline, "words_8", bounded_chunks(TEXT, 8))
    benchmark(pipeline, "words_5", bounded_chunks(TEXT, 5))


if __name__ == "__main__":
    main()
