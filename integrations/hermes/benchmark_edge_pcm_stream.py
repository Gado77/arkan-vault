"""Measure time-to-first-PCM for the Hermes Edge streaming provider."""

from __future__ import annotations

import time

from tools.tts_streaming import EdgeTTSStreamer


TEXT = (
    "Escute principalmente a nova voz do Hermes. Se a qualidade estiver "
    "aceitável, vamos levar esta cascata para o Linux."
)


def main() -> None:
    config = {
        "provider": "edge",
        "edge": {"voice": "pt-BR-ThalitaMultilingualNeural"},
    }
    provider = EdgeTTSStreamer(config, config["edge"])
    started = time.perf_counter()
    byte_count = 0
    first = None
    chunks = 0
    for pcm in provider.stream(TEXT):
        chunks += 1
        byte_count += len(pcm)
        if first is None:
            first = time.perf_counter() - started
    elapsed = time.perf_counter() - started
    audio_seconds = byte_count / 2 / provider.sample_rate
    print(
        f"FIRST_PCM_SECONDS={first:.3f} TOTAL_SECONDS={elapsed:.3f} "
        f"AUDIO_SECONDS={audio_seconds:.3f} CHUNKS={chunks} BYTES={byte_count}"
    )


if __name__ == "__main__":
    main()
