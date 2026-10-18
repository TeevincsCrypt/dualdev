"""Synthesizes the launch video soundtrack (original music + SFX) and mixes the voiceover.

    python3 audio.py spec.json out.wav
"""
import json
import sys
import wave

import numpy as np

SR = 44100
spec = json.load(open(sys.argv[1]))
DUR = spec["duration"]
N = int(DUR * SR)
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)


def add(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    L[i : i + len(sig)] += sig * (1 - max(0, pan))
    R[i : i + len(sig)] += sig * (1 + min(0, pan))


def env(n, a=0.002, d=0.2):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


def note(f, dur, kind="sine", d=0.25):
    n = int(dur * SR)
    t = np.arange(n) / SR
    if kind == "saw":
        s = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 7))
    elif kind == "tri":
        s = sum(((-1) ** ((k - 1) // 2)) * np.sin(2 * np.pi * f * k * t) / (k * k) for k in (1, 3, 5, 7))
    else:
        s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)
    return s * env(n, 0.004, d)


def lowpass(x, a):
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc)
        y[i] = acc
    return y


def kick():
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)


def hat():
    n = int(0.06 * SR)
    x = np.diff(rng.standard_normal(n + 1))
    return x * np.exp(-np.arange(n) / SR * 70) * 0.5


def clap():
    n = int(0.25 * SR)
    x = rng.standard_normal(n)
    x = x - lowpass(x, 0.25)
    return x * np.exp(-np.arange(n) / SR * 16) * 0.6


midi = lambda m: 440 * 2 ** ((m - 69) / 12)
# A minor - F - C - G
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOTS = [45, 41, 48, 43]
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
CUTS = spec["sceneCuts"]
DROP, BUILD, HIT = 3.2, 16.6, spec["hit"]

music = np.zeros((2, N))


def madd(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N or i < 0:
        return
    sig = sig[: N - i] * gain
    music[0, i : i + len(sig)] += sig * (1 - max(0, pan))
    music[1, i : i + len(sig)] += sig * (1 + min(0, pan))


t = 0.0
step = 0
while t < DUR:
    bar = int(t // BAR) % 4
    beat_in_bar = int(round((t % BAR) / BEAT * 4)) % 16  # 16th index
    chord = CHORDS[bar]
    full = DROP <= t < BUILD or (BUILD <= t < HIT - 0.8)
    outro = t >= HIT
    # arpeggio 16ths
    m = chord[step % 3] + 12 * (1 + (step // 3) % 2)
    madd(note(midi(m), 0.3, "tri", 0.12), t, 0.10 if not outro else 0.07 * max(0, 1 - (t - HIT) / 4.5), pan=-0.4 if step % 2 else 0.4)
    if beat_in_bar % 4 == 0:  # quarter
        if full:
            madd(kick(), t, 0.9)
        if beat_in_bar in (4, 12) and full:
            madd(clap(), t, 0.35)
    if beat_in_bar % 2 == 0 and (full or t < DROP) and not outro:
        madd(hat(), t + (BEAT / 2 if t < DROP else 0), 0.10 if t < DROP else 0.16, pan=0.3)
    if full and beat_in_bar % 2 == 0:
        b = note(midi(ROOTS[bar] - 12 + (12 if beat_in_bar % 8 == 6 else 0)), 0.25, "saw", 0.12)
        madd(lowpass(b, 0.08), t, 0.55)
    if beat_in_bar == 0:  # pad per bar
        n = int(BAR * SR)
        tt = np.arange(n) / SR
        pad = sum(np.sin(2 * np.pi * midi(c) * tt) for c in chord) * np.minimum(1, tt / 0.6) * np.minimum(1, (BAR - tt) / 0.4)
        madd(pad, t, 0.045 if not outro else 0.06 * max(0, 1 - (t - HIT) / 5))
    t += BEAT / 4
    step += 1

# build-up: snare roll accelerating + riser
roll_t = BUILD + 0.6
gap = BEAT / 2
while roll_t < HIT - 0.05:
    madd(clap(), roll_t, 0.12 + 0.3 * (roll_t - BUILD) / (HIT - BUILD))
    roll_t += gap
    gap = max(BEAT / 8, gap * 0.86)
n = int((HIT - BUILD) * SR)
noise = rng.standard_normal(n)
ramp = np.linspace(0.01, 0.4, n)
riser = np.empty(n)
acc = 0.0
for i in range(n):
    acc += ramp[i] * (noise[i] - acc)
    riser[i] = acc
madd(riser * np.linspace(0, 1, n) ** 2, BUILD, 0.5)

# the hit
madd(kick(), HIT, 1.2)
n = int(3.5 * SR)
crash = rng.standard_normal(n)
crash = (crash - lowpass(crash, 0.3)) * np.exp(-np.arange(n) / SR * 1.4)
madd(crash, HIT, 0.22)
n = int(1.6 * SR)
tt = np.arange(n) / SR
madd(np.sin(2 * np.pi * (40 + 30 * np.exp(-tt * 3)) * tt) * np.exp(-tt * 1.8), HIT, 0.7)

# ---------- SFX ----------
def whoosh(dur=0.55):
    n = int(dur * SR)
    x = rng.standard_normal(n)
    a = 0.02 + 0.5 * np.sin(np.linspace(0, np.pi, n)) ** 2
    y = np.empty(n)
    acc = 0.0
    for i in range(n):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y * np.sin(np.linspace(0, np.pi, n)) ** 1.5


for c in CUTS:
    add(whoosh(), c - 0.3, 0.55, pan=0.0)


def pop():
    n = int(0.07 * SR)
    tt = np.arange(n) / SR
    return np.sin(2 * np.pi * (950 - 4000 * tt) * tt) * np.exp(-tt * 45)


for p in spec["pops"]:
    add(pop(), p, 0.35, pan=rng.uniform(-0.5, 0.5))

a, b = spec["typing"]
for i, tt0 in enumerate(np.linspace(a, b, 32)):
    n = int(0.025 * SR)
    add(np.diff(rng.standard_normal(n + 1)) * np.exp(-np.arange(n) / SR * 200), tt0 + rng.uniform(-0.02, 0.02), 0.25, pan=rng.uniform(-0.2, 0.2))

n = int(0.3 * SR)
tt = np.arange(n) / SR
add((np.sign(np.sin(2 * np.pi * 220 * tt)) + np.sign(np.sin(2 * np.pi * 233 * tt))) * np.exp(-tt * 9) * 0.25, spec["fail"], 0.4)
for k, m in enumerate([84, 88, 91, 96]):
    add(note(midi(m), 1.2, "sine", 0.5), spec["success"] + k * 0.07, 0.22, pan=-0.3 + 0.2 * k)

# ---------- voice + ducking ----------
vo = np.zeros(N)
duck = np.ones(N)
for v in spec["voice"]:
    with wave.open(v["wav"]) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
    x = np.interp(np.arange(0, len(x), sr / SR), np.arange(len(x)), x)
    i = int(v["at"] * SR)
    x = x[: N - i]
    vo[i : i + len(x)] += x
    j0, j1 = max(0, i - int(0.1 * SR)), min(N, i + len(x) + int(0.15 * SR))
    duck[j0:j1] = 0.55
duck = np.convolve(duck, np.ones(2205) / 2205, mode="same")

L += music[0] * duck + vo * 1.25
R += music[1] * duck + vo * 1.25
fade = np.ones(N)
fade[-int(2.2 * SR) :] = np.linspace(1, 0, int(2.2 * SR))
out = np.stack([L, R], axis=1) * fade[:, None]
out = np.tanh(out * 1.1)
out = out / max(1e-9, np.abs(out).max()) * 0.92
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((out * 32767).astype(np.int16).tobytes())
print(f"mixed {DUR}s audio ({len(spec['voice'])} voice lines)")
