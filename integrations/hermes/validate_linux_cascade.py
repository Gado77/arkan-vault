from tools.tts_streaming import SentenceChunker, resolve_streaming_provider
from tools.tts_tool import _load_tts_config

text = (
    "Escute principalmente a amostra do Piper. Se a qualidade estiver aceitável, "
    "o próximo passo é instalar o Hermes no Linux e configurá-lo com essa voz. "
)
chunker = SentenceChunker(max_words=8, min_words=4)
chunks = chunker.feed(text) + chunker.flush()
config = _load_tts_config()
provider = resolve_streaming_provider(config)

print(f"CHUNKS={chunks!r}")
print(f"PROVIDER={type(provider).__name__} RATE={provider.sample_rate}")
