"""Live case feed: scrape iDengue (MOH/MYSA) and append to data/feed/.

iDengue only shows *today's* figures, so the history has to be built by snapshotting it on a schedule.
Each run appends one row per region per reporting date; reruns on the same date are idempotent.
"""
import html as htmllib
import json
import re
import time
from datetime import datetime

import pandas as pd

from .config import FEED, IDENGUE_TO_REGION, REFERENCE, REGIONS, URLS, norm_region
from .http import get

TAG = re.compile(r"<script.*?</script>|<style.*?</style>|<[^>]+>", re.S)


def _text(h: str) -> str:
    return re.sub(r"\s+", " ", htmllib.unescape(TAG.sub(" ", h)))


def _date(s: str) -> str:
    s = s.strip().title().replace("Dis", "Dec").replace("Mac", "Mar").replace("Mei", "May").replace("Ogo", "Aug").replace("Okt", "Oct")
    return datetime.strptime(s, "%d %b %Y").date().isoformat()


def parse_index(h: str) -> pd.DataFrame:
    t = _text(h)
    m = re.search(r"KES HARIAN PADA (\d{1,2} \w{3} \d{4}).*?TERKUMPUL DARI (\d{1,2} \w{3} \d{4}) HINGGA (\d{1,2} \w{3} \d{4})(.*?)Sumber", t)
    if not m:
        raise ValueError("iDengue layout changed: state table not found")
    day, cum_from, _, body = m.groups()
    rows = []
    for name, daily, cum in re.findall(r"([A-Z][A-Z ]+?)\s+(\d+)\s+(\d+)", body):
        name = name.replace("Kes Kumulatif", "").strip()
        if name.endswith("MALAYSIA"):
            region = "Malaysia"
        else:
            region = norm_region(name, IDENGUE_TO_REGION)
        rows.append({"date": _date(day), "region": region, "daily_cases": int(daily), "cumulative_cases": int(cum),
                     "cumulative_from": _date(cum_from)})
    df = pd.DataFrame(rows)
    missing = set(REGIONS) - set(df.region)
    if missing or "Malaysia" not in set(df.region):
        raise ValueError(f"iDengue layout changed: missing regions {missing}")
    d = re.search(r"JUMLAH KES KEMATIAN:\s*(\d+)", t)
    df["deaths_ytd"] = None
    if d:
        df["deaths_ytd"] = df["deaths_ytd"].astype("object")
        df.loc[df.region == "Malaysia", "deaths_ytd"] = int(d.group(1))
    return df


def parse_hotspots(h: str) -> pd.DataFrame:
    wk = re.search(r"minggu:\s*(\d+)\s*/\s*(\d{4})", _text(h))
    rows = re.findall(r"<td[^>]*>\s*\d+\s*</td>\s*<td[^>]*>([^<]+)</td>\s*<td[^>]*>([^<]+)</td>\s*<td[^>]*>\s*(\d+)\s*</td>"
                      r"\s*<td[^>]*>\s*(\d{2}-\d{2}-\d{4})\s*</td>\s*<td[^>]*>\s*(\d+)\s*</td>", h)
    df = pd.DataFrame(rows, columns=["state", "locality", "cum_cases", "start_date", "duration_days"])
    if df.empty:
        return df
    df["region"] = df.state.map(lambda s: norm_region(s, IDENGUE_TO_REGION))
    df["locality"] = df.locality.map(lambda s: " ".join(htmllib.unescape(s).split()))
    df["cum_cases"] = df.cum_cases.astype(int)
    df["duration_days"] = df.duration_days.astype(int)
    df["start_date"] = pd.to_datetime(df.start_date, format="%d-%m-%Y").dt.date.astype(str)
    df["report_week"] = f"{wk.group(2)}-W{int(wk.group(1)):02d}" if wk else None
    return df.drop(columns="state")


def parse_outbreaks(h: str, region: str) -> pd.DataFrame:
    rows = re.findall(r"<td\s+class='tbldata'\s*>\s*(\d+)\s*</td>\s*<td\s+class='tbldata'\s*>(.*?)</td>", h, flags=re.S)
    out = []
    for no, locs in rows:
        parts = [" ".join(p.split()) for p in htmllib.unescape(locs).split(",") if p.strip()]
        if parts:
            out.append({"region": region, "outbreak_no": int(no), "locality": parts[0], "n_localities": len(parts)})
    return pd.DataFrame(out)


# ---------------------------------------------------------------- geocoding (public locality names only)
_GC = REFERENCE / "geocode.json"          # committed: grows as new locality names appear, so daily CI runs only look up new ones
_STATE_ALIASES = {"W.P. Kuala Lumpur & Putrajaya": ["kuala lumpur", "putrajaya"], "W.P. Labuan": ["labuan"],
                  "Pulau Pinang": ["pulau pinang", "penang"], "Melaka": ["melaka", "malacca"]}


def _photon(q, place, ok):
    js = get(URLS["photon"], params={"q": f"{q}, {place}, Malaysia", "limit": 5, "bbox": "99.5,0.8,119.5,7.5"}, timeout=20, tries=1).json()
    for f in js.get("features", []):
        p = f["properties"]
        if p.get("countrycode") == "MY" and any(a in str(p.get("state", "")).lower() or a in str(p.get("city", "")).lower() for a in ok):
            return f["geometry"]["coordinates"]
    return None


def _nominatim(q, place, ok):
    js = get("https://nominatim.openstreetmap.org/search", params={"q": f"{q}, {place}, Malaysia", "format": "json", "limit": 3,
                                                                  "countrycodes": "my"}, timeout=20, tries=1).json()
    for f in js:
        if any(a in f.get("display_name", "").lower() for a in ok):
            return [float(f["lon"]), float(f["lat"])]
    return None


def geocode(localities: pd.DataFrame, budget: int = 400) -> pd.DataFrame:
    """Add lat/lon via Photon, then Nominatim (both OSM). Cached; at most `budget` new lookups per run, the rest
    are picked up by later runs. Unresolved names stay NaN and still count at state level."""
    cache = json.loads(_GC.read_text()) if _GC.exists() else {}
    lat, lon, calls, fails = [], [], 0, 0
    for r in localities.itertuples():
        key = f"{r.locality}|{r.region}"
        if key not in cache and calls < budget:
            calls += 1
            q = re.sub(r"\b(ZON|ZONE|FASA|BLOK|BLOCK)\b.*$", "", r.locality, flags=re.I).strip() or r.locality
            hit, ok = None, _STATE_ALIASES.get(r.region, [r.region.lower()])
            place = r.region.replace("W.P. ", "").replace(" & Putrajaya", "")
            try:
                hit = _photon(q, place, ok)
            except Exception:  # noqa: BLE001 - Photon throttles bursts; fall back to Nominatim
                try:
                    hit = _nominatim(q, place, ok)
                except Exception as e:  # noqa: BLE001
                    fails += 1
                    lat.append(None), lon.append(None)
                    if fails == 8:
                        print("  ! geocoders unavailable, leaving the rest for the next run:", e)
                        budget = 0
                    time.sleep(3)
                    continue
            cache[key] = hit
            if calls % 25 == 0:
                _GC.write_text(json.dumps(cache))      # keep progress if the run is interrupted
            time.sleep(1.0)       # be a polite client of free geocoders
        hit = cache.get(key)
        lat.append(hit[1] if hit else None)
        lon.append(hit[0] if hit else None)
    _GC.write_text(json.dumps(cache))
    return localities.assign(lat=lat, lon=lon)


def _append(path, df, keys, grow=()):
    """Append a snapshot, one row per key. `grow` lists counters that only increase within a reporting date:
    iDengue can show the daily column as 0 just after midnight while still labelled with the previous date, so a
    later snapshot must never overwrite a larger figure already saved for the same date."""
    if path.exists():
        df = pd.concat([pd.read_csv(path), df], ignore_index=True)
    grow = [c for c in grow if c in df.columns]
    peak = df.groupby(keys, dropna=False)[grow].transform("max") if grow else None
    df = df.drop_duplicates(keys, keep="last")
    if grow:
        df[grow] = peak.loc[df.index, grow]
    df = df.sort_values(keys)
    df.to_csv(path, index=False)
    return df


def run(do_geocode: bool = True) -> dict:
    base = URLS["idengue"]
    state = parse_index(get(base).text)
    snap = state.date.iloc[0]
    _append(FEED / "idengue_state_daily.csv", state, ["date", "region"], grow=("daily_cases", "cumulative_cases"))

    hot = parse_hotspots(get(base + "hotspotutama.php").text)
    hot.insert(0, "snapshot_date", snap)

    obs = []
    names = {r: r.upper() for r in REGIONS} | {v: k for k, v in IDENGUE_TO_REGION.items()}
    for region in REGIONS:
        try:
            obs.append(parse_outbreaks(get(base + "kluster.php", data={"negeri": names[region]}, timeout=60).text, region))
        except Exception as e:  # noqa: BLE001
            print("  ! outbreak list failed for", region, e)
    ob = pd.concat(obs, ignore_index=True) if obs else pd.DataFrame(columns=["region", "outbreak_no", "locality", "n_localities"])

    if do_geocode:
        hot = geocode(hot) if len(hot) else hot
        ob = geocode(ob) if len(ob) else ob
    if len(hot):
        _append(FEED / "hotspots.csv", hot, ["snapshot_date", "region", "locality"])
    ob.to_csv(FEED / "outbreak_localities_latest.csv", index=False)
    summ = ob.groupby("region").agg(n_outbreaks=("outbreak_no", "count"), n_localities=("n_localities", "sum")).reset_index()
    summ.insert(0, "snapshot_date", snap)
    _append(FEED / "outbreaks_by_region.csv", summ, ["snapshot_date", "region"])
    print(f"  iDengue {snap}: {int(state[state.region == 'Malaysia'].daily_cases.iloc[0])} cases today, "
          f"{len(hot)} hotspots, {len(ob)} active outbreaks")
    return {"snapshot_date": snap}


if __name__ == "__main__":
    run()
