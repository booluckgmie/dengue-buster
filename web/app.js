/* Dengue Buster dashboard. Reads window.DENGUE (web/data/bundle.js, written by the pipeline). */
(function () {
  const D = window.DENGUE;
  const $ = (s) => document.querySelector(s);
  if (!D || !window.d3) { document.querySelector("main").innerHTML = '<p class="panel pad">No data bundle found. Run <span class="mono">python -m pipeline.run</span> to build <span class="mono">web/data/bundle.js</span>, then reload.</p>'; return; }
  const fmt = d3.format(","), f1 = d3.format(",.1f"), f2 = d3.format(".2f");
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const TIERS = ["Low", "Moderate", "High", "Very high"];
  const pill = (t) => `<span class="pill t-${t.split(" ")[0]}"><i></i>${t}</span>`;
  const dfmt = (s) => new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const byId = new Map(D.districts.map((d) => [d.id, d]));
  const regionOf = new Map(D.regions.map((r) => [r.region, r]));
  const tip = $("#tip");
  function showTip(html, ev) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect(), x = Math.min(ev.clientX + 14, innerWidth - r.width - 8), y = ev.clientY + 16 + r.height > innerHeight ? ev.clientY - r.height - 10 : ev.clientY + 16;
    tip.style.left = Math.max(8, x) + "px"; tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };

  /* ---------- header + KPIs ---------- */
  $("#m-snap").textContent = dfmt(D.meta.snapshot);
  $("#m-win").textContent = dfmt(D.meta.window[0]).replace(/ \d{4}$/, "") + " to " + dfmt(D.meta.window[1]);
  $("#m-gen").textContent = D.meta.generated;
  const N = D.national, tc = N.tiers, nHigh = (tc["High"] || 0) + (tc["Very high"] || 0);
  $("#kpis").innerHTML = [
    ["Cases reported today", fmt(N.today), "nationwide, iDengue bulletin"],
    [D.meta.cum_is_ytd ? "Cases this year" : "Cumulative cases", fmt(N.cum), "since " + dfmt(D.meta.cum_start)],
    ["Deaths this year", N.deaths == null ? "n/a" : fmt(N.deaths), "reported by MOH"],
    ["Expected next 14 days", fmt(N.exp14), "model estimate, all districts"],
    ["Districts at High or Very high", nHigh + " of " + D.districts.length, f1(N.pop_high / 1e6) + " million residents"],
  ].map(([l, v, s]) => `<div class="kpi"><span class="eyebrow">${l}</span><span class="v num">${v}</span><span class="s">${s}</span></div>`).join("");

  /* ---------- map ---------- */
  const LAYERS = [
    { id: "tier", name: "Risk tier", type: "tier" },
    { id: "per100k", name: "Expected cases per 100,000", type: "seq", v: (d) => d.per100k, pow: 0.5, unit: " per 100k" },
    { id: "p_high", name: "Chance of reaching High tier", type: "seq", v: (d) => d.p_high * 100, unit: "%" },
    { id: "lisa", name: "Risk clusters (local Moran)", type: "lisa" },
    { id: "gi", name: "Hot and cold spots (Getis-Ord Gi*)", type: "div", v: (d) => d.gi, dom: [-3, 0, 3], unit: " z" },
    { id: "suit", name: "Mosquito breeding suitability", type: "seq", v: (d) => d.suit, unit: " / 100" },
    { id: "rain14", name: "Rain, last 14 days", type: "seq", v: (d) => d.rain14, unit: " mm" },
    { id: "rain_fc7", name: "Rain forecast, next 7 days", type: "seq", v: (d) => d.rain_fc7, unit: " mm" },
    { id: "clim", name: "Weather effect on cases", type: "div", v: (d) => d.clim, dom: [0.7, 1, 1.4], unit: "x" },
    { id: "density", name: "Population density", type: "seq", v: (d) => d.density, log: true, unit: " per km2" },
    { id: "constr", name: "Mapped construction sites", type: "seq", v: (d) => d.osm_constr, pow: 0.5, unit: " sites" },
    { id: "edu", name: "Schools and kindergartens (OSM)", type: "seq", v: (d) => d.osm_school + d.osm_kinder, pow: 0.5, unit: " sites" },
  ];
  $("#layer").innerHTML = LAYERS.map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
  const LISA = { HH: "High risk, high-risk neighbours", LL: "Low risk, low-risk neighbours", HL: "High among low", LH: "Low among high", ns: "No significant cluster" };
  let layer = LAYERS[0], selected = null, colorFn = () => "#888";

  // d3 needs clockwise exterior rings on the sphere; GeoJSON from GIS tools is usually the reverse.
  D.geo.features.forEach((f) => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    polys.forEach((p) => p.forEach((ring, i) => { const big = d3.geoArea({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI; if (i === 0 ? big : !big) ring.reverse(); }));
  });
  const svg = d3.select("#map"), box = svg.node().getBoundingClientRect();
  const W = 1000, H = Math.round(W / ((box.width || 1000) / (box.height || 465)));
  svg.attr("viewBox", `0 0 ${W} ${H}`);
  const proj = d3.geoMercator().fitExtent([[12, 12], [W - 12, H - 12]], D.geo), path = d3.geoPath(proj);
  const g = svg.append("g"), gD = g.append("g"), gS = g.append("g"), gO = g.append("g"), gH = g.append("g");
  let k = 1;
  const zoom = d3.zoom().scaleExtent([1, 60]).on("zoom", (e) => { g.attr("transform", e.transform); k = e.transform.k; sizePts(); });
  svg.call(zoom).on("dblclick.zoom", null);
  function sizePts() { gO.selectAll("circle").attr("r", 2.6 / k); gH.selectAll("circle").attr("r", 5 / k); gS.selectAll("circle").attr("r", 2.4 / Math.sqrt(k)); }
  const paths = gD.selectAll("path").data(D.geo.features).join("path").attr("class", "d").attr("d", path).attr("tabindex", 0)
    .attr("aria-label", (f) => { const d = byId.get(f.id); return `${d.district}, ${d.state}: ${d.tier}`; })
    .on("mousemove", (ev, f) => { const d = byId.get(f.id); showTip(`<b>${esc(d.district)}</b> <span class="k">${esc(d.state)}</span><br>${d.tier} risk, ${f1(d.exp)} cases expected<br><span class="k">${layer.name}:</span> ${layerValue(d)}`, ev); })
    .on("mouseleave", hideTip).on("click", (ev, f) => select(f.id)).on("keydown", (ev, f) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(f.id); } });
  gO.selectAll("circle").data(D.outbreak_pts).join("circle").attr("class", "ob").attr("cx", (p) => proj([p[0], p[1]])[0]).attr("cy", (p) => proj([p[0], p[1]])[1]);
  gH.selectAll("circle").data(D.hotspots).join("circle").attr("class", "hs").attr("cx", (p) => proj([p[0], p[1]])[0]).attr("cy", (p) => proj([p[0], p[1]])[1]);
  sizePts();

  function layerValue(d) {
    if (layer.type === "tier") return d.tier;
    if (layer.type === "lisa") return LISA[d.lisa];
    const v = layer.v(d); return v == null ? "n/a" : (Math.abs(v) >= 100 ? fmt(Math.round(v)) : f2(v).replace(/\.?0+$/, "")) + layer.unit;
  }
  function recolor() {
    const tcol = TIERS.map((_, i) => css("--t" + i)), lg = $("#legend");
    const neg = css("--div-neg"), mid = css("--div-mid"), pos = css("--div-pos");
    if (layer.type === "tier") {
      colorFn = (d) => tcol[TIERS.indexOf(d.tier)];
      const th = D.meta.tiers.map((t) => t[0]);
      lg.innerHTML = TIERS.map((t, i) => `<span><span class="sw" style="background:${tcol[i]}"></span>${t} <span class="muted">${i < 3 ? th[i] + " to " + th[i + 1] : th[i] + "+"}</span></span>`).join("") + `<span class="note">expected cases per 100,000 residents in 14 days</span>`;
    } else if (layer.type === "lisa") {
      const c = { HH: pos, LL: neg, HL: d3.interpolateRgb(mid, pos)(0.45), LH: d3.interpolateRgb(mid, neg)(0.45), ns: css("--nodata") };
      colorFn = (d) => c[d.lisa];
      lg.innerHTML = Object.keys(LISA).map((k2) => `<span><span class="sw" style="background:${c[k2]}"></span>${LISA[k2]}</span>`).join("") + `<span class="note">p &le; 0.05, 999 permutations</span>`;
    } else if (layer.type === "div") {
      const s = d3.scaleDiverging([layer.dom[0], layer.dom[1], layer.dom[2]], (t) => t < 0.5 ? d3.interpolateRgb(neg, mid)(t * 2) : d3.interpolateRgb(mid, pos)((t - 0.5) * 2)).clamp(true);
      colorFn = (d) => s(layer.v(d));
      lg.innerHTML = `<span>${layer.dom[0]}${layer.unit}<span class="ramp" style="background:linear-gradient(90deg,${neg},${mid},${pos})"></span>${layer.dom[2]}${layer.unit}</span><span class="note">${layer.id === "gi" ? "above +1.96 is a significant hot spot, below -1.96 a cold spot" : "1.0 means recent weather is neutral for transmission"}</span>`;
    } else {
      const vals = D.districts.map(layer.v).filter((v) => v != null && isFinite(v)), lo = d3.min(vals), hi = d3.max(vals);
      const sc = layer.log ? d3.scaleLog([Math.max(lo, 1), hi], [0, 1]) : d3.scalePow([lo, hi], [0, 1]).exponent(layer.pow || 1);
      const ramp = d3.interpolateRgb(css("--seq-lo"), css("--seq-hi"));
      colorFn = (d) => { const v = layer.v(d); return v == null ? css("--nodata") : ramp(Math.max(0, Math.min(1, sc(layer.log ? Math.max(v, 1) : v)))); };
      lg.innerHTML = `<span>${fmt(Math.round(lo))}<span class="ramp" style="background:linear-gradient(90deg,${ramp(0)},${ramp(1)})"></span>${fmt(Math.round(hi))}${layer.unit}</span>` + (layer.id === "suit" ? `<span class="note">temperature, 14-day rain and humidity combined; a mechanistic index, not fitted to cases</span>` : layer.id === "constr" || layer.id === "edu" ? `<span class="note">OpenStreetMap coverage is uneven; a low count can mean unmapped</span>` : "");
    }
    lg.innerHTML += `<span><span class="mk" style="background:var(--ink)"></span>active outbreak locality</span><span><span class="mk ring"></span>hotspot</span>`;
    paths.attr("fill", (f) => colorFn(byId.get(f.id)));
  }
  $("#layer").addEventListener("change", (e) => { layer = LAYERS.find((l) => l.id === e.target.value); recolor(); });
  $("#ov-ob").addEventListener("change", (e) => gO.attr("display", e.target.checked ? null : "none"));
  $("#ov-hs").addEventListener("change", (e) => gH.attr("display", e.target.checked ? null : "none"));
  function zoomTo(feats, pad, btn) {
    const b = path.bounds({ type: "FeatureCollection", features: feats }), dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1];
    const s = Math.min(40, pad / Math.max(dx / W, dy / H)), t = d3.zoomIdentity.translate(W / 2 - s * (b[0][0] + b[1][0]) / 2, H / 2 - s * (b[0][1] + b[1][1]) / 2).scale(s);
    svg.transition().duration(matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 500).call(zoom.transform, t);
    ["#z-all", "#z-pen", "#z-bor"].forEach((i) => $(i).setAttribute("aria-pressed", String(i === btn)));
  }
  const west = D.geo.features.filter((f) => byId.get(f.id).lon < 106), east = D.geo.features.filter((f) => byId.get(f.id).lon >= 106);
  $("#z-all").onclick = () => zoomTo(D.geo.features, 0.96, "#z-all");
  $("#z-pen").onclick = () => zoomTo(west, 0.9, "#z-pen");
  $("#z-bor").onclick = () => zoomTo(east, 0.9, "#z-bor");

  /* ---------- side panel ---------- */
  const KIND = { school: ["School", "--s1"], kindergarten: ["Kindergarten", "--s2"], construction: ["Construction site", "--s3"] };
  function select(id) {
    selected = id; paths.classed("sel", (f) => f.id === id); gS.selectAll("*").remove();
    if (!id) { renderRank(); return; }
    const d = byId.get(id), idx = D.districts.indexOf(d), pts = [];
    Object.keys(KIND).forEach((kd) => (D.sites[kd] || []).forEach((p) => { if (p[2] === idx) pts.push([p[0], p[1], kd]); }));
    gS.selectAll("circle").data(pts).join("circle").attr("class", "site").attr("fill", (p) => css(KIND[p[2]][1])).attr("cx", (p) => proj([p[0], p[1]])[0]).attr("cy", (p) => proj([p[0], p[1]])[1]);
    zoomTo(D.geo.features.filter((f) => f.id === id), 0.55, null); renderDistrict(d, pts.length);
  }
  function renderRank() {
    const top = D.districts.slice().sort((a, b) => a.rank - b.rank).slice(0, 30);
    $("#side").innerHTML = `<header><span class="eyebrow">Watch list</span><h2>Highest expected incidence</h2><p class="muted">Pick a district here or on the map.</p></header>
      <ol class="rank">${top.map((d) => `<li data-id="${d.id}" tabindex="0"><span class="muted num">${d.rank}</span><span class="nm"><b>${esc(d.district)}</b><span>${esc(d.state)}</span></span><span class="rv">${pill(d.tier)}<small>${f1(d.per100k)} per 100k</small></span></li>`).join("")}</ol>`;
    document.querySelectorAll(".rank li").forEach((li) => { li.onclick = () => select(li.dataset.id); li.onkeydown = (e) => { if (e.key === "Enter") select(li.dataset.id); }; });
  }
  function renderDistrict(d, nSites) {
    const r = regionOf.get(d.region), ages = D.meta.ages, mx = Math.max(...d.age_m, ...d.age_f, 1e-9);
    const band = (lo, hi) => { let c = 0, p = 0; ages.forEach((a, i) => { const s = parseInt(a, 10); if (s >= lo && s <= hi) { c += d.age_m[i] + d.age_f[i]; p += d.pop_m[i] + d.pop_f[i]; } }); return [c, p]; };
    const kids = band(5, 19), work = band(20, 49), old = band(60, 200);
    const sites = D.priority.filter((s) => s.id === d.id).slice(0, 5);
    $("#side").innerHTML = `<header><div class="row"><span class="eyebrow">${esc(d.state)}</span><button class="btn" id="back" type="button">All districts</button></div>
        <div class="row"><h2>${esc(d.district)}</h2>${pill(d.tier)}</div></header>
      <div class="blk"><div class="big"><span><span class="v num">${f1(d.exp)}</span> cases expected</span><span class="muted">likely range ${fmt(d.lo)} to ${fmt(d.hi)}</span></div>
        <dl class="kv"><dt>Per 100,000 residents</dt><dd>${f1(d.per100k)}</dd><dt>Chance of reaching High tier</dt><dd>${Math.round(d.p_high * 100)}%</dd><dt>Rank among ${D.districts.length} districts</dt><dd>${d.rank}</dd></dl></div>
      <div class="blk"><h3>Why this estimate</h3><dl class="kv">
        <dt>${esc(d.region)} current level</dt><dd>${f1(r.weekly_level)} cases / week</dd>
        <dt>Seasonal change expected</dt><dd>x ${f2(d.season)}</dd>
        <dt>Effect of the last 3 months' weather</dt><dd>x ${f2(d.clim)}</dd>
        <dt>District share of state cases</dt><dd>${f1(d.share * 100)}%</dd>
        <dt>Active outbreak localities located here</dt><dd>${d.outbreaks}${d.hotspots ? " (" + d.hotspots + " hotspot" + (d.hotspots > 1 ? "s" : "") + ")" : ""}</dd>
        <dt>Population, density</dt><dd>${fmt(d.pop)}, ${fmt(Math.round(d.density))} / km2</dd></dl></div>
      <div class="blk"><h3>Breeding conditions</h3><dl class="kv">
        <dt>Rain, last 14 days</dt><dd>${d.rain14 == null ? "n/a" : fmt(d.rain14) + " mm"}</dd><dt>Rain forecast, next 7 days</dt><dd>${d.rain_fc7 == null ? "n/a" : fmt(d.rain_fc7) + " mm"}</dd>
        <dt>Mean temperature, humidity</dt><dd>${d.temp14 ?? "n/a"} C, ${d.rh14 ?? "n/a"}%</dd><dt>Suitability index</dt><dd>${d.suit ?? "n/a"} / 100</dd></dl></div>
      <div class="blk"><h3>Who is most exposed</h3>
        <dl class="kv"><dt>School age, 5 to 19</dt><dd>${f1(kids[0])} cases, ${fmt(kids[1])} residents</dd><dt>Working age, 20 to 49</dt><dd>${f1(work[0])} cases, ${fmt(work[1])} residents</dd><dt>Aged 60 and over</dt><dd>${f1(old[0])} cases, ${fmt(old[1])} residents</dd></dl>
        <div class="pyr"><span class="h m" style="justify-self:end">Male</span><span class="a">Age</span><span class="h">Female</span>
        ${ages.map((a, i) => `<span class="b m" style="width:${(d.age_m[i] / mx) * 100}%" title="Male ${a}: ${f2(d.age_m[i])} cases"></span><span class="a">${a}</span><span class="b f" style="width:${(d.age_f[i] / mx) * 100}%" title="Female ${a}: ${f2(d.age_f[i])} cases"></span>`).reverse().join("")}</div>
        <p class="muted" style="font-size:12px">Expected cases split by ${D.meta.pop_year} population and an assumed age and sex risk profile. Replace with real case shares when MOH data is available.</p></div>
      <div class="blk"><h3>Places to check</h3><dl class="kv">
        <dt>Schools (MOE register)</dt><dd>${d.schools == null ? "n/a" : fmt(d.schools)}${d.students ? ", " + fmt(d.students) + " pupils" : ""}</dd>
        <dt><span class="mk" style="background:var(--s1)"></span>Schools mapped</dt><dd>${fmt(d.osm_school)}</dd><dt><span class="mk" style="background:var(--s2)"></span>Kindergartens mapped</dt><dd>${fmt(d.osm_kinder)}</dd><dt><span class="mk" style="background:var(--s3)"></span>Construction sites mapped</dt><dd>${fmt(d.osm_constr)}</dd></dl>
        ${sites.length ? `<table><tbody>${sites.map((s) => `<tr><td>${esc(s.name || "Unnamed " + KIND[s.kind][0].toLowerCase())}<br><span class="muted">${KIND[s.kind][0]}${s.near_km != null ? ", " + f1(s.near_km) + " km from an outbreak" : ""}</span></td><td class="n">${f1(s.score)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">${nSites ? "No site here is in the national top " + D.priority.length + "." : "No sites mapped in OpenStreetMap for this district."}</p>`}</div>`;
    $("#back").onclick = () => { select(null); zoomTo(D.geo.features, 0.96, "#z-all"); };
  }

  /* ---------- spatial summary ---------- */
  const S = D.spatial, L = S.lisa;
  $("#spatial").innerHTML = `<div class="card-h"><h3>Spatial structure</h3></div><div class="notes">
    <p><b>Moran's I = ${f2(S.risk.I)}</b> for expected incidence (p = ${S.risk.p}). Risk is strongly clustered: ${L.HH || 0} districts sit in high-risk clusters and ${L.LL || 0} in low-risk clusters. Population density alone gives I = ${f2(S.density.I)}, breeding suitability ${f2(S.suit.I)}.</p>
    <p>Neighbours share a border (queen contiguity, ${S.links} links), significance from 999 permutations. Because district estimates are allocated from state totals, clustering inside a state is partly built in. Clusters that cross state borders, and districts flagged high among low neighbours, are the informative ones.</p></div>`;

  /* ---------- states table ---------- */
  const rs = D.regions.slice().sort((a, b) => b.cum - a.cum), mc = d3.max(rs, (r) => r.cum);
  $("#regions").innerHTML = `<thead><tr><th>State</th><th class="n">Today</th><th>${D.meta.cum_is_ytd ? "Cases this year" : "Cumulative cases"}</th><th class="n">Per 100,000</th><th class="n">Current level / week</th><th class="n">Expected next 14 days</th><th class="n">Outbreak localities</th><th class="n">Hotspots</th></tr></thead><tbody>` +
    rs.map((r) => `<tr><td><b>${esc(r.region)}</b></td><td class="n">${fmt(r.today)}</td><td class="num"><span class="inbar" style="width:${Math.max(2, (r.cum / mc) * 120)}px"></span>${fmt(r.cum)}</td><td class="n">${f1(r.inc_cum)}</td><td class="n">${f1(r.weekly_level)}</td><td class="n">${fmt(Math.round(r.exp14))}</td><td class="n">${fmt(r.outbreaks)}</td><td class="n">${r.hotspots}</td></tr>`).join("") + "</tbody>";

  /* ---------- inspection queue ---------- */
  function renderQueue(kind) {
    const rows = D.priority.filter((s) => kind === "all" || s.kind === kind).slice(0, 120);
    $("#q-note").textContent = D.priority.length ? `Top ${rows.length} shown. Score 0 to 100. Select a row to open its district.` : "";
    $("#queue").innerHTML = rows.length ? `<thead><tr><th class="n">#</th><th>Site</th><th>Type</th><th>District</th><th>District risk</th><th class="n">Nearest outbreak</th><th class="n">Rain 14 d</th><th class="n">Score</th></tr></thead><tbody>` +
      rows.map((s, i) => `<tr class="click" data-id="${s.id}" tabindex="0"><td class="n muted">${i + 1}</td><td><b>${esc(s.name || "Unnamed")}</b></td><td><span class="mk" style="background:var(${KIND[s.kind][1]})"></span>${KIND[s.kind][0]}</td><td>${esc(s.district)}<span class="muted">, ${esc(s.state)}</span></td><td>${pill(s.tier)}</td><td class="n">${s.near_km == null ? "n/a" : f1(s.near_km) + " km"}</td><td class="n">${fmt(s.rain14)} mm</td><td class="n"><b>${f1(s.score)}</b></td></tr>`).join("") + "</tbody>"
      : `<tbody><tr><td class="muted">No exposure sites loaded. OpenStreetMap was unreachable on the last pipeline run; the next run retries.</td></tr></tbody>`;
    document.querySelectorAll("#queue tr.click").forEach((tr) => { const go = () => { select(tr.dataset.id); $("#map").scrollIntoView({ block: "center" }); }; tr.onclick = go; tr.onkeydown = (e) => { if (e.key === "Enter") go(); }; });
  }
  document.querySelectorAll("#kind button").forEach((b) => (b.onclick = () => { document.querySelectorAll("#kind button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); renderQueue(b.dataset.k); }));

  /* ---------- factor testing ---------- */
  const M = D.models, rm = M.region_month, nw = M.national_week;
  const get = (spec, model) => rm.find((r) => r.spec === spec && r.model === (model || "NB-GLM"));
  const base = rm[0].mae / (1 - rm[0].skill), mxm = Math.max(base, d3.max(rm, (r) => r.mae));
  $("#abl-sub").textContent = `Average miss in cases per state-month, tested on 2003 to 2010 (${fmt(rm[0].n)} state-months, ${M.train.region_month[1]} states with monthly history). Shorter is better. "Top 3" is how often the three worst-hit states were flagged.`;
  $("#abl").innerHTML = [{ spec: "Same as last month (baseline)", mae: base, ref: 1 }].concat(rm).map((r) => `<span>${r.spec}${r.model === "GBM" ? " (boosted trees)" : ""}</span><span class="trk"><span class="fill${r.ref ? " ref" : ""}" style="width:${(r.mae / mxm) * 100}%"></span></span><span class="val">${Math.round(r.mae)}${r.top3 != null ? " &middot; top 3 " + Math.round(r.top3 * 100) + "%" : ""}</span>`).join("");
  const w4 = (s) => nw.find((r) => r.horizon === 4 && r.spec === s), w1 = (s) => nw.find((r) => r.horizon === 1 && r.spec === s);
  const c = get("Recent cases"), cw = get("Cases + weather"), so = get("Seasonality only"), sw = get("+ Weather lags"), en = get("+ ENSO / IOD"), nbr = get("Cases + neighbours");
  $("#finding").innerHTML = `<b>Recent case counts carry almost all of the predictive power.</b> One month ahead, knowing recent cases cuts the average miss from ${Math.round(so.mae)} to ${Math.round(c.mae)} cases per state-month. Weather lags ${sw.deviance < so.deviance ? "improve a season-only model" : "do not improve a season-only model"} but ${cw.mae < c.mae ? "add a little" : "add nothing"} once recent cases are known (${Math.round(c.mae)} vs ${Math.round(cw.mae)}). Nationally, weather ${w4("Cases + weather").skill > w4("Recent cases").skill ? `starts to help at longer range: four weeks ahead, skill rises from ${f2(w4("Recent cases").skill)} to ${f2(w4("Cases + weather").skill)}` : "does not help at any horizon up to four weeks"}, and ${w1("Cases + weather").skill > w1("Recent cases").skill ? "also helps" : "does not help"} one week ahead. ENSO and Indian Ocean Dipole indices ${en.mae < sw.mae ? "helped" : "did not help"}; neighbouring-state cases ${nbr.mae < c.mae ? "helped" : "did not help"}. Population density, schools, construction and hygiene proxies cannot be tested this way yet because no open district-level case history exists.`;

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
    const x = d3.scaleLog([Math.min(0.85, d3.min(rows, (r) => r.lo)), Math.max(1.18, d3.max(rows, (r) => r.hi))], [m.l, Wc - m.r]);
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

  /* ---------- track record ---------- */
  (function bt() {
    const Hh = D.history, B = M.backtest_week, pm = new Map(B.week.map((w, i) => [w, B.pred[i]])), t = Hh.week.map((w) => new Date(w));
    const act = t.map((d, i) => [d, Hh.cases[i]]), pr = t.map((d, i) => [d, pm.has(Hh.week[i]) ? pm.get(Hh.week[i]) : null]);
    const yrs = d3.range(t[0].getFullYear() + 1, t[t.length - 1].getFullYear() + 1).map((y) => new Date(y, 0, 1));
    lineChart("#bt", [{ c: "--s1", pts: act }, { c: "--s2", pts: pr }], { h: 260, x: d3.scaleTime().domain([t[0], t[t.length - 1]]), y: d3.scaleLinear().domain([0, d3.max(Hh.cases) * 1.05]).nice(), xt: yrs, xf: (d) => d.getFullYear(), yf: (v) => fmt(v),
      tip: (i) => `<b>Week of ${dfmt(Hh.week[i])}</b><br>Reported: ${fmt(Hh.cases[i])}` + (pr[i][1] != null ? `<br>Forecast 2 weeks earlier: ${fmt(pr[i][1])}` : "") });
    const r2 = nw.find((r) => r.horizon === 2 && r.spec === B.spec);
    $("#bt-lg").innerHTML = `<span><i style="background:var(--s1)"></i>Reported cases per week</span><span><i style="background:var(--s2)"></i>Forecast made 2 weeks earlier (${B.spec.toLowerCase()})</span><span class="muted">average miss ${fmt(Math.round(r2.mae))} cases per week over ${r2.n} test weeks</span>`;
  })();

  /* ---------- sources + notes ---------- */
  $("#sources").innerHTML = `<thead><tr><th>Source</th><th>Provides</th><th>Refresh</th><th>Latest</th><th>Volume</th></tr></thead><tbody>` + D.meta.sources.map((s) => `<tr><td><a href="${s.url}" target="_blank" rel="noopener"><b>${esc(s.name)}</b></a></td><td>${esc(s.what)}</td><td>${esc(s.cadence)}</td><td class="num">${esc(s.latest)}</td><td class="num">${esc(s.rows)}</td></tr>`).join("") + "</tbody>";
  const gc = D.meta.geocoded;
  $("#notes").innerHTML = [
    `<b>District figures are estimates, not counts.</b> Malaysia publishes no open district-level case history. Each state's observed level is split across its districts by population, density, recent weather and the location of active outbreak localities. Treat tiers as a ranking for where to look first.`,
    `<b>The feed is ${D.feed.date.length} day${D.feed.date.length > 1 ? "s" : ""} old.</b> iDengue shows only today's numbers, so the pipeline saves a snapshot on every run. After two weeks of snapshots the state level switches from a year-to-date average to actual cases in the last 14 days, and district-level validation becomes possible.`,
    `<b>Running total.</b> iDengue labels its cumulative column as starting 31 Dec 2023, but 2024 alone had about 122,000 cases, so a total of ${fmt(N.cum)} can only be this year's. It is treated as year-to-date.`,
    `<b>Outbreak locations.</b> ${gc.outbreaks[0]} of ${gc.outbreaks[1]} active outbreak localities and ${gc.hotspots[0]} of ${gc.hotspots[1]} hotspots could be placed on the map from their names. Unplaced ones still count at state level.${D.meta.hot_week ? " The hotspot list is dated epidemiological week " + D.meta.hot_week.replace("-W", ", week ").replace(/^(\d{4}), week (\d+)$/, "$2 of $1") + " on the source site." : ""}`,
    `<b>Age and sex split uses assumed risk ratios.</b> Higher risk at ages 15 to 49 and slightly higher in males, applied to real district population. It shows who is exposed, not who will be infected.`,
    `<b>Sites come from OpenStreetMap.</b> Kindergartens and construction sites are under-mapped and may be out of date. Use the queue to plan inspections, then verify on the ground.`,
    `<b>Missing factors.</b> Aedes indices, fogging and inspection records, serotype shifts, mobility and symptom-onset dates are held by MOH (eDengue) and are not open. A data-sharing agreement would add the largest accuracy gain.`,
    `<b>Models.</b> Negative-binomial regression with population offset for explanation; boosted trees as a check. Dispersion ${D.meta.alpha}, density elasticity ${D.meta.gamma}. Tier cut-offs at ${D.meta.tiers.slice(1).map((t) => t[0]).join(", ")} expected cases per 100,000 in 14 days.`,
  ].map((t) => `<p>${t}</p>`).join("");

  /* ---------- boot + theme changes ---------- */
  function paint() { recolor(); heat(); gS.selectAll("circle").attr("fill", (p) => css(KIND[p[2]][1])); }
  paint(); renderRank(); renderQueue("all");
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
})();
