from pathlib import Path
import sys

path = Path(sys.argv[1]).expanduser() / "hermes_cli" / "voice.py"
text = path.read_text(encoding="utf-8")
backup = path.with_suffix(path.suffix + ".bak-arkan-f8")
if not backup.exists():
    backup.write_text(text, encoding="utf-8")

old = '''    # Bare char / bare named key (no explicit modifier) — the CLI's
    # prompt_toolkit binds the raw key without a modifier, which the TUI
    # parser refuses; reject here too so both runtimes agree.
    if len(parts) == 1:
        return _DEFAULT_PT_KEY
'''
new = '''    # Function keys are safe standalone push-to-talk shortcuts.
    if len(parts) == 1:
        key = parts[0]
        if key.startswith("f") and key[1:].isdigit() and 1 <= int(key[1:]) <= 12:
            return key
        return _DEFAULT_PT_KEY
'''
if old not in text:
    raise RuntimeError("Expected voice-key normalizer block was not found")
text = text.replace(old, new, 1)

old = '''    else:
        return "Ctrl+B"

    if not key:
'''
new = '''    else:
        if normalized.startswith("f") and normalized[1:].isdigit():
            return normalized.upper()
        return "Ctrl+B"

    if not key:
'''
if old not in text:
    raise RuntimeError("Expected voice-key formatter block was not found")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("F8 voice shortcut support applied")
