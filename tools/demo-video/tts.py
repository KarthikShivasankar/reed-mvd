"""Local neural TTS (piper) for the demo narration: reads [{"id", "text"}] JSON on stdin, writes <out>/<id>-<hash>.wav
(cached by text) and prints {"id": {"file", "seconds"}}. Nothing leaves the machine.
Usage: python tts.py <voice.onnx> <out dir> [length scale, default 1.2 = slower, ~150 words/min] < lines.json"""
import hashlib, json, sys, wave
from pathlib import Path

from piper import PiperVoice, SynthesisConfig

model, out = sys.argv[1], Path(sys.argv[2])
length = float(sys.argv[3]) if len(sys.argv) > 3 else 1.2
config = SynthesisConfig(length_scale=length)
out.mkdir(parents=True, exist_ok=True)
voice = None
result = {}
for line in json.load(sys.stdin):
    f = out / f'{line["id"]}-{hashlib.sha1(f'{model}{length}{line["text"]}'.encode()).hexdigest()[:10]}.wav'
    if not f.exists():
        voice = voice or PiperVoice.load(model)
        with wave.open(str(f), "wb") as w:
            voice.synthesize_wav(line["text"], w, syn_config=config)
    with wave.open(str(f)) as w:
        result[line["id"]] = {"file": str(f), "seconds": w.getnframes() / w.getframerate()}
print(json.dumps(result))
