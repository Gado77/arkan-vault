"""Local voice bridge that reuses Hermes' configured STT and TTS providers."""

import asyncio
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from datetime import date
from pathlib import Path

from aiohttp import web

HERMES_REPO = Path(os.environ.get("HERMES_REPO", Path.home() / ".hermes" / "hermes-agent"))
if os.name == "nt" and "HERMES_REPO" not in os.environ:
    HERMES_REPO = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "hermes" / "hermes-agent"
sys.path.insert(0, str(HERMES_REPO))

from tools.transcription_tools import _find_ffmpeg_binary, transcribe_audio, warm_groq_stt_connection
from tools.tts_tool import _get_provider, _load_tts_config, text_to_speech_tool

TRACE_DIR = Path(__file__).resolve().parents[1] / "logs"
TRACE_QUEUE = queue.SimpleQueue()


def save_trace(payload):
    write_started = time.perf_counter()
    TRACE_DIR.mkdir(parents=True, exist_ok=True)
    target = TRACE_DIR / f"voice-traces-{date.today().isoformat()}.jsonl"
    payload = {**payload, "observer": {**payload.get("observer", {}), "write_started": write_started}}
    with target.open("a", encoding="utf-8") as output:
        output.write(json.dumps(payload, ensure_ascii=False) + "\n")


def trace_worker():
    while True:
        save_trace(TRACE_QUEUE.get())


threading.Thread(target=trace_worker, name="voice-trace-writer", daemon=True).start()


def enqueue_trace(payload):
    enqueue_started = time.perf_counter()
    TRACE_QUEUE.put({**payload, "observer": {"enqueue_ms": round((time.perf_counter() - enqueue_started) * 1000, 4)}})


def trace_identity(request):
    return {
        "trace_id": request.headers.get("x-trace-id") or request.query.get("trace_id") or "",
        "generation_id": request.headers.get("x-generation-id") or request.query.get("generation_id") or "",
    }


async def health(_request):
    return web.json_response({"ok": True, "stt": "groq", "tts": "configured"})


async def transcribe(request):
    started = time.perf_counter()
    identity = trace_identity(request)
    receive_started = time.perf_counter()
    reader = await request.multipart()
    field = await reader.next()
    if field is None or field.name != "audio":
        return web.json_response({"error": "Áudio ausente."}, status=400)
    suffix = Path(field.filename or "recording.webm").suffix or ".webm"
    handle, path = tempfile.mkstemp(prefix="hermes-web-", suffix=suffix)
    os.close(handle)
    try:
        with open(path, "wb") as output:
            while chunk := await field.read_chunk():
                output.write(chunk)
        audio_saved = time.perf_counter()
        prepared_path = path
        conversion_ms = 0
        ffmpeg = _find_ffmpeg_binary()
        if suffix.lower() != ".wav" and ffmpeg:
            wav_path = str(Path(path).with_suffix(".wav"))
            conversion_started = time.perf_counter()
            await asyncio.to_thread(
                subprocess.run,
                [ffmpeg, "-y", "-i", path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav_path],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=20,
            )
            conversion_ms = round((time.perf_counter() - conversion_started) * 1000)
            prepared_path = wav_path
        stt_started = time.perf_counter()
        result = await asyncio.to_thread(transcribe_audio, prepared_path)
        result["timings"] = {
            "receive_and_save_ms": round((audio_saved - receive_started) * 1000),
            "conversion_ms": conversion_ms,
            "stt_ms": round((time.perf_counter() - stt_started) * 1000),
            "total_ms": round((time.perf_counter() - started) * 1000),
        }
        enqueue_trace({
            **identity,
            "source": "voice-backend",
            "span": "stt",
            "metrics": result["timings"],
            "metadata": {"input_format": suffix.lower(), "prepared_format": Path(prepared_path).suffix.lower()},
        })
        if prepared_path != path:
            Path(prepared_path).unlink(missing_ok=True)
        return web.json_response(result)
    finally:
        Path(path).unlink(missing_ok=True)


async def synthesize(request):
    started = time.perf_counter()
    identity = trace_identity(request)
    sequence = int(request.query.get("sequence") or 0)
    if request.method == "GET":
        text = str(request.query.get("text") or "").strip()
    else:
        raw_body = await request.read()
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except UnicodeDecodeError:
            payload = json.loads(raw_body.decode("cp1252"))
        text = str(payload.get("text") or "").strip()
    if not text:
        return web.json_response({"error": "Texto ausente."}, status=400)
    config = _load_tts_config()
    provider = _get_provider(config)
    if provider == "edge":
        import edge_tts

        edge = config.get("edge") or {}
        voice = edge.get("voice") or "pt-BR-FranciscaNeural"
        speed = float(edge.get("speed", config.get("speed", 1.0)))
        rate = f"{round((speed - 1.0) * 100):+d}%" if speed != 1.0 else "+0%"
        response = web.StreamResponse(status=200, headers={
            "Content-Type": "audio/mpeg",
            "X-Hermes-TTS-Provider": "edge",
            "X-Hermes-TTS-Voice": voice,
            "Cache-Control": "no-store",
        })
        await response.prepare(request)
        first_audio_ms = None
        async for message in edge_tts.Communicate(text, voice=voice, rate=rate).stream():
            if message.get("type") == "audio" and message.get("data"):
                if first_audio_ms is None:
                    first_audio_ms = round((time.perf_counter() - started) * 1000)
                await response.write(message["data"])
        await response.write_eof()
        enqueue_trace({
            **identity,
            "source": "voice-backend",
            "span": "tts",
            "metrics": {"first_audio_bytes_ms": first_audio_ms, "total_ms": round((time.perf_counter() - started) * 1000)},
            "metadata": {"provider": "edge", "voice": voice, "sequence": sequence, "words": len(text.split()), "chars": len(text)},
        })
        return response
    handle, path = tempfile.mkstemp(prefix="hermes-web-tts-", suffix=".mp3")
    os.close(handle)
    Path(path).unlink(missing_ok=True)
    try:
        raw = await asyncio.to_thread(text_to_speech_tool, text, path)
        result = json.loads(raw)
        if not result.get("success"):
            return web.json_response({"error": result.get("error", "Falha no TTS.")}, status=500)
        audio_path = Path(result["file_path"])
        audio = await asyncio.to_thread(audio_path.read_bytes)
        enqueue_trace({
            **identity,
            "source": "voice-backend",
            "span": "tts",
            "metrics": {"first_audio_bytes_ms": round((time.perf_counter() - started) * 1000), "total_ms": round((time.perf_counter() - started) * 1000)},
            "metadata": {"provider": str(result.get("provider", "configured")), "sequence": sequence, "words": len(text.split()), "chars": len(text)},
        })
        return web.Response(body=audio, content_type="audio/mpeg", headers={
            "X-Hermes-TTS-Provider": str(result.get("provider", "configured")),
            "Cache-Control": "no-store",
        })
    finally:
        Path(path).unlink(missing_ok=True)


async def record_trace(request):
    payload = await request.json()
    enqueue_trace(payload)
    return web.json_response({"ok": True})


async def on_startup(_app):
    asyncio.create_task(asyncio.to_thread(warm_groq_stt_connection))


app = web.Application(client_max_size=25 * 1024 * 1024)
app.add_routes([
    web.get("/health", health),
    web.post("/transcribe", transcribe),
    web.get("/tts", synthesize),
    web.post("/tts", synthesize),
    web.post("/trace", record_trace),
])
app.on_startup.append(on_startup)

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=8643, print=None)
