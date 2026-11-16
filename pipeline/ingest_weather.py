"""Weather per district centroid.

History  : NASA POWER daily (MERRA-2, 1992-> ~3 days ago). One request per district, cached and topped up.
Recent + forecast : Open-Meteo (last 30 days + next 16 days), fills POWER's latency gap and looks ahead.
"""
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import numpy as np
import pandas as pd

from .config import CACHE, URLS
from .http import get

VARS = {"PRECTOTCORR": "rain", "T2M": "temp", "T2M_MAX": "tmax", "T2M_MIN": "tmin", "RH2M": "rh", "WS2M": "wind"}
START = date(1992, 1, 1)
WDIR = CACHE / "weather"
WDIR.mkdir(parents=True, exist_ok=True)


def _power(lat, lon, start, end) -> pd.DataFrame:
    js = get(URLS["power"], params={"parameters": ",".join(VARS), "community": "AG", "latitude": lat, "longitude": lon,
                                    "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"), "format": "JSON"},
             timeout=180).json()["properties"]["parameter"]
    df = pd.DataFrame({VARS[k]: pd.Series(v) for k, v in js.items()})
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    return df.replace(-999.0, np.nan).dropna(how="all")


def _one(row) -> pd.DataFrame:
    p = WDIR / f"{row.id}.parquet"
    old = pd.read_parquet(p) if p.exists() else None
    start = START if old is None else (old.index.max() - timedelta(days=10)).date()   # re-pull the tail: POWER revises it
    end = date.today()
    if old is not None and (end - old.index.max().date()).days <= 4:
        return old
    new = _power(row.lat, row.lon, start, end)
    df = new if old is None else pd.concat([old[old.index < new.index.min()], new])
    df.to_parquet(p)
    return df


def history(dist: pd.DataFrame, workers: int = 5) -> pd.DataFrame:
    """Long frame: id, date, rain, temp, tmax, tmin, rh, wind."""
    t0 = time.time()
    with ThreadPoolExecutor(workers) as ex:
        frames = list(ex.map(_one, dist.itertuples()))
    out = pd.concat([f.assign(id=r.id) for f, r in zip(frames, dist.itertuples())]).rename_axis("date").reset_index()
    print(f"  weather history: {len(out):,} district-days to {out.date.max().date()} ({time.time() - t0:.0f}s)")
    return out


def recent_and_forecast(dist: pd.DataFrame) -> pd.DataFrame:
    """Open-Meteo daily for the last 30 days and next 16; flagged with is_forecast."""
    daily = "precipitation_sum,temperature_2m_mean,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean,wind_speed_10m_mean"
    names = ["rain", "temp", "tmax", "tmin", "rh", "wind"]
    out = []
    for i in range(0, len(dist), 40):
        ch = dist.iloc[i:i + 40]
        js = get(URLS["openmeteo"], params={"latitude": ",".join(map(str, ch.lat)), "longitude": ",".join(map(str, ch.lon)),
                                            "daily": daily, "past_days": 30, "forecast_days": 16, "timezone": "Asia/Singapore",
                                            "wind_speed_unit": "ms"}, timeout=120).json()
        js = js if isinstance(js, list) else [js]
        for r, j in zip(ch.itertuples(), js):
            d = pd.DataFrame(j["daily"])
            d.columns = ["date"] + names
            out.append(d.assign(id=r.id))
        time.sleep(1)
    out = pd.concat(out, ignore_index=True)
    out["date"] = pd.to_datetime(out.date)
    out["is_forecast"] = out.date >= pd.Timestamp(date.today())
    return out


def combined(dist: pd.DataFrame):
    """History with the latency gap and the next 16 days appended from Open-Meteo."""
    h = history(dist)
    try:
        f = recent_and_forecast(dist)
    except Exception as e:  # noqa: BLE001 - forecast is optional; the outlook then falls back to climatology
        print("  ! Open-Meteo unavailable:", e)
        return h.assign(is_forecast=False)
    last = h.groupby("id").date.max().rename("last")
    f = f.merge(last, on="id")
    f = f[f.date > f["last"]].drop(columns="last")
    return pd.concat([h.assign(is_forecast=False), f], ignore_index=True).sort_values(["id", "date"]).reset_index(drop=True)
