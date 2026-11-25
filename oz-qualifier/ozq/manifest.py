"""Reads data/sources.json, the list of designation datasets."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List

from .paths import MANIFEST_PATH

PROGRAMS = {"QOZ", "NMTC", "HUBZONE"}
TRACT_FILE_REQUIRED = ["id", "program", "name", "tract_vintage", "geocoder_vintage", "local_file",
                       "format", "membership", "columns"]


class ManifestError(ValueError):
    pass


def load_manifest(path: Path = MANIFEST_PATH, include_disabled: bool = False) -> List[dict]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    out = []
    seen = set()
    for ds in data.get("datasets", []):
        if not include_disabled and not ds.get("enabled", True):
            continue
        ds.setdefault("method", "tract_file")
        if ds["id"] in seen:
            raise ManifestError(f"duplicate dataset id {ds['id']}")
        seen.add(ds["id"])
        if ds.get("program") not in PROGRAMS:
            raise ManifestError(f"{ds['id']}: program must be one of {sorted(PROGRAMS)}")
        if ds["method"] == "tract_file":
            missing = [k for k in TRACT_FILE_REQUIRED if not ds.get(k)]
            if missing:
                raise ManifestError(f"{ds['id']}: missing {missing}")
            if "geoid" not in ds["columns"]:
                raise ManifestError(f"{ds['id']}: columns.geoid is required")
            if ds["membership"] == "flag" and "qualifies" not in ds["columns"]:
                raise ManifestError(f"{ds['id']}: membership 'flag' needs columns.qualifies")
        out.append(ds)
    return out


def tract_datasets(manifest: List[dict]) -> List[dict]:
    return [d for d in manifest if d.get("method") == "tract_file"]


def required_geocoder_vintages(manifest: List[dict]) -> List[str]:
    """Every Census Geocoder vintage some dataset needs, in a stable order."""
    seen: List[str] = []
    for d in tract_datasets(manifest):
        v = d["geocoder_vintage"]
        if v not in seen:
            seen.append(v)
    return seen
