"""US Census Bureau Geocoder: address -> coordinates -> census tract GEOID per vintage.

Tract vintage matters. The 2018 Opportunity Zone list uses 2010 census tracts, and the
2027 list and current NMTC data use 2020 tracts (the 2027 list uses Connecticut's
planning-region county codes, which first appear in the 2022+ geography). Each dataset
in data/sources.json names the geocoder vintage that returns GEOIDs matching its list.
We match the address once, then ask for the tract at that point in every vintage needed.

If a vintage-specific lookup fails we fall back to the current vintage and flag
"tract vintage mismatch, verify manually", because boundaries changed in 2020.

API docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .net import FetchError, Fetcher

GEOCODER = "https://geocoding.geo.census.gov/geocoder"
BENCHMARK = "Public_AR_Current"
FALLBACK_VINTAGE = "Current_Current"
LAYERS = "Census Tracts,Counties,States"
CACHE_DAYS = 180  # benchmarks are refreshed a few times a year

MISMATCH_FLAG = "tract vintage mismatch, verify manually"

_UNIT_RE = re.compile(
    r"[,\s]+(?:suite|ste\.?|unit|apt\.?|apartment|floor|fl\.?|room|rm\.?|bldg\.?|building|#)\s*[\w-]+",
    re.I,
)


@dataclass
class TractResult:
    requested_vintage: str
    vintage_used: Optional[str] = None
    geoid: Optional[str] = None
    name: Optional[str] = None
    mismatch: bool = False
    error: Optional[str] = None

    @property
    def flag(self) -> Optional[str]:
        return MISMATCH_FLAG if self.mismatch else None


@dataclass
class GeocodeResult:
    input_address: str
    matched_address: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    state_fips: Optional[str] = None
    state_abbr: Optional[str] = None
    state_name: Optional[str] = None
    county_fips: Optional[str] = None
    county_name: Optional[str] = None
    tracts: Dict[str, TractResult] = field(default_factory=dict)
    match_count: int = 0
    source: str = "address"  # address | coordinates
    warnings: List[str] = field(default_factory=list)
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.lat is not None and self.lon is not None

    def tract(self, vintage: str) -> Optional[TractResult]:
        return self.tracts.get(vintage)


def _tract_layer(geos: dict) -> Optional[dict]:
    for key, items in (geos or {}).items():
        if "tract" in key.lower() and "block" not in key.lower() and items:
            return items[0]
    return None


def _layer(geos: dict, word: str) -> Optional[dict]:
    for key, items in (geos or {}).items():
        if key.lower() == word.lower() and items:
            return items[0]
    return None


def _apply_admin(res: GeocodeResult, geos: dict) -> None:
    st = _layer(geos, "States")
    co = _layer(geos, "Counties")
    if st and not res.state_fips:
        res.state_fips, res.state_abbr, res.state_name = st.get("STATE"), st.get("STUSAB"), st.get("NAME")
    if co and not res.county_fips:
        res.county_fips, res.county_name = co.get("GEOID"), co.get("NAME")


def _get_json(fetcher: Fetcher, url: str, params: dict) -> dict:
    last = None
    for _ in range(2):  # the geocoder occasionally returns a transient 5xx
        try:
            resp = fetcher.get(url, params=params, max_age_days=CACHE_DAYS)
        except FetchError as exc:
            last = str(exc)
            continue
        if resp.ok:
            try:
                return resp.json()
            except ValueError:
                last = f"non-JSON reply from geocoder (HTTP {resp.status})"
                continue
        last = f"HTTP {resp.status} from geocoder"
    raise FetchError(last or "geocoder unavailable")


def tract_at(fetcher: Fetcher, lon: float, lat: float, vintage: str) -> TractResult:
    """Tract containing a point in one vintage, falling back to the current vintage."""
    out = TractResult(requested_vintage=vintage)
    for v in ([vintage] if vintage == FALLBACK_VINTAGE else [vintage, FALLBACK_VINTAGE]):
        try:
            data = _get_json(fetcher, f"{GEOCODER}/geographies/coordinates", {
                "x": f"{lon:.6f}", "y": f"{lat:.6f}", "benchmark": BENCHMARK, "vintage": v,
                "layers": LAYERS, "format": "json",
            })
            tract = _tract_layer(data.get("result", {}).get("geographies", {}))
        except FetchError as exc:
            out.error = str(exc)
            continue
        if tract and tract.get("GEOID"):
            out.vintage_used, out.geoid, out.name = v, tract["GEOID"], tract.get("NAME")
            out.mismatch = v != vintage
            return out
        out.error = f"no census tract returned for vintage {v}"
    return out


def geocode_address(fetcher: Fetcher, address: str, vintages: List[str]) -> GeocodeResult:
    """Match a one-line US address and return its tract GEOID in every requested vintage."""
    res = GeocodeResult(input_address=address)
    primary = vintages[0] if vintages else FALLBACK_VINTAGE
    attempts = [address]
    stripped = _UNIT_RE.sub("", address)
    if stripped != address:
        attempts.append(stripped)  # suite/unit numbers sometimes block a match

    match = None
    for attempt in attempts:
        try:
            data = _get_json(fetcher, f"{GEOCODER}/geographies/onelineaddress", {
                "address": attempt, "benchmark": BENCHMARK, "vintage": primary,
                "layers": LAYERS, "format": "json",
            })
        except FetchError as exc:
            res.error = f"Census geocoder unavailable: {exc}"
            return res
        matches = data.get("result", {}).get("addressMatches", [])
        if matches:
            match = matches[0]
            res.match_count = len(matches)
            if attempt != address:
                res.warnings.append(f"matched after removing the unit number ({attempt!r})")
            break
    if match is None:
        res.error = "the Census geocoder found no match for this address; check the spelling or try another address"
        return res

    if res.match_count > 1:
        res.warnings.append(f"the geocoder returned {res.match_count} possible matches; used the first, check it")
    res.matched_address = match.get("matchedAddress")
    res.lon, res.lat = float(match["coordinates"]["x"]), float(match["coordinates"]["y"])
    geos = match.get("geographies", {})
    _apply_admin(res, geos)

    tract = _tract_layer(geos)
    if tract and tract.get("GEOID"):
        res.tracts[primary] = TractResult(primary, primary, tract["GEOID"], tract.get("NAME"))
    else:
        res.tracts[primary] = tract_at(fetcher, res.lon, res.lat, primary)
    for v in vintages[1:]:
        res.tracts[v] = tract_at(fetcher, res.lon, res.lat, v)
    _fill_admin_from_point(fetcher, res)
    return res


def geocode_point(fetcher: Fetcher, lat: float, lon: float, vintages: List[str], label: str = "") -> GeocodeResult:
    """Same output as geocode_address, starting from coordinates (used with --latlon)."""
    res = GeocodeResult(input_address=label or f"{lat:.6f}, {lon:.6f}", lat=lat, lon=lon, source="coordinates")
    res.matched_address = None
    for v in vintages:
        res.tracts[v] = tract_at(fetcher, lon, lat, v)
    _fill_admin_from_point(fetcher, res)
    return res


def _fill_admin_from_point(fetcher: Fetcher, res: GeocodeResult) -> None:
    """County and state from the current vintage (names and codes as they are today)."""
    if res.state_fips and res.county_fips and res.state_abbr:
        return
    try:
        data = _get_json(fetcher, f"{GEOCODER}/geographies/coordinates", {
            "x": f"{res.lon:.6f}", "y": f"{res.lat:.6f}", "benchmark": BENCHMARK,
            "vintage": FALLBACK_VINTAGE, "layers": LAYERS, "format": "json",
        })
        _apply_admin(res, data.get("result", {}).get("geographies", {}))
    except FetchError as exc:
        res.warnings.append(f"could not look up county/state: {exc}")
