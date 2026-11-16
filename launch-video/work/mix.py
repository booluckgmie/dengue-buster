"""Synthesises the soundtrack (music, rain, UI sounds), places the voice, ducks the music under it, writes stems and SRTs."""
import json, wave
import numpy as np
from scipy.signal import butter, sosfilt, resample_poly, fftconvolve

SR = 44100
plan = json.load(open("work/plan.json"))
TOTAL = plan["total"]
N = int(SR * TOTAL)
rs = np.random.default_rng(11)
t_all = np.arange(N) / SR


def to_stereo(): return np.zeros((N, 2), dtype=np.float64)


def put(buf, sig, t0, pan=0.0, gain=1.0):
    """Add a mono signal at t0 seconds with a simple equal-power pan (-1 left, 1 right)."""
    i0 = int(round(t0 * SR))
    if i0 >= N or i0 + len(sig) < 0: return
    a = max(0, -i0); sig = sig[a:]; i0 = max(0, i0)
    n = min(len(sig), N - i0)
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i0:i0 + n, 0] += sig[:n] * gain * l
    buf[i0:i0 + n, 1] += sig[:n] * gain * r


def env(n, a=0.005, d=3.0):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-d * t)


def tone(f, dur, harm=((1, 1), (2, .28), (3, .1)), a=.006, d=4.0, f1=None):
    n = int(dur * SR); t = np.arange(n) / SR
    fr = f if f1 is None else np.linspace(f, f1, n)
    ph = 2 * np.pi * np.cumsum(fr) / SR if f1 is not None else 2 * np.pi * f * t
    return sum(h * np.sin(ph * k) for k, h in harm) * env(n, a, d)


def band(x, lo, hi, order=3):
    sos = butter(order, [lo, hi], btype="band", fs=SR, output="sos"); return sosfilt(sos, x)


def hp(x, f): return sosfilt(butter(2, f, btype="high", fs=SR, output="sos"), x)
def lp(x, f): return sosfilt(butter(2, f, btype="low", fs=SR, output="sos"), x)


def ramp(points, t):
    xs, ys = zip(*points); return np.interp(t, xs, ys)


# ---------------------------------------------------------------- music
BEAT = 60 / 90
CH = [  # Am, F, C, G
    [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [261.63, 329.63, 392.0], [196.0, 246.94, 293.66],
]
CHORD_LEN = BEAT * 8
music = to_stereo()
pad_gain = ramp([(0, .55), (6, .6), (13, .95), (18, .8), (73, .8), (79, 1.0), (85, .9), (92, .6)], t_all)
n_chords = int(np.ceil(TOTAL / CHORD_LEN)) + 1
for k in range(n_chords):
    t0 = k * CHORD_LEN
    freqs = CH[k % 4]
    if t0 >= 85.0: freqs = CH[2]                                    # land on C major for the close
    dur = CHORD_LEN + 2.4
    n = int(dur * SR); tt = np.arange(n) / SR
    e = np.minimum(1, tt / 1.3) * np.minimum(1, (dur - tt) / 1.6)
    for f in freqs:
        for pan, det in ((-.5, 1.0013), (.5, .9987)):
            v = (np.sin(2 * np.pi * f * det * tt) + .35 * np.sin(2 * np.pi * 2 * f * det * tt) + .08 * np.sin(2 * np.pi * 3 * f * tt)) * e
            put(music, v, t0, pan, .035)
    # bass on beats 1 and 3 once the title lands
    if t0 >= 13:
        for b in (0, 2, 4, 6):
            bt = t0 + b * BEAT
            if bt < 91: put(music, tone(freqs[0] / 2, 1.1, ((1, 1), (2, .2)), d=2.6), bt, 0, .11 * ramp([(13, .0), (14, 1)], np.array([bt]))[0])
    # arpeggio plucks
    pluck_gain = ramp([(0, 0), (6, 0), (6.5, .5), (13, .6), (18, 1.0), (73, .9), (79, 1.1), (85, .7), (86, 0)], np.array([t0]))[0]
    pat = [0, 1, 2, 1, 2, 1, 0, 1] if k % 2 == 0 else [2, 1, 0, 1, 2, 1, 2, 1]
    for j, idx in enumerate(pat):
        nt = t0 + j * BEAT
        if nt >= 86 or nt < 6: continue
        if 6 <= nt < 13 and j % 2: continue                           # sparser in the opening
        f = freqs[idx] * 2
        put(music, tone(f, 1.4, ((1, 1), (2, .3), (3, .08), (4, .04)), d=3.8), nt, (-1) ** j * .35, .052 * pluck_gain * ramp([(nt, 1)], np.array([nt]))[0])
music *= pad_gain[:, None] * 0 + 1                                    # (kept for clarity; per-chord gains are applied above)
# slow swell of the pad bed itself
swell = ramp([(0, .75), (6, .8), (13, 1.0), (73, 1.0), (79, 1.1), (92, .85)], t_all)
music *= swell[:, None]

# rain bed, drip, ripples, logo chime
rain = to_stereo()
for c in (0, 1):
    nz = rs.standard_normal(N); nz = band(nz, 1800, 9000)
    rain[:, c] = nz * ramp([(0, .11), (4.5, .11), (8.5, 0)], t_all) * (.8 + .2 * np.sin(2 * np.pi * (.17 + c * .05) * t_all))
put(rain, tone(1500, .14, ((1, 1),), a=.002, d=26, f1=620), 3.4, 0, .22)
put(rain, tone(220, .5, ((1, 1), (2, .3)), a=.004, d=9), 3.42, 0, .14)
for i, ft in enumerate((1760, 1318.5, 1046.5)): put(rain, tone(ft, 1.3, ((1, 1), (2.01, .2)), a=.01, d=4.2), 3.5 + i * .42, (-.4, 0, .4)[i], .045)
chime = to_stereo()
for f, g in ((880, 1), (1318.5, .55), (1760, .35), (2349, .18)): put(chime, tone(f, 2.4, ((1, 1), (2.76, .2)), a=.004, d=2.6), 13.1, 0, .06 * g)
put(chime, tone(440, 3.0, ((1, 1), (2, .2)), a=.01, d=1.6), 13.1, 0, .08)
final = to_stereo()
for f in (261.63, 329.63, 392.0, 523.25): put(final, tone(f, 5.0, ((1, 1), (2, .25), (3, .08)), a=.02, d=1.1), 85.5, 0, .05)

# ---------------------------------------------------------------- ui sounds from the real click log
sfx = to_stereo()
ev = json.load(open("work/live_events.json"))
T0 = plan["live_start"]
last_key = -9
for e in ev:
    t = T0 + e["t"]; ty = e["type"]
    if ty in ("click", "tab", "toggle", "zoom"):
        nz = hp(rs.standard_normal(int(.05 * SR)), 1500) * env(int(.05 * SR), .001, 90)
        put(sfx, nz * .5 + tone(1700, .05, ((1, 1),), a=.001, d=70), t, 0, .13)
        if ty == "toggle": put(sfx, tone(2100, .06, ((1, 1),), a=.001, d=60), t + .07, 0, .1)
        if ty == "tab": put(sfx, lp(rs.standard_normal(int(.5 * SR)), 900) * np.sin(np.linspace(0, np.pi, int(.5 * SR))) ** 2, t + .02, 0, .08)
        if ty == "zoom": put(sfx, tone(150, .7, ((1, 1), (2, .2)), a=.15, d=3.0, f1=330), t + .05, 0, .12)
    elif ty == "key":
        put(sfx, tone(2300, .02, ((1, 1),), a=.0005, d=140) + hp(rs.standard_normal(int(.02 * SR)), 2500) * .5 * env(int(.02 * SR), .0005, 140), t, (-1) ** int(t * 10) * .2, .045)
    elif ty == "layer":
        put(sfx, tone(520, .16, ((1, 1), (2, .2)), a=.002, d=22, f1=800), t, 0, .13)
    elif ty == "tick":
        put(sfx, tone(659.25, .22, ((1, 1), (2, .2)), a=.002, d=14), t, -.1, .1); put(sfx, tone(987.77, .3, ((1, 1), (2, .2)), a=.002, d=11), t + .09, .1, .1)
    elif ty == "grow":
        for j, f in enumerate((523.25, 659.25, 783.99, 1046.5)): put(sfx, tone(f, .8, ((1, 1), (2, .25), (4, .1)), a=.002, d=7), t + j * .07, (-.3, -.1, .1, .3)[j], .085)
    elif ty == "scroll":
        n = int(1.0 * SR); sw = band(rs.standard_normal(n), 350, 1400, 2) * np.sin(np.linspace(0, np.pi, n)) ** 2
        put(sfx, sw, t, 0, .05)
# a soft pulse under each count-up and a tap for the opening title card ring
# ---------------------------------------------------------------- room
def verb(x, wet=.2, rt=1.7):
    n = int(rt * SR); ir = rs.standard_normal(n) * np.exp(-3.2 * np.arange(n) / (rt * SR)); ir = lp(ir, 5500); ir /= np.sqrt(np.sum(ir ** 2))
    return np.stack([x[:, c] * (1 - wet) + fftconvolve(x[:, c], ir)[: len(x)] * wet * 1.6 for c in (0, 1)], axis=1)

music_bus = verb(music + rain + chime + final, .26)
sfx_bus = verb(sfx, .18, 1.0)

# ---------------------------------------------------------------- voice
def load_vo(k):
    with wave.open(f"work/vo_{k:02d}.wav") as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768; sr = w.getframerate()
    x = resample_poly(x, SR, sr) if sr != SR else x
    x = hp(x, 90)
    return x / (np.max(np.abs(x)) + 1e-9)

vo = to_stereo(); vo_env = np.zeros(N)
for k in range(1, 13):
    x = load_vo(k) * .78
    # gentle presence lift and a slow fade at both ends so the clips never click
    f = np.minimum(1, np.arange(len(x)) / (.02 * SR)) * np.minimum(1, (len(x) - np.arange(len(x))) / (.04 * SR)); x *= f
    t0 = plan["vo_at"][str(k)]; put(vo, x, t0, 0, 1.0)
    i0 = int(t0 * SR); vo_env[i0:i0 + len(x)] = np.maximum(vo_env[i0:i0 + len(x)], 1)
# ducking: music and effects dip while the voice speaks
sm = np.convolve(vo_env, np.ones(int(.35 * SR)) / int(.35 * SR), mode="same")
duck = 1 - .5 * np.clip(sm * 1.5, 0, 1)
music_bus *= duck[:, None]; sfx_bus *= (1 - .3 * np.clip(sm * 1.5, 0, 1))[:, None]

# ---------------------------------------------------------------- master
def fade(x):
    g = np.ones(N); g[:int(.4 * SR)] = np.linspace(0, 1, int(.4 * SR)); g[-int(2.2 * SR):] = np.linspace(1, 0, int(2.2 * SR)) ** 1.5; return x * g[:, None]
novo = fade(music_bus + sfx_bus); full = fade(music_bus + sfx_bus + vo)
peak = max(np.max(np.abs(full)), 1e-9); k = .89 / peak
def write(name, x):
    y = np.tanh(x * k * 1.05) / np.tanh(1.05)
    with wave.open(name, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())
write("work/audio_mix.wav", full); write("work/audio_no_voice.wav", novo); write("work/audio_voice_only.wav", fade(vo))
write("work/audio_music_only.wav", fade(music_bus)); write("work/audio_sfx_only.wav", fade(sfx_bus))

# ---------------------------------------------------------------- subtitles
def ts(x):
    h, m, s = int(x // 3600), int(x % 3600 // 60), x % 60; return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"
for name, fn in (("en", lambda c: c["en"]), ("ms", lambda c: c["ms"]), ("bilingual", lambda c: c["en"] + "\n" + c["ms"])):
    with open(f"work/subs_{name}.srt", "w") as f:
        for i, c in enumerate(plan["captions"], 1): f.write(f"{i}\n{ts(c['a'])} --> {ts(c['b'])}\n{fn(c)}\n\n")
print("audio ok", round(len(full) / SR, 2), "s; peak scale", round(k, 3))
