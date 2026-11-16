"""Paths, source URLs and name harmonisation shared by every pipeline stage."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "cache"        # re-downloadable, git-ignored
FEED = DATA / "feed"          # append-only live snapshots, committed (this is the history we build ourselves)
PROCESSED = DATA / "processed"
REFERENCE = DATA / "reference"  # small committed snapshots (OSM sites, geocode cache) so CI does not depend on flaky services
WEB_DATA = ROOT / "web" / "data"
for _p in (CACHE, FEED, PROCESSED, REFERENCE, WEB_DATA):
    _p.mkdir(parents=True, exist_ok=True)

UA = {"User-Agent": "dengue-early-warning-research/0.1 (open-data pipeline)"}

URLS = {
    "idengue": "https://idengue.mysa.gov.my/",
    "opendengue": "https://raw.githubusercontent.com/OpenDengue/master-repo/main/assets/Temporal_extract_WPRO_V1_3.zip",
    "districts": "https://raw.githubusercontent.com/dosm-malaysia/data-open/main/datasets/geodata/administrative_2_district.geojson",
    "pop_district": "https://storage.dosm.gov.my/population/population_district.parquet",
    "pop_state": "https://storage.dosm.gov.my/population/population_state.parquet",
    "datagov": "https://api.data.gov.my/data-catalogue",
    "power": "https://power.larc.nasa.gov/api/temporal/daily/point",
    "openmeteo": "https://api.open-meteo.com/v1/forecast",
    "oni": "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt",
    "dmi": "https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data",
    "overpass": "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "photon": "https://photon.komoot.io/api/",
}

# Modelling unit = "region": the 15 units iDengue reports (KL + Putrajaya are reported together).
REGIONS = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Pulau Pinang", "Perak",
           "Perlis", "Selangor", "Terengganu", "Sabah", "Sarawak", "W.P. Kuala Lumpur & Putrajaya", "W.P. Labuan"]
KLP = "W.P. Kuala Lumpur & Putrajaya"

STATE_TO_REGION = {"W.P. Kuala Lumpur": KLP, "W.P. Putrajaya": KLP}          # DOSM state -> region
IDENGUE_TO_REGION = {"WILAYAH PERSEKUTUAN": KLP, "WILAYAH PERSEKUTUAN LABUAN": "W.P. Labuan"}
OPENDENGUE_TO_REGION = {"KUALA LUMPUR": KLP, "W.P. KUALA LUMPUR": KLP, "LABUAN": "W.P. Labuan", "W.P. LABUAN": "W.P. Labuan"}
STATE_ISO = {"Johor": "MY-01", "Kedah": "MY-02", "Kelantan": "MY-03", "Melaka": "MY-04", "Negeri Sembilan": "MY-05",
             "Pahang": "MY-06", "Pulau Pinang": "MY-07", "Perak": "MY-08", "Perlis": "MY-09", "Selangor": "MY-10",
             "Terengganu": "MY-11", "Sabah": "MY-12", "Sarawak": "MY-13", "W.P. Kuala Lumpur": "MY-14",
             "W.P. Labuan": "MY-15", "W.P. Putrajaya": "MY-16"}


def region_of(state: str) -> str:
    return STATE_TO_REGION.get(state, state)


def norm_region(name: str, table: dict) -> str:
    n = " ".join(str(name).upper().split())
    if n in table:
        return table[n]
    for r in REGIONS:
        if r.upper() == n:
            return r
    raise KeyError(f"unknown state/region name: {name!r}")


# Relative dengue incidence by age band (ratio to the all-age rate). PRIOR, not fitted: public Malaysian
# surveillance summaries consistently show the highest notification rates in ages 15-49. Replace with
# district age-sex case shares when an MOH eDengue extract is available.
AGE_RELATIVE_RISK = {"0-4": 0.55, "5-9": 0.80, "10-14": 1.00, "15-19": 1.25, "20-24": 1.35, "25-29": 1.35,
                     "30-34": 1.25, "35-39": 1.15, "40-44": 1.05, "45-49": 0.95, "50-54": 0.85, "55-59": 0.80,
                     "60-64": 0.70, "65-69": 0.65, "70-74": 0.60, "75-79": 0.55, "80-84": 0.50, "85+": 0.50}
SEX_RELATIVE_RISK = {"male": 1.08, "female": 0.92}

HORIZON_DAYS = 14            # forecast window used for the district outlook
