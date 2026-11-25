"""Turn a downloaded spreadsheet (xlsx, xlsb, csv) into tract records."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Sequence, Tuple, Union

SheetRef = Union[int, str]


def normalize_geoid(value) -> Optional[str]:
    """Return an 11-digit tract GEOID or None.

    Handles text with leading zeros, numbers that lost them (1001020100 -> '01001020100'),
    floats from spreadsheets (1001020100.0) and stray whitespace or punctuation.
    """
    if value is None:
        return None
    if isinstance(value, float):
        if value != value:  # NaN
            return None
        value = str(int(value))
    s = re.sub(r"\D", "", str(value).strip())
    if not s or len(s) > 11:
        return None
    s = s.zfill(11)
    return s if len(s) == 11 else None


def _norm_header(h) -> str:
    return re.sub(r"\s+", " ", str(h or "")).strip().lower()


def read_rows(path: Path, fmt: str, sheet: SheetRef = 0) -> List[List]:
    fmt = fmt.lower()
    if fmt == "xlsx":
        import openpyxl

        wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
        ws = wb.worksheets[sheet] if isinstance(sheet, int) else wb[sheet]
        rows = [list(r) for r in ws.iter_rows(values_only=True)]
        wb.close()
        return rows
    if fmt == "xlsb":
        from pyxlsb import open_workbook

        with open_workbook(str(path)) as wb:
            name = wb.sheets[sheet] if isinstance(sheet, int) else sheet
            with wb.get_sheet(name) as ws:
                return [[c.v for c in row] for row in ws.rows()]
    if fmt == "csv":
        with open(path, newline="", encoding="utf-8-sig") as fh:
            return [row for row in csv.reader(fh)]
    raise ValueError(f"unsupported format {fmt!r}")


def find_header(rows: Sequence[Sequence], geoid_header: str, scan: int = 30) -> Tuple[int, List[str]]:
    """Locate the header row: the first row with a cell matching the GEOID column name."""
    want = _norm_header(geoid_header)
    for i, row in enumerate(rows[:scan]):
        cells = [_norm_header(c) for c in row]
        if any(c == want or c.startswith(want) or c.endswith(want) for c in cells):
            return i, cells
    raise ValueError(f"no header row containing {geoid_header!r} in the first {scan} rows")


def resolve_columns(header: List[str], wanted: Dict[str, str]) -> Dict[str, int]:
    """Map logical names to column indexes: exact match, then prefix, then suffix, then substring."""
    out: Dict[str, int] = {}
    for key, label in wanted.items():
        want = _norm_header(label)
        idx = None
        for test in (lambda c: c == want, lambda c: c.startswith(want), lambda c: c.endswith(want),
                     lambda c: want in c):
            hits = [i for i, c in enumerate(header) if c and test(c)]
            if hits:
                idx = hits[0]
                break
        if idx is None:
            raise ValueError(f"column {label!r} ({key}) not found; header is {header}")
        out[key] = idx
    return out


def _cell(row: Sequence, idx: Optional[int]):
    if idx is None or idx >= len(row):
        return None
    v = row[idx]
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def iter_records(ds: dict, rows: List[List]) -> Iterator[dict]:
    """Yield dicts with geoid, qualifies, category, state, county, flags, extra for one dataset."""
    cols = ds["columns"]
    header_idx, header = find_header(rows, cols["geoid"])
    idx = resolve_columns(header, cols)
    extra_idx = resolve_columns(header, ds.get("extra_columns", {}))
    flag_specs = ds.get("flags", {})
    flag_idx = resolve_columns(header, {k: v["column"] for k, v in flag_specs.items()})
    true_vals = {str(v).strip().upper() for v in ds.get("qualifies_true_values", ["YES", "Y", "TRUE", "1"])}

    for row in rows[header_idx + 1:]:
        geoid = normalize_geoid(_cell(row, idx["geoid"]))
        if not geoid:
            continue
        if ds["membership"] == "flag":
            raw = _cell(row, idx["qualifies"])
            qualifies = str(raw).strip().upper() in true_vals if raw is not None else False
        else:
            qualifies = True
        flags = {}
        for name, spec in flag_specs.items():
            val = _cell(row, flag_idx[name])
            flags[name] = val is not None and str(val).strip().upper() in {str(t).upper() for t in spec["true_values"]}
        yield {
            "geoid": geoid,
            "qualifies": qualifies,
            "category": _cell(row, idx.get("category")),
            "state": _cell(row, idx.get("state")),
            "county": _cell(row, idx.get("county")),
            "flags": flags,
            "extra": {k: _cell(row, i) for k, i in extra_idx.items()},
        }


def supplement_geoids(sup: dict, rows: List[List]) -> List[str]:
    header_idx, header = find_header(rows, sup["geoid_column"])
    gi = resolve_columns(header, {"geoid": sup["geoid_column"]})["geoid"]
    out = []
    for row in rows[header_idx + 1:]:
        g = normalize_geoid(_cell(row, gi))
        if g:
            out.append(g)
    return out


def to_db_rows(ds: dict, records: Iterable[dict], vintage_date: Optional[str]) -> Iterator[tuple]:
    for r in records:
        yield (
            r["geoid"], ds["name"], vintage_date, 1 if r["qualifies"] else 0, r["category"],
            r["state"], r["county"], json.dumps(r["flags"], sort_keys=True),
            json.dumps(r["extra"], sort_keys=True, default=str),
        )
