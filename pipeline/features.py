"""Build modelling panels: region x month (1993-2010) and national x week (2011-2022)."""
import numpy as np
import pandas as pd

WX = ["rain", "temp", "tmin", "tmax", "rh", "wind"]
CLIM_YEARS = (1992, 2020)     # reference period for weather anomalies


def region_daily(weather: pd.DataFrame, dist: pd.DataFrame, pop: pd.DataFrame) -> pd.DataFrame:
    """Population-weighted daily weather per region (people, not land, are what mosquitoes bite)."""
    w = weather.merge(dist[["id", "region"]], on="id").merge(pop, on="id")
    num = w[WX].multiply(w.population, axis=0)
    num[["region", "date"]] = w[["region", "date"]]
    den = w.groupby(["region", "date"]).population.sum()
    out = num.groupby(["region", "date"])[WX].sum().div(den, axis=0).reset_index()
    return out


def to_period(daily: pd.DataFrame, key: str, freq: str) -> pd.DataFrame:
    """Aggregate daily weather to months ('MS') or Sunday-start epi weeks ('W-SAT')."""
    d = daily.copy()
    d["period"] = d.date.dt.to_period("M").dt.start_time if freq == "MS" else d.date - pd.to_timedelta((d.date.dt.dayofweek + 1) % 7, unit="D")
    d["wet"] = (d.rain >= 1).astype(float)
    agg = {"rain": "mean", "temp": "mean", "tmin": "mean", "tmax": "mean", "rh": "mean", "wind": "mean", "wet": "mean"}
    out = d.groupby([key, "period"]).agg(agg).reset_index()
    out["dtr"] = out.tmax - out.tmin                    # diurnal temperature range
    return out


def anomalies(per: pd.DataFrame, key: str, season: str, ref_years=CLIM_YEARS) -> pd.DataFrame:
    """Standardised anomaly vs the unit's own climatology for that calendar month / week."""
    cols = WX + ["wet", "dtr"]
    p = per.copy()
    p["s"] = p.period.dt.month if season == "month" else np.minimum(p.period.dt.isocalendar().week.astype(int), 52)
    ref = p[p.period.dt.year.between(*ref_years)]
    mu = ref.groupby([key, "s"])[cols].mean().add_suffix("_mu")
    sd = ref.groupby([key, "s"])[cols].std().add_suffix("_sd")
    p = p.join(mu, on=[key, "s"]).join(sd, on=[key, "s"])
    for c in cols:
        p[c + "_a"] = ((p[c] - p[c + "_mu"]) / p[c + "_sd"].replace(0, np.nan)).clip(-4, 4).fillna(0)
    return p[[key, "period"] + [c + "_a" for c in cols]]


def _lags(df, key, cols, lags):
    g = df.groupby(key)
    for c in cols:
        for l in lags:
            df[f"{c}_l{l}"] = g[c].shift(l)
    return df


MONTH_GROUPS = {
    "season": ["sin1", "cos1", "sin2", "cos2"],
    "cases": ["lc_l1", "lc_l2", "lc_l3", "lc_l12"],
    "weather": [f"{v}_a_l{l}" for v in ["rain", "temp", "rh", "wind", "dtr", "wet"] for l in (1, 2, 3)],
    "climate": ["oni_l3", "oni_l6", "dmi_l3"],
    "neighbour": ["nb_l1"],
}


def region_month_panel(cases, region_weather_daily, pop_ry, indices, region_adj) -> pd.DataFrame:
    wx = anomalies(to_period(region_weather_daily, "region", "MS"), "region", "month").rename(columns={"period": "month"})
    df = cases.merge(wx, on=["region", "month"], how="left")
    df["year"] = df.month.dt.year
    df = df.merge(pop_ry, on=["region", "year"], how="left").sort_values(["region", "month"]).reset_index(drop=True)
    df["inc"] = df.cases / df.population * 1e5
    df["lc"] = np.log1p(df.inc)
    m = df.month.dt.month
    for k in (1, 2):
        df[f"sin{k}"], df[f"cos{k}"] = np.sin(2 * np.pi * k * m / 12), np.cos(2 * np.pi * k * m / 12)
    # neighbour pressure: mean log-incidence of adjacent regions that report; national mean of others otherwise
    wide = df.pivot(index="month", columns="region", values="lc")
    nb = {}
    for r in wide.columns:
        adj = [a for a in region_adj.get(r, []) if a in wide.columns] or [c for c in wide.columns if c != r]
        nb[r] = wide[adj].mean(axis=1)
    nb = pd.DataFrame(nb).stack().rename("nb").rename_axis(["month", "region"]).reset_index()
    df = df.merge(nb, on=["month", "region"], how="left").merge(indices, on="month", how="left")
    df = df.sort_values(["region", "month"]).reset_index(drop=True)
    df = _lags(df, "region", ["lc"], [1, 2, 3, 12])
    df = _lags(df, "region", ["nb"], [1])
    df = _lags(df, "region", [c for c in df.columns if c.endswith("_a")], [1, 2, 3])
    df = _lags(df, "region", ["oni"], [3, 6])
    df = _lags(df, "region", ["dmi"], [3])
    need = sum(MONTH_GROUPS.values(), [])
    return df.dropna(subset=need + ["population"]).reset_index(drop=True)


def week_groups(h: int) -> dict:
    """Feature groups for an h-week-ahead national forecast: only information available h weeks before."""
    return {
        "season": ["sin1", "cos1", "sin2", "cos2"],
        "cases": [f"lc_l{l}" for l in (h, h + 1, h + 2, h + 3)] + [f"gr_l{h}"],
        "weather": [f"{v}_a4_l{l}" for v in ["rain", "temp", "rh", "wind", "dtr"] for l in (h, h + 4)],
        "climate": [f"oni_l{h + 8}"],
    }


def national_week_panel(cases, nat_weather_daily, indices, max_h: int = 4) -> pd.DataFrame:
    nat = nat_weather_daily.assign(unit="MY")
    wx = anomalies(to_period(nat, "unit", "W-SAT"), "unit", "week").rename(columns={"period": "week"}).drop(columns="unit")
    df = cases.merge(wx, on="week", how="left").sort_values("week").reset_index(drop=True)
    df["lc"] = np.log1p(df.cases)
    df["gr"] = df.lc.diff(2)                               # 2-week growth
    woy = df.week.dt.dayofyear / 365.25
    for k in (1, 2):
        df[f"sin{k}"], df[f"cos{k}"] = np.sin(2 * np.pi * k * woy), np.cos(2 * np.pi * k * woy)
    idx = indices.assign(ym=indices.month.dt.to_period("M"))[["ym", "oni"]]
    df["ym"] = df.week.dt.to_period("M")
    df = df.merge(idx, on="ym", how="left").drop(columns="ym")
    df["oni"] = df.oni.ffill()
    for v in ["rain", "temp", "rh", "wind", "dtr"]:
        df[f"{v}_a4"] = df[f"{v}_a"].rolling(4).mean()        # 4-week mean anomaly
    for h in range(1, max_h + 1):
        for l in (h, h + 1, h + 2, h + 3):
            df[f"lc_l{l}"] = df.lc.shift(l)
        df[f"gr_l{h}"] = df.gr.shift(h)
        for v in ["rain", "temp", "rh", "wind", "dtr"]:
            for l in (h, h + 4):
                df[f"{v}_a4_l{l}"] = df[f"{v}_a4"].shift(l)
        df[f"oni_l{h + 8}"] = df.oni.shift(h + 8)
    return df


def lag_correlation(df, target, drivers, lags, unit=None):
    """Spearman correlation between a deseasonalised target and each driver anomaly `lag` periods earlier.

    A screening view only: it shows *when* a driver co-moves with cases, not that it adds forecast skill.
    """
    rows = []
    for v in drivers:
        for l in lags:
            x = df.groupby(unit)[v].shift(l) if unit else df[v].shift(l)
            ok = x.notna() & df[target].notna()
            rows.append({"driver": v.replace("_a", ""), "lag": l, "rho": float(pd.Series(x[ok]).corr(df.loc[ok, target], method="spearman")),
                         "n": int(ok.sum())})
    return pd.DataFrame(rows)
