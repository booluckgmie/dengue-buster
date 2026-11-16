"""Synthesise the English voice-over line by line and report each line's length."""
import json, sys, wave
from piper import PiperVoice, SynthesisConfig

LINES = {
    1: "After the rain, water collects in places we forget to look.",
    2: "For a parent, a health officer and an analyst, the questions are different. The need is the same: know sooner.",
    3: "This is Dengue Buster: a two-week outlook for every district in Malaysia.",
    4: "Type where you are. See your district's risk, and what is happening within a few kilometres.",
    5: "Then, simple steps that fit the risk level.",
    6: "Open the map. Switch layers: rain, density, schools, construction.",
    7: "Every estimate shows its reasons and its range, and who is most exposed.",
    8: "For field teams, a ranked list of schools, kindergartens and building sites. Priorities to inspect first, not findings about any site.",
    9: "And for analysts, the evidence in the open: what predicts dengue, what does not, and how often the forecast missed.",
    10: "In English or Bahasa Malaysia. Light or dark.",
    11: "Built on open data, refreshed every day. District figures are estimates, so we show you the range.",
    12: "Check your surroundings. Clear standing water. Look out for each other.",
}
voice = PiperVoice.load("voices/en_GB-alba-medium.onnx")
SCALE = {2: 0.88, 11: 0.88}   # these two lines are slightly too long for their scenes
out = {}
for k, text in LINES.items():
    path = f"work/vo_{k:02d}.wav"
    with wave.open(path, "wb") as wf:
        voice.synthesize_wav(text, wf, syn_config=SynthesisConfig(length_scale=SCALE.get(k, 1.0)))
    with wave.open(path) as r:
        out[k] = round(r.getnframes() / r.getframerate(), 2)
    print(k, out[k], "s")
json.dump(out, open("work/vo_durations.json", "w"))
