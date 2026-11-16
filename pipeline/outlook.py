"""District 14-day outlook.

No open district-level case history exists for Malaysia, so the outlook is a transparent *downscaling*:

  region expected cases (next 14 d) = current regional level x seasonal change x climate multiplier
  district share of the region      = blend of  structure (population x density^gamma x local climate multiplier)
                                      and       where active outbreak localities are right now (iDengue, geocoded)

Every factor is exported so the dashboard can show why a district ranks where it does.
"""
import numpy as np
import pandas as pd
from scipy import stats

from .config import AGE_RELATIVE_RISK, HORIZON_DAYS, REGIONS, SEX_RELATIVE_RISK

TIERS = [(0, "Low"), (3, "Moderate"), (8, "High"), (16, "Very high")]     # expected cases per 100k per 14 days


def tier(v):
    return [name for lo, name in TIERS if v >= lo][-1]


def regional_level(feed: pd.DataFrame, opd_total_2024: float) -> pd.DataFrame:
    """Current weekly case level per region from the iDengue feed.

    With >= 15 days of snapshots the last-14-day count comes straight from differences of the cumulative
    column. Until then we blend the year-to-date weekly average with today's count (noisy, so shrunk).
    """
    feed = feed.copy()
    feed["date"] = pd.to_datetime(feed.date)
    last = feed.date.max()
    cur = feed[feed.date == last].set_index("region")
    nat_cum = float(cur.loc["Malaysia", "cumulative_cases"])
    # iDengue labels the running total "since 31 Dec 2023", but OpenDengue records ~122k cases for 2024 alone,
    # so a smaller total can only be year-to-date. Decide from the data and expose the decision.
    since = pd.Timestamp(cur.cumulative_from.iloc[0])
    ytd = nat_cum < opd_total_2024 and since.year < last.year
    start = pd.Timestamp(last.year, 1, 1) if ytd else since
    weeks = max((last - start).days / 7, 1)
    rows = []
    for r in REGIONS:
        h = feed[feed.region == r].sort_values("date")
        avg_week = float(cur.loc[r, "cumulative_cases"]) / weeks
        today_week = float(cur.loc[r, "daily_cases"]) * 7
        prev = h[h.date <= last - pd.Timedelta(days=14)]
        if len(prev) and (last - prev.date.max()).days <= 21:
            span = (last - prev.date.max()).days
            level = (float(cur.loc[r, "cumulative_cases"]) - float(prev.cumulative_cases.iloc[-1])) / span * 7
            basis = f"feed: cases over the last {span} days"
        else:
            recent = h[h.date > last - pd.Timedelta(days=7)].daily_cases.mean() * 7
            ratio = np.clip(((recent + 5) / (avg_week + 5)) ** 0.5, 0.5, 2.0)      # shrink a few noisy daily counts
            level = avg_week * ratio
            basis = f"year-to-date weekly average x recent-activity ratio {ratio:.2f} ({len(h[h.date > last - pd.Timedelta(days=7)])} daily snapshots)"
        rows.append({"region": r, "weekly_level": level, "ytd_cases": float(cur.loc[r, "cumulative_cases"]) if ytd else np.nan,
                     "cum_cases": float(cur.loc[r, "cumulative_cases"]), "today": int(cur.loc[r, "daily_cases"]),
                     "avg_week": avg_week, "today_x7": today_week, "basis": basis})
    out = pd.DataFrame(rows)
    out.attrs.update({"date": last, "cum_is_ytd": bool(ytd), "cum_start": start, "weeks": weeks,
                      "deaths_ytd": cur.loc["Malaysia", "deaths_ytd"], "national_today": int(cur.loc["Malaysia", "daily_cases"]),
                      "national_cum": nat_cum, "snapshots": int(feed.date.nunique())})
    return out


def seasonal_change(region_month: pd.DataFrame, nat_week: pd.DataFrame, when: pd.Timestamp) -> dict:
    """Expected ratio of next-fortnight to last-fortnight cases from the historical seasonal profile."""
    nw = nat_week.assign(woy=np.minimum(nat_week.week.dt.isocalendar().week.astype(int), 52), yr=nat_week.week.dt.year)
    nw["rel"] = nw.cases / nw.groupby("yr").cases.transform("mean")
    prof = nw.groupby("woy").rel.mean()
    prof = pd.concat([prof.iloc[-3:], prof, prof.iloc[:3]]).rolling(7, center=True).mean().iloc[3:-3]     # circular smoothing
    w0 = min(int(when.isocalendar().week), 52)
    f = lambda ks: float(np.mean([prof.loc[(w0 + k - 1) % 52 + 1] for k in ks]))
    nat = f([1, 2]) / f([-1, 0])
    out = {}
    rm = region_month.assign(m=region_month.month.dt.month, yr=region_month.month.dt.year)
    rm["rel"] = rm.cases / rm.groupby(["region", "yr"]).cases.transform("mean")
    mp = rm.groupby(["region", "m"]).rel.mean()
    nxt = when + pd.Timedelta(days=HORIZON_DAYS)
    for r in REGIONS:
        if r in mp.index.get_level_values(0):
            a, b = mp.loc[(r, when.month)], mp.loc[(r, nxt.month)]
            frac = nxt.day / 30 if nxt.month != when.month else 0
            reg = 1 + (b / a - 1) * frac * 0.5 if a > 0 else 1.0
            out[r] = float(np.clip(0.5 * nat + 0.5 * reg * nat, 0.7, 1.4))          # blend: regional profile is 1993-2010
        else:
            out[r] = float(np.clip(nat, 0.7, 1.4))
    return out


def climate_multiplier(anom_recent: pd.DataFrame, coefs: dict) -> pd.Series:
    """exp(sum beta x anomaly) using the fitted weather-lag coefficients of the regional NB model.

    anom_recent: rows = unit, columns like 'rain_a_l1' (standardised anomaly 1 month back, ...).
    """
    s = sum(anom_recent[c] * b for c, b in coefs.items() if c in anom_recent)
    return np.exp(s).clip(0.7, 1.4)


def density_elasticity(levels: pd.DataFrame, region_stats: pd.DataFrame) -> float:
    """Cross-region slope of log incidence on log density (15 points -> noisy, so bounded)."""
    d = levels.merge(region_stats, on="region")
    x, y = np.log(d.density), np.log((d.cum_cases + 1) / d.population)
    g = float(np.polyfit(x, y, 1)[0])
    return float(np.clip(g, 0.0, 0.5))


def district_outlook(dist, levels, season, gamma, clim_mult, outbreaks, alpha):
    d = dist.copy()
    d["density"] = d.population / d.area_km2
    d["clim"] = d.id.map(clim_mult).fillna(1.0)
    d["struct"] = d.population * d.density ** gamma * d.clim
    ob = outbreaks.dropna(subset=["id"]) if len(outbreaks) else outbreaks
    d["outbreaks"] = d.id.map(ob.groupby("id").size()).fillna(0).astype(int) if len(ob) else 0
    cov = (outbreaks.assign(g=outbreaks.id.notna()).groupby("region").g.agg(["mean", "size"]) if len(outbreaks)
           else pd.DataFrame(columns=["mean", "size"]))
    lv = levels.set_index("region")
    rows = []
    for r, g in d.groupby("region"):
        s_struct = g.struct / g.struct.sum()
        w = 0.0
        if r in cov.index and g.outbreaks.sum() > 0:
            n = float(g.outbreaks.sum())
            # trust the outbreak map in proportion to how much of it we could locate, and less when it is a handful of points
            w = 0.6 * float(cov.loc[r, "mean"]) * n / (n + 20)
        s_ob = g.outbreaks / g.outbreaks.sum() if g.outbreaks.sum() else 0
        share = (1 - w) * s_struct + w * s_ob
        reg_clim = float((g.clim * g.population).sum() / g.population.sum())
        exp_region = lv.loc[r, "weekly_level"] * (HORIZON_DAYS / 7) * season[r] * reg_clim
        g = g.assign(share=share, exp_cases=exp_region * share, w_outbreak=w, season=season[r], region_level=lv.loc[r, "weekly_level"],
                     region_exp=exp_region)
        rows.append(g)
    d = pd.concat(rows)
    d["exp_per100k"] = d.exp_cases / d.population * 1e5
    # negative-binomial predictive interval using the dispersion estimated in the backtest
    n = 1 / alpha
    p = n / (n + d.exp_cases.clip(lower=1e-6))
    d["lo"], d["hi"] = stats.nbinom.ppf(0.1, n, p), stats.nbinom.ppf(0.9, n, p)
    thr = TIERS[2][0] * d.population / 1e5                      # cases needed to reach the "High" incidence band
    d["p_high"] = 1 - stats.nbinom.cdf(np.ceil(thr) - 1, n, p)
    d["tier"] = d.exp_per100k.map(tier)
    d["rank"] = d.exp_per100k.rank(ascending=False, method="first").astype(int)
    return d


def age_sex_allocation(d: pd.DataFrame, agesex: pd.DataFrame) -> pd.DataFrame:
    """Split each district's expected cases across age x sex: population x prior relative risk (see config)."""
    a = agesex.copy()
    a["w"] = a.population * a.age.map(AGE_RELATIVE_RISK) * a.sex.map(SEX_RELATIVE_RISK)
    a["w"] /= a.groupby("id").w.transform("sum")
    a = a.merge(d[["id", "exp_cases"]], on="id")
    a["exp_cases"] *= a.w
    return a[["id", "sex", "age", "population", "exp_cases"]]


def _haversine_km(lat1, lon1, lat2, lon2):
    p = np.pi / 180
    a = np.sin((lat2 - lat1) * p / 2) ** 2 + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))


def site_priority(sites, d, outbreaks, rain14):
    """Inspection priority = district risk x exposure x breeding potential x proximity to an active outbreak."""
    s = sites.merge(d[["id", "exp_per100k", "tier", "district", "state"]], on="id")
    ob = outbreaks.dropna(subset=["lat"]) if len(outbreaks) else outbreaks
    near = np.full(len(s), np.nan)
    if len(ob):
        olat, olon = ob.lat.values, ob.lon.values
        for i in range(0, len(s), 2000):
            ch = s.iloc[i:i + 2000]
            near[i:i + 2000] = _haversine_km(ch.lat.values[:, None], ch.lon.values[:, None], olat[None, :], olon[None, :]).min(1)
    s["near_km"] = near
    risk = s.exp_per100k.rank(pct=True)
    exposure = s.kind.map({"school": 1.0, "kindergarten": 1.0, "construction": 1.25})       # construction = breeding + mobile workers
    rain = s.id.map(rain14).fillna(60)
    wet = (rain / 100).clip(0.5, 1.5)
    prox = 1 + 2 * np.exp(-np.nan_to_num(near, nan=50) / 1.0)
    s["rain14"] = rain
    s["score"] = 100 * risk * exposure * wet * prox / (1.25 * 1.5 * 3)
    return s.sort_values("score", ascending=False).reset_index(drop=True)
