from pathlib import Path
import sys

path = Path(sys.argv[1]).expanduser() / "tools" / "transcription_tools.py"
text = path.read_text(encoding="utf-8")
backup = path.with_suffix(path.suffix + ".bak-arkan-groq-persistent")
if not backup.exists():
    backup.write_text(text, encoding="utf-8")

old = "def _transcribe_groq(file_path: str, model_name: str) -> Dict[str, Any]:\n"
new = '''_groq_stt_client = None
_groq_stt_client_key = ""
_groq_stt_client_factory = None
_groq_stt_client_lock = threading.Lock()


def _get_groq_stt_client(api_key: str):
    """Reuse the HTTP/TLS connection across consecutive voice turns."""
    global _groq_stt_client, _groq_stt_client_key, _groq_stt_client_factory
    from openai import OpenAI
    with _groq_stt_client_lock:
        if (
            _groq_stt_client is None
            or _groq_stt_client_key != api_key
            or _groq_stt_client_factory is not OpenAI
        ):
            old_client = _groq_stt_client
            _groq_stt_client = OpenAI(
                api_key=api_key, base_url=GROQ_BASE_URL, timeout=30, max_retries=0
            )
            _groq_stt_client_key = api_key
            _groq_stt_client_factory = OpenAI
            if old_client is not None:
                close = getattr(old_client, "close", None)
                if callable(close):
                    close()
        return _groq_stt_client


def warm_groq_stt_connection() -> None:
    """Open Groq's HTTP/TLS connection before the user's first recording."""
    api_key = _resolve_provider_key("GROQ_API_KEY", "groq")
    if not api_key:
        return
    try:
        client = _get_groq_stt_client(api_key)
        client.models.retrieve(DEFAULT_GROQ_STT_MODEL)
        logger.info("Groq STT connection warmed")
    except Exception as exc:
        logger.debug("Groq STT warmup skipped: %s", exc)


def _transcribe_groq(file_path: str, model_name: str) -> Dict[str, Any]:
'''
if text.count(old) != 1:
    raise RuntimeError("Expected Groq function definition not found exactly once")
text = text.replace(old, new, 1)

old = '''        from openai import OpenAI, APIError, APIConnectionError, APITimeoutError
        client = OpenAI(api_key=api_key, base_url=GROQ_BASE_URL, timeout=30, max_retries=0)
        try:
            create_kwargs = {
                "model": model_name,
                "response_format": "text",
            }
            if language:
                create_kwargs["language"] = language
            with open(file_path, "rb") as audio_file:
                transcription = client.audio.transcriptions.create(
                    file=audio_file,
                    **create_kwargs,
                )

            transcript_text = str(transcription).strip()
            logger.info("Transcribed %s via Groq API (%s, lang=%s, %d chars)",
                         Path(file_path).name, model_name, language or "auto", len(transcript_text))

            return {"success": True, "transcript": transcript_text, "provider": "groq"}
        finally:
            close = getattr(client, "close", None)
            if callable(close):
                close()
'''
new = '''        from openai import APIError, APIConnectionError, APITimeoutError
        client = _get_groq_stt_client(api_key)
        create_kwargs = {
            "model": model_name,
            "response_format": "text",
        }
        if language:
            create_kwargs["language"] = language
        with open(file_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                file=audio_file,
                **create_kwargs,
            )

        transcript_text = str(transcription).strip()
        logger.info("Transcribed %s via Groq API (%s, lang=%s, %d chars)",
                     Path(file_path).name, model_name, language or "auto", len(transcript_text))

        return {"success": True, "transcript": transcript_text, "provider": "groq"}
'''
if text.count(old) != 1:
    raise RuntimeError("Expected disposable Groq client block not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")

cli = Path(sys.argv[1]).expanduser() / "cli.py"
cli_text = cli.read_text(encoding="utf-8")
cli_backup = cli.with_suffix(cli.suffix + ".bak-arkan-groq-warmup")
if not cli_backup.exists():
    cli_backup.write_text(cli_text, encoding="utf-8")
cli_old = '''        with self._voice_lock:
            self._voice_mode = True
'''
cli_new = '''        with self._voice_lock:
            self._voice_mode = True

        if self._voice_stt_provider() == "groq":
            from tools.transcription_tools import warm_groq_stt_connection
            threading.Thread(
                target=warm_groq_stt_connection,
                name="groq-stt-warmup",
                daemon=True,
            ).start()
'''
if cli_text.count(cli_old) != 1:
    raise RuntimeError("Expected voice enable block not found exactly once")
cli.write_text(cli_text.replace(cli_old, cli_new, 1), encoding="utf-8")
print("Persistent Groq STT client applied")
