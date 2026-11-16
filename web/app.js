/* Dengue Buster dashboard. Reads window.DENGUE (web/data/bundle.js, written by the pipeline).
   Tabs: Today (everyone) / Map (explore) / Inspection (field teams) / Evidence (analysts) / About. */
(function () {
  const D = window.DENGUE;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  if (!D || !window.d3) { document.querySelector("main").innerHTML = '<p class="panel pad">No data bundle found. Run <span class="mono">python -m pipeline.run</span> to build <span class="mono">web/data/bundle.js</span>, then reload.</p>'; return; }
  const fmt = d3.format(","), f1 = d3.format(",.1f"), f2 = d3.format(".2f");
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TIERS = ["Low", "Moderate", "High", "Very high"];
  const pill = (t) => `<span class="pill t-${t.split(" ")[0]}"><i></i>${t}</span>`;
  const dfmt = (s) => new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const dshort = (s) => dfmt(s).replace(/ \d{4}$/, "");
  const clean = (n) => n.replace(/^W\.P\. /, "");
  const byId = new Map(D.districts.map((d) => [d.id, d]));
  const regionOf = new Map(D.regions.map((r) => [r.region, r]));
  const tierColor = (t) => css("--t" + TIERS.indexOf(t));
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

  /* ================= router ================= */
  const TABS = ["today", "map", "inspect", "evidence", "about"];
  let current = null;
  function go(t, o = {}) {
    if (!TABS.includes(t)) t = "today";
    current = t;
    $$(".tab").forEach((s) => (s.hidden = s.id !== "tab-" + t));
    $$("#tabs button").forEach((b) => (b.getAttribute("data-tab") === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
    if (t === "map") initMap();
    try { if (location.hash.slice(1) !== t) history.replaceState(null, "", "#" + t); } catch (e) { /* hash routing is optional */ }
    if (o.scroll !== false) window.scrollTo({ top: 0, behavior: calm ? "auto" : "smooth" });
  }
  $$("#tabs button").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  addEventListener("hashchange", () => go(location.hash.slice(1), { scroll: false }));
  function openDistrict(id) { go("map", { scroll: false }); select(id); $("#map").scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); }

  /* ================= header ================= */
  $("#m-snap").textContent = dfmt(D.meta.snapshot);
  $("#m-win").textContent = dshort(D.meta.window[0]) + " to " + dshort(D.meta.window[1]);
  $("#m-gen").textContent = D.meta.generated;

  /* ================= TODAY ================= */
  const N = D.national, tc = N.tiers, nHigh = (tc["High"] || 0) + (tc["Very high"] || 0);
  const ranked = D.districts.slice().sort((a, b) => a.rank - b.rank);
  const top3 = ranked.slice(0, 3).map((d) => clean(d.district));
  $("#h-eyebrow").textContent = "Malaysia dengue outlook, " + dshort(D.meta.window[0]) + " to " + dshort(D.meta.window[1]);
  $("#h1").innerHTML = `Dengue risk is highest around <em>${esc(top3[0])}</em>, ${esc(top3[1])} and ${esc(top3[2])}.`;
  $("#hsub").textContent = `About ${fmt(N.exp14)} cases are expected across the country over the next two weeks. ${nHigh} of ${D.districts.length} districts are at High or Very high risk, covering ${f1(N.pop_high / 1e6)} million people.`;

  const TIPS = {
    Low: { say: "Risk is low right now.", you: ["Keep a weekly habit: empty or turn over anything that holds water.", "Check roof gutters, plant trays and pet bowls."], team: "Routine surveillance." },
    Moderate: { say: "Risk is moderate. Cases could rise.", you: ["Check around your home twice a week for standing water, including drains and flower pot saucers.", "Use mosquito repellent in the daytime, when Aedes bites.", "Fever for more than 2 days: see a doctor."], team: "Step up premises checks in areas with recent cases." },
    High: { say: "Risk is high. Act now.", you: ["Clear standing water around your home today, and again every few days.", "Wear repellent and long sleeves during the day; use screens or nets for children and babies.", "Fever for more than 2 days: see a doctor. Avoid aspirin and ibuprofen unless a doctor says so.", "Work with neighbours on a quick clean-up of shared spaces."], team: "Prioritise inspection and larviciding; focus on schools, building sites and active outbreak localities." },
    "Very high": { say: "Risk is very high. Cases are likely to keep rising.", you: ["Clear standing water around your home today, and every few days.", "Wear repellent and long sleeves during the day; protect babies and young children with nets or screens.", "Fever for more than 2 days, or bleeding, vomiting, severe stomach pain: see a doctor straight away. Avoid aspirin and ibuprofen unless a doctor says so.", "Let health teams inspect your premises; they are looking for breeding sites."], team: "Surge response: inspection, source reduction and community clean-ups in the highest-ranked localities and sites first." },
  };
  /* ---------- find a place: address, landmark or GPS -> district + what is around it ---------- */
  $("#dlist").innerHTML = ranked.slice().sort((a, b) => a.district.localeCompare(b.district)).map((d) => `<option value="${esc(clean(d.district))} (${esc(clean(d.state))})"></option>`).join("");
  const byLabel = new Map(D.districts.map((d) => [`${clean(d.district)} (${clean(d.state)})`.toLowerCase(), d]));
  const findIn = $("#find"), say = (html, cls) => { $("#find-msg").className = "fine " + (cls || ""); $("#find-msg").innerHTML = html; };
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"], R = Math.PI / 180;
  const hav = (la1, lo1, la2, lo2) => { const x = Math.sin((la2 - la1) * R / 2) ** 2 + Math.cos(la1 * R) * Math.cos(la2 * R) * Math.sin((lo2 - lo1) * R / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
  const dir = (la1, lo1, la2, lo2) => { const y = Math.sin((lo2 - lo1) * R) * Math.cos(la2 * R), x = Math.cos(la1 * R) * Math.sin(la2 * R) - Math.sin(la1 * R) * Math.cos(la2 * R) * Math.cos((lo2 - lo1) * R); return DIRS[Math.round((((Math.atan2(y, x) / R) + 360) % 360) / 45) % 8]; };
  const km1 = (v) => (v < 0.95 ? Math.round(v * 10) / 10 : Math.round(v * 10) / 10).toFixed(1);
  function districtAt(lon, lat) {
    const f = D.geo.features.find((q) => d3.geoContains(q, [lon, lat]));
    if (f) return byId.get(f.id);
    const near = D.districts.map((d) => [hav(lat, lon, d.lat, d.lon), d]).sort((a, b) => a[0] - b[0])[0];
    return near && near[0] < 15 ? near[1] : null;       // coast and island points sit just outside the simplified polygons
  }
  function around(pt, km) {
    const within = (arr) => arr.map((p) => ({ p, d: hav(pt.lat, pt.lon, p[1], p[0]), dir: dir(pt.lat, pt.lon, p[1], p[0]) })).sort((a, b) => a.d - b.d);
    const ob = within(D.outbreak_pts), hs = within(D.hotspots), cnt = {};
    Object.keys(KIND).forEach((k2) => (cnt[k2] = (D.sites[k2] || []).filter((p) => hav(pt.lat, pt.lon, p[1], p[0]) <= km).length));
    return { ob: ob.filter((x) => x.d <= km), hs: hs.filter((x) => x.d <= km), nearOb: ob[0], nearHs: hs[0], cnt };
  }
  function renderFound() {
    const { d, pt } = found, tp = TIPS[d.tier], ages = D.meta.ages, tot = d.age_m.map((v, i) => v + d.age_f[i]), sum = d3.sum(tot) || 1;
    const peak = ages[tot.indexOf(d3.max(tot))], share = (lo, hi) => d3.sum(ages.map((a, i) => (parseInt(a, 10) >= lo && parseInt(a, 10) <= hi ? tot[i] : 0))) / sum;
    let near = "";
    if (pt) {
      const S = around(pt, radiusKm), gc2 = D.meta.geocoded, miss = gc2.outbreaks[1] - gc2.outbreaks[0];
      let v;
      if (S.nearOb && S.nearOb.d <= 1) v = ["alert", `Dengue cases are active very close by. <b>${esc(S.nearOb.p[2])}</b> is about ${km1(S.nearOb.d)} km ${S.nearOb.dir} of this spot. Clear standing water today and protect against daytime bites.`];
      else if (S.ob.length) v = ["watch", `${S.ob.length} active outbreak ${S.ob.length > 1 ? "localities" : "locality"} within ${radiusKm} km. The nearest is <b>${esc(S.ob[0].p[2])}</b>, ${km1(S.ob[0].d)} km ${S.ob[0].dir}.`];
      else if (S.hs.length) v = ["watch", `A long-running hotspot, <b>${esc(S.hs[0].p[2])}</b>, is ${km1(S.hs[0].d)} km ${S.hs[0].dir} of this spot.`];
      else v = ["calm", `No located outbreak localities within ${radiusKm} km.${S.nearOb ? ` The nearest is ${km1(S.nearOb.d)} km ${S.nearOb.dir}.` : ""} Dengue can still be present: ${miss} of ${gc2.outbreaks[1]} outbreak localities nationwide could not be placed on the map.`];
      const list = (xs, f) => xs.length ? `<ul class="near">${xs.slice(0, 5).map(f).join("")}</ul>` : "";
      near = `<div class="verdict ${v[0]}">${v[1]}</div>
        <div class="rad"><span class="muted">Look within</span><div class="seg" role="group" aria-label="Radius">${[1, 2, 5].map((r) => `<button type="button" data-r="${r}" aria-pressed="${r === radiusKm}">${r} km</button>`).join("")}</div></div>
        <div class="stats five"><div><b>${S.ob.length}</b><span>outbreak localities</span></div><div><b>${S.hs.length}</b><span>hotspots</span></div><div><b>${S.cnt.school}</b><span>schools</span></div><div><b>${S.cnt.kindergarten}</b><span>kindergartens</span></div><div><b>${S.cnt.construction}</b><span>construction sites</span></div></div>
        ${list(S.ob, (x) => `<li><b>${esc(x.p[2])}</b> <span class="muted">${km1(x.d)} km ${x.dir}</span></li>`)}
        ${list(S.hs, (x) => `<li><b>${esc(x.p[2])}</b> <span class="muted">${km1(x.d)} km ${x.dir}, outbreak for ${x.p[6]} days</span></li>`)}
        <p class="muted fine">Outbreak positions come from locality names and can be off by several hundred metres. Schools, kindergartens and building sites are from OpenStreetMap, which is incomplete.</p>`;
    }
    $("#found").innerHTML = `<div class="found"><div class="found-h"><h3>${esc(pt ? pt.label : clean(d.district) + ", " + clean(d.state))}</h3></div>
      <div class="found-h"><span class="muted">District</span> <b>${esc(clean(d.district))}, ${esc(clean(d.state))}</b> ${pill(d.tier)} <span class="muted">rank ${d.rank} of ${D.districts.length}</span></div>
      ${near || `<p class="muted">Type an address, area or landmark above to see what is within a few kilometres of you.</p>`}
      <p><b>${tp.say}</b> About ${f1(d.exp)} cases are expected in this district over the next 2 weeks (likely range ${fmt(d.lo)} to ${fmt(d.hi)}).</p>
      <p class="fine muted">Forecast for ${dshort(D.meta.window[0])} to ${dshort(D.meta.window[1])}, based on cases reported up to ${dfmt(D.meta.snapshot)}. It is a forecast, not a confirmed outbreak declaration.</p>
      <div class="stats"><div><b>${peak}</b><span>age group with most cases</span></div><div><b>${Math.round(share(5, 19) * 100)}%</b><span>of cases in school-age children</span></div><div><b>${Math.round(share(20, 49) * 100)}%</b><span>of cases in working-age adults</span></div></div>
      <div><b>What helps</b><ul>${tp.you.map((t) => `<li>${t}</li>`).join("")}</ul></div>
      <p class="muted"><b>For local teams:</b> ${tp.team}</p>
      <div class="acts"><button type="button" class="btn primary" id="f-map">Show on the map</button><button type="button" class="btn" id="f-ins">Sites to inspect</button></div></div>`;
    $$("#found .rad button").forEach((b) => (b.onclick = () => { radiusKm = +b.dataset.r; renderFound(); }));
    $("#f-map").onclick = () => { go("map", { scroll: false }); select(d.id); if (pt) { pin = { lat: pt.lat, lon: pt.lon, km: radiusKm }; drawPin(true); } $("#map").scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); };
    $("#f-ins").onclick = () => { go("inspect"); const s2 = $("#qstate"); s2.value = d.state; s2.dispatchEvent(new Event("change")); };
  }
  let found = null, radiusKm = 2;
  function choose(r) {
    const d = districtAt(r.lon, r.lat);
    if (!d) { say("That place is outside the districts covered here. Try a nearby town or landmark.", "warn"); return; }
    found = { d, pt: r }; renderFound();
  }
  // Free-text geocoder (Photon, OpenStreetMap data). Understands addresses, estates, schools and landmarks.
  async function geocode(q) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch("https://photon.komoot.io/api/?" + new URLSearchParams({ q, limit: 6, lang: "en", bbox: "99.5,0.8,119.5,7.5" }), { signal: ctl.signal });
      if (!r.ok) throw new Error("geocoder " + r.status);
      const js = await r.json(), seen = new Set();
      return js.features.filter((f) => f.properties.countrycode === "MY").map((f) => {
        const p = f.properties, label = [...new Set([p.name, p.street, p.district || p.locality, p.city, p.state].filter(Boolean))].join(", ");
        return { label, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
      }).filter((r2) => !seen.has(r2.label) && seen.add(r2.label));
    } finally { clearTimeout(t); }
  }
  // Offline fallback: places this dashboard already knows (districts, outbreak localities, hotspots, ranked sites).
  let gaz = null;
  function local(q) {
    if (!gaz) {
      gaz = D.districts.map((d) => ({ label: `${clean(d.district)}, ${clean(d.state)}`, lat: d.lat, lon: d.lon }))
        .concat(D.outbreak_pts.map((p) => ({ label: `${p[2]} (outbreak locality)`, lon: p[0], lat: p[1] })))
        .concat(D.hotspots.map((p) => ({ label: `${p[2]} (hotspot)`, lon: p[0], lat: p[1] })))
        .concat(D.priority.filter((s) => s.name).map((s) => ({ label: `${s.name} (${KIND[s.kind][0].toLowerCase()})`, lat: s.lat, lon: s.lon })));
    }
    const tk = q.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 1);
    return gaz.filter((g2) => tk.length && tk.every((t) => g2.label.toLowerCase().includes(t))).sort((a, b) => a.label.length - b.label.length).slice(0, 5);
  }
  function cands(list) {
    $("#cands").innerHTML = list.length > 1 ? `<span class="muted">Did you mean:</span>` + list.map((r, i) => `<button type="button" class="chip" data-i="${i}">${esc(r.label.length > 60 ? r.label.slice(0, 58) + "..." : r.label)}</button>`).join("") : "";
    $$("#cands .chip").forEach((b) => (b.onclick = () => choose(list[+b.dataset.i])));
  }
  $("#find-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = findIn.value.trim(); if (!q) return;
    const dl = byLabel.get(q.toLowerCase()) || D.districts.find((x) => clean(x.district).toLowerCase() === q.toLowerCase());
    if (dl) { say(""); cands([]); found = { d: dl, pt: null }; renderFound(); return; }
    say("Looking up that place...");
    let res = [], note = "";
    try { res = await geocode(q); } catch (err) { note = "Address lookup is not reachable from here, so this matched place names already in the dashboard."; }
    if (!res.length) { res = local(q); if (!note && res.length) note = "No address match, so this matched place names already in the dashboard."; }
    if (!res.length) { say("Could not find that place. Try a nearby landmark, a taman or kampung name, or a district.", "warn"); cands([]); return; }
    say(note, note ? "muted" : ""); cands(res); choose(res[0]);
  });
  $("#locate").onclick = () => {
    if (!navigator.geolocation) { say("Your browser cannot share its location. Type an address instead.", "warn"); return; }
    say("Waiting for your location...");
    navigator.geolocation.getCurrentPosition((p) => { say(""); cands([]); choose({ label: "Your location", lat: p.coords.latitude, lon: p.coords.longitude }); },
      () => say("Location is blocked or unavailable here. Type an address or landmark instead.", "warn"), { timeout: 10000, maximumAge: 300000 });
  };
  findIn.addEventListener("change", () => { const v = findIn.value.trim().toLowerCase(), d = byLabel.get(v); if (d) { say(""); cands([]); found = { d, pt: null }; renderFound(); } });
  $$(".aud-c").forEach((b) => (b.onclick = () => { const g = b.dataset.go; if (g === "find") { findIn.focus(); findIn.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" }); } else go(g); }));

  function countUp(el, to, fn) {
    if (calm) { el.textContent = fn(to); return; }
    const t0 = performance.now(), dur = 900;
    (function step(t) { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fn(Math.round(to * e)); if (p < 1) requestAnimationFrame(step); })(t0);
  }
  const KP = [
    ["New cases reported today", N.today, fmt, "across Malaysia, from the Ministry of Health bulletin"],
    [D.meta.cum_is_ytd ? "Cases so far this year" : "Cumulative cases", N.cum, fmt, "since " + dfmt(D.meta.cum_start)],
    ["Deaths this year", N.deaths, fmt, "reported by the Ministry of Health"],
    ["Expected in the next 2 weeks", N.exp14, fmt, "model estimate, all districts"],
    ["Districts needing attention", nHigh, (v) => v + " of " + D.districts.length, `High or Very high risk, ${f1(N.pop_high / 1e6)} million residents`],
  ];
  $("#kpis").innerHTML = KP.map(([l, , , s]) => `<div class="kpi"><span class="eyebrow">${l}</span><span class="v num">0</span><span class="s">${s}</span></div>`).join("");
  $$("#kpis .v").forEach((el, i) => (KP[i][1] == null ? (el.textContent = "n/a") : countUp(el, KP[i][1], KP[i][2])));

  const mxI = d3.max(ranked.slice(0, 10), (d) => d.per100k);
  $("#topd").innerHTML = ranked.slice(0, 10).map((d, i) => `<button type="button" class="row" data-id="${d.id}" title="${esc(d.district)}: ${f1(d.exp)} cases expected"><span class="nm">${esc(clean(d.district))}<span>${esc(clean(d.state))}</span></span><span class="trk"><span class="gbar" style="--w:${(d.per100k / mxI) * 100}%;--c:${tierColor(d.tier)};animation-delay:${i * 50}ms"></span></span><span class="v"><b>${f1(d.per100k)}</b> ${pill(d.tier)}</span></button>`).join("");
  $$("#topd .row").forEach((b) => (b.onclick = () => openDistrict(b.dataset.id)));

  let stMetric = "inc";
  function renderStates() {
    const key = stMetric === "inc" ? (r) => r.inc_cum : (r) => r.cum, rs = D.regions.slice().sort((a, b) => key(b) - key(a)), mx = d3.max(rs, key);
    $("#states").innerHTML = rs.map((r, i) => `<div class="row" title="${esc(r.region)}: ${fmt(r.cum)} cases this year, ${fmt(r.today)} today"><span class="nm">${esc(clean(r.region).replace(" & Putrajaya", " + Putrajaya"))}<span>${r.today} today</span></span><span class="trk"><span class="gbar" style="--w:${(key(r) / mx) * 100}%;animation-delay:${i * 35}ms"></span></span><span class="v"><b>${stMetric === "inc" ? f1(r.inc_cum) : fmt(r.cum)}</b></span></div>`).join("");
    $("#st-note").textContent = stMetric === "inc" ? "Cases this year per 100,000 people, so large and small states can be compared fairly." : "Total cases reported this year. Larger states naturally have more.";
  }
  $$("#st-metric button").forEach((b) => (b.onclick = () => { stMetric = b.dataset.m; $$("#st-metric button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderStates(); }));
  renderStates();

  /* ================= MAP ================= */
  const LAYERS = [
    { id: "tier", name: "Risk tier", type: "tier", desc: "How many cases are expected per 100,000 residents over the next 2 weeks. Darker means higher risk." },
    { id: "per100k", name: "Expected cases per 100,000", type: "seq", v: (d) => d.per100k, pow: 0.5, unit: " per 100k", desc: "The same measure as the tier, shown as a continuous scale." },
    { id: "p_high", name: "Chance of reaching High tier", type: "seq", v: (d) => d.p_high * 100, unit: "%", desc: "How likely the district is to reach the High tier, given the uncertainty in the estimate." },
    { id: "lisa", name: "Risk clusters", type: "lisa", desc: "Groups of neighbouring districts that are all high or all low, more than chance would explain (local Moran's I)." },
    { id: "gi", name: "Hot and cold spots", type: "div", v: (d) => d.gi, dom: [-3, 0, 3], unit: " z", desc: "Statistical hot spots (red) and cold spots (blue) of expected incidence (Getis-Ord Gi*)." },
    { id: "suit", name: "Mosquito breeding suitability", type: "seq", v: (d) => d.suit, unit: " / 100", desc: "How well recent temperature, rain and humidity suit Aedes breeding. A rule-based index, not fitted to cases." },
    { id: "rain14", name: "Rain, last 14 days", type: "seq", v: (d) => d.rain14, unit: " mm", desc: "Rain collects in containers, tyres and drains. Breeding follows within about 1 to 2 weeks." },
    { id: "rain_fc7", name: "Rain forecast, next 7 days", type: "seq", v: (d) => d.rain_fc7, unit: " mm", desc: "Forecast rainfall for the coming week." },
    { id: "clim", name: "Weather effect on cases", type: "div", v: (d) => d.clim, dom: [0.7, 1, 1.4], unit: "x", desc: "How much recent weather is pushing expected cases up (red) or down (blue). 1.0 is neutral." },
    { id: "density", name: "Population density", type: "seq", v: (d) => d.density, log: true, unit: " per km2", desc: "Dense areas mean more people near each mosquito." },
    { id: "constr", name: "Mapped construction sites", type: "seq", v: (d) => d.osm_constr, pow: 0.5, unit: " sites", desc: "Construction sites in OpenStreetMap. Coverage is uneven, so a low count can mean unmapped." },
    { id: "edu", name: "Schools and kindergartens", type: "seq", v: (d) => d.osm_school + d.osm_kinder, pow: 0.5, unit: " sites", desc: "Schools and kindergartens in OpenStreetMap. Coverage is uneven." },
  ];
  $("#layer").innerHTML = LAYERS.map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
  const LISA = { HH: "High risk, high-risk neighbours", LL: "Low risk, low-risk neighbours", HL: "High among low", LH: "Low among high", ns: "No significant cluster" };
  const KIND = { school: ["School", "--s1"], kindergarten: ["Kindergarten", "--s2"], construction: ["Construction site", "--s3"] };
  let layer = LAYERS[0], mapReady = false, gP, pin = null, colorFn = () => "#888", svg, proj, path, gS, gO, gH, paths, zoom, k = 1, W = 1000, H = 465, selected = null;

  function layerValue(d) {
    if (layer.type === "tier") return d.tier;
    if (layer.type === "lisa") return LISA[d.lisa];
    const v = layer.v(d); return v == null ? "n/a" : (Math.abs(v) >= 100 ? fmt(Math.round(v)) : f2(v).replace(/\.?0+$/, "")) + layer.unit;
  }
  function recolor() {
    if (!mapReady) return;
    const tcol = TIERS.map((_, i) => css("--t" + i)), lg = $("#legend");
    const neg = css("--div-neg"), mid = css("--div-mid"), pos = css("--div-pos");
    $("#layer-desc").textContent = layer.desc;
    if (layer.type === "tier") {
      colorFn = (d) => tcol[TIERS.indexOf(d.tier)];
      const th = D.meta.tiers.map((t) => t[0]);
      lg.innerHTML = TIERS.map((t, i) => `<span><span class="sw" style="background:${tcol[i]}"></span>${t} <span class="muted">${i < 3 ? th[i] + " to " + th[i + 1] : th[i] + "+"}</span></span>`).join("") + `<span class="note">cases per 100,000 residents in 14 days</span>`;
    } else if (layer.type === "lisa") {
      const c = { HH: pos, LL: neg, HL: d3.interpolateRgb(mid, pos)(0.45), LH: d3.interpolateRgb(mid, neg)(0.45), ns: css("--nodata") };
      colorFn = (d) => c[d.lisa];
      lg.innerHTML = Object.keys(LISA).map((k2) => `<span><span class="sw" style="background:${c[k2]}"></span>${LISA[k2]}</span>`).join("") + `<span class="note">p at most 0.05</span>`;
    } else if (layer.type === "div") {
      const s = d3.scaleDiverging([layer.dom[0], layer.dom[1], layer.dom[2]], (t) => t < 0.5 ? d3.interpolateRgb(neg, mid)(t * 2) : d3.interpolateRgb(mid, pos)((t - 0.5) * 2)).clamp(true);
      colorFn = (d) => s(layer.v(d));
      lg.innerHTML = `<span>${layer.dom[0]}${layer.unit}<span class="ramp" style="background:linear-gradient(90deg,${neg},${mid},${pos})"></span>${layer.dom[2]}${layer.unit}</span><span class="note">${layer.id === "gi" ? "beyond +1.96 or -1.96 is statistically significant" : "1.0 means recent weather is neutral"}</span>`;
    } else {
      const vals = D.districts.map(layer.v).filter((v) => v != null && isFinite(v)), lo = d3.min(vals), hi = d3.max(vals);
      const sc = layer.log ? d3.scaleLog().domain([Math.max(lo, 1), hi]).range([0, 1]) : d3.scalePow().exponent(layer.pow || 1).domain([lo, hi]).range([0, 1]);
      const ramp = d3.interpolateRgb(css("--seq-lo"), css("--seq-hi"));
      colorFn = (d) => { const v = layer.v(d); return v == null ? css("--nodata") : ramp(Math.max(0, Math.min(1, sc(layer.log ? Math.max(v, 1) : v)))); };
      lg.innerHTML = `<span>${fmt(Math.round(lo))}<span class="ramp" style="background:linear-gradient(90deg,${ramp(0)},${ramp(1)})"></span>${fmt(Math.round(hi))}${layer.unit}</span>`;
    }
    lg.innerHTML += `<span><span class="mk" style="background:var(--ink)"></span>active outbreak locality</span><span><span class="mk ring"></span>hotspot (over 30 days)</span>`;
    paths.attr("fill", (f) => colorFn(byId.get(f.id)));
  }
  function sizePts() { gP && gP.selectAll("circle").attr("r", 6 / k); gO.selectAll("circle").attr("r", 2.6 / k); gH.selectAll("circle").attr("r", 5 / k); gS.selectAll("circle").attr("r", 2.4 / Math.sqrt(k)); }
  function initMap() {
    if (mapReady) return; mapReady = true;
    svg = d3.select("#map");
    const box = svg.node().getBoundingClientRect();
    H = Math.round(W / ((box.width || 1000) / (box.height || 465)));
    svg.attr("viewBox", `0 0 ${W} ${H}`);
    proj = d3.geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], D.geo); path = d3.geoPath(proj);
    const g = svg.append("g"), gD = g.append("g"); gS = g.append("g"); gO = g.append("g"); gH = g.append("g"); gP = g.append("g");
    zoom = d3.zoom().scaleExtent([1, 60]).on("zoom", (e) => { g.attr("transform", e.transform); k = e.transform.k; sizePts(); });
    svg.call(zoom).on("dblclick.zoom", null);
    paths = gD.selectAll("path").data(D.geo.features).join("path").attr("class", "d").attr("d", path).attr("tabindex", 0)
      .attr("aria-label", (f) => { const d = byId.get(f.id); return `${d.district}, ${d.state}: ${d.tier}`; })
      .on("mousemove", (ev, f) => { const d = byId.get(f.id); showTip(`<b>${esc(d.district)}</b> <span class="k">${esc(d.state)}</span><br>${d.tier} risk, ${f1(d.exp)} cases expected<br><span class="k">${layer.name}:</span> ${layerValue(d)}`, ev); })
      .on("mouseleave", hideTip).on("click", (ev, f) => select(f.id)).on("keydown", (ev, f) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(f.id); } });
    gO.selectAll("circle").data(D.outbreak_pts).join("circle").attr("class", "ob").attr("cx", (p) => proj([p[0], p[1]])[0]).attr("cy", (p) => proj([p[0], p[1]])[1]);
    gH.selectAll("circle").data(D.hotspots).join("circle").attr("class", "hs").attr("cx", (p) => proj([p[0], p[1]])[0]).attr("cy", (p) => proj([p[0], p[1]])[1]);
    sizePts(); recolor(); drawPin(false);
    if (selected) select(selected); else renderRank();
  }
  $("#layer").addEventListener("change", (e) => { layer = LAYERS.find((l) => l.id === e.target.value); recolor(); });
  $("#ov-ob").addEventListener("change", (e) => gO && gO.attr("display", e.target.checked ? null : "none"));
  $("#ov-hs").addEventListener("change", (e) => gH && gH.attr("display", e.target.checked ? null : "none"));
  function zoomTo(feats, pad, btn) {
    const b = path.bounds({ type: "FeatureCollection", features: feats }), dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1];
    const s = Math.min(40, pad / Math.max(dx / W, dy / H)), t = d3.zoomIdentity.translate(W / 2 - s * (b[0][0] + b[1][0]) / 2, H / 2 - s * (b[0][1] + b[1][1]) / 2).scale(s);
    svg.transition().duration(calm ? 0 : 600).call(zoom.transform, t);
    ["#z-all", "#z-pen", "#z-bor"].forEach((i) => $(i).setAttribute("aria-pressed", String(i === btn)));
  }
  $("#z-all").onclick = () => zoomTo(D.geo.features, 0.96, "#z-all");
  $("#z-pen").onclick = () => zoomTo(D.geo.features.filter((f) => byId.get(f.id).lon < 106), 0.9, "#z-pen");
  $("#z-bor").onclick = () => zoomTo(D.geo.features.filter((f) => byId.get(f.id).lon >= 106), 0.9, "#z-bor");

  function drawPin(zoomIt) {
    if (!mapReady || !pin) return;
    gP.selectAll("*").remove();
    const c = d3.geoCircle().center([pin.lon, pin.lat]).radius(pin.km / 111.32)();
    gP.append("path").datum(c).attr("class", "pinr").attr("d", path);
    const [x, y] = proj([pin.lon, pin.lat]);
    gP.append("circle").attr("class", "pin").attr("cx", x).attr("cy", y).attr("r", 6 / k);
    if (zoomIt) zoomTo([{ type: "Feature", geometry: c, properties: {} }], 0.6, null);
  }
  function select(id) {
    selected = id;
    if (!mapReady) { return; }
    paths.classed("sel", (f) => f.id === id); gS.selectAll("*").remove();
    if (!id) { renderRank(); return; }
    const d = byId.get(id), idx = D.districts.indexOf(d), pts = [];
    Object.keys(KIND).forEach((kd) => (D.sites[kd] || []).forEach((p) => { if (p[2] === idx) pts.push([p[0], p[1], kd]); }));
    gS.selectAll("circle").data(pts).join("circle").attr("class", "site").attr("fill", (p) => css(KIND[p[2]][1])).attr("cx", (p) => proj([p[0], p[1]])[0]).attr("cy", (p) => proj([p[0], p[1]])[1]);
    sizePts(); zoomTo(D.geo.features.filter((f) => f.id === id), 0.55, null); renderDistrict(d, pts.length);
  }
  function renderRank() {
    $("#side").innerHTML = `<header><span class="eyebrow">Watch list</span><h2>Highest expected incidence</h2><p class="muted">Pick a district here or on the map.</p></header>
      <ol class="rank">${ranked.slice(0, 30).map((d) => `<li data-id="${d.id}" tabindex="0"><span class="muted num">${d.rank}</span><span class="nm"><b>${esc(d.district)}</b><span>${esc(d.state)}</span></span><span class="rv">${pill(d.tier)}<small>${f1(d.per100k)} per 100k</small></span></li>`).join("")}</ol>`;
    $$(".rank li").forEach((li) => { li.onclick = () => select(li.dataset.id); li.onkeydown = (e) => { if (e.key === "Enter") select(li.dataset.id); }; });
  }
  function renderDistrict(d, nSites) {
    const r = regionOf.get(d.region), ages = D.meta.ages, mx = Math.max(...d.age_m, ...d.age_f, 1e-9);
    const band = (lo, hi) => { let c = 0, p = 0; ages.forEach((a, i) => { const s = parseInt(a, 10); if (s >= lo && s <= hi) { c += d.age_m[i] + d.age_f[i]; p += d.pop_m[i] + d.pop_f[i]; } }); return [c, p]; };
    const kids = band(5, 19), work = band(20, 49), old = band(60, 200);
    const sites = D.priority.filter((s) => s.id === d.id).slice(0, 5);
    $("#side").innerHTML = `<header><div class="row2"><span class="eyebrow">${esc(d.state)}</span><button class="btn" id="back" type="button">All districts</button></div>
        <div class="row2"><h2>${esc(d.district)}</h2>${pill(d.tier)}</div></header>
      <div class="blk"><div class="big"><span><span class="v num">${f1(d.exp)}</span> cases expected</span><span class="muted">likely range ${fmt(d.lo)} to ${fmt(d.hi)}</span></div>
        <dl class="kv"><dt>Per 100,000 residents</dt><dd>${f1(d.per100k)}</dd><dt>Chance of reaching High tier</dt><dd>${Math.round(d.p_high * 100)}%</dd><dt>Rank among ${D.districts.length} districts</dt><dd>${d.rank}</dd></dl></div>
      <div class="blk"><h3>Why this estimate</h3><dl class="kv">
        <dt>${esc(d.region)} current level</dt><dd>${f1(r.weekly_level)} cases / week</dd>
        <dt>Seasonal change expected</dt><dd>x ${f2(d.season)}</dd>
        <dt>Effect of the last 3 months' weather</dt><dd>x ${f2(d.clim)}</dd>
        <dt>District share of state cases</dt><dd>${f1(d.share * 100)}%</dd>
        <dt>Active outbreak localities here</dt><dd>${d.outbreaks}${d.hotspots ? " (" + d.hotspots + " hotspot" + (d.hotspots > 1 ? "s" : "") + ")" : ""}</dd>
        <dt>Population, density</dt><dd>${fmt(d.pop)}, ${fmt(Math.round(d.density))} / km2</dd></dl></div>
      <div class="blk"><h3>Breeding conditions</h3><dl class="kv">
        <dt>Rain, last 14 days</dt><dd>${d.rain14 == null ? "n/a" : fmt(d.rain14) + " mm"}</dd><dt>Rain forecast, next 7 days</dt><dd>${d.rain_fc7 == null ? "n/a" : fmt(d.rain_fc7) + " mm"}</dd>
        <dt>Mean temperature, humidity</dt><dd>${d.temp14 ?? "n/a"} C, ${d.rh14 ?? "n/a"}%</dd><dt>Suitability index</dt><dd>${d.suit ?? "n/a"} / 100</dd></dl></div>
      <div class="blk"><h3>Who is most exposed</h3>
        <dl class="kv"><dt>School age, 5 to 19</dt><dd>${f1(kids[0])} cases, ${fmt(kids[1])} residents</dd><dt>Working age, 20 to 49</dt><dd>${f1(work[0])} cases, ${fmt(work[1])} residents</dd><dt>Aged 60 and over</dt><dd>${f1(old[0])} cases, ${fmt(old[1])} residents</dd></dl>
        <div class="pyr"><span class="h m" style="justify-self:end">Male</span><span class="a">Age</span><span class="h">Female</span>
        ${ages.map((a, i) => `<span class="b m" style="width:${(d.age_m[i] / mx) * 100}%" title="Male ${a}: ${f2(d.age_m[i])} cases"></span><span class="a">${a}</span><span class="b f" style="width:${(d.age_f[i] / mx) * 100}%" title="Female ${a}: ${f2(d.age_f[i])} cases"></span>`).reverse().join("")}</div>
        <p class="muted" style="font-size:12px">Expected cases split by ${D.meta.pop_year} population and an assumed age and sex risk profile. It shows who is exposed, not who will be infected.</p></div>
      <div class="blk"><h3>Places to check</h3><dl class="kv">
        <dt>Schools (MOE register)</dt><dd>${d.schools == null ? "n/a" : fmt(d.schools)}${d.students ? ", " + fmt(d.students) + " pupils" : ""}</dd>
        <dt><span class="mk" style="background:var(--s1)"></span>Schools mapped</dt><dd>${fmt(d.osm_school)}</dd><dt><span class="mk" style="background:var(--s2)"></span>Kindergartens mapped</dt><dd>${fmt(d.osm_kinder)}</dd><dt><span class="mk" style="background:var(--s3)"></span>Construction sites mapped</dt><dd>${fmt(d.osm_constr)}</dd></dl>
        ${sites.length ? `<table><tbody>${sites.map((s) => `<tr><td>${esc(s.name || "Unnamed " + KIND[s.kind][0].toLowerCase())}<br><span class="muted">${KIND[s.kind][0]}${s.near_km != null ? ", " + f1(s.near_km) + " km from an outbreak" : ""}</span></td><td class="n">${f1(s.score)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">${nSites ? "No site here is in the top of the national queue." : "No sites mapped in OpenStreetMap for this district."}</p>`}</div>`;
    $("#back").onclick = () => { select(null); zoomTo(D.geo.features, 0.96, "#z-all"); };
  }

  /* ================= INSPECTION ================= */
  $("#caution").innerHTML = "<b>Read this list as priorities, not findings.</b> A site appears here because it lies in an area with elevated forecast risk, recent rain, and sometimes a nearby outbreak locality. That does not mean the site is unsafe or that it caused any case; the source of an outbreak is established on the ground by health teams.";
  const ICON = { ok: "&#10003;", part: "&#9680;", no: "&#10005;" };
  const ROLES = [
    ["Residents and parents", "Is risk rising near my home or my child's school?", "Risk for your district, outbreaks and sites within 1 to 5 km, a prevention checklist", "Check your surroundings and follow local health-office advice", "today", "ok", "Available"],
    ["Kindergarten and school managers", "Which parts of our premises need attention?", "Area risk around a school, sites ranked for inspection", "Schedule checks of drains, containers and toilets", "inspect", "part", "Partly: no task tracking yet"],
    ["Construction site managers", "What needs fixing on our site?", "Area risk and where mapped sites rank", "Check water-collection hazards and drainage", "inspect", "part", "Partly: no site inspection records"],
    ["Community leaders and JMB", "Where should we organise a clean-up?", "Outbreak localities and hotspots near you", "Coordinate residents and council support", "map", "part", "Partly: no resident reports"],
    ["District health teams", "Where do limited field teams go first?", "Ranked districts with ranges, outbreak localities, ranked sites", "Allocate field visits", "map", "ok", "Available, as estimates until district data is shared"],
    ["Local councils", "Which hazards are ours to clear?", "Nothing yet", "Clear drainage and waste problems", "about", "no", "Not built: needs council work-order data"],
    ["Clinics and hospitals", "Could demand rise near us?", "District forecast ranges and age mix", "Review staffing and supplies", "map", "part", "Partly: district level only"],
    ["State and MOH managers", "Which districts need extra support?", "District comparison and forecast accuracy", "Allocate resources", "evidence", "part", "Partly: no response-coverage data"],
    ["Researchers and data teams", "Can we trust this prediction?", "Backtests, data freshness and stated limits", "Validate and improve the model", "evidence", "ok", "Available"],
  ];
  $("#roles").innerHTML = `<thead><tr><th>Who</th><th>Their question</th><th>This page gives them</th><th>Decision it supports</th><th>Status</th></tr></thead><tbody>` +
    ROLES.map(([w, q, g, dcs, tab, st, txt]) => `<tr class="click" data-tab="${tab}" tabindex="0"><td><b>${w}</b></td><td>${q}</td><td>${g}</td><td>${dcs}</td><td><span class="st st-${st}">${ICON[st]} ${txt}</span></td></tr>`).join("") + "</tbody>";
  $$("#roles tr.click").forEach((tr) => { const open = () => go(tr.dataset.tab); tr.onclick = open; tr.onkeydown = (e) => { if (e.key === "Enter") open(); }; });
  $("#roles-note").textContent = "Not built yet: the working loop of forecast, review, assign an inspection, fix the hazard, and verify completion. That needs sign-in, owners and due dates, and a database, so it is the next phase, starting with district health teams, school and kindergarten managers, and construction managers.";
  $("#score-how").innerHTML = [["District risk", "Sites in districts with higher expected incidence rank higher."], ["Recent rain", "More rain in the last 14 days means more standing water."], ["Distance to an outbreak", "Sites within about a kilometre of an active outbreak locality get a large boost."], ["Site type", "Construction sites weigh a little more: open water plus a mobile workforce."]].map(([a, b]) => `<div><b>${a}</b>${b}</div>`).join("");
  const qStates = [...new Set(D.priority.map((s) => s.state))].sort();
  $("#qstate").innerHTML = `<option value="">All states</option>` + qStates.map((s) => `<option>${esc(s)}</option>`).join("");
  let qKind = "all";
  function renderQueue() {
    const st = $("#qstate").value, rows = D.priority.filter((s) => (qKind === "all" || s.kind === qKind) && (!st || s.state === st)).sort((a, b) => b.score - a.score).slice(0, 150);
    $("#q-note").textContent = D.priority.length ? `${rows.length} shown. Select a row to open its district.` : "";
    $("#queue").innerHTML = rows.length ? `<thead><tr><th class="n">#</th><th>Site</th><th>Type</th><th>District</th><th>District risk</th><th class="n">Nearest outbreak</th><th class="n">Rain 14 d</th><th class="n">Score</th></tr></thead><tbody>` +
      rows.map((s, i) => `<tr class="click" data-id="${s.id}" tabindex="0"><td class="n muted">${i + 1}</td><td><b>${esc(s.name || "Unnamed")}</b></td><td><span class="mk" style="background:var(${KIND[s.kind][1]})"></span>${KIND[s.kind][0]}</td><td>${esc(s.district)}<span class="muted">, ${esc(s.state)}</span></td><td>${pill(s.tier)}</td><td class="n">${s.near_km == null ? "n/a" : f1(s.near_km) + " km"}</td><td class="n">${fmt(s.rain14)} mm</td><td class="n"><span class="inbar" style="width:${s.score * 0.6}px"></span><b>${f1(s.score)}</b></td></tr>`).join("") + "</tbody>"
      : `<tbody><tr><td class="muted">No sites match. ${D.priority.length ? "Try another type or state." : "OpenStreetMap was unreachable on the last pipeline run; the next run retries."}</td></tr></tbody>`;
    $$("#queue tr.click").forEach((tr) => { const open = () => openDistrict(tr.dataset.id); tr.onclick = open; tr.onkeydown = (e) => { if (e.key === "Enter") open(); }; });
  }
  $$("#kind button").forEach((b) => (b.onclick = () => { qKind = b.dataset.k; $$("#kind button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderQueue(); }));
  $("#qstate").addEventListener("change", renderQueue);

  /* ================= EVIDENCE ================= */
  const M = D.models, rm = M.region_month, nw = M.national_week;
  const get = (spec, model) => rm.find((r) => r.spec === spec && r.model === (model || "NB-GLM"));
  const base = rm[0].mae / (1 - rm[0].skill), mxm = Math.max(base, d3.max(rm, (r) => r.mae));
  const w4 = (s) => nw.find((r) => r.horizon === 4 && r.spec === s), w1 = (s) => nw.find((r) => r.horizon === 1 && r.spec === s);
  const c = get("Recent cases"), cw = get("Cases + weather"), so = get("Seasonality only"), sw = get("+ Weather lags"), en = get("+ ENSO / IOD"), nbr = get("Cases + neighbours");
  $("#takeaways").innerHTML = [
    ["yes", "Predictive", "Recent case counts", `Knowing recent cases cuts the average miss from <b>${Math.round(so.mae)}</b> to <b>${Math.round(c.mae)}</b> cases per state-month. Almost all short-range skill comes from here.`],
    [w4("Cases + weather").skill > w4("Recent cases").skill ? "meh" : "no", "Helps a little", "Weather", `A season-only model improves with weather lags (${Math.round(so.mae)} to ${Math.round(sw.mae)}), but one month ahead it adds ${cw.mae < c.mae ? "a little" : "nothing"} once recent cases are known. Four weeks ahead nationally, skill moves from ${f2(w4("Recent cases").skill)} to ${f2(w4("Cases + weather").skill)}.`],
    ["no", "No gain", "ENSO, neighbours, and the rest", `ENSO and Indian Ocean Dipole ${en.mae < sw.mae ? "helped" : "did not help"}; neighbouring states ${nbr.mae < c.mae ? "helped" : "did not help"}. Density, schools, construction and hygiene cannot be tested yet: no open district-level case history exists.`],
  ].map(([cls, tag, h, p]) => `<div><span class="tag ${cls}">${tag}</span><h3>${h}</h3><p>${p}</p></div>`).join("");
  $("#abl-sub").textContent = `Average miss in cases per state-month, tested on 2003 to 2010 (${fmt(rm[0].n)} state-months, ${M.train.region_month[1]} states). Shorter is better.`;
  $("#abl").innerHTML = [{ spec: "Same as last month (baseline)", mae: base, ref: 1 }].concat(rm).map((r) => `<span>${r.spec}${r.model === "GBM" ? " (boosted trees)" : ""}</span><span class="trk"><span class="fill${r.ref ? " ref" : ""}" style="width:${(r.mae / mxm) * 100}%"></span></span><span class="val">${Math.round(r.mae)}${r.top3 != null ? " &middot; top 3 " + Math.round(r.top3 * 100) + "%" : ""}</span>`).join("");
  $("#abl-read").textContent = `"Top 3" is how often the three worst-hit states were correctly flagged each month. Seasonality alone catches about ${Math.round(so.top3 * 100)}%; adding recent cases reaches ${Math.round(c.top3 * 100)}%.`;
  $("#hz-read").textContent = `One week ahead, weather ${w1("Cases + weather").skill > w1("Recent cases").skill ? "helps" : "does not help"}; by four weeks it ${w4("Cases + weather").skill > w4("Recent cases").skill ? "starts to" : "still does not"}.`;

  function lineChart(el, series, o) {
    const Wc = 640, Hc = o.h || 240, m = { t: 12, r: o.right || 16, b: 26, l: 44 }, x = o.x.range([m.l, Wc - m.r]), y = o.y.range([Hc - m.b, m.t]);
    const s = d3.select(el).html("").append("svg").attr("class", "chart").attr("viewBox", `0 0 ${Wc} ${Hc}`);
    y.ticks(5).forEach((t) => { s.append("line").attr("class", "grid").attr("x1", m.l).attr("x2", Wc - m.r).attr("y1", y(t)).attr("y2", y(t)); s.append("text").attr("x", m.l - 8).attr("y", y(t) + 4).attr("text-anchor", "end").text(o.yf(t)); });
    o.xt.forEach((t) => s.append("text").attr("x", x(t)).attr("y", Hc - 8).attr("text-anchor", "middle").text(o.xf(t)));
    if (o.zero) s.append("line").attr("class", "axis").attr("x1", m.l).attr("x2", Wc - m.r).attr("y1", y(0)).attr("y2", y(0));
    const ln = d3.line().defined((p) => p[1] != null).x((p) => x(p[0])).y((p) => y(p[1]));
    series.forEach((se) => { s.append("path").attr("d", ln(se.pts)).attr("fill", "none").attr("stroke", `var(${se.c})`).attr("stroke-width", 2).attr("stroke-linejoin", "round"); if (o.dots) se.pts.forEach((p) => s.append("circle").attr("cx", x(p[0])).attr("cy", y(p[1])).attr("r", 4.5).attr("fill", `var(${se.c})`).attr("stroke", "var(--surface)").attr("stroke-width", 2)); });
    const hair = s.append("line").attr("class", "axis").attr("y1", m.t).attr("y2", Hc - m.b).attr("display", "none");
    s.append("rect").attr("x", m.l).attr("y", m.t).attr("width", Wc - m.l - m.r).attr("height", Hc - m.t - m.b).attr("fill", "transparent")
      .on("mousemove", (ev) => { const px = d3.pointer(ev)[0], xs = series[0].pts.map((p) => p[0]), i = d3.leastIndex(xs, (a) => Math.abs(x(a) - px)); hair.attr("display", null).attr("x1", x(xs[i])).attr("x2", x(xs[i])); showTip(o.tip(i), ev); })
      .on("mouseleave", () => { hair.attr("display", "none"); hideTip(); });
  }
  const HZ = [["Recent cases", "--s1"], ["Cases + weather", "--s2"], ["All factors", "--s3"]];
  const hzS = HZ.map(([sp, col]) => ({ c: col, name: sp, pts: [1, 2, 3, 4].map((h) => [h, nw.find((r) => r.horizon === h && r.spec === sp).skill]) }));
  const ys = hzS.flatMap((s) => s.pts.map((p) => p[1]));
  lineChart("#hz", hzS, { x: d3.scaleLinear().domain([0.8, 4.2]), y: d3.scaleLinear().domain([Math.min(-0.05, d3.min(ys)), d3.max(ys) + 0.03]).nice(), xt: [1, 2, 3, 4], xf: (t) => t + (t === 1 ? " week ahead" : " weeks"), yf: (t) => (t > 0 ? "+" : "") + Math.round(t * 100) + "%", zero: true, dots: true,
    tip: (i) => `<b>${i + 1} week${i ? "s" : ""} ahead</b><br>` + hzS.map((s) => `${s.name}: ${(s.pts[i][1] > 0 ? "+" : "") + Math.round(s.pts[i][1] * 100)}% vs baseline`).join("<br>") });
  $("#hz-lg").innerHTML = HZ.map(([n, col]) => `<span><i style="background:var(${col})"></i>${n}</span>`).join("");

  const DRV = { rain: "Rainfall", wet: "Wet days", rh: "Humidity", temp: "Mean temperature", tmin: "Night temperature", tmax: "Day temperature", dtr: "Day-night range", wind: "Wind speed" };
  function heat() {
    const neg = css("--div-neg"), mid = css("--div-mid"), pos = css("--div-pos"), lags = [...new Set(M.lag_week.map((r) => r.lag))];
    const sc = (v) => (v < 0 ? d3.interpolateRgb(mid, neg)(Math.min(1, -v / 0.2)) : d3.interpolateRgb(mid, pos)(Math.min(1, v / 0.2)));
    $("#lagw").innerHTML = `<thead><tr><th class="r">Weeks earlier</th>${lags.map((l) => `<th>${l}</th>`).join("")}</tr></thead><tbody>` + Object.keys(DRV).map((dk) => `<tr><th class="r">${DRV[dk]}</th>${lags.map((l) => { const r = M.lag_week.find((q) => q.driver === dk && q.lag === l); return `<td class="c" style="background:${sc(r.rho)}" title="${DRV[dk]}, ${l} weeks earlier: rho ${r.rho}">${Math.round(r.rho * 100)}</td>`; }).join("")}</tr>`).join("") + `</tbody><tfoot><tr><th class="r"></th><th colspan="${lags.length}" style="text-align:left;padding-top:6px">Spearman correlation x 100. Blue: fewer cases follow. Red: more cases follow.</th></tr></tfoot>`;
  }
  (function irr() {
    const rows = M.irr_weather, Wc = 640, rh = 15, m = { t: 6, r: 16, b: 24, l: 150 }, Hc = m.t + m.b + rows.length * rh;
    const x = d3.scaleLog().domain([Math.min(0.85, d3.min(rows, (r) => r.lo)), Math.max(1.18, d3.max(rows, (r) => r.hi))]).range([m.l, Wc - m.r]);
    const s = d3.select("#irr").append("svg").attr("class", "chart").attr("viewBox", `0 0 ${Wc} ${Hc}`);
    [0.9, 1, 1.1, 1.2].filter((t) => t >= x.domain()[0] && t <= x.domain()[1]).forEach((t) => { s.append("line").attr("class", t === 1 ? "axis" : "grid").attr("x1", x(t)).attr("x2", x(t)).attr("y1", m.t).attr("y2", Hc - m.b); s.append("text").attr("x", x(t)).attr("y", Hc - 8).attr("text-anchor", "middle").text(t === 1 ? "1.0 no effect" : t.toFixed(1)); });
    rows.forEach((r, i) => {
      const [v, , l] = r.term.split("_"), y = m.t + i * rh + rh / 2, sig = r.p < 0.05;
      s.append("text").attr("x", m.l - 10).attr("y", y + 4).attr("text-anchor", "end").text(`${DRV[v]}, ${l.slice(1)} mo`);
      s.append("line").attr("x1", x(r.lo)).attr("x2", x(r.hi)).attr("y1", y).attr("y2", y).attr("stroke", sig ? "var(--s1)" : "var(--muted)").attr("stroke-width", 2).attr("stroke-linecap", "round");
      s.append("circle").attr("cx", x(r.irr)).attr("cy", y).attr("r", 4).attr("fill", sig ? "var(--s1)" : "var(--surface)").attr("stroke", sig ? "var(--surface)" : "var(--muted)").attr("stroke-width", sig ? 1.5 : 2);
      s.append("rect").attr("x", m.l).attr("y", y - rh / 2).attr("width", Wc - m.l - m.r).attr("height", rh).attr("fill", "transparent").on("mousemove", (ev) => showTip(`<b>${DRV[v]}, ${l.slice(1)} month${l === "l1" ? "" : "s"} earlier</b><br>Rate ratio ${r.irr.toFixed(3)} (95% CI ${r.lo.toFixed(3)} to ${r.hi.toFixed(3)})<br>${sig ? "Distinguishable from no effect" : "Not distinguishable from no effect"}, p = ${r.p.toFixed(3)}`, ev)).on("mouseleave", hideTip);
    });
    d3.select("#irr").append("div").attr("class", "lg").html(`<span><i style="background:var(--s1)"></i>filled: p &lt; 0.05</span><span><i style="background:var(--muted)"></i>hollow: not significant</span>`);
  })();
  (function bt() {
    const Hh = D.history, B = M.backtest_week, pm = new Map(B.week.map((w, i) => [w, B.pred[i]])), t = Hh.week.map((w) => new Date(w));
    const act = t.map((d, i) => [d, Hh.cases[i]]), pr = t.map((d, i) => [d, pm.has(Hh.week[i]) ? pm.get(Hh.week[i]) : null]);
    const yrs = d3.range(t[0].getFullYear() + 1, t[t.length - 1].getFullYear() + 1).map((y) => new Date(y, 0, 1));
    lineChart("#bt", [{ c: "--s1", pts: act }, { c: "--s2", pts: pr }], { h: 260, x: d3.scaleTime().domain([t[0], t[t.length - 1]]), y: d3.scaleLinear().domain([0, d3.max(Hh.cases) * 1.05]).nice(), xt: yrs, xf: (d) => d.getFullYear(), yf: (v) => fmt(v),
      tip: (i) => `<b>Week of ${dfmt(Hh.week[i])}</b><br>Reported: ${fmt(Hh.cases[i])}` + (pr[i][1] != null ? `<br>Forecast 2 weeks earlier: ${fmt(pr[i][1])}` : "") });
    const r2 = nw.find((r) => r.horizon === 2 && r.spec === B.spec);
    $("#bt-lg").innerHTML = `<span><i style="background:var(--s1)"></i>Reported cases per week</span><span><i style="background:var(--s2)"></i>Forecast made 2 weeks earlier (${B.spec.toLowerCase()})</span><span class="muted">average miss ${fmt(Math.round(r2.mae))} cases per week over ${r2.n} test weeks</span>`;
  })();
  const S = D.spatial, L = S.lisa;
  $("#spatial").innerHTML = `<div class="notes">
    <p><b>Moran's I = ${f2(S.risk.I)}</b> for expected incidence (p = ${S.risk.p}). Risk is strongly clustered: ${L.HH || 0} districts sit in high-risk clusters and ${L.LL || 0} in low-risk clusters. Population density alone gives I = ${f2(S.density.I)}, breeding suitability ${f2(S.suit.I)}.</p>
    <p>Neighbours share a border (queen contiguity, ${S.links} links), significance from 999 permutations. Because district estimates are allocated from state totals, clustering inside a state is partly built in. Clusters that cross state borders, and districts flagged high among low neighbours, are the informative ones.</p></div>`;
  const rs = D.regions.slice().sort((a, b) => b.cum - a.cum), mc = d3.max(rs, (r) => r.cum);
  $("#regions").innerHTML = `<thead><tr><th>State</th><th class="n">Today</th><th>${D.meta.cum_is_ytd ? "Cases this year" : "Cumulative cases"}</th><th class="n">Per 100,000</th><th class="n">Current level / week</th><th class="n">Expected next 14 days</th><th class="n">Outbreak localities</th><th class="n">Hotspots</th></tr></thead><tbody>` +
    rs.map((r) => `<tr><td><b>${esc(r.region)}</b></td><td class="n">${fmt(r.today)}</td><td class="num"><span class="inbar" style="width:${Math.max(2, (r.cum / mc) * 120)}px"></span>${fmt(r.cum)}</td><td class="n">${f1(r.inc_cum)}</td><td class="n">${f1(r.weekly_level)}</td><td class="n">${fmt(Math.round(r.exp14))}</td><td class="n">${fmt(r.outbreaks)}</td><td class="n">${r.hotspots}</td></tr>`).join("") + "</tbody>";

  /* ================= ABOUT ================= */
  $("#steps").innerHTML = [["Read today's cases", "The Ministry of Health publishes cases by state every day. That is the only open, current case count."], ["Adjust for season and weather", "Compare with the usual pattern for this time of year, then nudge up or down for recent warm spells and rain."], ["Share across districts", "Split each state's cases by population, density, local weather and where active outbreak localities are."], ["Rank and add detail", "Give each district a tier and range, split by age and sex, and list nearby schools, kindergartens and building sites."]].map(([h, p]) => `<li><b>${h}</b>${p}</li>`).join("");
  $("#gloss").innerHTML = [
    ["Risk tier", "Low, Moderate, High or Very high, set from expected cases per 100,000 residents over 14 days."],
    ["Per 100,000", "Cases divided by population, times 100,000. It lets small and large places be compared fairly."],
    ["Likely range", "The span the true number should fall in about 8 times out of 10."],
    ["Chance of reaching High", "The probability the district's cases reach the High tier threshold."],
    ["Outbreak locality", "A neighbourhood or housing area the Ministry lists as having an active dengue cluster."],
    ["Hotspot", "A locality with an outbreak that has lasted more than 30 days."],
    ["Breeding suitability", "A rule-based 0 to 100 score for how well recent temperature, rain and humidity suit Aedes mosquitoes."],
    ["Risk cluster", "A group of neighbouring districts that are all high or all low, more than chance would explain."],
    ["Rate ratio", "How much incidence multiplies for a one-step change in a factor. 1.0 means no effect."],
    ["Skill", "How much a forecast beats a simple baseline. Zero means no better; above zero means better."],
  ].map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join("");
  const gc = D.meta.geocoded;
  $("#notes").innerHTML = [
    `<b>District figures are estimates, not counts.</b> Malaysia publishes no open district-level case history. Each state's observed level is split across its districts. Treat tiers as a ranking for where to look first.`,
    `<b>The feed is ${D.feed.date.length} day${D.feed.date.length > 1 ? "s" : ""} old.</b> iDengue shows only today's numbers, so the pipeline saves a snapshot on every run. After two weeks the state level switches from a year-to-date average to cases in the last 14 days.`,
    `<b>Running total.</b> iDengue labels its cumulative column as starting 31 Dec 2023, but 2024 alone had about 122,000 cases, so ${fmt(N.cum)} can only be this year's. It is treated as year-to-date.`,
    `<b>Outbreak locations.</b> ${gc.outbreaks[0]} of ${gc.outbreaks[1]} active outbreak localities and ${gc.hotspots[0]} of ${gc.hotspots[1]} hotspots could be placed on the map from their names. Unplaced ones still count at state level.${D.meta.hot_week ? " The hotspot list is dated epidemiological week " + D.meta.hot_week.replace("-W", ", week ").replace(/^(\d{4}), week (\d+)$/, "$2 of $1") + " on the source site." : ""}`,
    `<b>Exposure is not infection.</b> Population counts by age and sex describe who lives in an area, not who will fall ill, and where someone lives does not show where they were bitten. Premise rankings are priorities for inspection, not findings about any site.`,
    `<b>Age and sex split uses assumed risk ratios.</b> Higher risk at ages 15 to 49 and slightly higher in males, applied to real district population.`,
    `<b>Address search.</b> Text you type is sent to the Photon geocoder (OpenStreetMap data) to get coordinates; the page stores nothing. Distances are straight-line and outbreak positions are approximate, placed from locality names.`,
    `<b>Sites come from OpenStreetMap.</b> Kindergartens and construction sites are under-mapped and may be out of date. Use the queue to plan inspections, then verify on the ground.`,
    `<b>Missing factors.</b> Aedes indices, fogging and inspection records, serotype shifts, mobility and symptom-onset dates are held by the Ministry (eDengue) and are not open. A data-sharing agreement would add the largest accuracy gain.`,
    `<b>Models.</b> Negative-binomial regression with population offset for explanation; boosted trees as a check. Dispersion ${D.meta.alpha}, density elasticity ${D.meta.gamma}. Tier cut-offs at ${D.meta.tiers.slice(1).map((t) => t[0]).join(", ")} expected cases per 100,000 in 14 days.`,
  ].map((t) => `<p>${t}</p>`).join("");
  $("#sources").innerHTML = `<thead><tr><th>Source</th><th>Provides</th><th>Refresh</th><th>Latest</th><th>Volume</th></tr></thead><tbody>` + D.meta.sources.map((s) => `<tr><td><a href="${s.url}" target="_blank" rel="noopener"><b>${esc(s.name)}</b></a></td><td>${esc(s.what)}</td><td>${esc(s.cadence)}</td><td class="num">${esc(s.latest)}</td><td class="num">${esc(s.rows)}</td></tr>`).join("") + "</tbody>";

  /* ================= boot ================= */
  function paint() { heat(); recolor(); if (mapReady && gS) gS.selectAll("circle").attr("fill", (p) => css(KIND[p[2]][1])); $$("#topd .gbar").forEach((el, i) => (el.style.setProperty("--c", tierColor(ranked[i].tier)))); }
  paint(); renderQueue();
  go(location.hash.slice(1), { scroll: false });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
