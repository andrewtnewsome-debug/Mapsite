"""Theatrical profitability model.

Every assumption lives in config/assumptions.json. The dashboard runs a line-for-line
JavaScript port (dashboard_src/model.js) so the assumptions panel can recompute live;
tests/test_js_parity.py checks that both give the same numbers.

    rentals   = domestic x 52%  +  international ex-China x 40%  +  China x 25%
                (no China split: all international x 40% blended)
    P&A       = by budget tier: <$10M 50% of budget, $10-40M $12M, $40-100M $25M,
                $100-200M $40M, >$200M $55M
    profit    = rentals - production budget - P&A
    ROI       = profit / (budget + P&A)

Theatrical estimate only. Excludes streaming, home entertainment, TV licensing,
merchandising, participations, and residuals.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from common import ASSUMPTIONS_JSON, CPI_CSV

DISCLAIMER = ("Theatrical estimate only. Excludes streaming, home entertainment, TV licensing, "
              "merchandising, participations, and residuals.")

RATE_KEYS = ("domestic", "international_ex_china", "china", "international_blended", "worldwide_only")


# ---------------------------------------------------------------- loading
def load_assumptions(path: Path = ASSUMPTIONS_JSON) -> dict:
    with open(path, encoding="utf-8") as handle:
        assumptions = json.load(handle)
    validate_assumptions(assumptions)
    return assumptions


def validate_assumptions(a: dict) -> None:
    rates = a.get("rental_rates") or {}
    for key in RATE_KEYS:
        value = rates.get(key)
        if not isinstance(value, (int, float)) or not 0 <= value <= 1:
            raise ValueError(f"rental_rates.{key} must be a fraction between 0 and 1, got {value!r}")
    if a.get("pa_tiers_basis", "real") not in ("real", "nominal"):
        raise ValueError("pa_tiers_basis must be 'real' or 'nominal'")
    tiers = a.get("pa_tiers") or []
    if not tiers:
        raise ValueError("pa_tiers is empty")
    previous = -1
    for i, tier in enumerate(tiers):
        bound = tier.get("max_budget")
        last = i == len(tiers) - 1
        if last and bound is not None:
            raise ValueError("the last P&A tier must have max_budget null (no upper bound)")
        if not last and (not isinstance(bound, (int, float)) or bound <= previous):
            raise ValueError(f"pa_tiers[{i}].max_budget must be a number above the previous tier's")
        if tier.get("kind") not in ("flat", "percent_of_budget"):
            raise ValueError(f"pa_tiers[{i}].kind must be 'flat' or 'percent_of_budget'")
        if not isinstance(tier.get("value"), (int, float)) or tier["value"] < 0:
            raise ValueError(f"pa_tiers[{i}].value must be a non-negative number")
        previous = bound if bound is not None else previous


def load_cpi(path: Path = CPI_CSV) -> dict[int, float]:
    with open(path, newline="", encoding="utf-8") as handle:
        return {int(row["year"]): float(row["cpi_u_annual_avg"]) for row in csv.DictReader(handle)}


class Inflation:
    """Converts nominal dollars of a release year into latest-CPI-year dollars."""

    def __init__(self, cpi: dict[int, float]):
        self.cpi = cpi
        self.first_year = min(cpi)
        self.latest_year = max(cpi)

    def factor(self, year: int | None) -> float:
        if year is None or year >= self.latest_year:
            return 1.0  # films after the last CPI year are treated as latest-year dollars
        year = max(year, self.first_year)
        return self.cpi[self.latest_year] / self.cpi[year]


# ---------------------------------------------------------------- model pieces
def tier_index(budget_basis: float, tiers: list[dict]) -> int:
    for i, tier in enumerate(tiers):
        bound = tier.get("max_budget")
        if bound is None:
            return i
        if budget_basis < bound or (tier.get("max_inclusive", True) and budget_basis == bound):
            return i
    return len(tiers) - 1


def pa_estimate(budget: int | None, year: int | None, a: dict, inflation: Inflation) -> tuple[float | None, int | None]:
    """Return (P&A in nominal dollars of the release year, tier index)."""
    if budget is None:
        return None, None
    factor = inflation.factor(year) if a.get("pa_tiers_basis", "real") == "real" else 1.0
    basis = budget * factor
    index = tier_index(basis, a["pa_tiers"])
    tier = a["pa_tiers"][index]
    if tier["kind"] == "percent_of_budget":
        pa_basis = basis * tier["value"]
    else:
        pa_basis = float(tier["value"])
    return pa_basis / factor, index


def rentals(fin: dict, a: dict) -> dict:
    """Studio share of box office under the rental-rate assumptions."""
    r = a["rental_rates"]
    dom, intl = fin.get("domestic_gross"), fin.get("international_gross")
    ww, china = fin.get("worldwide_gross"), fin.get("china_gross")
    out = {"domestic": None, "international": None, "china": None, "total": None, "method": None}
    if dom is not None and intl is not None:
        out["domestic"] = dom * r["domestic"]
        if china is not None and china <= intl:
            out["international"] = (intl - china) * r["international_ex_china"]
            out["china"] = china * r["china"]
            out["method"] = "china_split"
        else:
            out["international"] = intl * r["international_blended"]
            out["china"] = 0.0
            out["method"] = "blended"
        out["total"] = out["domestic"] + out["international"] + out["china"]
    elif ww is not None:
        out["total"] = ww * r["worldwide_only"]
        out["method"] = "worldwide_only"
    elif dom is not None:
        out["domestic"] = dom * r["domestic"]
        out["total"] = out["domestic"]
        out["method"] = "domestic_only"
    return out


def compute(fin: dict, year: int | None, a: dict, inflation: Inflation) -> dict:
    """All derived metrics for one film, in nominal dollars (ratios are inflation-free)."""
    budget = fin.get("production_budget")
    ww = fin.get("worldwide_gross")
    dom = fin.get("domestic_gross")
    opening = fin.get("opening_weekend_domestic")
    rent = rentals(fin, a)
    pa, tier = pa_estimate(budget, year, a, inflation)

    m = {
        "rentals_domestic": rent["domestic"],
        "rentals_international": rent["international"],
        "rentals_china": rent["china"],
        "rentals_total": rent["total"],
        "rental_method": rent["method"],
        "effective_rental_rate": None,
        "pa_estimate": pa,
        "budget_tier": tier,
        "total_cost": None,
        "est_profit": None,
        "est_roi": None,
        "profitable": None,
        "gross_multiple": None,
        "breakeven_worldwide_gross": None,
        "breakeven_multiple": None,
        "opening_multiplier": None,
    }
    if ww and rent["total"] is not None:
        m["effective_rental_rate"] = rent["total"] / ww
    if budget:
        m["total_cost"] = budget + pa
        if ww is not None:
            m["gross_multiple"] = ww / budget
        if rent["total"] is not None:
            m["est_profit"] = rent["total"] - budget - pa
            m["est_roi"] = m["est_profit"] / m["total_cost"]
            m["profitable"] = m["est_profit"] > 0
        rate = m["effective_rental_rate"] or a["rental_rates"]["worldwide_only"]
        if rate > 0:
            m["breakeven_worldwide_gross"] = m["total_cost"] / rate
            m["breakeven_multiple"] = m["breakeven_worldwide_gross"] / budget
    if dom is not None and opening:
        m["opening_multiplier"] = dom / opening
    return m


def describe(a: dict, inflation: Inflation | None = None) -> str:
    """One-line human summary of the active assumptions (also shown in the dashboard)."""
    r = a["rental_rates"]
    pct = lambda x: f"{x * 100:g}%"
    money = lambda x: f"${x / 1e6:g}M"
    tiers = []
    for t in a["pa_tiers"]:
        value = pct(t["value"]) + " of budget" if t["kind"] == "percent_of_budget" else money(t["value"])
        tiers.append(f"{t['label']}: {value}")
    basis = ""
    if a.get("pa_tiers_basis", "real") == "real" and inflation:
        basis = f" (tiers in {inflation.latest_year} dollars)"
    return (f"Rentals: domestic {pct(r['domestic'])}, international {pct(r['international_blended'])} "
            f"(ex-China {pct(r['international_ex_china'])}, China {pct(r['china'])} where split known). "
            f"P&A{basis}: " + "; ".join(tiers) + ".")
