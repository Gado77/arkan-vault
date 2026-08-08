import sounddevice as sd

devices = sd.query_devices()
input_device = next(i for i, d in enumerate(devices) if "alsa_input" in d["name"] and d["max_input_channels"] > 0)
output_device = next(i for i, d in enumerate(devices) if "alsa_output" in d["name"] and d["max_output_channels"] > 0)
sd.check_input_settings(device=input_device, channels=1, dtype="int16", samplerate=48000)
sd.check_output_settings(device=output_device, channels=1, dtype="int16", samplerate=24000)
with sd.InputStream(device=input_device, channels=1, dtype="int16", samplerate=48000):
    pass
with sd.OutputStream(device=output_device, channels=1, dtype="int16", samplerate=24000):
    pass
print(f"AUDIO_OK input={input_device} output={output_device}")
