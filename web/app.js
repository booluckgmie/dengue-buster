/* Dengue Buster dashboard. Reads window.DENGUE (web/data/bundle.js, written by the pipeline) and window.I18N (web/i18n.js).
   Tabs: Today (everyone) / Map (explore) / Inspection (field teams) / Evidence (analysts) / About. Languages: English, Bahasa Malaysia. */
(function () {
  const D = window.DENGUE, X = window.I18N;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  if (!D || !window.d3 || !X) { document.querySelector("main").innerHTML = '<p class="panel pad">No data bundle found. Run <span class="mono">python -m pipeline.run</span> to build <span class="mono">web/data/bundle.js</span>, then reload.</p>'; return; }
  const fmt = d3.format(","), f1 = d3.format(",.1f"), f2 = d3.format(".2f");
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ================= language ================= */
  let lang = (function () {
    try { const s = localStorage.getItem("db-lang"); if (s === "en" || s === "ms") return s; } catch (e) { /* storage may be blocked */ }
    return (navigator.language || "").toLowerCase().startsWith("ms") ? "ms" : "en";
  })();
  const missing = (window.__i18nMissing = new Set());
  const t = (k, ...a) => {
    let v = X[lang][k];
    if (v === undefined) { missing.add(lang + ":" + k); v = X.en[k]; }
    if (v === undefined) return k;
    return typeof v === "string" ? v.replace(/\{(\d+)\}/g, (m, i) => (a[+i] === undefined ? "" : a[+i])) : v;
  };
  const has = (k) => X.en[k] !== undefined;
  const locale = () => (lang === "ms" ? "ms-MY" : "en-GB");
  const TIERS = ["Low", "Moderate", "High", "Very high"];
  const tierName = (x) => t("tier." + x);
  const pill = (x) => `<span class="pill t-${x.split(" ")[0]}"><i></i>${tierName(x)}</span>`;
  const dfmt = (s) => new Date(s + "T00:00:00").toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
  const dshort = (s) => dfmt(s).replace(/ \d{4}$/, "");
  const clean = (n) => n.replace(/^W\.P\. /, "");
  const kindName = (k) => t("kind." + k);
  const specName = (s) => (has("spec." + s) ? t("spec." + s) : s);
  const byId = new Map(D.districts.map((d) => [d.id, d]));
  const regionOf = new Map(D.regions.map((r) => [r.region, r]));
  const tierColor = (x) => css("--t" + TIERS.indexOf(x));
  const tip = $("#tip");
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect(), x = Math.min(ev.clientX + 14, innerWidth - r.width - 8), y = ev.clientY + 16 + r.height > innerHeight ? ev.clientY - r.height - 10 : ev.clientY + 16;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };

  // d3 needs clockwise exterior rings (also for point-in-polygon); GeoJSON from GIS tools is usually the reverse.
  D.geo.features.forEach((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    polys.forEach((p) => p.forEach((ring, i) => { const big = d3.geoArea({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI; if (i === 0 ? big : !big) ring.reverse(); }));
  });

  // Drawing geometry: East Malaysia is moved SHIFT degrees west so both halves of the country fill the same frame
  // (like the Alaska inset on a US map). Lookups such as "which district is this point in" always use real coordinates.
  const SHIFT = 3.6, sh = (lon) => (lon > 106.5 ? lon - SHIFT : lon);
  const shiftCoords = (c) => (typeof c[0] === "number" ? [sh(c[0]), c[1]] : c.map(shiftCoords));
  const GEO2 = { type: "FeatureCollection", features: D.geo.features.map((f) => ({ type: "Feature", id: f.id, properties: f.properties, geometry: { type: f.geometry.type, coordinates: shiftCoords(f.geometry.coordinates) } })) };
  function mapBase(el, w, h, coll) {
    const s = d3.select(el); s.selectAll("*").remove(); s.attr("viewBox", `0 0 ${w} ${h}`);
    const pr = d3.geoMercator().fitExtent([[6, 6], [w - 6, h - 6]], coll || GEO2);
    return { s, pr, pa: d3.geoPath(pr), P: (lo, la) => pr([sh(lo), la]) };
  }

  /* ================= theme ================= */
  const root = document.documentElement;
  const sysDark = () => matchMedia("(prefers-color-scheme: dark)").matches;
  const effTheme = () => root.dataset.theme || (sysDark() ? "dark" : "light");
  try { const s = localStorage.getItem("db-theme"); if (s === "light" || s === "dark") root.dataset.theme = s; } catch (e) { /* storage may be blocked */ }
  const ICONS = {
    moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  };
  function themeButton() {
    const dark = effTheme() === "dark", b = $("#theme");
    b.innerHTML = dark ? ICONS.sun : ICONS.moon;
    const label = t(dark ? "theme.tolight" : "theme.todark");
    b.setAttribute("aria-label", label); b.title = label;
  }
  $("#theme").onclick = () => {
    const next = effTheme() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("db-theme", next); } catch (e) { /* optional */ }
    themeButton();
  };

  /* ================= router ================= */
  const TABS = ["today", "map", "inspect", "evidence", "about"];
  function go(tab, o = {}) {
    if (!TABS.includes(tab)) tab = "today";
    $$(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + tab));
    $$("#tabs button").forEach((b) => (b.getAttribute("data-tab") === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    if (tab === "map") initMap();
    if (tab === "evidence") renderEvidence();       // chart widths follow the container, which is only known once visible
    try { if (location.hash.slice(1) !== tab) history.replaceState(null, "", "#" + tab); } catch (e) { /* hash routing is optional */ }
    if (o.scroll !== false) window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
  }
  $$("#tabs button").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  addEventListener("hashchange", () => go(location.hash.slice(1), { scroll: false }));
  function openDistrict(id) { go("map", { scroll: false }); select(id); $("#map").scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); }

  /* ================= shared data ================= */
  const N = D.national, tc = N.tiers, nHigh = (tc["High"] || 0) + (tc["Very high"] || 0);
  const ranked = D.districts.slice().sort((a, b) => a.rank - b.rank);
  const KIND = { school: "--s1", kindergarten: "--s2", construction: "--s3" };
  const KINDS = Object.keys(KIND);
  let found = null, radiusKm = 2, stMetric = "inc", qKind = "all", selected = null, selectedSites = 0, kpiDone = false;

  /* ================= TODAY ================= */
  const byLabel = new Map(D.districts.map((d) => [`${clean(d.district)} (${clean(d.state)})`.toLowerCase(), d]));
  const findIn = $("#find"), say = (html, cls) => { $("#find-msg").className = "fine " + (cls || ""); $("#find-msg").innerHTML = html; };
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], R = Math.PI / 180;
  const hav = (la1, lo1, la2, lo2) => { const x = Math.sin((la2 - la1) * R / 2) ** 2 + Math.cos(la1 * R) * Math.cos(la2 * R) * Math.sin((lo2 - lo1) * R / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  const dir = (la1, lo1, la2, lo2) => { const y = Math.sin((lo2 - lo1) * R) * Math.cos(la2 * R), x = Math.cos(la1 * R) * Math.sin(la2 * R) - Math.sin(la1 * R) * Math.cos(la2 * R) * Math.cos((lo2 - lo1) * R); return DIRS[Math.round((((Math.atan2(y, x) / R) + 360) % 360) / 45) % 8]; };
  const km1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

  function renderHero() {
    const top3 = ranked.slice(0, 3).map((d) => clean(d.district));
    $("#h-eyebrow").textContent = t("hero.eyebrow", dshort(D.meta.window[0]), dshort(D.meta.window[1]));
    $("#h1").innerHTML = t("hero.h1", esc(top3[0]), esc(top3[1]), esc(top3[2]));
    $("#hsub").textContent = t("hero.sub", fmt(N.exp14), nHigh, D.districts.length, f1(N.pop_high / 1e6));
    $("#dlist").innerHTML = ranked.slice().sort((a, b) => a.district.localeCompare(b.district)).map((d) => `<option value="${esc(clean(d.district))} (${esc(clean(d.state))})"></option>`).join("");
  }
  // Hero map: every district coloured by tier, outbreak localities on top. Click opens the district on the main map.
  function renderHeroMap() {
    const { s, pa, P: P2 } = mapBase($("#hero-map"), 640, 330);
    s.append("g").selectAll("path").data(GEO2.features).join("path").attr("d", pa).attr("class", "hm").style("fill", (f) => tierColor(byId.get(f.id).tier))
      .on("mousemove", (ev, f) => { const d = byId.get(f.id); showTip(`<b>${esc(d.district)}</b> <span class="k">${esc(d.state)}</span><br>${t("tip.d", tierName(d.tier), f1(d.exp))}`, ev); })
      .on("mouseleave", hideTip).on("click", (ev, f) => openDistrict(f.id));
    s.append("g").selectAll("circle").data(D.outbreak_pts).join("circle").attr("class", "mini-ob").attr("r", 1.9).attr("cx", (p) => P2(p[0], p[1])[0]).attr("cy", (p) => P2(p[0], p[1])[1]);
    $("#hero-legend").innerHTML = TIERS.map((x) => `<span><i style="background:${tierColor(x)}"></i>${tierName(x)}</span>`).join("") + `<span><b class="mini-dot"></b>${t("leg.ob")}</span>`;
    $("#hero-cap").textContent = t("hero.map.cap") + " " + t("map.inset");
  }
  function renderTierDist() {
    const rows = TIERS.slice().reverse().map((x) => { const ds = D.districts.filter((d) => d.tier === x); return { x, n: ds.length, pop: d3.sum(ds, (d) => d.pop) }; }), tot = d3.sum(rows, (r) => r.pop) || 1;
    $("#tier-dist").innerHTML = `<div class="card-h"><h3>${t("dist.h")}</h3></div><div class="rows">` + rows.map((r) => `<div class="row tier-row"><span class="nm">${pill(r.x)}</span><span class="trk"><span class="gbar" style="--w:${(r.pop / tot) * 100}%;--c:${tierColor(r.x)}"></span></span><span class="v">${t("dist.row", `<b>${r.n}</b>`, f1(r.pop / 1e6))}</span></div>`).join("") + `</div>`;
  }

  function districtAt(lon, lat) {
    const f = D.geo.features.find((q) => d3.geoContains(q, [lon, lat]));
    if (f) return byId.get(f.id);
    const near = D.districts.map((d) => [hav(lat, lon, d.lat, d.lon), d]).sort((a, b) => a[0] - b[0])[0];
    return near && near[0] < 15 ? near[1] : null;       // coast and island points sit just outside the simplified polygons
  }
  function around(pt, km) {
    const within = (arr) => arr.map((p) => ({ p, d: hav(pt.lat, pt.lon, p[1], p[0]), dir: dir(pt.lat, pt.lon, p[1], p[0]) })).sort((a, b) => a.d - b.d);
    const ob = within(D.outbreak_pts), hs = within(D.hotspots), cnt = {};
    KINDS.forEach((k2) => (cnt[k2] = (D.sites[k2] || []).filter((p) => hav(pt.lat, pt.lon, p[1], p[0]) <= km).length));
    return { ob: ob.filter((x) => x.d <= km), hs: hs.filter((x) => x.d <= km), nearOb: ob[0], nearHs: hs[0], cnt };
  }
  const dn = (c) => t("dir." + c);
  function renderFound() {
    if (!found) { $("#found").innerHTML = ""; return; }
    const { d, pt } = found, ages = D.meta.ages, tot = d.age_m.map((v, i) => v + d.age_f[i]), sum = d3.sum(tot) || 1;
    const peak = ages[tot.indexOf(d3.max(tot))], share = (lo, hi) => d3.sum(ages.map((a, i) => (parseInt(a, 10) >= lo && parseInt(a, 10) <= hi ? tot[i] : 0))) / sum;
    let near = "";
    if (pt) {
      const S = around(pt, radiusKm), gc = D.meta.geocoded, miss = gc.outbreaks[1] - gc.outbreaks[0];
      let v;
      if (S.nearOb && S.nearOb.d <= 1) v = ["alert", t("near.alert", esc(S.nearOb.p[2]), km1(S.nearOb.d), dn(S.nearOb.dir))];
      else if (S.ob.length) v = ["watch", t("near.watch", S.ob.length, S.ob.length > 1 ? t("near.loc.many") : t("near.loc.one"), radiusKm, esc(S.ob[0].p[2]), km1(S.ob[0].d), dn(S.ob[0].dir))];
      else if (S.hs.length) v = ["watch", t("near.hs", esc(S.hs[0].p[2]), km1(S.hs[0].d), dn(S.hs[0].dir))];
      else v = ["calm", t("near.calm", radiusKm, S.nearOb ? t("near.calm.nearest", km1(S.nearOb.d), dn(S.nearOb.dir)) : "", miss, gc.outbreaks[1])];
      const list = (xs, f) => (xs.length ? `<ul class="near">${xs.slice(0, 5).map(f).join("")}</ul>` : "");
      near = `<div class="verdict ${v[0]}">${v[1]}</div>
        <div class="rad"><span class="muted">${t("near.within")}</span><div class="seg" role="group" aria-label="${t("rad.aria")}">${[1, 2, 5].map((r) => `<button type="button" data-r="${r}" aria-pressed="${r === radiusKm}">${r} km</button>`).join("")}</div></div>
        <div class="stats five"><div><b>${S.ob.length}</b><span>${t("near.stat.ob")}</span></div><div><b>${S.hs.length}</b><span>${t("near.stat.hs")}</span></div>${KINDS.map((k2) => `<div><b>${S.cnt[k2]}</b><span>${t("near.stat." + k2)}</span></div>`).join("")}</div>
        ${list(S.ob, (x) => `<li><b>${esc(x.p[2])}</b> <span class="muted">${km1(x.d)} km ${dn(x.dir)}</span></li>`)}
        ${list(S.hs, (x) => `<li><b>${esc(x.p[2])}</b> <span class="muted">${t("near.hs.days", km1(x.d), dn(x.dir), x.p[6])}</span></li>`)}
        <p class="muted fine">${t("near.fine")}</p>`;
    }
    $("#found").innerHTML = `<div class="found"><div class="found-h"><h3>${esc(pt ? pt.label : clean(d.district) + ", " + clean(d.state))}</h3></div>
      <div class="found-h"><span class="muted">${t("f.district")}</span> <b>${esc(clean(d.district))}, ${esc(clean(d.state))}</b> ${pill(d.tier)} <span class="muted">${t("f.rank", d.rank, D.districts.length)}</span></div>
      ${near || `<p class="muted">${t("f.hint")}</p>`}
      <p><b>${t("tip." + d.tier + ".say")}</b> ${t("f.exp", f1(d.exp), fmt(d.lo), fmt(d.hi))}</p>
      <p class="fine muted">${t("f.stamp", dshort(D.meta.window[0]), dshort(D.meta.window[1]), dfmt(D.meta.snapshot))}</p>
      <div class="stats"><div><b>${peak}</b><span>${t("f.peak")}</span></div><div><b>${Math.round(share(5, 19) * 100)}%</b><span>${t("f.school")}</span></div><div><b>${Math.round(share(20, 49) * 100)}%</b><span>${t("f.work")}</span></div></div>
      <div><b>${t("f.helps")}</b><ul>${t("tip." + d.tier + ".you").map((x) => `<li>${x}</li>`).join("")}</ul></div>
      <p class="muted"><b>${t("f.team")}</b> ${t("tip." + d.tier + ".team")}</p>
      <div class="acts"><button type="button" class="btn primary" id="f-map">${t("f.map")}</button><button type="button" class="btn" id="f-ins">${t("f.ins")}</button></div></div>`;
    $$("#found .rad button").forEach((b) => (b.onclick = () => { radiusKm = +b.dataset.r; renderFound(); }));
    $("#f-map").onclick = () => { go("map", { scroll: false }); select(d.id); if (pt) { pin = { lat: pt.lat, lon: pt.lon, km: radiusKm }; drawPin(true); } $("#map").scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); };
    $("#f-ins").onclick = () => { go("inspect"); const s2 = $("#qstate"); s2.value = d.state; s2.dispatchEvent(new Event("change")); };
  }
  function choose(r) {
    const d = districtAt(r.lon, r.lat);
    if (!d) { say(t("find.outside"), "warn"); return; }
    found = { d, pt: r }; renderFound();
  }
  // Free-text geocoder (Photon, OpenStreetMap data). Understands addresses, estates, schools and landmarks.
  async function geocode(q) {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch("https://photon.komoot.io/api/?" + new URLSearchParams({ q, limit: 6, lang: "en", bbox: "99.5,0.8,119.5,7.5" }), { signal: ctl.signal });
      if (!r.ok) throw new Error("geocoder " + r.status);
      const js = await r.json(), seen = new Set();
      return js.features.filter((f) => f.properties.countrycode === "MY").map((f) => {
        const p = f.properties, label = [...new Set([p.name, p.street, p.district || p.locality, p.city, p.state].filter(Boolean))].join(", ");
        return { label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
      }).filter((r2) => !seen.has(r2.label) && seen.add(r2.label));
    } finally { clearTimeout(tm); }
  }
  // Offline fallback: places this dashboard already knows (districts, outbreak localities, hotspots, ranked sites).
  let gaz = null;
  function local(q) {
    if (!gaz) {
      gaz = D.districts.map((d) => ({ label: `${clean(d.district)}, ${clean(d.state)}`, lat: d.lat, lon: d.lon }))
        .concat(D.outbreak_pts.map((p) => ({ label: `${p[2]} (${t("leg.ob")})`, lon: p[0], lat: p[1] })))
        .concat(D.hotspots.map((p) => ({ label: `${p[2]} (${t("leg.hs")})`, lon: p[0], lat: p[1] })))
        .concat(D.priority.filter((s) => s.name).map((s) => ({ label: `${s.name} (${kindName(s.kind).toLowerCase()})`, lat: s.lat, lon: s.lon })));
    }
    const tk = q.toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1);
    return gaz.filter((g2) => tk.length && tk.every((w) => g2.label.toLowerCase().includes(w))).sort((a, b) => a.label.length - b.label.length).slice(0, 5);
  }
  function cands(list) {
    $("#cands").innerHTML = list.length > 1 ? `<span class="muted">${t("find.didyou")}</span>` + list.map((r, i) => `<button type="button" class="chip" data-i="${i}">${esc(r.label.length > 60 ? r.label.slice(0, 58) + "..." : r.label)}</button>`).join("") : "";
    $$("#cands .chip").forEach((b) => (b.onclick = () => choose(list[+b.dataset.i])));
  }
  $("#find-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = findIn.value.trim(); if (!q) return;
    const dl = byLabel.get(q.toLowerCase()) || D.districts.find((x) => clean(x.district).toLowerCase() === q.toLowerCase());
    if (dl) { say(""); cands([]); found = { d: dl, pt: null }; renderFound(); return; }
    say(t("find.looking"));
    let res = [], note = "";
    try { res = await geocode(q); } catch (err) { note = t("find.nogeo"); }
    if (!res.length) { res = local(q); if (!note && res.length) note = t("find.noaddr"); }
    if (!res.length) { say(t("find.none"), "warn"); cands([]); return; }
    say(note, note ? "muted" : ""); cands(res); choose(res[0]);
  });
  $("#locate").onclick = () => {
    if (!navigator.geolocation) { say(t("find.nogps"), "warn"); return; }
    say(t("find.gpswait"));
    navigator.geolocation.getCurrentPosition((p) => { say(""); cands([]); choose({ label: t("find.you"), lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => say(t("find.gpsfail"), "warn"), { timeout: 10000, maximumAge: 300000 });
  };
  findIn.addEventListener("change", () => { const v = findIn.value.trim().toLowerCase(), d = byLabel.get(v); if (d) { say(""); cands([]); found = { d, pt: null }; renderFound(); } });
  $$(".aud-c").forEach((b) => (b.onclick = () => { const g = b.dataset.go; if (g === "find") { findIn.focus(); findIn.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); } else go(g); }));

  function countUp(el, to, fn) {
    if (calm || kpiDone) { el.textContent = fn(to); return; }
    const t0 = performance.now(), dur = 900;
    (function step(now) { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fn(Math.round(to * e)); if (p < 1) requestAnimationFrame(step); })(t0);
  }
  function renderKpis() {
    const KP = [
      [t("kpi.today"), N.today, fmt, t("kpi.today.s")],
      [D.meta.cum_is_ytd ? t("kpi.ytd") : t("kpi.cum"), N.cum, fmt, t("kpi.since", dfmt(D.meta.cum_start))],
      [t("kpi.deaths"), N.deaths, fmt, t("kpi.deaths.s")],
      [t("kpi.exp"), N.exp14, fmt, t("kpi.exp.s")],
      [t("kpi.att"), nHigh, (v) => t("kpi.att.v", v, D.districts.length), t("kpi.att.s", f1(N.pop_high / 1e6))],
    ];
    $("#kpis").innerHTML = KP.map(([l, , , s]) => `<div class="kpi"><span class="eyebrow">${l}</span><span class="v num">0</span><span class="s">${s}</span></div>`).join("");
    $$("#kpis .v").forEach((el, i) => (KP[i][1] == null ? (el.textContent = t("na")) : countUp(el, KP[i][1], KP[i][2])));
    kpiDone = true;
  }
  function renderTop() {
    const mxI = d3.max(ranked.slice(0, 10), (d) => d.per100k);
    $("#topd").innerHTML = ranked.slice(0, 10).map((d, i) => `<button type="button" class="row" data-id="${d.id}" title="${esc(t("top.title", d.district, f1(d.exp)))}"><span class="nm">${esc(clean(d.district))}<span>${esc(clean(d.state))}</span></span><span class="trk"><span class="gbar" style="--w:${(d.per100k / mxI) * 100}%;--c:${tierColor(d.tier)};animation-delay:${i * 50}ms"></span></span><span class="v"><b>${f1(d.per100k)}</b> ${pill(d.tier)}</span></button>`).join("");
    $$("#topd .row").forEach((b) => (b.onclick = () => openDistrict(b.dataset.id)));
  }
  function renderStates() {
    const key = stMetric === "inc" ? (r) => r.inc_cum : (r) => r.cum, rs = D.regions.slice().sort((a, b) => key(b) - key(a)), mx = d3.max(rs, key);
    $("#states").innerHTML = rs.map((r, i) => `<div class="row" title="${esc(t("state.title", r.region, fmt(r.cum), fmt(r.today)))}"><span class="nm">${esc(clean(r.region).replace(" & Putrajaya", " + Putrajaya"))}<span>${t("state.today", r.today)}</span></span><span class="trk"><span class="gbar" style="--w:${(key(r) / mx) * 100}%;animation-delay:${i * 35}ms"></span></span><span class="v"><b>${stMetric === "inc" ? f1(r.inc_cum) : fmt(r.cum)}</b></span></div>`).join("");
    $("#st-note").textContent = t(stMetric === "inc" ? "state.note.inc" : "state.note.cum");
  }
  $$("#st-metric button").forEach((b) => (b.onclick = () => { stMetric = b.dataset.m; $$("#st-metric button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderStates(); }));

  const ROLES = [["today", "ok"], ["inspect", "part"], ["inspect", "part"], ["map", "part"], ["map", "ok"], ["about", "no"], ["map", "part"], ["evidence", "part"], ["evidence", "ok"]];
  const ICON = { ok: "&#10003;", part: "&#9680;", no: "&#10005;" };
  function renderRoles() {
    $("#roles").innerHTML = `<thead><tr>${["who", "q", "g", "d", "s"].map((c) => `<th>${t("roles.th." + c)}</th>`).join("")}</tr></thead><tbody>` +
      ROLES.map(([tab, st], i) => `<tr class="click" data-tab="${tab}" tabindex="0"><td><b>${t(`r${i + 1}.w`)}</b></td><td>${t(`r${i + 1}.q`)}</td><td>${t(`r${i + 1}.g`)}</td><td>${t(`r${i + 1}.d`)}</td><td><span class="st st-${st}">${ICON[st]} ${t(`r${i + 1}.s`)}</span></td></tr>`).join("") + "</tbody>";
    $$("#roles tr.click").forEach((tr) => { const open = () => go(tr.dataset.tab); tr.onclick = open; tr.onkeydown = (e) => { if (e.key === "Enter") open(); }; });
    $("#roles-note").textContent = t("roles.note");
  }

  /* ================= MAP ================= */
  const LAYERS = [
    { id: "tier", type: "tier" },
    { id: "per100k", type: "seq", v: (d) => d.per100k, pow: 0.5, u: () => t("L.per100k.u") },
    { id: "p_high", type: "seq", v: (d) => d.p_high * 100, u: () => "%" },
    { id: "lisa", type: "lisa" },
    { id: "gi", type: "div", v: (d) => d.gi, dom: [-3, 0, 3], u: () => " z" },
    { id: "suit", type: "seq", v: (d) => d.suit, u: () => t("L.suit.u") },
    { id: "rain14", type: "seq", v: (d) => d.rain14, u: () => " mm" },
    { id: "rain_fc7", type: "seq", v: (d) => d.rain_fc7, u: () => " mm" },
    { id: "clim", type: "div", v: (d) => d.clim, dom: [0.7, 1, 1.4], u: () => "x" },
    { id: "density", type: "seq", v: (d) => d.density, log: true, u: () => t("L.density.u") },
    { id: "constr", type: "seq", v: (d) => d.osm_constr, pow: 0.5, u: () => t("L.constr.u") },
    { id: "edu", type: "seq", v: (d) => d.osm_school + d.osm_kinder, pow: 0.5, u: () => t("L.constr.u") },
  ];
  const lname = (l) => t(`L.${l.id}.n`), ldesc = (l) => t(`L.${l.id}.d`);
  let layer = LAYERS[0], mapReady = false, colorFn = () => "#888", svg, proj, path, gA, gS, gO, gH, gP, pin = null, paths, zoom, k = 1, W = 1000, H = 465;
  const P = (lon, lat) => proj([sh(lon), lat]);
  const siteOn = { school: true, kindergarten: true, construction: true };

  function renderLayerSelect() {
    const sel = $("#layer");
    sel.innerHTML = LAYERS.map((l) => `<option value="${l.id}">${lname(l)}</option>`).join("");
    sel.value = layer.id;
  }
  function layerValue(d) {
    if (layer.type === "tier") return tierName(d.tier);
    if (layer.type === "lisa") return t("lisa." + d.lisa);
    const v = layer.v(d); return v == null ? t("na") : (Math.abs(v) >= 100 ? fmt(Math.round(v)) : f2(v).replace(/\.?0+$/, "")) + layer.u();
  }
  function recolor() {
    if (!mapReady) return;
    const tcol = TIERS.map((_, i) => css("--t" + i)), lg = $("#legend");
    const neg = css("--div-neg"), mid = css("--div-mid"), pos = css("--div-pos");
    let note = "";
    $("#layer-desc").textContent = ldesc(layer);
    if (layer.type === "tier") {
      colorFn = (d) => tcol[TIERS.indexOf(d.tier)];
      const th = D.meta.tiers.map((x) => x[0]);
      lg.innerHTML = TIERS.map((x, i) => `<span><span class="sw" style="background:${tcol[i]}"></span>${tierName(x)} <span class="muted">${i < 3 ? th[i] + " - " + th[i + 1] : th[i] + "+"}</span></span>`).join("");
      note = t("leg.per");
    } else if (layer.type === "lisa") {
      const c = { HH: pos, LL: neg, HL: d3.interpolateRgb(mid, pos)(0.45), LH: d3.interpolateRgb(mid, neg)(0.45), ns: css("--nodata") };
      colorFn = (d) => c[d.lisa];
      lg.innerHTML = Object.keys(c).map((k2) => `<span><span class="sw" style="background:${c[k2]}"></span>${t("lisa." + k2)}</span>`).join("");
      note = t("leg.p");
    } else if (layer.type === "div") {
      const s = d3.scaleDiverging([layer.dom[0], layer.dom[1], layer.dom[2]], (x) => x < 0.5 ? d3.interpolateRgb(neg, mid)(x * 2) : d3.interpolateRgb(mid, pos)((x - 0.5) * 2)).clamp(true);
      colorFn = (d) => s(layer.v(d));
      lg.innerHTML = `<span>${layer.dom[0]}${layer.u()}<span class="ramp" style="background:linear-gradient(90deg,${neg},${mid},${pos})"></span>${layer.dom[2]}${layer.u()}</span>`;
      note = layer.id === "gi" ? t("leg.gi") : t("leg.clim");
    } else {
      const vals = D.districts.map(layer.v).filter((v) => v != null && isFinite(v)), lo = d3.min(vals), hi = d3.max(vals);
      const sc = layer.log ? d3.scaleLog().domain([Math.max(lo, 1), hi]).range([0, 1]) : d3.scalePow().exponent(layer.pow || 1).domain([lo, hi]).range([0, 1]);
      const ramp = d3.interpolateRgb(css("--seq-lo"), css("--seq-hi"));
      colorFn = (d) => { const v = layer.v(d); return v == null ? css("--nodata") : ramp(Math.max(0, Math.min(1, sc(layer.log ? Math.max(v, 1) : v)))); };
      lg.innerHTML = `<span>${fmt(Math.round(lo))}<span class="ramp" style="background:linear-gradient(90deg,${ramp(0)},${ramp(1)})"></span>${fmt(Math.round(hi))}${layer.u()}</span>`;
    }
    lg.innerHTML += `<span class="sep"></span><span><span class="mk" style="background:var(--ink)"></span>${t("leg.ob")}</span><span><span class="mk ring"></span>${t("leg.hs")}</span>` +
      KINDS.map((k2) => `<span><span class="mk" style="background:var(${KIND[k2]})"></span>${kindName(k2)}</span>`).join("") +
      (pin ? `<span><span class="mk pinmk"></span>${t("leg.pin")}</span>` : "") +
      `<span class="note">${note ? note + ". " : ""}<span id="site-hint"></span> ${t("map.inset")}</span>`;
    paths.attr("fill", (f) => colorFn(byId.get(f.id)));
    updateSiteVis();
  }
  // Marker sizes are divided by the zoom factor so they keep a steady on-screen size.
  // Radii AND stroke widths are set here from the zoom factor, not with CSS `vector-effect: non-scaling-stroke`, which some
  // browsers ignore for dashed strokes inside a zoomed group (a 2px ring then becomes 80px thick at full zoom).
  function sizePts() {
    const rs = Math.min(5, 2 + 0.6 * Math.log2(k + 1));       // on-screen radius of a site dot, in map units
    if (gP) {
      gP.selectAll("circle").attr("r", 6 / k).style("stroke-width", 2.5 / k);
      gP.selectAll("path").style("stroke-width", 2 / k).style("stroke-dasharray", `${7 / k} ${5 / k}`);
    }
    gO.selectAll("circle").attr("r", 3.4 / k).style("stroke-width", 0.8 / k);
    gH.selectAll("circle").attr("r", 6.5 / k).style("stroke-width", 1.6 / k);
    gA.selectAll("circle").attr("r", rs / k).style("stroke-width", 0.5 / k);
    gS.selectAll("circle").attr("r", (rs * 1.15) / k).style("stroke-width", 0.6 / k);
  }
  // The ~9,500 school, kindergarten and construction dots only appear once zoomed in (k >= 3), or when their toggle is on.
  function updateSiteVis() {
    if (!mapReady) return;
    const show = k >= 3;
    gA.attr("display", show ? null : "none");
    gA.selectAll("g.sg").attr("display", function () { return siteOn[this.dataset.kind] ? null : "none"; });
    const h = $("#site-hint"); if (h) h.textContent = !show && KINDS.some((x) => siteOn[x]) ? t("leg.zoom") : "";
  }
  function initMap() {
    if (mapReady) return; mapReady = true; k = 1;
    svg = d3.select("#map");
    const box = svg.node().getBoundingClientRect();
    W = 1000; H = Math.max(300, Math.round(W / ((box.width || 1000) / (box.height || 465))));
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    proj = d3.geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], GEO2); path = d3.geoPath(proj);
    const g = svg.append("g"), gD = g.append("g"); gA = g.append("g"); gS = g.append("g"); gO = g.append("g"); gH = g.append("g"); gP = g.append("g");
    zoom = d3.zoom().scaleExtent([1, 60]).on("zoom", (e) => { g.attr("transform", e.transform); k = e.transform.k; sizePts(); updateSiteVis(); });
    svg.call(zoom).on("dblclick.zoom", null);
    paths = gD.selectAll("path").data(GEO2.features).join("path").attr("class", "d").attr("d", path).attr("tabindex", 0)
      .attr("aria-label", (f) => { const d = byId.get(f.id); return `${d.district}, ${d.state}: ${tierName(d.tier)}`; })
      .on("mousemove", (ev, f) => { const d = byId.get(f.id); showTip(`<b>${esc(d.district)}</b> <span class="k">${esc(d.state)}</span><br>${t("tip.d", tierName(d.tier), f1(d.exp))}<br><span class="k">${lname(layer)}:</span> ${layerValue(d)}`, ev); })
      .on("mouseleave", hideTip).on("click", (ev, f) => select(f.id)).on("keydown", (ev, f) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(f.id); } });
    KINDS.forEach((kd) => gA.append("g").attr("class", "sg").attr("data-kind", kd).selectAll("circle").data(D.sites[kd] || []).join("circle").attr("class", "sa").style("fill", `var(${KIND[kd]})`)
      .attr("cx", (p) => P(p[0], p[1])[0]).attr("cy", (p) => P(p[0], p[1])[1]));
    gO.selectAll("circle").data(D.outbreak_pts).join("circle").attr("class", "ob").attr("cx", (p) => P(p[0], p[1])[0]).attr("cy", (p) => P(p[0], p[1])[1]);
    gH.selectAll("circle").data(D.hotspots).join("circle").attr("class", "hs").attr("cx", (p) => P(p[0], p[1])[0]).attr("cy", (p) => P(p[0], p[1])[1]);
    gO.attr("display", $("#ov-ob").checked ? null : "none"); gH.attr("display", $("#ov-hs").checked ? null : "none");
    sizePts(); drawPin(false); recolor();
    if (selected) select(selected); else renderRank();
  }
  $("#layer").addEventListener("change", (e) => { layer = LAYERS.find((l) => l.id === e.target.value); recolor(); });
  $("#ov-ob").addEventListener("change", (e) => gO && gO.attr("display", e.target.checked ? null : "none"));
  $("#ov-hs").addEventListener("change", (e) => gH && gH.attr("display", e.target.checked ? null : "none"));
  [["school", "#ov-school"], ["kindergarten", "#ov-kg"], ["construction", "#ov-con"]].forEach(([kd, id]) => $(id).addEventListener("change", (e) => { siteOn[kd] = e.target.checked; updateSiteVis(); }));
  $("#clear-pin").onclick = () => { pin = null; if (gP) gP.selectAll("*").remove(); $("#clear-pin").hidden = true; recolor(); };
  function zoomTo(feats, pad, btn) {
    const b = path.bounds({ type: "FeatureCollection", features: feats }), dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1];
    const s = Math.min(40, pad / Math.max(dx / W, dy / H)), tr = d3.zoomIdentity.translate(W / 2 - s * (b[0][0] + b[1][0]) / 2, H / 2 - s * (b[0][1] + b[1][1]) / 2).scale(s);
    svg.transition().duration(calm ? 0 : 600).call(zoom.transform, tr);
    ["#z-all", "#z-pen", "#z-bor"].forEach((i) => $(i).setAttribute("aria-pressed", String(i === btn)));
  }
  $("#z-all").onclick = () => zoomTo(GEO2.features, 0.96, "#z-all");
  $("#z-pen").onclick = () => zoomTo(GEO2.features.filter((f) => byId.get(f.id).lon < 106), 0.92, "#z-pen");
  $("#z-bor").onclick = () => zoomTo(GEO2.features.filter((f) => byId.get(f.id).lon >= 106), 0.92, "#z-bor");

  function drawPin(zoomIt) {
    $("#clear-pin").hidden = !pin;
    if (!mapReady || !pin) return;
    gP.selectAll("*").remove();
    const c = d3.geoCircle().center([sh(pin.lon), pin.lat]).radius(pin.km / 111.32)();
    gP.append("path").datum(c).attr("class", "pinr").attr("d", path);
    const [x, y] = P(pin.lon, pin.lat);
    gP.append("circle").attr("class", "pin").attr("cx", x).attr("cy", y).attr("r", 6 / k);
    sizePts();
    if (zoomIt) zoomTo([{ type: "Feature", geometry: c, properties: {} }], 0.6, null);
    recolor();
  }
  function select(id) {
    selected = id;
    if (!mapReady) return;
    paths.classed("sel", (f) => f.id === id); gS.selectAll("*").remove();
    svg.classed("has-sel", !!id);
    if (id) paths.filter((f) => f.id === id).raise();      // draw the selected outline on top of its neighbours
    if (!id) { renderRank(); return; }
    const d = byId.get(id), idx = D.districts.indexOf(d), pts = [];
    KINDS.forEach((kd) => (D.sites[kd] || []).forEach((p) => { if (p[2] === idx) pts.push([p[0], p[1], kd]); }));
    selectedSites = pts.length;
    gS.selectAll("circle").data(pts).join("circle").attr("class", "site").style("fill", (p) => `var(${KIND[p[2]]})`).attr("cx", (p) => P(p[0], p[1])[0]).attr("cy", (p) => P(p[0], p[1])[1]);
    sizePts(); zoomTo(GEO2.features.filter((f) => f.id === id), 0.55, null); renderDistrict(d, pts.length);
  }
  function renderRank() {
    $("#side").innerHTML = `<header><span class="eyebrow">${t("side.watch")}</span><h2>${t("side.top")}</h2><p class="muted">${t("side.pick")}</p></header>
      <ol class="rank">${ranked.slice(0, 40).map((d) => `<li data-id="${d.id}" tabindex="0"><span class="muted num">${d.rank}</span><span class="nm"><b>${esc(d.district)}</b><span>${esc(d.state)}</span></span><span class="rv">${pill(d.tier)}<small>${t("side.per", f1(d.per100k))}</small></span></li>`).join("")}</ol>`;
    $$(".rank li").forEach((li) => { li.onclick = () => select(li.dataset.id); li.onkeydown = (e) => { if (e.key === "Enter") select(li.dataset.id); }; });
  }
  function renderDistrict(d, nSites) {
    const r = regionOf.get(d.region), ages = D.meta.ages, mx = Math.max(...d.age_m, ...d.age_f, 1e-9);
    const band = (lo, hi) => { let c = 0, p = 0; ages.forEach((a, i) => { const s = parseInt(a, 10); if (s >= lo && s <= hi) { c += d.age_m[i] + d.age_f[i]; p += d.pop_m[i] + d.pop_f[i]; } }); return [c, p]; };
    const kids = band(5, 19), work = band(20, 49), old = band(60, 200);
    const sites = D.priority.filter((s) => s.id === d.id).slice(0, 5);
    const hsTxt = d.hotspots ? " " + t("side.hs", d.hotspots) : "";
    $("#side").innerHTML = `<header><div class="row2"><span class="eyebrow">${esc(d.state)}</span><button class="btn" id="back" type="button">${t("side.all")}</button></div>
        <div class="row2"><h2>${esc(d.district)}</h2>${pill(d.tier)}</div></header>
      <div class="blk"><div class="big"><span><span class="v num">${f1(d.exp)}</span> ${t("side.cases")}</span><span class="muted">${t("side.range", fmt(d.lo), fmt(d.hi))}</span></div>
        <dl class="kv"><dt>${t("side.p100")}</dt><dd>${f1(d.per100k)}</dd><dt>${t("side.chance")}</dt><dd>${Math.round(d.p_high * 100)}%</dd><dt>${t("side.rank", D.districts.length)}</dt><dd>${d.rank}</dd></dl></div>
      <div class="blk"><h3>${t("side.why")}</h3><dl class="kv">
        <dt>${t("side.level", esc(d.region))}</dt><dd>${t("side.week", f1(r.weekly_level))}</dd>
        <dt>${t("side.season")}</dt><dd>x ${f2(d.season)}</dd>
        <dt>${t("side.clim")}</dt><dd>x ${f2(d.clim)}</dd>
        <dt>${t("side.share")}</dt><dd>${f1(d.share * 100)}%</dd>
        <dt>${t("side.ob")}</dt><dd>${d.outbreaks}${hsTxt}</dd>
        <dt>${t("side.pop")}</dt><dd>${fmt(d.pop)}, ${fmt(Math.round(d.density))} / km2</dd></dl></div>
      <div class="blk"><h3>${t("side.breed")}</h3><dl class="kv">
        <dt>${t("side.rain14")}</dt><dd>${d.rain14 == null ? t("na") : fmt(d.rain14) + " mm"}</dd><dt>${t("side.rainfc")}</dt><dd>${d.rain_fc7 == null ? t("na") : fmt(d.rain_fc7) + " mm"}</dd>
        <dt>${t("side.temp")}</dt><dd>${d.temp14 ?? t("na")} C, ${d.rh14 ?? t("na")}%</dd><dt>${t("side.suit")}</dt><dd>${d.suit ?? t("na")} / 100</dd></dl></div>
      <div class="blk"><h3>${t("side.exposed")}</h3>
        <dl class="kv"><dt>${t("side.kids")}</dt><dd>${t("side.cr", f1(kids[0]), fmt(kids[1]))}</dd><dt>${t("side.work")}</dt><dd>${t("side.cr", f1(work[0]), fmt(work[1]))}</dd><dt>${t("side.old")}</dt><dd>${t("side.cr", f1(old[0]), fmt(old[1]))}</dd></dl>
        <div class="pyr"><span class="h m" style="justify-self:end">${t("side.male")}</span><span class="a">${t("side.age")}</span><span class="h">${t("side.female")}</span>
        ${ages.map((a, i) => `<span class="b m" style="width:${(d.age_m[i] / mx) * 100}%" title="${t("side.mt", a, f2(d.age_m[i]))}"></span><span class="a">${a}</span><span class="b f" style="width:${(d.age_f[i] / mx) * 100}%" title="${t("side.ft", a, f2(d.age_f[i]))}"></span>`).reverse().join("")}</div>
        <p class="muted" style="font-size:12px">${t("side.agenote", D.meta.pop_year)}</p></div>
      <div class="blk"><h3>${t("side.places")}</h3><dl class="kv">
        <dt>${t("side.moe")}</dt><dd>${d.schools == null ? t("na") : fmt(d.schools)}${d.students ? ", " + t("side.pupils", fmt(d.students)) : ""}</dd>
        <dt><span class="mk" style="background:var(--s1)"></span>${t("side.sm")}</dt><dd>${fmt(d.osm_school)}</dd><dt><span class="mk" style="background:var(--s2)"></span>${t("side.km")}</dt><dd>${fmt(d.osm_kinder)}</dd><dt><span class="mk" style="background:var(--s3)"></span>${t("side.cm")}</dt><dd>${fmt(d.osm_constr)}</dd></dl>
        ${sites.length ? `<table><tbody>${sites.map((s) => `<tr><td>${esc(s.name || t("side.unnamed", kindName(s.kind).toLowerCase()))}<br><span class="muted">${kindName(s.kind)}${s.near_km != null ? ", " + t("side.fromob", f1(s.near_km)) : ""}</span></td><td class="n">${f1(s.score)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">${nSites ? t("side.notop") : t("side.nosites")}</p>`}</div>`;
    $("#back").onclick = () => { select(null); zoomTo(GEO2.features, 0.96, "#z-all"); };
  }

  /* ================= INSPECTION ================= */
  const qStates = [...new Set(D.priority.map((s) => s.state))].sort();
  function renderInspect() {
    $("#caution").innerHTML = t("ins.caution");
    $("#score-how").innerHTML = [1, 2, 3, 4].map((i) => `<div><b>${t(`ins.s${i}.t`)}</b>${t(`ins.s${i}.d`)}</div>`).join("");
    const sel = $("#qstate"), cur = sel.value;
    sel.innerHTML = `<option value="">${t("ins.allstates")}</option>` + qStates.map((s) => `<option>${esc(s)}</option>`).join("");
    sel.value = cur;
    renderQueue();
  }
  function renderQueue() {
    const st = $("#qstate").value, rows = D.priority.filter((s) => (qKind === "all" || s.kind === qKind) && (!st || s.state === st)).sort((a, b) => b.score - a.score).slice(0, 150);
    $("#q-note").textContent = D.priority.length ? t("q.note", rows.length) : "";
    $("#queue").innerHTML = rows.length ? `<thead><tr><th class="n">#</th><th>${t("q.th.site")}</th><th>${t("q.th.type")}</th><th>${t("q.th.district")}</th><th>${t("q.th.risk")}</th><th class="n">${t("q.th.near")}</th><th class="n">${t("q.th.rain")}</th><th class="n">${t("q.th.score")}</th></tr></thead><tbody>` +
      rows.map((s, i) => `<tr class="click" data-id="${s.id}" tabindex="0"><td class="n muted">${i + 1}</td><td><b>${esc(s.name || t("q.unnamed"))}</b></td><td><span class="mk" style="background:var(${KIND[s.kind]})"></span>${kindName(s.kind)}</td><td>${esc(s.district)}<span class="muted">, ${esc(s.state)}</span></td><td>${pill(s.tier)}</td><td class="n">${s.near_km == null ? t("na") : f1(s.near_km) + " km"}</td><td class="n">${fmt(s.rain14)} mm</td><td class="n"><span class="inbar" style="width:${s.score * 0.6}px"></span><b>${f1(s.score)}</b></td></tr>`).join("") + "</tbody>"
      : `<tbody><tr><td class="muted">${D.priority.length ? t("q.none") : t("q.noosm")}</td></tr></tbody>`;
    $$("#queue tr.click").forEach((tr) => { const open = () => openDistrict(tr.dataset.id); tr.onclick = open; tr.onkeydown = (e) => { if (e.key === "Enter") open(); }; });
    renderInspectMap(rows, st);
  }
  // Map beside the queue: the listed sites as dots (bigger = higher score), zoomed to the chosen state.
  function renderInspectMap(rows, st) {
    const coll = st ? { type: "FeatureCollection", features: GEO2.features.filter((f) => byId.get(f.id).state === st) } : GEO2;
    const { s, pa, P: P2 } = mapBase($("#imap"), 520, 310, coll);
    s.append("g").selectAll("path").data(GEO2.features).join("path").attr("d", pa).attr("class", "im").classed("on", (f) => !st || byId.get(f.id).state === st).on("click", (ev, f) => openDistrict(f.id));
    s.append("g").selectAll("circle").data(rows.slice().reverse()).join("circle").attr("class", "isite").style("fill", (r) => `var(${KIND[r.kind]})`)
      .attr("cx", (r) => P2(r.lon, r.lat)[0]).attr("cy", (r) => P2(r.lon, r.lat)[1]).attr("r", (r) => 3 + (r.score / 100) * 5)
      .on("mousemove", (ev, r) => showTip(`<b>${esc(r.name || t("q.unnamed"))}</b><br>${kindName(r.kind)}, ${esc(r.district)}<br>${t("q.th.score")} ${f1(r.score)}`, ev)).on("mouseleave", hideTip).on("click", (ev, r) => openDistrict(r.id));
    $("#imap-sum").innerHTML = KINDS.map((kd) => `<div><b style="color:var(${KIND[kd]})">${rows.filter((r) => r.kind === kd).length}</b><span>${t("near.stat." + kd)}</span></div>`).join("");
    $("#imap-legend").innerHTML = `<span class="note" style="margin-left:0">${t("ins.map.note")} ${t("map.inset")}</span>`;
  }
  $$("#kind button").forEach((b) => (b.onclick = () => { qKind = b.dataset.k; $$("#kind button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderQueue(); }));
  $("#qstate").addEventListener("change", renderQueue);

  /* ================= EVIDENCE ================= */
  const M = D.models, rm = M.region_month, nw = M.national_week;
  const get = (spec, model) => rm.find((r) => r.spec === spec && r.model === (model || "NB-GLM"));
  const w4 = (s) => nw.find((r) => r.horizon === 4 && r.spec === s), w1 = (s) => nw.find((r) => r.horizon === 1 && r.spec === s);
  const DRV = ["rain", "wet", "rh", "temp", "tmin", "tmax", "dtr", "wind"];

  function lineChart(el, series, o) {
    const Wc = Math.max(300, Math.round($(el).clientWidth || 640)), Hc = o.h || 240, m = { t: 12, r: o.right || 16, b: 26, l: 44 }, x = o.x.range([m.l, Wc - m.r]), y = o.y.range([Hc - m.b, m.t]);
    const s = d3.select(el).html("").append("svg").attr("class", "chart").attr("viewBox", `0 0 ${Wc} ${Hc}`);
    y.ticks(5).forEach((tk) => { s.append("line").attr("class", "grid").attr("x1", m.l).attr("x2", Wc - m.r).attr("y1", y(tk)).attr("y2", y(tk)); s.append("text").attr("x", m.l - 8).attr("y", y(tk) + 4).attr("text-anchor", "end").text(o.yf(tk)); });
    o.xt.forEach((tk) => s.append("text").attr("x", x(tk)).attr("y", Hc - 8).attr("text-anchor", "middle").text(o.xf(tk)));
    if (o.zero) s.append("line").attr("class", "axis").attr("x1", m.l).attr("x2", Wc - m.r).attr("y1", y(0)).attr("y2", y(0));
    const ln = d3.line().defined((p) => p[1] != null).x((p) => x(p[0])).y((p) => y(p[1]));
    series.forEach((se) => { s.append("path").attr("d", ln(se.pts)).attr("fill", "none").attr("stroke", `var(${se.c})`).attr("stroke-width", 2).attr("stroke-linejoin", "round"); if (o.dots) se.pts.forEach((p) => s.append("circle").attr("cx", x(p[0])).attr("cy", y(p[1])).attr("r", 4.5).attr("fill", `var(${se.c})`).attr("stroke", "var(--surface)").attr("stroke-width", 2)); });
    const hair = s.append("line").attr("class", "axis").attr("y1", m.t).attr("y2", Hc - m.b).attr("display", "none");
    s.append("rect").attr("x", m.l).attr("y", m.t).attr("width", Wc - m.l - m.r).attr("height", Hc - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", (ev) => { const px = d3.pointer(ev)[0], xs = series[0].pts.map((p) => p[0]), i = d3.leastIndex(xs, (a) => Math.abs(x(a) - px)); hair.attr("display", null).attr("x1", x(xs[i])).attr("x2", x(xs[i])); showTip(o.tip(i), ev); })
      .on("mouseleave", () => { hair.attr("display", "none"); hideTip(); });
  }
  function renderEvidence() {
    const base = rm[0].mae / (1 - rm[0].skill), mxm = Math.max(base, d3.max(rm, (r) => r.mae));
    const c = get("Recent cases"), cw = get("Cases + weather"), so = get("Seasonality only"), sw = get("+ Weather lags"), en = get("+ ENSO / IOD"), nbr = get("Cases + neighbours");
    const weatherHelps4 = w4("Cases + weather").skill > w4("Recent cases").skill;
    $("#takeaways").innerHTML = [
      ["yes", t("ev.tag.yes"), t("ev.c1"), t("ev.t1", Math.round(so.mae), Math.round(c.mae))],
      [weatherHelps4 ? "meh" : "no", t("ev.tag.meh"), t("ev.c2"), t("ev.t2", Math.round(so.mae), Math.round(sw.mae), cw.mae < c.mae ? t("ev.little") : t("ev.nothing"), f2(w4("Recent cases").skill), f2(w4("Cases + weather").skill))],
      ["no", t("ev.tag.no"), t("ev.c3"), t("ev.t3", en.mae < sw.mae ? t("ev.helped") : t("ev.nohelp"), nbr.mae < c.mae ? t("ev.helped") : t("ev.nohelp"))],
    ].map(([cls, tag, h, p]) => `<div><span class="tag ${cls}">${tag}</span><h3>${h}</h3><p>${p}</p></div>`).join("");
    $("#abl-sub").textContent = t("ev.abl.sub", fmt(rm[0].n), M.train.region_month[1]);
    $("#abl").innerHTML = [{ spec: "", mae: base, ref: 1 }].concat(rm).map((r) => `<span>${r.ref ? t("ev.abl.base") : specName(r.spec) + (r.model === "GBM" ? " " + t("ev.abl.boost") : "")}</span><span class="trk"><span class="fill${r.ref ? " ref" : ""}" style="width:${(r.mae / mxm) * 100}%"></span></span><span class="val">${Math.round(r.mae)}${r.top3 != null ? " &middot; " + t("ev.abl.top3", Math.round(r.top3 * 100)) : ""}</span>`).join("");
    $("#abl-read").textContent = t("ev.abl.read", Math.round(so.top3 * 100), Math.round(c.top3 * 100));
    $("#hz-read").textContent = t("ev.hz.read", w1("Cases + weather").skill > w1("Recent cases").skill ? t("ev.hz.helps") : t("ev.hz.nohelp"), weatherHelps4 ? t("ev.hz.start") : t("ev.hz.still"));

    const HZ = [["Recent cases", "--s1"], ["Cases + weather", "--s2"], ["All factors", "--s3"]];
    const hzS = HZ.map(([sp, col]) => ({ c: col, name: specName(sp), pts: [1, 2, 3, 4].map((h) => [h, nw.find((r) => r.horizon === h && r.spec === sp).skill]) }));
    const ys = hzS.flatMap((s) => s.pts.map((p) => p[1]));
    lineChart("#hz", hzS, { x: d3.scaleLinear().domain([0.8, 4.2]), y: d3.scaleLinear().domain([Math.min(-0.05, d3.min(ys)), d3.max(ys) + 0.03]).nice(), xt: [1, 2, 3, 4], xf: (n) => (n === 1 ? t("ev.hz.x1", n) : t("ev.hz.xn", n)), yf: (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%", zero: true, dots: true,
      tip: (i) => `<b>${t("ev.hz.tip", i + 1)}</b><br>` + hzS.map((s) => t("ev.hz.vs", s.name, (s.pts[i][1] > 0 ? "+" : "") + Math.round(s.pts[i][1] * 100))).join("<br>") });
    $("#hz-lg").innerHTML = hzS.map((s) => `<span><i style="background:var(${s.c})"></i>${s.name}</span>`).join("");

    // lag heat map
    const neg = css("--div-neg"), mid = css("--div-mid"), pos = css("--div-pos"), lags = [...new Set(M.lag_week.map((r) => r.lag))];
    const sc = (v) => (v < 0 ? d3.interpolateRgb(mid, neg)(Math.min(1, -v / 0.2)) : d3.interpolateRgb(mid, pos)(Math.min(1, v / 0.2)));
    $("#lagw").innerHTML = `<thead><tr><th class="r">${t("ev.lag.weeks")}</th>${lags.map((l) => `<th>${l}</th>`).join("")}</tr></thead><tbody>` + DRV.map((dk) => `<tr><th class="r">${t("drv." + dk)}</th>${lags.map((l) => { const r = M.lag_week.find((q) => q.driver === dk && q.lag === l); return `<td class="c" style="background:${sc(r.rho)}" title="${t("ev.lag.cell", t("drv." + dk), l, r.rho)}">${Math.round(r.rho * 100)}</td>`; }).join("")}</tr>`).join("") + `</tbody><tfoot><tr><th class="r"></th><th colspan="${lags.length}" style="text-align:left;padding-top:6px">${t("ev.lag.foot")}</th></tr></tfoot>`;

    // weather effects once cases are known
    const rows = M.irr_weather, Wc = Math.max(320, Math.round($("#irr").clientWidth || 640)), rh = 18, mg = { t: 6, r: 16, b: 24, l: 170 }, Hc = mg.t + mg.b + rows.length * rh;
    const x = d3.scaleLog().domain([Math.min(0.85, d3.min(rows, (r) => r.lo)), Math.max(1.18, d3.max(rows, (r) => r.hi))]).range([mg.l, Wc - mg.r]);
    $("#irr").innerHTML = "";
    const s = d3.select("#irr").append("svg").attr("class", "chart").attr("viewBox", `0 0 ${Wc} ${Hc}`);
    [0.9, 1, 1.1, 1.2].filter((v) => v >= x.domain()[0] && v <= x.domain()[1]).forEach((v) => { s.append("line").attr("class", v === 1 ? "axis" : "grid").attr("x1", x(v)).attr("x2", x(v)).attr("y1", mg.t).attr("y2", Hc - mg.b); s.append("text").attr("x", x(v)).attr("y", Hc - 8).attr("text-anchor", "middle").text(v === 1 ? t("ev.irr.zero") : v.toFixed(1)); });
    rows.forEach((r, i) => {
      const [v, , l] = r.term.split("_"), y = mg.t + i * rh + rh / 2, sig = r.p < 0.05, lab = t("drv." + v);
      s.append("text").attr("x", mg.l - 10).attr("y", y + 4).attr("text-anchor", "end").text(t("ev.irr.lab", lab, l.slice(1)));
      s.append("line").attr("x1", x(r.lo)).attr("x2", x(r.hi)).attr("y1", y).attr("y2", y).attr("stroke", sig ? "var(--s1)" : "var(--muted)").attr("stroke-width", 2).attr("stroke-linecap", "round");
      s.append("circle").attr("cx", x(r.irr)).attr("cy", y).attr("r", 4).attr("fill", sig ? "var(--s1)" : "var(--surface)").attr("stroke", sig ? "var(--surface)" : "var(--muted)").attr("stroke-width", sig ? 1.5 : 2);
      s.append("rect").attr("x", mg.l).attr("y", y - rh / 2).attr("width", Wc - mg.l - mg.r).attr("height", rh).attr("fill", "transparent").on("mousemove", (ev) => showTip(`<b>${t("ev.irr.tip", lab, l.slice(1))}</b><br>${t("ev.irr.rr", r.irr.toFixed(3), r.lo.toFixed(3), r.hi.toFixed(3))}<br>${sig ? t("ev.irr.sig") : t("ev.irr.nosig")}, p = ${r.p.toFixed(3)}`, ev)).on("mouseleave", hideTip);
    });
    d3.select("#irr").append("div").attr("class", "lg").html(`<span><i style="background:var(--s1)"></i>${t("ev.irr.l1")}</span><span><i style="background:var(--muted)"></i>${t("ev.irr.l2")}</span>`);

    // track record
    const Hh = D.history, B = M.backtest_week, pm = new Map(B.week.map((w, i) => [w, B.pred[i]])), tt = Hh.week.map((w) => new Date(w));
    const act = tt.map((d, i) => [d, Hh.cases[i]]), pr = tt.map((d, i) => [d, pm.has(Hh.week[i]) ? pm.get(Hh.week[i]) : null]);
    const yrs = d3.range(tt[0].getFullYear() + 1, tt[tt.length - 1].getFullYear() + 1).map((y) => new Date(y, 0, 1));
    lineChart("#bt", [{ c: "--s1", pts: act }, { c: "--s2", pts: pr }], { h: 300, x: d3.scaleTime().domain([tt[0], tt[tt.length - 1]]), y: d3.scaleLinear().domain([0, d3.max(Hh.cases) * 1.05]).nice(), xt: yrs, xf: (d) => d.getFullYear(), yf: (v) => fmt(v),
      tip: (i) => `<b>${t("ev.bt.week", dfmt(Hh.week[i]))}</b><br>${t("ev.bt.rep", fmt(Hh.cases[i]))}` + (pr[i][1] != null ? `<br>${t("ev.bt.fc", fmt(pr[i][1]))}` : "") });
    const r2 = nw.find((r) => r.horizon === 2 && r.spec === B.spec);
    $("#bt-lg").innerHTML = `<span><i style="background:var(--s1)"></i>${t("ev.bt.l1")}</span><span><i style="background:var(--s2)"></i>${t("ev.bt.l2", specName(B.spec).toLowerCase())}</span><span class="muted">${t("ev.bt.miss", fmt(Math.round(r2.mae)), r2.n)}</span>`;

    // spatial + state table
    const S = D.spatial, L = S.lisa;
    $("#spatial").innerHTML = `<div class="notes"><p>${t("ev.sp.1", f2(S.risk.I), S.risk.p, L.HH || 0, L.LL || 0, f2(S.density.I), f2(S.suit.I))}</p><p>${t("ev.sp.2", S.links)}</p></div>`;
    const rs = D.regions.slice().sort((a, b) => b.cum - a.cum), mc = d3.max(rs, (r) => r.cum);
    $("#regions").innerHTML = `<thead><tr><th>${t("tbl.state")}</th><th class="n">${t("tbl.today")}</th><th>${D.meta.cum_is_ytd ? t("tbl.ytd") : t("tbl.cum")}</th><th class="n">${t("tbl.per")}</th><th class="n">${t("tbl.lvl")}</th><th class="n">${t("tbl.exp")}</th><th class="n">${t("tbl.ob")}</th><th class="n">${t("tbl.hs")}</th></tr></thead><tbody>` +
      rs.map((r) => `<tr><td><b>${esc(r.region)}</b></td><td class="n">${fmt(r.today)}</td><td class="num"><span class="inbar" style="width:${Math.max(2, (r.cum / mc) * 120)}px"></span>${fmt(r.cum)}</td><td class="n">${f1(r.inc_cum)}</td><td class="n">${f1(r.weekly_level)}</td><td class="n">${fmt(Math.round(r.exp14))}</td><td class="n">${fmt(r.outbreaks)}</td><td class="n">${r.hotspots}</td></tr>`).join("") + "</tbody>";
  }

  /* ================= ABOUT ================= */
  const msRows = (s) => s.replace(/daily snapshot\(s\) in feed/, "tangkapan harian dalam suapan").replace(/state-months/, "negeri-bulan").replace(/ weeks/, " minggu").replace(/forecast district-days/, "hari-daerah ramalan").replace(/district-days/, "hari-daerah").replace(/ districts/, " daerah").replace(/ sites in (\d+) of 16 states/, " tapak dalam $1 daripada 16 negeri").replace(/ months/, " bulan");
  function renderAbout() {
    $("#steps").innerHTML = [1, 2, 3, 4].map((i) => `<li><b>${t(`st${i}.t`)}</b>${t(`st${i}.d`)}</li>`).join("");
    $("#gloss").innerHTML = d3.range(1, 11).map((i) => `<div><dt>${t(`g${i}.t`)}</dt><dd>${t(`g${i}.d`)}</dd></div>`).join("");
    const gc = D.meta.geocoded, hw = /^(\d{4})-W(\d+)$/.exec(D.meta.hot_week || "");
    const hot = hw ? t("n4.hot", lang === "ms" ? `${+hw[2]} tahun ${hw[1]}` : `${+hw[2]} of ${hw[1]}`) : "";
    $("#notes").innerHTML = [
      t("n1"), t("n2", D.feed.date.length), t("n3", fmt(N.cum)), t("n4", gc.outbreaks[0], gc.outbreaks[1], gc.hotspots[0], gc.hotspots[1], hot),
      t("n5"), t("n6"), t("n7"), t("n8"), t("n9"), t("n10", D.meta.alpha, D.meta.gamma, D.meta.tiers.slice(1).map((x) => x[0]).join(", ")),
    ].map((x) => `<p>${x}</p>`).join("");
    $("#sources").innerHTML = `<thead><tr><th>${t("src.th.src")}</th><th>${t("src.th.what")}</th><th>${t("src.th.cad")}</th><th>${t("src.th.latest")}</th><th>${t("src.th.vol")}</th></tr></thead><tbody>` +
      D.meta.sources.map((s) => { const ms = lang === "ms" && X.srcMs[s.name]; return `<tr><td><a href="${s.url}" target="_blank" rel="noopener"><b>${esc(s.name)}</b></a></td><td>${esc(ms ? ms[0] : s.what)}</td><td>${esc(ms ? ms[1] : s.cadence)}</td><td class="num">${esc(s.latest)}</td><td class="num">${esc(lang === "ms" ? msRows(s.rows) : s.rows)}</td></tr>`; }).join("") + "</tbody>";
  }

  /* ================= render + language switch ================= */
  function applyStatic() {
    $$("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
    $$("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
    $$("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
    $$("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  }
  function renderAll() {
    document.documentElement.lang = lang;
    $$(".lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
    applyStatic();
    $("#m-snap").textContent = dfmt(D.meta.snapshot);
    $("#m-win").textContent = dshort(D.meta.window[0]) + " " + t("range.to") + " " + dshort(D.meta.window[1]);
    $("#foot").innerHTML = t("foot", esc(D.meta.generated));
    themeButton();
    renderHero(); renderHeroMap(); renderKpis(); renderTop(); renderTierDist(); renderStates(); renderRoles(); renderFound();
    renderLayerSelect(); renderInspect(); renderEvidence(); renderAbout();
    gaz = null;
    if (mapReady) { recolor(); if (selected && byId.get(selected)) renderDistrict(byId.get(selected), selectedSites); else renderRank(); paths.attr("aria-label", (f) => { const d = byId.get(f.id); return `${d.district}, ${d.state}: ${tierName(d.tier)}`; }); }
  }
  function setLang(l) {
    lang = l;
    try { localStorage.setItem("db-lang", l); } catch (e) { /* optional */ }
    renderAll();
  }
  $$(".lang button").forEach((b) => (b.onclick = () => setLang(b.dataset.lang)));
  function paint() {
    themeButton(); renderEvidence(); recolor(); renderHeroMap(); renderTierDist();
    $$("#topd .gbar").forEach((el, i) => el.style.setProperty("--c", tierColor(ranked[i].tier)));
  }
  let rz;
  addEventListener("resize", () => {          // the main map and the charts size themselves from their container
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (mapReady && !$("#tab-map").hidden) { $("#map").innerHTML = ""; mapReady = false; initMap(); }
      if (!$("#tab-evidence").hidden) renderEvidence();
    }, 250);
  });

  renderAll();
  go(location.hash.slice(1), { scroll: false });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
