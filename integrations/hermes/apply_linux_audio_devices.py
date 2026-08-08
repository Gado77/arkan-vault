from pathlib import Path
import sys

root = Path(sys.argv[1]).expanduser()


def patch(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    backup = path.with_suffix(path.suffix + ".bak-arkan-audio")
    if not backup.exists():
        backup.write_text(text, encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


selector = '''    try:
        devices = sd.query_devices()
        input_device = next(
            (i for i, item in enumerate(devices)
             if "alsa_input" in item["name"] and item["max_input_channels"] > 0),
            None,
        )
        output_device = next(
            (i for i, item in enumerate(devices)
             if "alsa_output" in item["name"] and item["max_output_channels"] > 0),
            None,
        )
        if input_device is not None or output_device is not None:
            current = sd.default.device
            sd.default.device = (
                input_device if input_device is not None else current[0],
                output_device if output_device is not None else current[1],
            )
    except Exception:
        pass
'''

voice = root / "tools" / "voice_mode.py"
patch(
    voice,
    '''    import sounddevice as sd
    import numpy as np
    return sd, np
''',
    '''    import sounddevice as sd
    import numpy as np
''' + selector + '''    return sd, np
''',
)

tts = root / "tools" / "tts_tool.py"
patch(
    tts,
    '''    import sounddevice as sd
    return sd
''',
    '''    import sounddevice as sd
''' + selector + '''    return sd
''',
)

print("PulseAudio input/output auto-selection applied")
