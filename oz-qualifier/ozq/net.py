"""HTTP access with a local SQLite cache.

Every network answer the tool relies on (geocoder, HUBZone map, company web pages)
goes through Fetcher.get(), so a repeat lookup is instant and works offline.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Optional

import requests

from .paths import CACHE_PATH

USER_AGENT = "Mozilla/5.0 (compatible; oz-qualifier/1.0; location screening tool)"


class FetchError(Exception):
    """Raised when a URL cannot be fetched and nothing usable is cached."""


@dataclass
class CachedResponse:
    url: str
    final_url: str
    status: int
    content_type: str
    text: str
    fetched_at: float
    from_cache: bool
    stale: bool = False

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    def json(self):
        return json.loads(self.text)

    @property
    def fetched_at_iso(self) -> str:
        return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(self.fetched_at))


class Fetcher:
    def __init__(self, cache_path: Path = CACHE_PATH, offline: bool = False, timeout: float = 25.0):
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(cache_path))
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS http_cache ("
            " key TEXT PRIMARY KEY, url TEXT NOT NULL, final_url TEXT, status INTEGER,"
            " content_type TEXT, body TEXT, fetched_at REAL NOT NULL)"
        )
        self.conn.commit()
        self.offline = offline
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT

    @staticmethod
    def _key(url: str, params: Optional[Mapping[str, str]], headers: Optional[Mapping[str, str]]) -> str:
        blob = json.dumps([url, sorted((params or {}).items()), sorted((headers or {}).items())])
        return hashlib.sha256(blob.encode()).hexdigest()

    def _read_cache(self, key: str) -> Optional[tuple]:
        return self.conn.execute(
            "SELECT url, final_url, status, content_type, body, fetched_at FROM http_cache WHERE key=?",
            (key,),
        ).fetchone()

    def get(
        self,
        url: str,
        params: Optional[Mapping[str, str]] = None,
        headers: Optional[Mapping[str, str]] = None,
        max_age_days: Optional[float] = None,
        cache_errors: bool = False,
    ) -> CachedResponse:
        """GET with caching.

        max_age_days=None means a cached answer never expires. When the network is
        unavailable (or offline=True) a stale cached answer is returned, marked stale.
        """
        key = self._key(url, params, headers)
        row = self._read_cache(key)
        if row is not None:
            age_days = (time.time() - row[5]) / 86400.0
            fresh = max_age_days is None or age_days <= max_age_days
            if fresh or self.offline:
                return CachedResponse(row[0], row[1], row[2], row[3] or "", row[4] or "", row[5],
                                      from_cache=True, stale=not fresh)
        if self.offline:
            raise FetchError(f"offline and no cached copy of {url}")
        try:
            resp = self.session.get(url, params=params, headers=headers, timeout=self.timeout)
        except requests.RequestException as exc:
            if row is not None:
                return CachedResponse(row[0], row[1], row[2], row[3] or "", row[4] or "", row[5],
                                      from_cache=True, stale=True)
            raise FetchError(f"{url}: {exc.__class__.__name__}: {exc}") from exc

        text = resp.text
        out = CachedResponse(url, resp.url, resp.status_code, resp.headers.get("Content-Type", ""),
                             text, time.time(), from_cache=False)
        if out.ok or cache_errors:
            self.conn.execute(
                "INSERT OR REPLACE INTO http_cache (key, url, final_url, status, content_type, body, fetched_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (key, url, out.final_url, out.status, out.content_type, text, out.fetched_at),
            )
            self.conn.commit()
        return out


def download_file(url: str, dest: Path, timeout: float = 120.0) -> Path:
    """Stream a source file to disk (used by build_data.py). Writes atomically."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=timeout, headers={"User-Agent": USER_AGENT}) as r:
        r.raise_for_status()
        with open(tmp, "wb") as fh:
            for chunk in r.iter_content(chunk_size=1 << 16):
                fh.write(chunk)
    tmp.replace(dest)
    return dest


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()
