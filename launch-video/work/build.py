"""Encodes each segment, joins them with 0.5 s crossfades, adds the soundtrack."""
import json, subprocess, pathlib, sys
W = pathlib.Path('work'); FPS = 30
plan = json.load(open(W / 'plan.json')); hook = json.load(open(W / 'plan_hook.json'))
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(' '.join(cmd)[:300]); print(r.stderr[-1500:]); sys.exit(1)

# 1. illustrated scenes: image sequences -> mp4
for n in (0, 1, 2, 3, 11, 12):
    run(['ffmpeg', '-y', '-framerate', str(FPS), '-i', f'work/frames/s{n:02d}/%06d.jpg', '-c:v', 'libx264', '-crf', '14', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', str(FPS), f'work/seg_s{n:02d}.mp4'])
    print('segment', n)

# 2. live recording: variable-rate screencast frames -> constant 30 fps, holding each frame for as long as it was on screen
LIVE_LEN = 61.5
fr = json.load(open('work/frames_live/frames.json'))['frames']
fr = sorted(fr, key=lambda f: f['t'])
before = [f for f in fr if f['t'] <= 0]; after = [f for f in fr if f['t'] > 0]
seq = ([dict(before[-1], t=0.0)] if before else []) + after
lines = []
for i, f in enumerate(seq):
    end = seq[i + 1]['t'] if i + 1 < len(seq) else LIVE_LEN
    lines.append(f"file '{pathlib.Path('work/frames_live', f['f']).resolve()}'\nduration {max(end - f['t'], 0.001):.4f}")
lines.append(f"file '{pathlib.Path('work/frames_live', seq[-1]['f']).resolve()}'")
(W / 'live_list.txt').write_text('\n'.join(lines))
run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', 'work/live_list.txt', '-vf', f'fps={FPS},scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '15', '-preset', 'medium', '-t', str(LIVE_LEN), 'work/seg_live.mp4'])
print('segment live')

# 3. crossfade chain
segs = [('s00', round(hook['D'] + 0.5, 2)), ('s01', 6.5), ('s02', 7.5), ('s03', 5.5), ('live', LIVE_LEN), ('s11', 6.5), ('s12', 7.0)]
X = 0.5; inputs = []; fc = []; L = segs[0][1]
for name, _ in segs: inputs += ['-i', f'work/seg_{name}.mp4']
prev = '[0:v]'
for k in range(1, len(segs)):
    off = L - X; out = f'[v{k}]'
    fc.append(f'{prev}[{k}:v]xfade=transition=fade:duration={X}:offset={off:.3f}{out}'); prev = out; L = L + segs[k][1] - X
print('total length', round(L, 2))
run(['ffmpeg', '-y', *inputs, '-filter_complex', ';'.join(fc), '-map', prev, '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-movflags', '+faststart', 'work/video_silent.mp4'])
print('joined')
