"""Builds the hook's sound (heartbeat, count-up ticks, impact, riser, voice), then joins it to the body soundtrack
produced by mix.py. Also writes the sidecar subtitle files and the chapter list for the film as finally cut."""
import json, wave
import numpy as np
from scipy.signal import butter, sosfilt, resample_poly, fftconvolve

SR = 44100
hook = json.load(open("work/plan_hook.json")); plan = json.load(open("work/plan.json"))
D, T, DUR, F = hook["D"], hook["t"], hook["dur"], hook["figures"]
H = D + 0.5                                   # hook segment length (0.5 s overlaps the next scene)
BODY = plan["total"]                          # 92 s
TOTAL = D + BODY
rs = np.random.default_rng(5)


def read(path):
    with wave.open(path) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        ch, sr = w.getnchannels(), w.getframerate()
    return x.reshape(-1, ch), sr


def hp(x, f): return sosfilt(butter(2, f, btype="high", fs=SR, output="sos"), x)
def lp(x, f): return sosfilt(butter(2, f, btype="low", fs=SR, output="sos"), x)
def env(n, a=.004, d=4.0): t = np.arange(n) / SR; return np.minimum(1, t / max(a, 1e-4)) * np.exp(-d * t)


def tone(f, dur, harm=((1, 1),), a=.004, d=4.0, f1=None):
    n = int(dur * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * np.cumsum(np.linspace(f, f1, n)) / SR if f1 else 2 * np.pi * f * t
    return sum(h * np.sin(ph * k) for k, h in harm) * env(n, a, d)


def put(buf, sig, t0, g=1.0):
    i0 = int(round(t0 * SR))
    if i0 < 0 or i0 >= len(buf): return
    n = min(len(sig), len(buf) - i0); buf[i0:i0 + n] += sig[:n] * g


NH = int(SR * H)
drone = np.zeros(NH); beats = np.zeros(NH); fx = np.zeros(NH); vo = np.zeros(NH)
t = np.arange(NH) / SR

# dark drone: a low fifth with a slow wobble, cut hard when the question lands
lfo = 1 + .25 * np.sin(2 * np.pi * .35 * t)
drone += (np.sin(2 * np.pi * 55 * t) + .6 * np.sin(2 * np.pi * 82.4 * t) + .25 * np.sin(2 * np.pi * 110.3 * t)) * lfo
drone *= np.minimum(1, t / .8) * np.interp(t, [0, T["h4"] - .15, T["h4"] + .35, H], [1, 1, .18, 0]) * .11

# heartbeat: lub-dub every 0.86 s, stopping when the question lands
b = .2
while b < T["h4"] - .1:
    put(beats, tone(60, .35, ((1, 1), (2, .25)), a=.003, d=11), b, .62)
    put(beats, tone(74, .3, ((1, 1), (2, .2)), a=.003, d=13), b + .2, .38)
    put(beats, lp(rs.standard_normal(int(.03 * SR)), 380) * env(int(.03 * SR), .001, 80), b, .35)
    b += .86


def ticks(start, dur, total, step, amp, pitch):
    prev = 0
    for s in np.arange(0, dur, 1 / 400):
        k = 1 - (1 - min(1, s / dur)) ** 3
        c = int(total * k / step)
        if c > prev:
            put(fx, tone(pitch * (1 + .04 * rs.standard_normal()), .018, ((1, 1),), a=.0005, d=200), start + s, amp); prev = c

ticks(T["h1"], 1.9, F["cum"], 2400, .045, 2300)       # the big count
ticks(T["h2"], .8, F["deaths"], 5, .06, 1500)         # deaths
ticks(T["h2"] + .9, .9, F["today"], 14, .035, 2300)   # today
# impact on "sixty-eight"
put(fx, tone(150, 1.6, ((1, 1), (2, .2)), a=.004, d=2.4, f1=36), T["h2"], .85)
put(fx, lp(rs.standard_normal(int(.7 * SR)), 260) * env(int(.7 * SR), .001, 5), T["h2"], .55)
put(fx, hp(rs.standard_normal(int(.09 * SR)), 2500) * env(int(.09 * SR), .001, 45), T["h2"], .22)
# the expected-cases card: a rising chirp and a thin pad swell
put(fx, tone(300, .35, ((1, 1), (2, .3)), a=.01, d=6, f1=1200), T["h3"], .09)
for f in (220, 330, 440): put(fx, tone(f, 1.6, ((1, 1),), a=.4, d=1.3), T["h3"], .035)
# riser into the question, a breath of silence, then one low pulse
n = int(.75 * SR); r = hp(rs.standard_normal(n), 700) * np.linspace(0, 1, n) ** 2.2
put(fx, r, T["h4"] - .8, .11)
put(fx, tone(55, 1.8, ((1, 1), (2, .3)), a=.01, d=2.0), T["h4"] + .05, .6)

# voice
def load_vo(k):
    x, sr = read(f"work/vo_{k}.wav"); x = x[:, 0]; x = resample_poly(x, SR, sr) if sr != SR else x; x = hp(x, 90)
    x = x / (np.max(np.abs(x)) + 1e-9)
    f = np.minimum(1, np.arange(len(x)) / (.02 * SR)) * np.minimum(1, (len(x) - np.arange(len(x))) / (.04 * SR)); return x * f
voenv = np.zeros(NH)
for k in ("h1", "h2", "h3", "h4"):
    x = load_vo(k); put(vo, x, T[k], .78); i0 = int(T[k] * SR); voenv[i0:i0 + len(x)] = 1
duck = 1 - .45 * np.clip(np.convolve(voenv, np.ones(int(.3 * SR)) / int(.3 * SR), mode="same") * 1.5, 0, 1)

# a touch of room on everything that is not the voice
n = int(1.4 * SR); ir = rs.standard_normal(n) * np.exp(-3.4 * np.arange(n) / n); ir = lp(ir, 5000); ir /= np.sqrt(np.sum(ir ** 2))
bus = (drone + beats + fx) * duck
bus = bus * .8 + fftconvolve(bus, ir)[:NH] * .35
hook_nov = bus.copy()
hook_all = bus + vo

# match the hook's voice loudness to the body's voice, so the two halves sit together
body_vo, _ = read("work/audio_voice_only.wav"); bv = body_vo[:, 0]; bv = bv[np.abs(bv) > .01]
hv = vo[np.abs(vo) > .01]
ratio = np.sqrt(np.mean(bv ** 2)) / (np.sqrt(np.mean(hv ** 2)) + 1e-9)
vo *= ratio; hook_all = bus + vo
hook_vo = vo.copy()

# ---------------------------------------------------------------- join to the body
def body_stem(name):
    x, _ = read(f"work/{name}.wav"); return x
def join(hook_sig, body_x):
    out = np.zeros((int(SR * TOTAL), 2))
    tail = np.ones(NH); nfade = int(.5 * SR); tail[-nfade:] = np.cos(np.linspace(0, np.pi / 2, nfade)) ** 2
    out[:NH, 0] += hook_sig * tail; out[:NH, 1] += hook_sig * tail
    i0 = int(round(D * SR)); n = min(len(body_x), len(out) - i0); out[i0:i0 + n] += body_x[:n]
    return out
def write(name, x):
    y = np.tanh(x * 1.05) / np.tanh(1.05)
    with wave.open(name, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(y, -1, 1) * 32767).astype(np.int16).tobytes())
# hook levels are on the same scale as the body mix (which was normalised to about -1 dBFS peak)
g = 1.0
write("work/audio_final.wav", join(hook_all * g, body_stem("audio_mix")))
write("work/audio_final_no_voice.wav", join(hook_nov * g, body_stem("audio_no_voice")))
write("work/audio_final_voice_only.wav", join(hook_vo * g, body_stem("audio_voice_only")))

# ---------------------------------------------------------------- sidecar subtitles and chapter list for the final cut
HOOK_CAPS = [
    (T["h1"], T["h1"] + DUR["h1"], "Over eighty-three thousand dengue cases this year.", "Lebih 83,000 kes denggi tahun ini."),
    (T["h2"], T["h2"] + DUR["h2"], "Sixty-eight deaths.", "68 kematian."),
    (T["h3"], T["h3"] + DUR["h3"], "About four thousand more expected in the next two weeks.", "Kira-kira 4,000 lagi dijangka dalam dua minggu akan datang."),
    (T["h4"], T["h4"] + DUR["h4"], "Is your district next?", "Adakah daerah anda yang seterusnya?"),
]
caps = [{"a": a, "b": b, "en": en, "ms": ms} for a, b, en, ms in HOOK_CAPS] + [{"a": round(c["a"] + D, 2), "b": round(c["b"] + D, 2), "en": c["en"], "ms": c["ms"]} for c in plan["captions"]]
def ts(x): h, m, s = int(x // 3600), int(x % 3600 // 60), x % 60; return f"{h:02d}:{m:02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}"
for name, fn in (("en", lambda c: c["en"]), ("ms", lambda c: c["ms"]), ("bilingual", lambda c: c["en"] + "\n" + c["ms"])):
    with open(f"work/subs_{name}.srt", "w") as f:
        for i, c in enumerate(caps, 1): f.write(f"{i}\n{ts(c['a'])} --> {ts(c['b'])}\n{fn(c)}\n\n")
json.dump({"D": D, "total": round(TOTAL, 2), "captions": caps, "start": {str(k): round(v + D, 2) for k, v in plan["start"].items()}}, open("work/plan_final.json", "w"), indent=1)
print("final audio", round(TOTAL, 2), "s; hook voice gain vs body", round(float(ratio), 2))
