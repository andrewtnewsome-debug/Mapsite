"""Combine a geocoded location with the designation tables into a screening verdict."""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass, field
from typing import List, Optional

from . import db
from .geocode import MISMATCH_FLAG, GeocodeResult


@dataclass
class DesignationResult:
    dataset_id: str
    program: str
    name: str
    round_label: str
    tract_vintage: Optional[str]
    geocoder_vintage: Optional[str]
    geoid_used: Optional[str] = None       # GEOID from the geocoder
    geoid_matched: Optional[str] = None    # GEOID found in the list (differs only via an alias)
    alias_note: Optional[str] = None
    vintage_used: Optional[str] = None
    vintage_mismatch: bool = False
    in_dataset: bool = False
    qualifies: Optional[bool] = None       # None = could not determine
    category: Optional[str] = None
    flags: dict = field(default_factory=dict)
    extra: dict = field(default_factory=dict)
    effective_date: Optional[str] = None
    expires_date: Optional[str] = None
    period_status: Optional[str] = None    # in_effect | not_yet_effective | expired | None
    period_note: Optional[str] = None
    vintage_date: Optional[str] = None
    is_sample: bool = False
    source_url: Optional[str] = None
    source_file: Optional[str] = None
    map_url: Optional[str] = None
    map_label: Optional[str] = None
    problem: Optional[str] = None

    @property
    def flag(self) -> Optional[str]:
        return MISMATCH_FLAG if self.vintage_mismatch else None


@dataclass
class QozVerdict:
    answer: str                      # YES | NO | UNKNOWN
    rounds_yes: List[DesignationResult]
    summary: str
    unverified: bool                 # True if any QOZ lookup used a mismatched vintage or sample data


def _period_status(today: dt.date, start: Optional[str], end: Optional[str]) -> Optional[str]:
    if not start and not end:
        return None
    if start and today < dt.date.fromisoformat(start):
        return "not_yet_effective"
    if end and today > dt.date.fromisoformat(end):
        return "expired"
    return "in_effect"


def _fmt(d: Optional[str]) -> str:
    if not d:
        return "?"
    day = dt.date.fromisoformat(d)
    return f"{day:%b} {day.day}, {day.year}"  # portable (no %-d on Windows)


def map_url(template: Optional[str], geo: GeocodeResult) -> Optional[str]:
    if not template or not geo.ok:
        return template
    return template.format(lat=f"{geo.lat:.6f}", lon=f"{geo.lon:.6f}")


def evaluate_tract_datasets(conn, geo: GeocodeResult, today: dt.date) -> List[DesignationResult]:
    results = []
    for ds in db.datasets(conn):
        if ds["membership"] not in ("listed", "flag"):
            continue
        r = DesignationResult(
            dataset_id=ds["dataset_id"], program=ds["program"], name=ds["name"],
            round_label=ds["round_label"] or ds["name"], tract_vintage=ds["tract_vintage"],
            geocoder_vintage=ds["geocoder_vintage"], vintage_date=ds["vintage_date"],
            is_sample=bool(ds["is_sample"]), source_url=ds["source_url"], source_file=ds["source_file"],
            period_note=ds["period_note"], map_label=ds["map_label"],
            map_url=map_url(ds["map_url_template"], geo),
        )
        start, end = ds["effective_date"], ds["expires_date"]
        overrides = json.loads(ds["expires_by_state_fips"] or "{}")
        if geo.state_fips and geo.state_fips in overrides:
            end = overrides[geo.state_fips]
        r.effective_date, r.expires_date = start, end
        r.period_status = _period_status(today, start, end)

        tract = geo.tract(ds["geocoder_vintage"])
        if tract is None or not tract.geoid:
            r.problem = (tract.error if tract else None) or "no census tract available for this location"
            results.append(r)
            continue
        r.geoid_used, r.vintage_used, r.vintage_mismatch = tract.geoid, tract.vintage_used, tract.mismatch
        rec, matched, alias = db.lookup_with_aliases(conn, ds, tract.geoid)
        r.geoid_matched, r.alias_note = matched, alias
        if rec is not None:
            r.in_dataset = True
            r.qualifies = bool(rec["qualifies"])
            r.category, r.flags, r.extra = rec["category"], rec["flags"], rec["extra"]
        elif ds["membership"] == "listed":
            r.qualifies = False  # not on the designation list
        else:
            r.qualifies = None
            r.problem = f"tract {tract.geoid} is not in this dataset (verify manually)"
        results.append(r)
    return results


def qoz_verdict(results: List[DesignationResult]) -> QozVerdict:
    qoz = [r for r in results if r.program == "QOZ"]
    if not qoz:
        return QozVerdict("UNKNOWN", [], "No Opportunity Zone list is loaded (run build_data.py).", True)
    unverified = any(r.vintage_mismatch or r.is_sample for r in qoz)
    live = [r for r in qoz if r.qualifies and r.period_status != "expired"]
    if live:
        parts = []
        for r in live:
            if r.period_status == "not_yet_effective":
                parts.append(f"{r.round_label} (designated; takes effect {_fmt(r.effective_date)}, runs to {_fmt(r.expires_date)})")
            else:
                parts.append(f"{r.round_label} (in effect through {_fmt(r.expires_date)})")
        return QozVerdict("YES", live, "Designated in the " + " and the ".join(parts) + ".", unverified)
    if any(r.qualifies is None for r in qoz) and not any(r.qualifies for r in qoz):
        return QozVerdict("UNKNOWN", [], "The tract could not be checked against every Opportunity Zone list.", True)
    expired = [r for r in qoz if r.qualifies and r.period_status == "expired"]
    note = ""
    if expired:
        note = " Previously designated in the " + ", ".join(r.round_label for r in expired) + ", now expired."
    rounds = ", ".join(r.round_label for r in qoz)
    return QozVerdict("NO", [], f"Not in a tract designated for any current or upcoming round ({rounds} checked).{note}",
                      unverified)
