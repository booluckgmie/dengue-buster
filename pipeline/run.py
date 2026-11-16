"""End-to-end run:  python -m pipeline.run [--skip-live] [--skip-osm]

ingest -> features -> models/backtests -> district outlook -> spatial statistics -> web/data bundle
"""
import argparse
import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import features as F
from . import ingest_idengue, ingest_osm, ingest_static, ingest_weather, models, outlook, spatial
from .config import FEED, HORIZON_DAYS, PROCESSED, REGIONS, WEB_DATA


def _r(x, n=2):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), n)


def suitability(temp, rain14, rh):
    """Mechanistic Aedes breeding-suitability index 0-100 (not fitted): Briere-type temperature response
    peaking near 29 C, saturating 14-day rainfall, and humidity above ~60%."""
    t = np.clip(temp, 14, 35)
    briere = t * (t - 13.5) * np.sqrt(np.clip(35.5 - t, 0, None))
    briere = briere / (29 * (29 - 13.5) * np.sqrt(35.5 - 29))
    rain = 1 - np.exp(-np.asarray(rain14) / 60)
    hum = np.clip((np.asarray(rh) - 50) / 30, 0.2, 1)
    return 100 * np.clip(briere, 0, 1) * (0.35 + 0.65 * rain) * hum


def main(skip_live=False, skip_osm=False, osm_cached=False):
    t0 = time.time()
    log = lambda m: print(f"[{time.time() - t0:5.0f}s] {m}", flush=True)

    # ------------------------------------------------------------------ 1. ingest
    log("reference data")
    gj, dist = ingest_static.districts()
    pop, agesex, pop_year = ingest_static.population_district(dist)
    dist = dist.merge(pop, on="id").merge(ingest_static.socioeconomic(dist), on="id")
    pop_ry = ingest_static.population_region_year()
    region_month, nat_week, nat_month = ingest_static.opendengue()
    indices = ingest_static.climate_indices()

    if not skip_live:
        log("live feed (iDengue)")
        try:
            ingest_idengue.run()
        except Exception as e:  # noqa: BLE001 - keep the last good snapshot and say so
            log(f"! live feed failed, using last snapshot: {e}")
    feed = pd.read_csv(FEED / "idengue_state_daily.csv")
    hot = pd.read_csv(FEED / "hotspots.csv") if (FEED / "hotspots.csv").exists() else pd.DataFrame()
    hot = hot[hot.snapshot_date == hot.snapshot_date.max()] if len(hot) else hot
    try:
        ob = pd.read_csv(FEED / "outbreak_localities_latest.csv")
    except Exception:  # noqa: BLE001
        ob = pd.DataFrame(columns=["region", "outbreak_no", "locality", "n_localities", "lat", "lon"])

    log("weather")
    wx = ingest_weather.combined(dist)
    log("OSM exposure sites")
    sites = ingest_osm.sites(dist, fetch=not osm_cached) if not skip_osm else pd.DataFrame(columns=["kind", "name", "lat", "lon", "id"])

    # ------------------------------------------------------------------ 2. spatial weights
    W = spatial.adjacency(dist.geom.values, dist.id.values, dist.lat.values, dist.lon.values)
    reg = dist.region.values
    region_adj = {r: sorted({reg[j] for i in np.where(reg == r)[0] for j in np.where(W[i] > 0)[0]} - {r}) for r in REGIONS}

    # ------------------------------------------------------------------ 3. features + models
    log("features + backtests")
    hist = wx[~wx.is_forecast]
    rd = F.region_daily(hist, dist, pop)
    nat = hist.merge(pop, on="id")
    natd = (nat[F.WX].multiply(nat.population, axis=0).assign(date=nat.date).groupby("date").sum()
            .div(nat.groupby("date").population.sum(), axis=0).reset_index())
    pm = F.region_month_panel(region_month, rd, pop_ry, indices, region_adj)
    pw = F.national_week_panel(nat_week, natd, indices)
    pm.to_parquet(PROCESSED / "panel_region_month.parquet")
    pw.to_parquet(PROCESSED / "panel_national_week.parquet")

    sc_m, pred_m = models.backtest_region_month(pm, F.MONTH_GROUPS, range(2003, 2011))
    sc_w, pred_w = models.backtest_national_week(pw, F.week_groups, [1, 2, 3, 4], range(2016, 2023))
    print(sc_m[["spec", "model", "mae", "deviance", "skill", "top3"]].round(3).to_string(index=False))
    print(sc_w[["horizon", "spec", "mae", "skill"]].round(3).to_string(index=False))

    # explainable fits on the full history
    fe = pd.get_dummies(pm.region, prefix="r", drop_first=True, dtype=float)
    off = np.log(pm.population.values)
    allc = sum(F.MONTH_GROUPS.values(), [])
    nb_all = models.NB().fit(pd.concat([pm[allc], fe], axis=1), pm.cases.values.astype(float), off)
    # weather effects *conditional on recent cases*: the part of weather not already reflected in current transmission
    wcols = F.MONTH_GROUPS["season"] + F.MONTH_GROUPS["cases"] + F.MONTH_GROUPS["weather"]
    nb_wx = models.NB().fit(pd.concat([pm[wcols], fe], axis=1), pm.cases.values.astype(float), off)
    irr = nb_all.irr()
    irr = irr[~irr.term.str.startswith("r_")]
    irr_wx = nb_wx.irr()
    wx_coef = {t: float(np.log(v)) for t, v in zip(irr_wx.term, irr_wx.irr) if t in F.MONTH_GROUPS["weather"]}

    drivers = ["rain_a", "temp_a", "tmin_a", "tmax_a", "rh_a", "wind_a", "dtr_a", "wet_a"]
    pm["resid"] = pm.lc - pm.groupby(["region", pm.month.dt.month]).lc.transform("mean") - pm.groupby(["region", "year"]).lc.transform("mean")
    lag_m = F.lag_correlation(pm.sort_values(["region", "month"]).reset_index(drop=True), "resid", drivers, range(0, 7), unit="region")
    pw["woy"] = np.minimum(pw.week.dt.isocalendar().week.astype(int), 52)
    pw["resid"] = pw.lc - pw.groupby("woy").lc.transform("mean") - pw.groupby(pw.week.dt.year).lc.transform("mean")
    lag_w = F.lag_correlation(pw, "resid", drivers, range(0, 17))

    # ------------------------------------------------------------------ 4. district outlook
    log("district outlook")
    levels = outlook.regional_level(feed, float(nat_month[nat_month.month.dt.year == 2024].cases.sum()))
    snap = levels.attrs["date"]
    season = outlook.seasonal_change(region_month, nat_week, snap)
    target = snap + pd.Timedelta(days=HORIZON_DAYS // 2)
    # "unusual for the current climate": anomalies against the last 10 full years, so the warming trend is not
    # mistaken for a dengue signal
    dm = F.anomalies(F.to_period(hist, "id", "MS"), "id", "month", ref_years=(snap.year - 10, snap.year - 1))
    dm = dm[dm.period < target.to_period("M").start_time]
    anom = {}
    for l in (1, 2, 3):
        per = (target.to_period("M") - l).start_time
        a = dm[dm.period == per].set_index("id")
        for c in a.columns:
            if c.endswith("_a"):
                anom[f"{c}_l{l}"] = a[c]
    anom = pd.DataFrame(anom).reindex(dist.id).fillna(0)
    clim = outlook.climate_multiplier(anom, wx_coef)

    ob = ob.copy()
    hot = hot.copy()
    for pts in (ob, hot):
        if len(pts):
            ok = pts.lat.notna()
            ids = np.full(len(pts), None, dtype=object)
            if ok.any():
                from shapely import STRtree, points
                pi, gi = STRtree(dist.geom.values).query(points(pts.lon[ok].values, pts.lat[ok].values), predicate="within")
                sub = np.full(int(ok.sum()), None, dtype=object)
                sub[pi] = dist.id.values[gi]
                ids[ok.values] = sub
            pts["id"] = ids
            # a geocode that lands in another region is a wrong match: drop it
            rmap = dict(zip(dist.id, dist.region))
            bad = pts.id.notna() & (pts.id.map(rmap) != pts.region)
            pts.loc[bad, ["id", "lat", "lon"]] = None
        else:
            pts["id"] = None

    rstats = dist.groupby("region").agg(population=("population", "sum"), area=("area_km2", "sum")).reset_index()
    rstats["density"] = rstats.population / rstats.area
    gamma = outlook.density_elasticity(levels, rstats)
    d = outlook.district_outlook(dist, levels, season, gamma, clim, ob, nb_all.alpha)
    alloc = outlook.age_sex_allocation(d, agesex)

    # short-term weather context per district
    today = pd.Timestamp(datetime.now().date())
    g = wx.groupby("id")
    last14 = wx[(wx.date > today - pd.Timedelta(days=14)) & (wx.date <= today)].groupby("id")
    nxt7 = wx[(wx.date > today) & (wx.date <= today + pd.Timedelta(days=7))].groupby("id")
    d = d.set_index("id")
    d["rain14"], d["temp14"], d["rh14"] = last14.rain.sum(), last14.temp.mean(), last14.rh.mean()
    d["rain_fc7"] = nxt7.rain.sum()
    d["suit"] = suitability(d.temp14, d.rain14, d.rh14)
    for k in ("school", "kindergarten", "construction"):
        d[f"osm_{k}"] = sites[sites.kind == k].groupby("id").size().reindex(d.index).fillna(0).astype(int) if len(sites) else 0
    d["hotspots"] = hot.dropna(subset=["id"]).groupby("id").size().reindex(d.index).fillna(0).astype(int) if len(hot) else 0
    d = d.reset_index()
    prio = outlook.site_priority(sites, d, pd.concat([ob, hot], ignore_index=True), d.set_index("id").rain14) if len(sites) else pd.DataFrame()

    # ------------------------------------------------------------------ 5. spatial statistics
    log("spatial statistics")
    d = dist[["id"]].merge(d, on="id")            # keep W's ordering
    x = np.log1p(d.exp_per100k.values)
    mor = spatial.moran(x, W)
    Ii, p_l, lab, lagv = spatial.lisa(x, W)
    d["lisa"], d["lisa_p"], d["gi"] = lab, p_l, spatial.gi_star(x, W)
    mor_dens = spatial.moran(np.log(d.density.values), W)
    mor_suit = spatial.moran(d.suit.fillna(d.suit.mean()).values, W)

    d.drop(columns="geom").to_csv(PROCESSED / "district_outlook.csv", index=False)
    alloc.to_csv(PROCESSED / "district_outlook_age_sex.csv", index=False)
    if len(prio):
        prio.drop(columns=["id"]).head(2000).to_csv(PROCESSED / "site_priority.csv", index=False)

    # ------------------------------------------------------------------ 6. export for the dashboard
    log("export")
    from shapely.geometry import mapping
    feats = []
    for r in dist.itertuples():
        geom = r.geom.simplify(0.004, preserve_topology=True)
        m = json.loads(json.dumps(mapping(geom)), parse_float=lambda s: round(float(s), 3))
        feats.append({"type": "Feature", "id": r.id, "properties": {"id": r.id}, "geometry": m})

    ages = ingest_static.AGES
    al = alloc.pivot_table(index=["id", "sex"], columns="age", values=["population", "exp_cases"])
    drows = []
    for r in d.itertuples():
        drows.append({
            "id": r.id, "state": r.state, "district": r.district, "region": r.region, "lat": r.lat, "lon": r.lon,
            "pop": int(r.population), "density": _r(r.density, 1), "exp": _r(r.exp_cases), "lo": _r(r.lo, 0), "hi": _r(r.hi, 0),
            "per100k": _r(r.exp_per100k), "p_high": _r(r.p_high, 3), "tier": r.tier, "rank": int(r.rank),
            "clim": _r(r.clim, 3), "season": _r(r.season, 3), "share": _r(r.share, 4), "w_outbreak": _r(r.w_outbreak),
            "outbreaks": int(r.outbreaks), "hotspots": int(r.hotspots),
            "rain14": _r(r.rain14, 0), "rain_fc7": _r(r.rain_fc7, 0), "temp14": _r(r.temp14, 1), "rh14": _r(r.rh14, 0), "suit": _r(r.suit, 0),
            "osm_school": int(r.osm_school), "osm_kinder": int(r.osm_kindergarten), "osm_constr": int(r.osm_construction),
            "schools": _r(r.schools, 0), "students": _r(r.students, 0), "income": _r(r.income_median, 0), "poverty": _r(r.poverty, 1),
            "lisa": r.lisa, "lisa_p": _r(r.lisa_p, 3), "gi": _r(r.gi),
            "age_m": [_r(v, 3) for v in al.loc[(r.id, "male"), "exp_cases"][ages]],
            "age_f": [_r(v, 3) for v in al.loc[(r.id, "female"), "exp_cases"][ages]],
            "pop_m": [int(v) for v in al.loc[(r.id, "male"), "population"][ages]],
            "pop_f": [int(v) for v in al.loc[(r.id, "female"), "population"][ages]],
        })

    lv = levels.merge(rstats, on="region")
    dg = d.groupby("region")
    regions = [{"region": r.region, "today": r.today, "cum": int(r.cum_cases), "pop": int(r.population),
                "inc_cum": _r(r.cum_cases / r.population * 1e5, 1), "weekly_level": _r(r.weekly_level, 1), "basis": r.basis,
                "exp14": _r(dg.exp_cases.sum()[r.region], 1), "season": _r(season[r.region], 3),
                "outbreaks": int((ob.region == r.region).sum()) if len(ob) else 0,
                "hotspots": int((hot.region == r.region).sum()) if len(hot) else 0, "density": _r(r.density, 1)}
               for r in lv.itertuples()]

    best_w = sc_w[sc_w.horizon == 2].sort_values("mae").iloc[0].spec
    bt = pw.assign(pred=pred_w[(best_w, 2)], seas=pred_w[("Seasonality only", 2)])
    bt = bt[bt.pred.notna()]
    fd = feed.copy()
    natf = fd[fd.region == "Malaysia"].sort_values("date")

    def pts(df, cols):
        return [[_r(getattr(r, c), 4) if c in ("lat", "lon") else getattr(r, c) for c in cols] for r in df.dropna(subset=["lat"]).itertuples()] if len(df) else []

    sources = [
        {"name": "iDengue (MOH / MYSA)", "what": "Daily cases by state, active outbreak localities, hotspots", "cadence": "daily snapshot",
         "latest": str(snap.date()), "rows": f"{levels.attrs['snapshots']} daily snapshot(s) in feed", "url": "https://idengue.mysa.gov.my/"},
        {"name": "OpenDengue v1.3", "what": "Historical cases: state-month 1993-2010, national-week 2011-2022, national-month 2024",
         "cadence": "static release", "latest": "2024-12", "rows": f"{len(region_month):,} state-months, {len(nat_week)} weeks", "url": "https://opendengue.org/"},
        {"name": "NASA POWER (MERRA-2)", "what": "Daily rain, temperature, humidity, wind at each district centroid since 1992", "cadence": "daily, ~3 day lag",
         "latest": str(hist.date.max().date()), "rows": f"{len(hist):,} district-days", "url": "https://power.larc.nasa.gov/"},
        {"name": "Open-Meteo", "what": "Latest days and 16-day forecast per district", "cadence": "daily",
         "latest": str(wx.date.max().date()), "rows": f"{int(wx.is_forecast.sum()):,} forecast district-days", "url": "https://open-meteo.com/"},
        {"name": "DOSM / data.gov.my", "what": "District population by age and sex, income, poverty, schools, enrolment; boundaries", "cadence": "annual",
         "latest": str(pop_year), "rows": f"{len(dist)} districts", "url": "https://open.dosm.gov.my/"},
        {"name": "OpenStreetMap", "what": "Schools, kindergartens, mapped construction sites", "cadence": "monthly refresh",
         "latest": datetime.now().strftime("%Y-%m"), "rows": f"{len(sites):,} sites in {sites.id.map(dict(zip(dist.id, dist.state))).nunique() if len(sites) else 0} of 16 states", "url": "https://www.openstreetmap.org/"},
        {"name": "NOAA CPC / PSL", "what": "ENSO (ONI) and Indian Ocean Dipole indices", "cadence": "monthly",
         "latest": str(indices.month.max().date())[:7], "rows": f"{len(indices)} months", "url": "https://www.cpc.ncep.noaa.gov/"},
    ]

    didx = {i: n for n, i in enumerate(d.id)}
    bundle = {
        "meta": {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "snapshot": str(snap.date()),
                 "horizon_days": HORIZON_DAYS, "window": [str((snap + pd.Timedelta(days=1)).date()), str((snap + pd.Timedelta(days=HORIZON_DAYS)).date())],
                 "tiers": outlook.TIERS, "cum_is_ytd": levels.attrs["cum_is_ytd"], "cum_start": str(levels.attrs["cum_start"].date()),
                 "gamma": _r(gamma, 3), "alpha": _r(nb_all.alpha, 3), "pop_year": pop_year, "ages": ages, "sources": sources,
                 "hot_week": (hot.report_week.iloc[0] if len(hot) and "report_week" in hot else None),
                 "geocoded": {"outbreaks": [int(ob.id.notna().sum()), len(ob)] if len(ob) else [0, 0],
                              "hotspots": [int(hot.id.notna().sum()), len(hot)] if len(hot) else [0, 0]}},
        "national": {"today": levels.attrs["national_today"], "cum": int(levels.attrs["national_cum"]),
                     "deaths": None if pd.isna(levels.attrs["deaths_ytd"]) else int(levels.attrs["deaths_ytd"]),
                     "exp14": _r(d.exp_cases.sum(), 0), "outbreaks": len(ob), "hotspots": len(hot),
                     "tiers": d.tier.value_counts().to_dict(),
                     "pop_high": int(d[d.tier.isin(["High", "Very high"])].population.sum())},
        "regions": regions, "districts": drows, "geo": {"type": "FeatureCollection", "features": feats},
        "hotspots": pts(hot, ["lon", "lat", "locality", "region", "cum_cases", "start_date", "duration_days"]),
        "outbreak_pts": pts(ob, ["lon", "lat", "locality", "n_localities"]),
        "sites": {k: [[_r(a, 4), _r(b, 4), didx[i]] for a, b, i in zip(sites[sites.kind == k].lon, sites[sites.kind == k].lat, sites[sites.kind == k].id)]
                  for k in ("school", "kindergarten", "construction")} if len(sites) else {},
        "priority": [{"kind": r.kind, "name": r.name if isinstance(r.name, str) else "", "lat": _r(r.lat, 4), "lon": _r(r.lon, 4), "district": r.district, "state": r.state,
                      "id": r.id, "score": _r(r.score, 1), "near_km": _r(r.near_km, 1), "rain14": _r(r.rain14, 0), "tier": r.tier}
                     for r in prio.groupby("kind").head(150).itertuples()] if len(prio) else [],
        "models": {
            "region_month": json.loads(sc_m.drop(columns="groups").round(4).to_json(orient="records")),
            "national_week": json.loads(sc_w.round(4).to_json(orient="records")),
            "irr": json.loads(irr.round(4).to_json(orient="records")),
            "irr_weather": json.loads(irr_wx[irr_wx.term.isin(F.MONTH_GROUPS["weather"])].round(4).to_json(orient="records")),
            "lag_month": json.loads(lag_m.round(3).to_json(orient="records")),
            "lag_week": json.loads(lag_w.round(3).to_json(orient="records")),
            "backtest_week": {"spec": best_w, "week": [str(w.date()) for w in bt.week], "actual": [int(v) for v in bt.cases],
                              "pred": [_r(v, 0) for v in bt.pred], "seasonal": [_r(v, 0) for v in bt.seas]},
            "train": {"region_month": [int(len(pm)), int(pm.region.nunique()), str(pm.month.min().date())[:7], str(pm.month.max().date())[:7]],
                      "national_week": [int(len(pw)), str(pw.week.min().date()), str(pw.week.max().date())]},
        },
        "spatial": {"risk": {k: _r(v, 4) for k, v in mor.items()}, "density": {k: _r(v, 4) for k, v in mor_dens.items()},
                    "suit": {k: _r(v, 4) for k, v in mor_suit.items()}, "lisa": pd.Series(lab).value_counts().to_dict(),
                    "links": int(W.sum() / 2)},
        "history": {"week": [str(w.date()) for w in nat_week.week], "cases": [int(v) for v in nat_week.cases],
                    "month2024": [int(v) for v in nat_month.cases],
                    "region_month": {r: {"start": str(g.month.min().date())[:7], "inc": [_r(v, 1) for v in g.inc]} for r, g in pm.groupby("region")}},
        "feed": {"date": list(natf.date), "daily": [int(v) for v in natf.daily_cases], "cum": [int(v) for v in natf.cumulative_cases]},
    }
    js = json.dumps(bundle, separators=(",", ":"), allow_nan=False)
    (WEB_DATA / "bundle.json").write_text(js)
    (WEB_DATA / "bundle.js").write_text("window.DENGUE=" + js + ";")
    log(f"wrote web/data/bundle.js ({len(js) / 1e6:.2f} MB) - {d.tier.value_counts().to_dict()}")
    return bundle


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-live", action="store_true", help="do not scrape iDengue; reuse the last snapshot in data/feed")
    ap.add_argument("--skip-osm", action="store_true")
    ap.add_argument("--osm-cached", action="store_true", help="use only OSM states already in data/cache (no Overpass calls)")
    a = ap.parse_args()
    main(a.skip_live, a.skip_osm, a.osm_cached)
