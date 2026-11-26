"""Optional TMDb enrichment with an on-disk cache.

Every response (including empty search results) is written to data/tmdb_cache/,
so no movie is ever fetched twice. Network failures never raise: the first
connection error switches the client off for the rest of the run.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from common import fold

API_ROOT = "https://api.themoviedb.org/3"


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(text)).strip("-")[:80] or "untitled"


class TMDbClient:
    def __init__(self, api_key: str, cache_dir: Path, fetcher=None, timeout: float = 8.0, log=print):
        self.api_key = api_key.strip()
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.timeout = timeout
        self.fetcher = fetcher or self._http_get
        self.log = log
        self.offline = False
        self.stats = {"cache_hits": 0, "fetched": 0, "errors": 0}

    # -- transport -------------------------------------------------------
    def _http_get(self, path: str, params: dict) -> dict:
        query = dict(params)
        headers = {"Accept": "application/json"}
        if self.api_key.startswith("eyJ"):  # v4 read-access token
            headers["Authorization"] = f"Bearer {self.api_key}"
        else:  # v3 API key
            query["api_key"] = self.api_key
        url = f"{API_ROOT}{path}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def _cached(self, cache_name: str, path: str, params: dict):
        cache_file = self.cache_dir / cache_name
        if cache_file.exists():
            self.stats["cache_hits"] += 1
            with open(cache_file, encoding="utf-8") as handle:
                return json.load(handle)
        if self.offline:
            return None
        try:
            payload = self.fetcher(path, params)
        except urllib.error.HTTPError as exc:
            self.stats["errors"] += 1
            if exc.code in (401, 403):
                self.log(f"  TMDb rejected the key (HTTP {exc.code}); skipping enrichment for this run.")
                self.offline = True
            elif exc.code == 404:
                payload = {"_not_found": True}
                self._write(cache_file, payload)
                return payload
            else:
                self.log(f"  TMDb HTTP {exc.code} for {path}; skipped.")
            return None
        except Exception as exc:  # network down, DNS, timeout, bad JSON
            self.stats["errors"] += 1
            self.log(f"  TMDb unreachable ({exc.__class__.__name__}: {exc}); continuing without it.")
            self.offline = True
            return None
        self.stats["fetched"] += 1
        self._write(cache_file, payload)
        return payload

    @staticmethod
    def _write(cache_file: Path, payload) -> None:
        with open(cache_file, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False)

    # -- endpoints -------------------------------------------------------
    def search_movie(self, title: str, year: int | None) -> int | None:
        params = {"query": title, "include_adult": "false"}
        if year:
            params["year"] = str(year)
        payload = self._cached(f"search_{_slug(title)}_{year or 'any'}.json", "/search/movie", params)
        if not payload:
            return None
        results = payload.get("results") or []
        target = fold(title)
        for result in results:  # prefer an exact title match
            if fold(result.get("title", "")) == target or fold(result.get("original_title", "")) == target:
                return result.get("id")
        return results[0].get("id") if results else None

    def movie(self, tmdb_id: int) -> dict | None:
        payload = self._cached(
            f"movie_{int(tmdb_id)}.json",
            f"/movie/{int(tmdb_id)}",
            {"append_to_response": "credits,release_dates"},
        )
        if not payload or payload.get("_not_found"):
            return None
        return payload


def extract(details: dict) -> dict:
    """Flatten a TMDb movie payload into the fields this project uses."""
    out: dict = {}
    if not details:
        return out
    out["genres"] = [g["name"] for g in details.get("genres") or [] if g.get("name")]
    out["runtime_min"] = details.get("runtime") or None
    out["release_date"] = details.get("release_date") or None
    collection = details.get("belongs_to_collection") or {}
    if collection.get("name"):
        out["franchise"] = re.sub(r"\s+Collection$", "", collection["name"]).strip()
    companies = details.get("production_companies") or []
    if companies and companies[0].get("name"):
        out["studio"] = companies[0]["name"]
    out["production_budget"] = details.get("budget") or None  # TMDb uses 0 for unknown
    out["worldwide_gross"] = details.get("revenue") or None

    rating = None
    for country in (details.get("release_dates") or {}).get("results") or []:
        if country.get("iso_3166_1") != "US":
            continue
        dates = sorted(country.get("release_dates") or [], key=lambda d: (d.get("type") != 3, d.get("type", 9)))
        for entry in dates:
            if entry.get("certification"):
                rating = entry["certification"].strip()
                break
    out["mpaa_rating"] = rating

    credits = details.get("credits") or {}
    crew = credits.get("crew") or []

    def crew_names(job: str) -> list[str]:
        names: list[str] = []
        for member in crew:
            if member.get("job") == job and member.get("name") and member["name"] not in names:
                names.append(member["name"])
        return names

    cast = sorted(credits.get("cast") or [], key=lambda c: c.get("order", 999))
    out["people"] = {
        "director": crew_names("Director"),
        "producer": crew_names("Producer"),
        "executive_producer": crew_names("Executive Producer"),
        "lead_cast": [c["name"] for c in cast[:3] if c.get("name")],
    }
    return out
