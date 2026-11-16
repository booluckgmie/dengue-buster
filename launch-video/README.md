# Launch film

92-second launch film for Dengue Buster, built entirely from code so it can be re-cut when the product changes.

| Step | Script | What it does |
|---|---|---|
| 1 | `work/vo.py` | English voice-over with Piper (`voices/en_GB-alba-medium.onnx`, download from rhasspy/piper-voices) |
| 2 | `work/plan.py` | Master timeline: scene starts, voice placement, caption windows -> `work/plan.json` |
| 3 | `work/render_illustrated.js` | Scenes 1, 2, 3, 11, 12 rendered frame by frame at 30 fps from `work/scenes.html` |
| 4 | `work/record_live.js` | Scenes 4-10: films the live site through a scripted user journey (Chrome screencast, 1920x1080) |
| 5 | `work/mix.py` | Music, rain, UI sounds from the click log, voice with ducking; writes stems and SRT files |
| 6 | `work/build.py`, then `work/finish.sh` | Encodes segments and crossfades them; then adds the soundtrack with loudness normalisation and makes the web version |

Requires: Node + Playwright (Chromium), Python (numpy, scipy, piper-tts), ffmpeg.
Outputs go to `out/` (git-ignored). Run order is the table order; `record_live.js` needs network access to the live site.
