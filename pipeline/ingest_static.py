"""Slow-moving reference data: boundaries, population, socio-economics, schools, case history, climate indices."""
import io
import json
import zipfile

import numpy as np
import pandas as pd
from shapely.geometry import shape

from .config import OPENDENGUE_TO_REGION, URLS, norm_region, region_of
from .http import cached_file, cached_json, get

AGES = ["0-4", "5-9", "10-14", "15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59",
        "60-64", "65-69", "70-74", "75-79", "80-84", "85+"]


def districts():
    """GeoJSON features + a frame with centroid, area (km2) and shapely geometry per district."""
    gj = cached_json("districts.geojson", URLS["districts"], 90)
    rows = []
    for f in gj["features"]:
        p, g = f["properties"], shape(f["geometry"]).buffer(0)
        c = g.representative_point()
        # equal-area approximation good to <1% at Malaysia's latitudes
        km2 = g.area * 111.32 * 110.57 * np.cos(np.radians(c.y))
        rows.append({"id": p["code_state_district"], "state": p["state"], "district": p["district"],
                     "region": region_of(p["state"]), "lat": round(c.y, 4), "lon": round(c.x, 4), "area_km2": km2, "geom": g})
    return gj, pd.DataFrame(rows)


def population_district(dist: pd.DataFrame):
    """Latest-year population (persons) per district: total, and by 5-year age band x sex.

    DOSM lists six newer Sabah/Sarawak districts that the boundary file still draws inside their parents.
    """
    parent = {("Sarawak", "Pantu"): "Sri Aman", ("Sarawak", "Lingga"): "Sri Aman", ("Sarawak", "Sebuyau"): "Simunjan",
              ("Sarawak", "Gedong"): "Simunjan", ("Sarawak", "Siburan"): "Serian", ("Sabah", "Membakut"): "Beaufort"}
    p = pd.read_parquet(cached_file("population_district.parquet", URLS["pop_district"], 30))
    p = p[(p.date == p.date.max()) & (p.ethnicity == "overall")].copy()
    year = int(str(p.date.max())[:4])
    p["district"] = [parent.get((s, d), d) for s, d in zip(p.state, p.district)]
    p["population"] *= 1000
    p = p.groupby(["state", "district", "sex", "age"], as_index=False).population.sum()
    tot = p[(p.sex == "both") & (p.age == "overall")][["state", "district", "population"]]
    agesex = p[(p.sex != "both") & (p.age != "overall")]
    key = dist[["id", "state", "district"]]
    tot = key.merge(tot, how="left")
    agesex = key.merge(agesex)
    assert tot.population.notna().all(), tot[tot.population.isna()]
    return tot[["id", "population"]], agesex[["id", "sex", "age", "population"]], year


def population_region_year() -> pd.DataFrame:
    p = pd.read_parquet(cached_file("population_state.parquet", URLS["pop_state"], 30))
    p = p[(p.sex == "both") & (p.age == "overall") & (p.ethnicity == "overall") & (p.state != "Malaysia")].copy()
    p["region"] = p.state.map(region_of)
    p["year"] = pd.to_datetime(p.date).dt.year
    p = p.groupby(["region", "year"], as_index=False).population.sum()
    p["population"] *= 1000
    return p


def _catalogue(ds: str) -> pd.DataFrame:
    js = cached_json(f"datagov_{ds}.json", URLS["datagov"], 30, params={"id": ds, "limit": 50000})
    return pd.DataFrame(js)


def socioeconomic(dist: pd.DataFrame) -> pd.DataFrame:
    """District: household income, poverty, schools, enrolment. State: piped water + sanitation access."""
    key = dist[["id", "state", "district"]]
    h = _catalogue("hies_district")
    h = h[h.date == h.date.max()][["state", "district", "income_median", "poverty", "gini"]]
    s = _catalogue("schools_district")
    s = s[(s.date == s.date.max()) & (s.district != "All Districts")].groupby(["state", "district"], as_index=False).schools.sum()
    e = _catalogue("enrolment_school_district")
    e = e[(e.date == e.date.max()) & (e.sex == "both") & (e.district != "All Districts")].groupby(["state", "district"], as_index=False).students.sum()
    w = _catalogue("water_access")
    w = w[(w.date == w.date.max()) & (w.strata == "overall")][["state", "proportion"]].rename(columns={"proportion": "piped_water_pct"})
    sa = _catalogue("sanitation_access")
    sa = sa[sa.date == sa.date.max()][["state", "proportion"]].rename(columns={"proportion": "sanitation_pct"})
    out = key.merge(h, how="left").merge(s, how="left").merge(e, how="left").merge(w, how="left").merge(sa, how="left")
    return out.drop(columns=["state", "district"])


def opendengue():
    """Historical cases. Returns (region-month 1993-2010, national-week 2011-2022, national-month 2024)."""
    z = zipfile.ZipFile(io.BytesIO(cached_file("opendengue_wpro.zip", URLS["opendengue"], 60).read_bytes()))
    d = pd.read_csv(z.open(z.namelist()[0]), low_memory=False)
    d = d[d.adm_0_name == "MALAYSIA"].copy()
    d["start"] = pd.to_datetime(d.calendar_start_date)
    sm = d[(d.S_res == "Admin1") & (d.T_res == "Month")].copy()
    sm["region"] = sm.adm_1_name.map(lambda s: norm_region(s, OPENDENGUE_TO_REGION))
    sm = sm.groupby(["region", "start"], as_index=False).dengue_total.sum().rename(columns={"start": "month", "dengue_total": "cases"})
    nw = d[(d.S_res == "Admin0") & (d.T_res == "Week")][["start", "dengue_total"]].rename(columns={"start": "week", "dengue_total": "cases"})
    nw = nw.drop_duplicates("week").sort_values("week").reset_index(drop=True)
    nm = d[(d.S_res == "Admin0") & (d.T_res == "Month")][["start", "dengue_total"]].rename(columns={"start": "month", "dengue_total": "cases"})
    return sm.sort_values(["region", "month"]).reset_index(drop=True), nw, nm.sort_values("month").reset_index(drop=True)


def opendengue_annual() -> dict[int, int]:
    """Yearly Malaysia totals (sum of the 15 state/territory rows) for years OpenDengue has no weekly or monthly series for."""
    z = zipfile.ZipFile(io.BytesIO(cached_file("opendengue_wpro.zip", URLS["opendengue"], 60).read_bytes()))
    d = pd.read_csv(z.open(z.namelist()[0]), low_memory=False)
    d = d[(d.adm_0_name == "MALAYSIA") & (d.T_res == "Year") & (d.S_res == "Admin1") & (d.Year >= 2020)]
    g = d.groupby("Year").agg(n=("dengue_total", "size"), total=("dengue_total", "sum"))
    return {int(y): int(r.total) for y, r in g.iterrows() if r.n >= 15}        # only complete years


def climate_indices() -> pd.DataFrame:
    """Monthly ENSO (ONI, NOAA CPC) and Indian Ocean Dipole (DMI, NOAA PSL)."""
    txt = cached_file("oni.txt", URLS["oni"], 20).read_text().split("\n")[1:]
    seas = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]
    rows = []
    for ln in txt:
        a = ln.split()
        if len(a) == 4:
            rows.append({"month": pd.Timestamp(int(a[1]), seas.index(a[0]) + 1, 1), "oni": float(a[3])})
    oni = pd.DataFrame(rows)
    rows = []
    try:
        for ln in cached_file("dmi.txt", URLS["dmi"], 20).read_text().split("\n")[1:]:
            a = ln.split()
            if len(a) == 13 and a[0].isdigit():
                rows += [{"month": pd.Timestamp(int(a[0]), m + 1, 1), "dmi": float(v)} for m, v in enumerate(a[1:]) if float(v) > -90]
    except Exception as e:  # noqa: BLE001
        print("  ! DMI unavailable:", e)
    out = oni.merge(pd.DataFrame(rows, columns=["month", "dmi"]), how="left", on="month")
    out["dmi"] = out.dmi.ffill()
    return out
