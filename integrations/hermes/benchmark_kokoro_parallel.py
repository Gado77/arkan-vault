"""Benchmark ordered Kokoro streaming with two persistent synthesis workers."""

from __future__ import annotations

import concurrent.futures
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
OUTPUT = Path("/home/vitor/kokoro-streaming/parallel_2.wav")


def chunks(text: str, max_words: int = 8) -> list[str]:
    result: list[str] = []
    for sentence in re.findall(r"[^.!?]+[.!?]?", text):
        words = sentence.strip().split()
        while len(words) > max_words:
            cut = max_words
            for index in range(max_words - 1, 2, -1):
                if words[index - 1].endswith((",", ";", ":")):
                    cut = index
                    break
            result.append(" ".join(words[:cut]))
            words = words[cut:]
        if words:
            result.append(" ".join(words))
    return result


def synthesize(pipeline: KPipeline, text: str) -> tuple[np.ndarray, float]:
    started = time.perf_counter()
    audio = np.concatenate(
        [
            np.asarray(piece, dtype=np.float32)
            for _graphemes, _phonemes, piece in pipeline(
                text,
                voice="pf_dora",
                speed=1.0,
            )
        ]
    )
    return audio, time.perf_counter() - started


def main() -> None:
    init_started = time.perf_counter()
    pipelines = [KPipeline(lang_code="p"), KPipeline(lang_code="p")]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda p: synthesize(p, "Teste inicial."), pipelines))
        print(f"WORKERS_READY_SECONDS={time.perf_counter() - init_started:.3f}", flush=True)

        started = time.perf_counter()
        items = chunks(TEXT)
        futures = [
            pool.submit(synthesize, pipelines[index % 2], text)
            for index, text in enumerate(items)
        ]

        playback_end = 0.0
        total_gap = 0.0
        rendered: list[np.ndarray] = []
        for index, (text, future) in enumerate(zip(items, futures), start=1):
            audio, generation_seconds = future.result()
            ready_at = time.perf_counter() - started
            duration = len(audio) / SAMPLE_RATE
            if index == 1:
                first_audio = ready_at
                play_at = ready_at
            else:
                gap = max(0.0, ready_at - playback_end)
                total_gap += gap
                if gap:
                    rendered.append(np.zeros(round(gap * SAMPLE_RATE), dtype=np.float32))
                play_at = max(ready_at, playback_end)
            playback_end = play_at + duration
            rendered.append(audio)
            print(
                f"CHUNK={index} WORK={generation_seconds:.3f} READY_AT={ready_at:.3f} "
                f"PLAY_AT={play_at:.3f} AUDIO={duration:.3f} TEXT={text}",
                flush=True,
            )

    sf.write(OUTPUT, np.concatenate(rendered), SAMPLE_RATE)
    print(
        f"RESULT=parallel_2 FIRST_AUDIO={first_audio:.3f} GAPS={total_gap:.3f} "
        f"FINISH={playback_end:.3f} OUTPUT={OUTPUT}",
        flush=True,
    )


if __name__ == "__main__":
    main()
