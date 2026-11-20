"""Weekly national dengue cases for Malaysia after 25 Dec 2022, read from the WHO Western Pacific dengue situation
updates (https://www.who.int/westernpacific/emergencies/surveillance/dengue).

Why this exists: OpenDengue's weekly series for Malaysia stops at 25 Dec 2022 and iDengue publishes only today's figures.
Each WHO update quotes Malaysia's latest reported epidemiological week and the week before it, with the year-to-date total.
Malaysia is refreshed only some of the time ("monthly update", or "no update in this reporting period"), so the result is a
patchy series of weekly points, not a complete one. It is a backfill for the trend chart, not an input to the forecast.

Run:  python -m pipeline.ingest_who          (adds issues published since the last run)
      python -m pipeline.ingest_who --all    (re-reads every issue from 2025-01-09)
The weekly values for 2023 to mid-2026 that WHO does not print in words come from digitise_who.py (approximate, read off WHO charts).
Drop extra rows (for example, from a KKM "Situasi Semasa Demam Denggi" statement) into
data/reference/malaysia_weekly_manual.csv with the columns week_end,cases,source; they win over WHO rows for the same week.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import re

import logging

import pandas as pd
import requests

from .config import DATA

logging.getLogger("pypdf").setLevel(logging.ERROR)     # these PDFs trigger harmless "wrong pointing object" warnings

REF = DATA / "reference"
WEEKLY = REF / "malaysia_weekly_who.csv"
ISSUES = REF / "who_issues.json"        # issue date -> source file name, or "none" when no file was found
MANUAL = REF / "malaysia_weekly_manual.csv"
CDN = "https://cdn.who.int/media/docs/default-source/wpro---documents/emergency/surveillance/dengue/"
FIRST_ISSUE, FIRST_NO = dt.date(2025, 1, 9), 709   # issues come out on alternate Thursdays and are numbered in order
HEADERS = {"User-Agent": "dengue-buster-open-data-pipeline"}
NUM = r"\d{1,3}(?: \d{3})+|\d+"
MONTHS = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace(" ", " ").replace(" ", " ").replace(" ", " ")).strip()


def _n(s: str) -> int:
    return int(s.replace(" ", ""))


def _end_date(span: str) -> dt.date | None:
    """Last date in text such as '22 to 28 December 2024' or '31 August to 6 September 2025'."""
    m = re.search(r"(\d{1,2}) ([A-Za-z]+) (\d{4})\s*$", span.strip())
    if not m or m.group(2) not in MONTHS:
        return None
    return dt.date(int(m.group(3)), MONTHS[m.group(2)], int(m.group(1)))


def parse_text(text: str, issue: dt.date) -> list[dict]:
    """Malaysia's latest week and the week before it, from one update's text."""
    t = _norm(text)
    h = re.search(r"Malaysia(?: \(Monthly update\))? (?=(?:There (?:was|is) no update[^.]*\. )?In epidemiological week)", t)
    if not h:
        return []
    para = t[h.end():]
    stop = re.search(r" (?:Singapore|Philippines|Viet Nam|Cambodia|Lao PDR|Papua New Guinea|Pacific island)\b", para)
    para = para[: stop.start()] if stop else para[:1500]
    m = re.search(rf"epidemiological week (\d+)(?: of \d{{4}})? \(([^)]+)\),? (?:a total of |there were )?({NUM}) (?:new )?(?:dengue )?cases[^.]{{0,220}}?"
                  rf"(?:from|compared to) ?({NUM}) cases in week (\d+)", para)
    if not m:
        return []
    wk, span, last, prev, pwk = int(m.group(1)), m.group(2), _n(m.group(3)), _n(m.group(4)), int(m.group(5))
    end = _end_date(span)
    if end is None or end.weekday() != 5:       # Malaysian epidemiological weeks end on a Saturday
        return []
    cum = re.search(rf"Cumulatively, (?:a total of )?({NUM}) (?:dengue )?cases", para)
    deaths = re.search(r"(?:including|and) (\w+|\d+) (?:additional )?deaths", para[cum.start():]) if cum else None
    small = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
    d = None
    if deaths:
        v = deaths.group(1)
        d = small.get(v.lower(), int(v) if v.isdigit() else None)
    src = issue.isoformat()
    rows = [{"week_end": end.isoformat(), "epi_week": wk, "cases": last, "cum_ytd": _n(cum.group(1)) if cum else None, "deaths_ytd": d, "source": f"WHO {src}"}]
    if pwk in (wk - 1, 52, 53):
        rows.append({"week_end": (end - dt.timedelta(7)).isoformat(), "epi_week": pwk, "cases": prev, "cum_ytd": None, "deaths_ytd": None, "source": f"WHO {src}"})
    return rows


def pdf_text(raw: bytes) -> str:
    from pypdf import PdfReader
    r = PdfReader(io.BytesIO(raw))
    return "\n".join((p.extract_text() or "") for p in r.pages[:6])


def pdf_images(raw: bytes, page: int) -> dict[str, bytes]:
    """Images embedded on one page (1-based) of a PDF, by name."""
    from pypdf import PdfReader
    return {im.name: im.data for im in PdfReader(io.BytesIO(raw)).pages[page - 1].images}


def _fetch(url: str) -> bytes | None:
    try:
        r = requests.get(url, headers=HEADERS, timeout=60)
        if r.status_code == 200 and r.content[:4] == b"%PDF":
            return r.content
    except requests.RequestException:
        pass
    return None


def candidates(d: dt.date) -> list[str]:
    k = d.strftime("%Y%m%d")
    e = FIRST_NO + (d - FIRST_ISSUE).days // 14
    return [f"dengue_{k}.pdf", f"dengue-{k}.pdf"] + [f"dengue_biweekly_{n}_{k}.pdf" for n in range(e - 5, e + 6)]


def refresh(everything: bool = False, today: dt.date | None = None) -> pd.DataFrame:
    REF.mkdir(parents=True, exist_ok=True)
    seen = json.loads(ISSUES.read_text()) if ISSUES.exists() and not everything else {}
    old = pd.read_csv(WEEKLY) if WEEKLY.exists() and not everything else pd.DataFrame()
    today = today or dt.date.today()
    done = [dt.date.fromisoformat(k) for k, v in seen.items() if v != "none"]
    start = max(FIRST_ISSUE, (max(done) - dt.timedelta(28)) if done else FIRST_ISSUE)
    rows = []
    d = FIRST_ISSUE
    while d <= today:
        key = d.isoformat()
        retry = key not in seen or (seen[key] == "none" and (today - d).days < 60)
        if d >= start and retry:
            got = None
            for name in candidates(d):
                raw = _fetch(CDN + name)
                if raw:
                    got = name
                    try:
                        rows += parse_text(pdf_text(raw), d)
                    except Exception as e:  # noqa: BLE001
                        print(f"  ! {name}: {e}")
                    break
            seen[key] = got or "none"
            print(f"  WHO {key}: {got or 'no file'}")
        d += dt.timedelta(14)
    new = pd.DataFrame(rows, columns=["week_end", "epi_week", "cases", "cum_ytd", "deaths_ytd", "source"])
    out = pd.concat([old, new], ignore_index=True)
    if len(out):
        out = out.sort_values(["week_end", "source"]).drop_duplicates("week_end", keep="last").reset_index(drop=True)   # a later issue may revise a week
    out.to_csv(WEEKLY, index=False)
    ISSUES.write_text(json.dumps(dict(sorted(seen.items())), indent=0))
    print(f"  WHO weekly: {len(out)} weeks, {out.week_end.min() if len(out) else '-'} to {out.week_end.max() if len(out) else '-'}")
    return out


CHART = REF / "malaysia_weekly_chart.csv"      # approximate weekly values read off WHO charts (see digitise_who.py)


def load() -> pd.DataFrame:
    """One row per week after 2022. Precedence for a week: manual rows, then numbers WHO prints in words, then values read off charts.
    `kind` is 'text', 'chart' or 'manual'."""
    parts = []
    for path, kind in ((CHART, "chart"), (WEEKLY, "text"), (MANUAL, "manual")):      # later parts win
        if path.exists():
            d = pd.read_csv(path)[["week_end", "cases", "source"]]
            d["kind"] = kind
            parts.append(d)
    w = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["week_end", "cases", "source", "kind"])
    w = w.drop_duplicates("week_end", keep="last")
    w["week_end"] = pd.to_datetime(w.week_end)
    return w.sort_values("week_end").reset_index(drop=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    refresh(ap.parse_args().all)
