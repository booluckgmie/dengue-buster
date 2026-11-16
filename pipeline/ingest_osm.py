"""Exposure sites from OpenStreetMap: schools, kindergartens, mapped construction sites.

OSM is community-mapped: coverage is uneven (kindergartens and construction especially) and a site may be
out of date. Use as a screening layer for inspection planning, never as an enforcement register.
"""
import json
import time

import numpy as np
import pandas as pd
from shapely import STRtree, points

from .config import CACHE, STATE_ISO, URLS
from .http import get

Q = '[out:json][timeout:120];area["ISO3166-2"="{iso}"]->.a;({sel});out center tags;'
SELECTORS = ['nwr["amenity"="school"](area.a);', 'nwr["amenity"="kindergarten"](area.a);',
             'nwr["landuse"="construction"](area.a);nwr["building"="construction"](area.a);']


def _state(state: str, iso: str, max_age_days=30) -> list:
    p = CACHE / "osm" / f"{iso}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists() and time.time() - p.stat().st_mtime < max_age_days * 86400:
        return json.loads(p.read_text())
    els = []
    try:   # one small query per site type: the public Overpass mirrors time out on big combined queries
        for sel in SELECTORS:
            els += get(URLS["overpass"], data={"data": Q.format(iso=iso, sel=sel)}, timeout=150, tries=4).json()["elements"]
            time.sleep(2)
    except Exception as e:  # noqa: BLE001
        print(f"  ! OSM failed for {state}: {e}")
        return json.loads(p.read_text()) if p.exists() else []
    rows = []
    for e in els:
        t = e.get("tags", {})
        lat = e.get("lat") or e.get("center", {}).get("lat")
        lon = e.get("lon") or e.get("center", {}).get("lon")
        if lat is None:
            continue
        kind = t.get("amenity") if t.get("amenity") in ("school", "kindergarten") else "construction"
        rows.append({"kind": kind, "name": t.get("name") or t.get("name:ms") or t.get("name:en") or "", "lat": lat, "lon": lon})
    p.write_text(json.dumps(rows))
    return rows


def sites(dist: pd.DataFrame) -> pd.DataFrame:
    """All sites with the district id they fall in (point-in-polygon)."""
    rows = []
    for state, iso in STATE_ISO.items():
        rows += _state(state, iso)
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
