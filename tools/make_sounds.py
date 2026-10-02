"""Synthesize Tokencraft's two sound effects into sounds/*.wav.

Original chimes made from sine tones, so the mod ships no game audio.
Run from the repo root: python3 tools/make_sounds.py
"""
import math
import struct
import wave
from pathlib import Path

RATE = 22050


def tone(freq, seconds, gain=0.35):
    """One note: a sine with its octave, a fast attack and an exponential fade."""
    n = int(RATE * seconds)
    out = []
    for i in range(n):
        t = i / RATE
        envelope = min(1.0, t / 0.008) * math.exp(-5.0 * t / seconds)
        sample = math.sin(2 * math.pi * freq * t) + 0.3 * math.sin(4 * math.pi * freq * t)
        out.append(gain * envelope * sample / 1.3)
    return out


def mix(notes):
    """Notes as (start_seconds, samples), summed and clipped to 16-bit."""
    length = max(int(start * RATE) + len(s) for start, s in notes)
    buf = [0.0] * length
    for start, samples in notes:
        offset = int(start * RATE)
        for i, v in enumerate(samples):
            buf[offset + i] += v
    return [max(-1.0, min(1.0, v)) for v in buf]


def write(path, samples):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(v * 32767)) for v in samples))


out = Path(__file__).resolve().parent.parent / "sounds"
out.mkdir(exist_ok=True)
# Level-up: a rising major arpeggio, C5 E5 G5 C6
write(out / "levelup.wav", mix([(i * 0.08, tone(f, 0.45)) for i, f in enumerate([523.25, 659.25, 783.99, 1046.5])]))
# Smelted: two soft bell strikes, G5 then C6
write(out / "smelted.wav", mix([(0.0, tone(783.99, 0.7, 0.3)), (0.18, tone(1046.5, 0.9, 0.3))]))
print("wrote", *sorted(p.name for p in out.glob("*.wav")))
