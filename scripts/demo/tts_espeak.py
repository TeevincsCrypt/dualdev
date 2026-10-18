"""Offline TTS for the demo recorder on Linux: espeak-ng via the espeakng-loader wheel.

    pip install espeakng-loader
    python3 scripts/demo/tts_espeak.py out.wav text.txt [voice]
"""
import ctypes
import os
import sys
import wave

import espeakng_loader

out, txt = sys.argv[1], sys.argv[2]
voice = sys.argv[3] if len(sys.argv) > 3 else "en-us+Annie"
text = open(txt, encoding="utf-8").read().strip()

lib = ctypes.CDLL(espeakng_loader.get_library_path())
AUDIO_OUTPUT_SYNCHRONOUS = 2
rate = lib.espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, os.path.dirname(espeakng_loader.get_data_path()).encode(), 0)
if rate <= 0:
    sys.exit("espeak-ng failed to initialise")

samples = bytearray()
CALLBACK = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_short), ctypes.c_int, ctypes.c_void_p)

@CALLBACK
def on_audio(wav, n, _events):
    if n > 0:
        samples.extend(ctypes.string_at(wav, n * 2))
    return 0

lib.espeak_SetSynthCallback(on_audio)
lib.espeak_SetVoiceByName(voice.encode())
lib.espeak_SetParameter(1, 158, 0)  # espeakRATE: words per minute
lib.espeak_SetParameter(3, 48, 0)   # espeakPITCH
data = text.encode("utf-8")
lib.espeak_Synth(data, len(data) + 1, 0, 0, 0, 0x00, None, None)
lib.espeak_Synchronize()

with wave.open(out, "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    w.writeframes(bytes(samples))
