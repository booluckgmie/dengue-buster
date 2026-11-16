import numpy as np
import pandas as pd
from shapely.geometry import box

from pipeline import ingest_idengue as idg
from pipeline import models, outlook, spatial

INDEX = """<table><tr><td>NEGERI</td><td>KES HARIAN PADA 15 Nov 2026</td><td>*JUMLAH KES TERKUMPUL DARI 31 DEC 2023 HINGGA 15 Nov 2026</td></tr>
{rows}<tr><td>Kes Kumulatif MALAYSIA</td><td>193</td><td>83152</td></tr></table> *Sumber Daripada CPRC
JUMLAH KES KEMATIAN: 68 Orang"""
NAMES = ["JOHOR", "KEDAH", "KELANTAN", "MELAKA", "NEGERI SEMBILAN", "PAHANG", "PULAU PINANG", "PERAK", "PERLIS", "SELANGOR",
         "TERENGGANU", "SABAH", "SARAWAK", "WILAYAH PERSEKUTUAN", "WILAYAH PERSEKUTUAN LABUAN"]


def _index():
    return INDEX.format(rows="".join(f"<tr><td>{n}</td><td>{i}</td><td>{100 * (i + 1)}</td></tr>" for i, n in enumerate(NAMES)))


def test_parse_index_maps_every_region():
    df = idg.parse_index(_index())
    assert len(df) == 16 and df.date.iloc[0] == "2026-11-15"
    assert df.set_index("region").loc["W.P. Kuala Lumpur & Putrajaya", "daily_cases"] == 13
    assert df.set_index("region").loc["W.P. Labuan", "cumulative_cases"] == 1500
    assert df.set_index("region").loc["Malaysia", "deaths_ytd"] == 68


def test_parse_index_fails_loudly_when_layout_changes():
    try:
        idg.parse_index("<html>maintenance</html>")
    except ValueError:
        return
    raise AssertionError("expected ValueError")


def test_parse_outbreaks_and_hotspots():
    h = "<tr class='tbldata' >\n<td  class='tbldata'>1</td>\n<td class='tbldata' >TAMAN A,TAMAN B &amp; C</td></tr>"
    ob = idg.parse_outbreaks(h, "Selangor")
    assert ob.locality.tolist() == ["TAMAN A"] and ob.n_localities.tolist() == [2]
    h = ("minggu: 33 /2026 <tr><td align='center'>1</td><td align='left' >KELANTAN</td><td align='left'>LORONG HUDA</td>"
         "<td align='center'>5</td><td align='center'>15-07-2026</td><td align='right'>31</td></tr>")
    hs = idg.parse_hotspots(h)
    assert hs.iloc[0].to_dict() == {"locality": "LORONG HUDA", "cum_cases": 5, "start_date": "2026-07-15", "duration_days": 31,
                                    "region": "Kelantan", "report_week": "2026-W33"}


def test_spatial_statistics_detect_a_planted_cluster():
    geoms = [box(i, j, i + 1, j + 1) for i in range(6) for j in range(6)]
    W = spatial.adjacency(geoms, list(range(36)), [g.centroid.y for g in geoms], [g.centroid.x for g in geoms], tol=0.01)
    assert W[0].sum() == 3 and W[7].sum() == 8                       # queen contiguity: corner 3, interior 8
    x = np.array([10.0 if (i < 3 and j < 3) else 1.0 for i in range(6) for j in range(6)])
    x += np.random.default_rng(0).normal(0, 0.1, 36)
    assert spatial.moran(x, W, perms=199)["p"] <= 0.01
    _, _, lab, _ = spatial.lisa(x, W, perms=199)
    assert lab[0] == "HH" and lab[35] in ("LL", "ns")
    assert spatial.gi_star(x, W)[0] > 1.96


def test_nb_recovers_a_known_rate_ratio():
    rng = np.random.default_rng(1)
    x = rng.normal(size=3000)
    y = rng.poisson(np.exp(1.0 + 0.3 * x) * rng.gamma(5, 1 / 5, 3000))
    irr = models.NB().fit(pd.DataFrame({"x": x}), y.astype(float)).irr()
    assert abs(irr.irr.iloc[0] - np.exp(0.3)) < 0.05 and irr.p.iloc[0] < 0.001


def test_district_outlook_conserves_regional_cases_and_allocates_by_age():
    dist = pd.DataFrame({"id": ["a", "b", "c"], "region": ["Johor", "Johor", "Kedah"], "population": [1e5, 3e5, 2e5],
                         "area_km2": [100.0, 100.0, 400.0]})
    levels = pd.DataFrame({"region": ["Johor", "Kedah"], "weekly_level": [70.0, 7.0]})
    season = {"Johor": 1.0, "Kedah": 1.0}
    ob = pd.DataFrame({"region": ["Johor", "Johor"], "id": ["a", None], "lat": [1.0, None], "lon": [1.0, None]})
    d = outlook.district_outlook(dist, levels, season, 0.2, pd.Series({"a": 1.0, "b": 1.0, "c": 1.0}), ob, alpha=0.3)
    assert abs(d[d.region == "Johor"].exp_cases.sum() - 140) < 1e-6          # 70/week x 2 weeks
    share = d.set_index("id").share
    assert share["a"] > (1e5 * 1000 ** 0.2) / (1e5 * 1000 ** 0.2 + 3e5 * 3000 ** 0.2)   # outbreak pulls cases into "a"
    assert (d.lo <= d.exp_cases).all() and (d.hi >= d.exp_cases).all()
    agesex = pd.DataFrame([{"id": i, "sex": s, "age": a, "population": 1000.0} for i in "abc" for s in ("male", "female") for a in ("0-4", "20-24")])
    al = outlook.age_sex_allocation(d, agesex)
    assert np.allclose(al.groupby("id").exp_cases.sum().values, d.set_index("id").exp_cases.loc[["a", "b", "c"]].values)
    one = al[al.id == "a"].set_index(["sex", "age"]).exp_cases
    assert one[("male", "20-24")] > one[("male", "0-4")]


def test_tiers():
    assert [outlook.tier(v) for v in (0, 2.9, 3, 8, 15.9, 16, 99)] == ["Low", "Low", "Moderate", "High", "High", "Very high", "Very high"]
