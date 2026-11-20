"""One-off backfill: Malaysia's weekly dengue cases for 2023 to mid-2026, read off the line charts in WHO's situation updates.

Why: OpenDengue's weekly series ends on 25 Dec 2022, the Ministry (KKM) statements are not reachable from here, and the text of the
WHO updates quotes only two weeks at a time. The charts in three WHO updates, however, draw every week:

  dengue_20250109.pdf  page 3  Figure 4   2023 (green) and 2024 to week 41 (red)    -> 2023
  dengue_20250529.pdf  page 2  Figure 3   2024 (blue, all 52 weeks), 2025 to week 18 -> 2024
  dengue_biweekly_758_20261112.pdf p3 Fig 5  2025 (blue, 53 weeks), 2026 to week 34 -> 2025, 2026

The values are read from pixels, so they are approximate. Checks against numbers WHO prints in words:
  2023 weeks sum to 123 044 (WHO: 123 133),  2024 weeks sum to 122 257 (WHO: 122 423),
  2025 and 2026 weeks differ from the weeks WHO quotes by about 1% (at most about 2%).
Weeks that WHO quotes exactly (malaysia_weekly_who.csv) override these values when the two files are merged (see ingest_who.load).

Run:  python -m pipeline.digitise_who        (writes data/reference/malaysia_weekly_chart.csv; needs network for the three PDFs)
"""
from __future__ import annotations

import datetime as dt
import io
import logging

import numpy as np
import pandas as pd
import requests
from PIL import Image
from scipy import ndimage as ndi

from .ingest_who import CDN, HEADERS, REF, pdf_images

logging.getLogger("pypdf").setLevel(logging.ERROR)
OUT = REF / "malaysia_weekly_chart.csv"
WEEK1_END = {2023: dt.date(2023, 1, 7), 2024: dt.date(2024, 1, 6), 2025: dt.date(2025, 1, 4), 2026: dt.date(2026, 1, 10)}   # Saturdays that end epidemiological week 1


def _rgb(raw: bytes) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(raw)).convert("RGB")).astype(int)


def _near(a, ref, tol):
    return np.abs(a - np.array(ref)).sum(2) < tol


def _refine(m, x1, dx, n, ymax):
    """Find where week 1 sits and the spacing between weeks by maximising how much series colour lies on the week columns."""
    best = None
    for ax in np.arange(x1 - 4, x1 + 4.01, 0.5):
        for bd in np.arange(dx - 0.3, dx + 0.301, 0.02):
            s = sum(m[:ymax, int(round(ax + w * bd)) - 1:int(round(ax + w * bd)) + 2].sum() for w in range(n))
            if best is None or s > best[0]:
                best = (s, ax, bd)
    return best[1], best[2]


def _marker_y(m, x1, dx, n, ymax):
    """Vertical centre of the marker nearest each week column (the largest blob of series colour in a 5 px wide strip)."""
    out = []
    for w in range(n):
        x = int(round(x1 + w * dx))
        lab, k = ndi.label(m[:ymax, x - 2:x + 3])
        if k == 0:
            out.append(np.nan)
            continue
        j = 1 + int(np.argmax(ndi.sum(m[:ymax, x - 2:x + 3], lab, range(1, k + 1))))
        out.append(float(np.mean(np.where(lab == j)[0])))
    return np.array(out)


def figure_b(img):
    """20250529: 2024 blue triangles (52 weeks) and 2025 red squares (18 weeks). y: 0 at row 479.5, 46.55 px per 500 cases."""
    val = lambda y: (479.5 - y) / 46.55 * 500
    blue, red = _near(img, (0, 112, 192), 150), _near(img, (200, 30, 40), 170)
    x1, dx = _refine(blue, 127, 15.34, 52, 470)
    return val(_marker_y(blue, x1, dx, 52, 470)), (x1, dx)


def figure_c(img):
    """20261112: 2025 blue triangles (53 weeks) and 2026 red squares (34 weeks). y: 0 at row 323.9, 31.4 px per 500 cases."""
    val = lambda y: (323.9 - y) / 31.4 * 500
    blue, red = _near(img, (0, 100, 190), 150), _near(img, (200, 0, 0), 150)
    x1, dx = _refine(blue, 71, 9.88, 53, 320)
    x1r, dxr = _refine(red, x1, dx, 34, 320)
    return val(_marker_y(blue, x1, dx, 53, 320)), val(_marker_y(red, x1r, dxr, 34, 320))


def figure_a(img, ref2024):
    """20250109: 2023 green line (no markers, 52 weeks) on a beige chart. The 2024 red line (to week 41) is also in this chart, so it
    is used to calibrate the vertical scale against the clean 2024 series from figure B. Where the red line hides the green one,
    the two coincide, so the red line's height stands in for it."""
    R, G, B = img[..., 0], img[..., 1], img[..., 2]
    green = (G > R + 45) & (G > B + 35) & (G > 110) & (R < 130)
    red = _near(img, (205, 25, 30), 150)

    def clusters(m, x, lo=70, hi=410):
        col = m[lo:hi, x - 1:x + 2].any(1)
        lab, k = ndi.label(col)
        return [lo + float(np.mean(np.where(lab == j)[0])) for j in range(1, k + 1)]

    def red_y(x1, dx, n):
        out = []
        for w in range(n):
            c = clusters(red, int(round(x1 + w * dx)))
            out.append(c[0] if c else np.nan)
        return np.array(out)

    best = None
    for x1 in np.arange(142, 154, 0.5):
        for dx in np.arange(14.3, 15.0, 0.02):
            y = red_y(x1, dx, 41)
            ok = ~np.isnan(y)
            if ok.sum() < 35:
                continue
            a, b = np.polyfit(y[ok], ref2024[:41][ok], 1)
            err = float(np.sqrt(np.mean((a * y[ok] + b - ref2024[:41][ok]) ** 2)))
            if best is None or err < best[0]:
                best = (err, x1, dx, a, b)
    _, x1, dx, a, b = best
    g = np.full(52, np.nan)
    for w in range(52):
        c = clusters(green, int(round(x1 + w * dx)))
        if c:
            g[w] = a * c[0] + b
    for w in np.where(np.isnan(g))[0]:
        c = clusters(red, int(round(x1 + w * dx))) if w < 41 else []
        if c:
            g[w] = a * c[0] + b
        else:
            ok = ~np.isnan(g)
            g[w] = np.interp(w, np.arange(52)[ok], g[ok])
    return g


def build() -> pd.DataFrame:
    from pypdf import PdfReader  # noqa: F401  (imported inside pdf_images)
    imgs = {}
    for key, (name, page, image) in {"a": ("dengue_20250109.pdf", 3, "Image44.jpg"), "b": ("dengue_20250529.pdf", 2, "Image32.jpg"),
                                     "c": ("dengue_biweekly_758_20261112.pdf", 3, "Image37.png")}.items():
        raw = requests.get(CDN + name, headers=HEADERS, timeout=120).content
        imgs[key] = _rgb(pdf_images(raw, page)[image])
    v2024, _ = figure_b(imgs["b"])
    v2023 = figure_a(imgs["a"], v2024)
    v2025, v2026 = figure_c(imgs["c"])
    rows = []
    for year, v in ((2023, v2023), (2024, v2024), (2025, v2025), (2026, v2026)):
        for w, c in enumerate(v, 1):
            if not np.isnan(c):
                rows.append({"week_end": (WEEK1_END[year] + dt.timedelta(7 * (w - 1))).isoformat(), "epi_week": w, "cases": int(round(c)),
                             "source": "WHO chart (read off, approximate)"})
    df = pd.DataFrame(rows).sort_values("week_end").reset_index(drop=True)
    print({y: int(df[df.week_end.str.startswith(str(y))].cases.sum()) for y in (2023, 2024, 2025, 2026)}, "(2023 and 2024: WHO prints 123 133 and 122 423)")
    return df


if __name__ == "__main__":
    df = build()
    df.to_csv(OUT, index=False)
    print(f"wrote {OUT} ({len(df)} weeks, {df.week_end.min()} to {df.week_end.max()})")
