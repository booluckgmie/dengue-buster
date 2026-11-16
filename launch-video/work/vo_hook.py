"""Voice lines for the opening hook, and the timing plan that drives its pictures and sound (work/plan_hook.json)."""
import json, wave
from piper import PiperVoice, SynthesisConfig
voice = PiperVoice.load("voices/en_GB-alba-medium.onnx")
B = json.load(open('../web/data/bundle.json')); N = B['national']
LINES = [("h1", "Over eighty-three thousand dengue cases this year.", .9), ("h2", "Sixty-eight deaths.", 1.0),
         ("h3", "About four thousand more expected in the next two weeks.", .9), ("h4", "Is your district next?", 1.05)]
dur = {}
for k, text, sc in LINES:
    p = f"work/vo_{k}.wav"
    with wave.open(p, "wb") as wf: voice.synthesize_wav(text, wf, syn_config=SynthesisConfig(length_scale=sc))
    with wave.open(p) as r: dur[k] = round(r.getnframes() / r.getframerate(), 2)
t1 = 0.35; t2 = t1 + dur['h1'] + 0.2; t3 = t2 + dur['h2'] + 0.25; t4 = t3 + dur['h3'] + 0.3
D = round(t4 + dur['h4'] + 0.7, 2)
json.dump({"dur": dur, "t": {"h1": round(t1, 2), "h2": round(t2, 2), "h3": round(t3, 2), "h4": round(t4, 2)}, "D": D,
           "figures": {"cum": N['cum'], "deaths": N['deaths'], "today": N['today'], "exp14": int(N['exp14'])}, "snapshot": B['meta']['snapshot']}, open("work/plan_hook.json", "w"), indent=1)
