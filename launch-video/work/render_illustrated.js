// Renders the illustrated scenes frame by frame (30 fps) so motion is perfectly smooth.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan.json')));
const ONLY = process.argv[2] ? process.argv[2].split(',').map(Number) : null;
const LEN = { 1: 6.5, 2: 7.5, 3: 5.5, 11: 6.5, 12: 7 };      // includes the 0.5 s overlap used for the crossfade
const FPS = 30;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto('file://' + path.join(__dirname, 'scenes.html'));
  await p.waitForTimeout(1500);
  for (const n of Object.keys(LEN).map(Number)) {
    if (ONLY && !ONLY.includes(n)) continue;
    const dir = path.join(__dirname, 'frames', 's' + String(n).padStart(2, '0'));
    fs.mkdirSync(dir, { recursive: true });
    await p.evaluate(([n, caps, off]) => window.load(n, caps, off), [n, plan.captions, plan.start[n]]);
    const frames = Math.round(LEN[n] * FPS);
    for (let i = 0; i < frames; i++) {
      await p.evaluate(t => window.seek(t), i / FPS);
      await p.screenshot({ path: path.join(dir, String(i).padStart(6, '0') + '.jpg'), type: 'jpeg', quality: 92 });
    }
    console.log('scene', n, frames, 'frames');
  }
  await b.close();
})();
