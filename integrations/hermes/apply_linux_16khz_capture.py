from pathlib import Path
import sys

path = Path(sys.argv[1]).expanduser() / "tools" / "voice_mode.py"
text = path.read_text(encoding="utf-8")
backup = path.with_suffix(path.suffix + ".bak-arkan-16khz")
if not backup.exists():
    backup.write_text(text, encoding="utf-8")
old = "        self._sample_rate = _default_input_samplerate(sd)\n"
new = '''        # Whisper-native capture; PulseAudio resamples external devices.
        self._sample_rate = SAMPLE_RATE
'''
if old not in text:
    raise RuntimeError("Expected capture sample-rate assignment not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("16 kHz voice capture applied")
