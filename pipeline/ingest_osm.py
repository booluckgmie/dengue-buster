"""Exposure sites from OpenStreetMap: schools, kindergartens, mapped construction sites.

OSM is community-mapped: coverage is uneven (kindergartens and construction especially) and a site may be
out of date. Use as a screening layer for inspection planning, never as an enforcement register.
"""
import json
import time

import numpy as np
import pandas as pd
from shapely import STRtree, points

from .config import CACHE, REFERENCE, STATE_ISO, URLS
from .http import get

Q = '[out:json][timeout:120];area["ISO3166-2"="{iso}"]->.a;({sel});out center tags;'
SELECTORS = ['nwr["amenity"="school"](area.a);', 'nwr["amenity"="kindergarten"](area.a);',
             'nwr["landuse"="construction"](area.a);nwr["building"="construction"](area.a);']


SEED = REFERENCE / "osm"       # committed snapshot: a fresh CI machine has no cache and the Overpass mirror is flaky


def _fetch(iso: str, tries: int = 4) -> list:
    """Query Overpass for one state. One small query per site type: the public mirrors time out on big combined queries."""
    els = []
    for sel in SELECTORS:
        els += get(URLS["overpass"], data={"data": Q.format(iso=iso, sel=sel)}, timeout=150, tries=tries).json()["elements"]
        time.sleep(2)
    rows = []
    for e in els:
        t = e.get("tags", {})
        lat = e.get("lat") or e.get("center", {}).get("lat")
        lon = e.get("lon") or e.get("center", {}).get("lon")
        if lat is None:
            continue
        kind = t.get("amenity") if t.get("amenity") in ("school", "kindergarten") else "construction"
        rows.append({"kind": kind, "name": t.get("name") or t.get("name:ms") or t.get("name:en") or "", "lat": lat, "lon": lon})
    return rows


def _fallback(iso: str, cache) -> list:
    if cache.exists():
        return json.loads(cache.read_text())
    seed = SEED / f"{iso}.json"
    return json.loads(seed.read_text()) if seed.exists() else []


def _state(state: str, iso: str, max_age_days=30, fetch=True) -> list:
    p = CACHE / "osm" / f"{iso}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists() and time.time() - p.stat().st_mtime < max_age_days * 86400:
        return json.loads(p.read_text())
    if not fetch:
        return _fallback(iso, p)
    try:
        rows = _fetch(iso)
    except Exception as e:  # noqa: BLE001
        print(f"  ! OSM failed for {state}: {e}")
        return _fallback(iso, p)
    p.write_text(json.dumps(rows))
    return rows


def refresh() -> None:
    """python -m pipeline.ingest_osm : re-download every state and update the committed snapshot in data/reference/osm."""
    SEED.mkdir(parents=True, exist_ok=True)
    for state, iso in STATE_ISO.items():
        try:
            rows = _fetch(iso, tries=3)
        except Exception as e:  # noqa: BLE001 - keep the previous snapshot for this state
            print(f"  ! {state}: {e}")
            continue
        (SEED / f"{iso}.json").write_text(json.dumps(rows))
        print(f"  {state}: {len(rows)} sites")


def sites(dist: pd.DataFrame, fetch: bool = True) -> pd.DataFrame:
    """All sites with the district id they fall in (point-in-polygon)."""
    rows = []
    for state, iso in STATE_ISO.items():
        rows += _state(state, iso, fetch=fetch)
    df = pd.DataFrame(rows).drop_duplicates(["kind", "lat", "lon"])
    tree = STRtree(dist.geom.values)
    pts = points(df.lon.values, df.lat.values)
    pi, gi = tree.query(pts, predicate="within")
    ids = np.full(len(df), None, dtype=object)
    ids[pi] = dist.id.values[gi]
    df["id"] = ids
    df = df.dropna(subset=["id"]).reset_index(drop=True)
    print("  OSM sites:", df.kind.value_counts().to_dict())
    return df


if __name__ == "__main__":
    refresh()
