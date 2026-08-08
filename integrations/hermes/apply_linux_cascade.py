from pathlib import Path
import sys

root = Path(sys.argv[1]).expanduser()
streaming = root / "tools" / "tts_streaming.py"
tts_tool = root / "tools" / "tts_tool.py"


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if text.count(old) != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {text.count(old)}")
    backup = path.with_suffix(path.suffix + ".bak-arkan-cascade")
    if not backup.exists():
        backup.write_text(text, encoding="utf-8")
    path.write_text(text.replace(old, new), encoding="utf-8")


replace_once(
    streaming,
    '''    def __init__(self, min_len: int = 20):
        self.min_len = min_len
        self.buf = ""

    def feed''',
    '''    def __init__(self, min_len: int = 20, max_words: int = 0, min_words: int = 4):
        self.min_len = min_len
        self.max_words = max(0, int(max_words))
        self.min_words = max(1, int(min_words))
        self.buf = ""

    def _pop_word_chunk(self) -> Optional[str]:
        if not self.max_words:
            return None
        matches = list(re.finditer(r"\\S+\\s+", self.buf))
        if len(matches) < self.max_words:
            return None
        cut_index = self.max_words
        for index in range(self.min_words, self.max_words + 1):
            if matches[index - 1].group(0).strip().endswith((",", ";", ":")):
                cut_index = index
                break
        end = matches[cut_index - 1].end()
        chunk, self.buf = self.buf[:end], self.buf[end:]
        return chunk

    def feed''',
)

replace_once(
    streaming,
    '''            self.buf = self.buf[m.end():]
            start = 0
        return out
''',
    '''            self.buf = self.buf[m.end():]
            start = 0
        while chunk := self._pop_word_chunk():
            out.append(chunk)
        return out
''',
)

edge_provider = r'''
@register("edge")
class EdgeTTSStreamer(StreamingTTSProvider):
    """Free Edge TTS MP3 stream decoded incrementally to PCM with PyAV."""

    sample_rate = 24000

    @staticmethod
    def available() -> bool:
        try:
            import av  # noqa: F401
            import edge_tts  # noqa: F401
            return hasattr(edge_tts.Communicate, "stream_sync")
        except (ImportError, AttributeError):
            return False

    def stream(self, text: str) -> Iterator[bytes]:
        import queue
        import threading
        import av
        import edge_tts

        class QueueReader:
            def __init__(self):
                self.queue = queue.Queue()
                self.buffer = bytearray()
                self.eof = False

            def feed(self, data):
                self.queue.put(data)

            def finish(self):
                self.queue.put(None)

            def read(self, size=-1):
                while not self.eof and (size < 0 or len(self.buffer) < size):
                    item = self.queue.get()
                    if item is None:
                        self.eof = True
                        break
                    self.buffer.extend(item)
                    if self.buffer:
                        break
                if not self.buffer:
                    return b""
                take = len(self.buffer) if size < 0 else min(size, len(self.buffer))
                data = bytes(self.buffer[:take])
                del self.buffer[:take]
                return data

            def readable(self):
                return True

            def seekable(self):
                return False

        cfg = self.section if isinstance(self.section, dict) else {}
        voice = cfg.get("voice") or "pt-BR-ThalitaMultilingualNeural"
        speed = float(cfg.get("speed", self.tts_config.get("speed", 1.0)))
        kwargs = {"voice": voice}
        if speed != 1.0:
            kwargs["rate"] = f"{round((speed - 1.0) * 100):+d}%"
        reader = QueueReader()
        errors = []

        def produce():
            try:
                for message in edge_tts.Communicate(text, **kwargs).stream_sync():
                    if message.get("type") == "audio" and message.get("data"):
                        reader.feed(message["data"])
            except BaseException as exc:
                errors.append(exc)
            finally:
                reader.finish()

        producer = threading.Thread(target=produce, daemon=True)
        producer.start()
        try:
            resampler = av.AudioResampler(format="s16", layout="mono", rate=self.sample_rate)
            with av.open(reader, mode="r", format="mp3") as container:
                for frame in container.decode(audio=0):
                    for pcm in resampler.resample(frame):
                        yield pcm.to_ndarray().tobytes()
                for pcm in resampler.resample(None):
                    yield pcm.to_ndarray().tobytes()
        finally:
            producer.join(timeout=5.0)
        if errors:
            raise RuntimeError(f"Edge TTS stream failed: {errors[0]}")

'''
replace_once(streaming, '@register("elevenlabs")\n', edge_provider + '@register("elevenlabs")\n')

replace_once(
    tts_tool,
    "        chunker = SentenceChunker()\n",
    '''        streaming_cfg = tts_config.get("streaming") or {}
        chunker = SentenceChunker(
            max_words=int(streaming_cfg.get("max_words") or 0),
            min_words=int(streaming_cfg.get("min_words") or 4),
        )
''',
)

print("Linux Hermes cascade patch applied successfully")
