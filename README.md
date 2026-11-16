# Dengue Buster

An open-data dengue early-warning pipeline and dashboard for Malaysia.

Every day it snapshots the Ministry of Health's iDengue bulletin, joins it with weather, population,
socio-economic and OpenStreetMap layers, tests which factors actually predict cases, and publishes a
14-day outlook for all 160 districts with the age groups, schools, kindergartens and construction
sites most worth checking first.

```
python -m pipeline.run          # ingest -> features -> backtests -> outlook -> spatial stats -> web/data/bundle.js
python -m pipeline.build_web    # assemble web/index.html
python -m http.server -d web    # open http://localhost:8000
```

`pip install -r requirements.txt` first. The first run downloads about 35 years of daily weather for
160 districts (around a minute) and geocodes active outbreak localities (several minutes, cached
afterwards). `--skip-live` reuses the last iDengue snapshot; `--skip-osm` skips the OSM layer.

## What the data can and cannot support

| Need | Open source used | Reality |
|---|---|---|
| Current cases | iDengue (MOH/MYSA) | Today's cases and a running total **by state**, plus lists of active outbreak localities and hotspots. No history, no district table. |
| Case history | OpenDengue v1.3 | State x month 1993-2010 (10 states), national x week 2011-2022, national x month 2024. **No district history exists in the open.** |
| Weather | NASA POWER, Open-Meteo | Daily rain, temperature, humidity, wind per district centroid since 1992, plus a 16-day forecast. |
| Climate modes | NOAA CPC / PSL | ENSO (ONI) and Indian Ocean Dipole, monthly. |
| Population | DOSM | District population by 5-year age band and sex, 2020-2026. |
| Socio-economic | data.gov.my | District income and poverty; schools and enrolment; state piped-water and sanitation access. |
| Exposure sites | OpenStreetMap | Schools, kindergartens, mapped construction sites (uneven coverage). |

Two consequences shape the design:

1. **Factors are tested where history exists** (state-month and national-week), with rolling-origin
   backtests: train on the past, score on the next unseen year, add one factor group at a time.
2. **District numbers are a downscaling, not a fitted district model.** Each state's observed level is
   split across districts by population, density, recent weather and the location of active outbreak
   localities. Tiers are a ranking for where to look first.

Because iDengue keeps no history, `data/feed/` is the history: the scheduled workflow appends one
snapshot per day. After 14 days the state level switches automatically from a year-to-date average
to actual cases over the last fortnight.

## Pipeline

| Stage | Module | Output |
|---|---|---|
| Live feed | `pipeline/ingest_idengue.py` | `data/feed/idengue_state_daily.csv`, `hotspots.csv`, `outbreaks_by_region.csv`, `outbreak_localities_latest.csv` (geocoded) |
| Reference data | `pipeline/ingest_static.py` | boundaries, population, socio-economics, OpenDengue history, ENSO/IOD |
| Weather | `pipeline/ingest_weather.py` | daily district weather 1992 to today plus forecast (cached, topped up) |
| Exposure sites | `pipeline/ingest_osm.py` | schools, kindergartens, construction sites assigned to districts |
| Features | `pipeline/features.py` | population-weighted weather, standardised anomalies, lags, neighbour pressure |
| Models | `pipeline/models.py` | negative-binomial GLM (rate ratios), boosted trees, rolling-origin backtests |
| Outlook | `pipeline/outlook.py` | district expected cases, interval, tier, age-sex split, site priority score |
| Spatial | `pipeline/spatial.py` | queen contiguity, Moran's I, local Moran clusters, Getis-Ord Gi* |
| Orchestration | `pipeline/run.py` | `data/processed/*.csv|parquet`, `web/data/bundle.js` |

### District outlook formula

```
state expected cases (14 d) = current weekly level x 2 x seasonal change x weather effect
district share              = (1 - w) x population x density^gamma x local weather effect   (normalised within state)
                            +      w  x share of the state's located outbreak localities
```

- **Weather effect** = exp(sum of beta x anomaly) using the coefficients of weather lags *conditional on
  recent cases*, with anomalies measured against the last 10 years so the warming trend is not read as
  a dengue signal. Bounded to 0.7-1.4.
- **gamma** is the cross-state slope of log incidence on log density, bounded to 0-0.5.
- **w** grows with the fraction of a state's outbreak localities that could be geocoded (max 0.6).
- The interval and "chance of reaching High" come from a negative-binomial distribution with the
  dispersion estimated in the backtest.
- Tiers: Low < 3, Moderate 3-8, High 8-16, Very high >= 16 expected cases per 100,000 in 14 days.

### Site priority score (0-100)

`district risk percentile x exposure weight x recent-rain factor x proximity to an active outbreak`.
Construction sites carry a 1.25 weight (breeding habitat plus mobile workforce).

## Factors tested so far

Run the pipeline to regenerate; the dashboard shows the current numbers.

- **Recent cases** dominate short-range prediction at both scales.
- **Weather lags** improve a season-only model but add nothing one month ahead once recent cases are
  known; nationally they start to help at 3-4 weeks ahead. Rainfall correlates most with cases 5-7
  weeks later, consistent with the mosquito life cycle plus incubation, but the link is weak.
- **ENSO / IOD** and **neighbouring-state cases** did not improve out-of-sample error on this history.
- **Density, schools, construction, income, water and sanitation** are in the district layer but cannot
  be validated until district case counts accumulate or MOH shares eDengue extracts.

## Known limits

- iDengue labels its running total "since 31 Dec 2023"; it is smaller than 2024's cases alone, so the
  pipeline treats it as year-to-date and says so on the dashboard.
- Geocoding outbreak localities by name is imperfect; unplaced localities still count at state level.
- The age and sex split applies assumed relative risks (`AGE_RELATIVE_RISK` in `pipeline/config.py`) to
  real population. Replace with observed case shares when available.
- Aedes indices, fogging and inspection records, serotypes, mobility and onset dates are not open.
- The public Overpass mirror used for OSM is sometimes unavailable; states that fail are retried on
  the next run and the dashboard reports how many sites loaded.

## Automation

`.github/workflows/pipeline.yml` runs daily at 09:17 Malaysia time: tests, pipeline, then commits
`data/feed`, `data/processed` and the dashboard bundle. Serve `web/` with GitHub Pages or any static host.

## Tests

`pytest -q` covers the iDengue parsers (including failing loudly on a layout change), the spatial
statistics on a planted cluster, the negative-binomial fit, and conservation of cases in the downscaling.
