from hermes_cli.voice import (
    format_voice_record_key_for_status,
    normalize_voice_record_key_for_prompt_toolkit,
)
from prompt_toolkit.key_binding import KeyBindings

normalized = normalize_voice_record_key_for_prompt_toolkit("f8")
label = format_voice_record_key_for_status("f8")
bindings = KeyBindings()

@bindings.add(normalized)
def handle_f8(event):
    pass

assert normalized == "f8"
assert label == "F8"
print(f"KEY={normalized} LABEL={label} BINDING_OK=true")
