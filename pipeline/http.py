"""Small HTTP helpers: retries with backoff + on-disk cache for slow, static downloads."""
import json
import time
from pathlib import Path

import requests

from .config import CACHE, UA

_session = requests.Session()
_session.headers.update(UA)


def get(url, *, params=None, data=None, timeout=60, tries=4, method=None):
    last = None
    for i in range(tries):
        try:
            m = method or ("POST" if data is not None else "GET")
            r = _session.request(m, url, params=params, data=data, timeout=timeout)
            if r.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"{r.status_code} from {url}")
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001 - network errors are retried uniformly
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"GET {url} failed after {tries} tries: {last}")


def cached_file(name: str, url: str, max_age_days: float = 30, **kw) -> Path:
    """Download `url` to data/cache/<name> unless a fresh enough copy exists."""
    p = CACHE / name
    p.parent.mkdir(parents=True, exist_ok=True)
    if p.exists() and (time.time() - p.stat().st_mtime) < max_age_days * 86400:
        return p
    try:
        p.write_bytes(get(url, **kw).content)
    except RuntimeError:
        if not p.exists():
            raise
        print(f"  ! refresh failed, using stale cache for {name}")
    return p


def cached_json(name: str, url: str, max_age_days: float = 30, **kw):
    return json.loads(cached_file(name, url, max_age_days, **kw).read_text())
