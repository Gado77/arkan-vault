"""Measure Hermes' cascaded Edge TTS without playing audio."""

from __future__ import annotations

import queue
import threading
import time

from tools import tts_tool, voice_mode


TEXT = (
    "Escute principalmente a nova voz do Hermes. "
    "Se a qualidade estiver aceitável, o próximo passo é levar esta cascata "
    "para o Linux e conectá-la à memória do Arkan."
)


def main() -> None:
    text_queue: queue.Queue[str | None] = queue.Queue()
    stop_event = threading.Event()
    done_event = threading.Event()
    started = time.perf_counter()
    ready_times: list[float] = []

    def fake_play(path: str) -> bool:
        ready_at = time.perf_counter() - started
        ready_times.append(ready_at)
        print(f"AUDIO_CHUNK={len(ready_times)} READY_SECONDS={ready_at:.3f} PATH={path}")
        return True

    voice_mode.play_audio_file = fake_play

    worker = threading.Thread(
        target=tts_tool.stream_tts_to_speaker,
        args=(text_queue, stop_event, done_event),
        daemon=True,
    )
    worker.start()

    for word in TEXT.split():
        text_queue.put(word + " ")
        time.sleep(0.03)
    text_queue.put(None)
    worker.join(timeout=120)

    print(
        f"DONE={done_event.is_set()} CHUNKS={len(ready_times)} "
        f"FIRST_AUDIO_SECONDS={ready_times[0] if ready_times else -1:.3f} "
        f"TOTAL_SECONDS={time.perf_counter() - started:.3f}"
    )


if __name__ == "__main__":
    main()
