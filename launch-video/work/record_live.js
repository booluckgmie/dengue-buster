// Films scenes 4 to 10 as one continuous flow on the live site, using Chrome's screencast for high-quality frames.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const plan = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan.json')));
const URL = 'https://dengue-buster-phi.vercel.app/';
const MAXT = process.env.MAXT ? +process.env.MAXT : 61.5;          // seconds of the flow to record (61.5 for the full cut)
const OUT = path.join(__dirname, process.env.OUTDIR || 'frames_live');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INJECT = `(() => { const run = () => {
  const Z = 1.5; document.documentElement.style.zoom = String(Z);
  const css = document.createElement('style');
  css.textContent = \`
    #vid-cursor{position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;transform:translate(600px,280px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
    .vid-rip{position:fixed;z-index:2147483646;pointer-events:none;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid rgba(11,110,114,.85);background:rgba(11,110,114,.14);animation:vidrip .55s ease-out forwards}
    @keyframes vidrip{from{transform:scale(.25);opacity:1}to{transform:scale(1.5);opacity:0}}
    #vid-cap{position:fixed;left:0;right:0;bottom:26px;z-index:2147483645;display:flex;justify-content:center;pointer-events:none;opacity:0;transition:opacity .25s}
    #vid-cap .box{background:rgba(13,27,30,.84);border-radius:12px;padding:9px 22px 11px;max-width:1120px;text-align:center;box-shadow:0 6px 22px rgba(0,0,0,.28)}
    #vid-cap .en{font:600 23.5px/1.25 Inter,system-ui,sans-serif;color:#fff} #vid-cap .ms{font:500 18.5px/1.3 Inter,system-ui,sans-serif;color:#bfe6e3;margin-top:3px}
    #side.vid-grow .pyr .b{animation:vidgrow .9s cubic-bezier(.2,.8,.2,1) both}
    #side.vid-grow .pyr .m{transform-origin:right center} #side.vid-grow .pyr .f{transform-origin:left center}
    @keyframes vidgrow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    .vid-grow .bars .fill{animation:vidgrowx .9s cubic-bezier(.2,.8,.2,1) both;transform-origin:left center}
    @keyframes vidgrowx{from{transform:scaleX(0)}to{transform:scaleX(1)}}
    .vid-reveal svg.chart{animation:vidreveal 1.5s ease both} @keyframes vidreveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
  \`;
  document.documentElement.appendChild(css);
  const cur = document.createElement('div'); cur.id = 'vid-cursor';
  cur.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2.5l15 9-6.6 1.6L8.6 20z" fill="#0d1b1e" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(cur);
  addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + (e.clientX / Z - 3) + 'px,' + (e.clientY / Z - 2) + 'px)'; }, true);
  addEventListener('mousedown', (e) => { const r = document.createElement('div'); r.className = 'vid-rip'; r.style.left = (e.clientX / Z) + 'px'; r.style.top = (e.clientY / Z) + 'px'; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700); }, true);
  const cap = document.createElement('div'); cap.id = 'vid-cap'; cap.innerHTML = '<div class="box"><div class="en"></div><div class="ms"></div></div>'; document.documentElement.appendChild(cap);
  window.__cap = (en, ms) => { if (!en) { cap.style.opacity = 0; return; } cap.querySelector('.en').textContent = en; cap.querySelector('.ms').textContent = ms; cap.style.opacity = 1; };
  window.__flash = (sel, ms) => { const e = document.querySelector(sel); if (!e) return; e.style.transition = 'box-shadow .2s'; e.style.boxShadow = '0 0 0 5px rgba(11,110,114,.55)'; setTimeout(() => { e.style.boxShadow = ''; }, ms || 900); };
  const ease = (k) => (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  window.__scrollTo = (y, ms) => new Promise((res) => { const y0 = scrollY, t0 = performance.now(); (function f(now) { const k = Math.min(1, (now - t0) / ms); window.scrollTo(0, y0 + (y - y0) * ease(k)); k < 1 ? requestAnimationFrame(f) : res(); })(t0); });
  window.__scrollEl = (sel, y, ms) => new Promise((res) => { const el = document.querySelector(sel), y0 = el.scrollTop, t0 = performance.now(); (function f(now) { const k = Math.min(1, (now - t0) / ms); el.scrollTop = y0 + (y - y0) * ease(k); k < 1 ? requestAnimationFrame(f) : res(); })(t0); });
  window.__retrigger = (sel, cls) => { const e = document.querySelector(sel); if (!e) return; e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); };
  }; if (document.documentElement && document.body) run(); else document.addEventListener('DOMContentLoaded', run); })();`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, locale: 'en-GB', colorScheme: 'light' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', e.message));
  await page.addInitScript(INJECT);
  await page.route('https://photon.komoot.io/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ features: [{ properties: { name: 'Pandan Indah', district: 'Ampang Jaya', city: 'Ampang', state: 'Selangor', countrycode: 'MY' }, geometry: { coordinates: [101.7478, 3.1361] } }] }) }));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} document.fonts.ready; });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 0));

  // ---- screencast
  const cdp = await ctx.newCDPSession(page);
  const frames = []; let n = 0;
  cdp.on('Page.screencastFrame', (e) => {
    cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
    const f = String(n++).padStart(6, '0') + '.jpg';
    fs.writeFileSync(path.join(OUT, f), Buffer.from(e.data, 'base64'));
    frames.push({ f, ts: e.metadata && e.metadata.timestamp ? e.metadata.timestamp : Date.now() / 1000 });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await sleep(600);

  const T0 = Date.now() / 1000;
  const now = () => Date.now() / 1000 - T0;
  const waitUntil = async (t) => { const d = t - now(); if (d > 0) await sleep(d * 1000); };
  const events = [];
  const ev = (type, extra) => events.push({ t: +now().toFixed(3), type, ...(extra || {}) });
  let mx = 900, my = 420;
  await page.mouse.move(mx, my);

  const moveTo = async (x, y, dur = 600) => {
    const x0 = mx, y0 = my, steps = Math.max(8, Math.round(dur / 16));
    for (let i = 1; i <= steps; i++) { const k = i / steps, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; mx = x0 + (x - x0) * e; my = y0 + (y - y0) * e; await page.mouse.move(mx, my); await sleep(dur / steps); }
  };
  const STICKY = /^(#tabs|\.lang|#theme|#side|#queue)/;           // controls that live in the header or in their own scroll area
  const center = async (sel) => {
    const loc = page.locator(sel).first(); let b = await loc.boundingBox();
    if (!b) throw new Error('no box for ' + sel);
    if (!STICKY.test(sel) && (b.y < 150 || b.y + b.height > 1010)) {      // keep targets clear of the sticky header and the caption
      await page.evaluate((y) => window.__scrollTo(scrollY + y - 520, 500), b.y); b = await loc.boundingBox();
    }
    return [b.x + b.width / 2, b.y + b.height / 2];
  };
  const clickAt = async (sel, dur = 600, tag = 'click') => { const [x, y] = await center(sel); await moveTo(x, y, dur); await page.mouse.down(); ev(tag); await sleep(90); await page.mouse.up(); };
  // set a <select> directly: Playwright's visibility check misreads selects inside the zoomed page
  const setSel = (sel, v) => page.evaluate(([s, val]) => { const e = document.querySelector(s); e.value = val; e.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
  const flash = (sel, ms) => page.evaluate(([s, m]) => window.__flash(s, m), [sel, ms]);

  // no burned-in subtitles in the film
  try { flow: {
  // ===== Scene 4: Am I affected? (T 0 to 11)
  await waitUntil(1.0); await clickAt('#find', 700);
  await waitUntil(2.0); for (const ch of 'Pandan Indah') { await page.keyboard.type(ch); ev('key'); await sleep(112); }
  await waitUntil(3.9); await clickAt('#find-form button[type=submit]', 600);
  await waitUntil(5.0); await page.evaluate(() => { const e = document.querySelector('#found'); return window.__scrollTo(e.getBoundingClientRect().top + scrollY - 108, 1100); }); ev('scroll');
  await waitUntil(6.4); await flash('#found .rad', 1200); await clickAt('#found .rad button[data-r="1"]', 650);
  await waitUntil(8.0); await clickAt('#found .rad button[data-r="5"]', 650);
  await waitUntil(9.6); await clickAt('#found .rad button[data-r="2"]', 650);
  if (MAXT <= 11) break flow;
  // ===== Scene 5: What should I do? (T 11 to 18)
  await waitUntil(11.0); await page.evaluate(() => { const u = [...document.querySelectorAll('#found ul')].find((x) => !x.classList.contains('near')); u.querySelectorAll('li').forEach((li) => { li.style.opacity = .22; li.style.transition = 'opacity .4s'; }); return window.__scrollTo(u.getBoundingClientRect().top + scrollY - 250, 1200); }); ev('scroll');
  for (let i = 0; i < 4; i++) { await waitUntil(12.9 + i * 0.85); await page.evaluate((i) => { const u = [...document.querySelectorAll('#found ul')].find((x) => !x.classList.contains('near')), li = u.querySelectorAll('li')[i]; if (!li) return; li.style.opacity = 1; li.insertAdjacentHTML('afterbegin', '<span style="color:#0a8f0a;font-weight:700;margin-right:8px">&#10003;</span>'); }, i); ev('tick'); }
  if (MAXT <= 18) break flow;
  // ===== Scene 6: See the whole picture (T 18 to 29)
  await waitUntil(18.1); await page.evaluate(() => { const b = document.querySelector('#f-map'); return window.__scrollTo(b.getBoundingClientRect().top + scrollY - 420, 700); });
  await waitUntil(18.9); await clickAt('#f-map', 650, 'zoom'); await page.waitForSelector('#tab-map:not([hidden])', { timeout: 5000 });
  await waitUntil(21.3); await clickAt('#layer', 700);
  for (const [t, id] of [[22.3, 'rain14'], [23.1, 'density'], [23.9, 'edu'], [24.7, 'constr'], [26.0, 'tier']]) { await waitUntil(t); await setSel('#layer', id); ev('layer'); await flash('#layer', 700); }
  await waitUntil(26.6); await clickAt('#z-all', 650, 'zoom');
  if (MAXT <= 29) break flow;
  // ===== Scene 7: reasons, range, who is exposed (T 29 to 36)
  await waitUntil(29.1);
  { const box = await page.evaluate(() => { const D = window.DENGUE, id = D.districts.find((d) => d.district === 'Ulu Langat').id; const p = [...document.querySelectorAll('#map path.d')].find((q) => q.__data__.id === id); const r = p.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await moveTo(box.x, box.y, 800); await page.mouse.down(); ev('click'); await sleep(90); await page.mouse.up();
    await sleep(500); const ok = await page.evaluate(() => !!document.querySelector('#map path.d.sel')); if (!ok) { await clickAt('#side .rank li >> nth=4', 500); } }
  await waitUntil(32.4); await page.evaluate(() => { const s = document.querySelector('#side'), h = [...s.querySelectorAll('h3')].find((x) => /exposed|terdedah/i.test(x.textContent)); return window.__scrollEl('#side', h.getBoundingClientRect().top - s.getBoundingClientRect().top + s.scrollTop - 10, 1300); }); ev('scroll');
  await waitUntil(33.9); await page.evaluate(() => { document.querySelectorAll('#side .pyr .b').forEach((b, i) => { b.style.animationDelay = (i * 0.035) + 's'; }); window.__retrigger('#side', 'vid-grow'); }); ev('grow');
  if (MAXT <= 36) break flow;
  // ===== Scene 8: who acts (T 36 to 46)
  await waitUntil(36.0); await clickAt('#tabs button[data-tab=inspect]', 700, 'tab');
  await waitUntil(37.6); await flash('#caution', 1400);
  await waitUntil(38.5); await clickAt('#kind button[data-k=construction]', 700);
  await waitUntil(40.4); await clickAt('#qstate', 700); await waitUntil(41.2); await setSel('#qstate', 'Selangor'); ev('layer'); await flash('#qstate', 800);
  await waitUntil(42.6); await flash('#caution', 1500);
  await waitUntil(43.8); { const [x, y] = await center('#queue tbody tr:nth-child(3)'); await moveTo(x, y, 800); }
  if (MAXT <= 46) break flow;
  // ===== Scene 9: can we trust it (T 46 to 55)
  await waitUntil(46.1); await clickAt('#tabs button[data-tab=evidence]', 700, 'tab');
  await waitUntil(48.3); await page.evaluate(() => { const e = document.querySelector('#abl'); return window.__scrollTo(e.getBoundingClientRect().top + scrollY - 190, 1100); }); ev('scroll');
  await waitUntil(49.5); await page.evaluate(() => { window.__retrigger('#abl', 'vid-grow'); window.__retrigger('#hz', 'vid-reveal'); }); ev('grow');
  await waitUntil(51.0); await page.evaluate(() => { const e = document.querySelector('#bt'); return window.__scrollTo(e.getBoundingClientRect().top + scrollY - 170, 1200); }); ev('scroll');
  await waitUntil(52.4); await page.evaluate(() => window.__retrigger('#bt', 'vid-reveal')); ev('grow');
  if (MAXT <= 55) break flow;
  // ===== Scene 10: language and light (T 55 to 61)
  await waitUntil(55.0); await clickAt('#tabs button[data-tab=today]', 650, 'tab');
  await waitUntil(56.0); await clickAt('.lang button[data-lang=ms]', 600, 'toggle');
  await waitUntil(57.5); await clickAt('#theme', 600, 'toggle');
  } } catch (err) { console.log('FLOW ERROR at t=' + now().toFixed(2), String(err.message).split('\n')[0]); await page.screenshot({ path: path.join(__dirname, 'flow_error_' + Date.now() + '.png') }); }
  await waitUntil(Math.min(MAXT, now() + 1));

  await cdp.send('Page.stopScreencast');
  await sleep(300);
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ T0, frames: frames.map((f) => ({ f: f.f, t: +(f.ts - T0).toFixed(4) })) }));
  fs.writeFileSync(path.join(__dirname, 'live_events.json'), JSON.stringify(events));
  console.log('frames', frames.length, 'events', events.length, 'last t', frames.length ? (frames[frames.length - 1].ts - T0).toFixed(2) : 0);
  const b0 = fs.statSync(path.join(OUT, '000000.jpg')).size; console.log('first frame bytes', b0);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
