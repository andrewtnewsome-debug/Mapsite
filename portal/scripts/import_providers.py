"""
Load capital providers from the Minority Business Investor Database workbook into data/seed.json.

    python3 scripts/import_providers.py path/to/Minority_Business_Investor_Database.xlsx

Numbers, notes, sources and status come straight from the workbook. The matching fields the
workbook only describes in prose (capital types, uses of funds, sectors, states, ownership rules)
come from MAPPING below; every judgment call is listed in that provider's "interpretations" so
the team can see it on the provider page and correct it here.
"""

import json
import re
import sys
from pathlib import Path

import openpyxl

SHEETS = ["Acquisition & Growth", "Community Credit", "Verify & Indirect"]
SEED = Path(__file__).resolve().parent.parent / "data" / "seed.json"

ALL_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
    "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
    "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
    "WV", "WI", "WY",
]


def all_but(*excluded):
    return [s for s in ALL_STATES if s not in excluded]


# Census South: 16 states plus DC, Delaware to Texas.
SOUTH = ["DE", "MD", "DC", "VA", "WV", "NC", "SC", "GA", "FL", "KY", "TN", "AL", "MS", "AR", "LA", "OK", "TX"]
MID_ATLANTIC = ["DE", "MD", "DC", "NJ", "NY", "PA", "VA", "WV"]

DEBT_ALL = ["acquisition", "growth", "refinance", "working_capital", "equipment", "real_estate"]

# Defaults: geographies ["National"], no "confirm" states, no ownership rule, no sector limits.
# capital: senior_debt | sba_7a | mezzanine | revenue_based | minority_equity | majority_equity
# uses / uses_confirm: acquisition | growth | refinance | recap | working_capital | equipment | real_estate
# ownership: none | minority | minority_or_women | specific
MAPPING = {
    "AG01": dict(capital=["mezzanine", "minority_equity", "majority_equity"],
                 uses=["growth", "acquisition", "recap", "refinance"],
                 sectors=["54", "56", "31-33", "62"],
                 notes=["\"Tailored junior capital\" read as mezzanine plus minority or majority equity.",
                        "Business services mapped to professional (54) and admin/facility services (56); consumer products and specialty manufacturing to manufacturing (31-33)."]),
    "AG02": dict(capital=["minority_equity", "majority_equity"],
                 uses=["growth", "acquisition", "recap"],
                 sectors=["54", "56", "31-33", "62"],
                 geo_confirm="Company must be located in a Qualified Opportunity Zone",
                 notes=["Opportunity Zone location can't be checked from the submission, so every match is flagged to confirm."]),
    "AG03": dict(capital=["senior_debt", "mezzanine", "minority_equity"],
                 uses=["growth", "acquisition", "recap"],
                 sectors=["54", "56", "31-33", "62", "52"],
                 excluded=["53"], min_years=2,
                 notes=["Published EBITDA screen is strictly greater than $1M; entered as a $1M floor.",
                        "\"Startups\" exclusion entered as at least 2 years in business.",
                        "Preferred equity read as minority equity."]),
    "AG04": dict(capital=["mezzanine", "minority_equity"],
                 uses=["growth", "acquisition"],
                 sectors=["48-49", "54"], ownership="minority",
                 notes=["Sectors are observed investments, not a published mandate.",
                        "Fund is for established minority-owned businesses, so minority ownership is required."]),
    "AG05": dict(capital=["majority_equity"], uses=["acquisition", "recap", "growth"],
                 sectors=["54", "56", "62"],
                 notes=["Government contracting mapped to professional services (54).",
                        "EBITDA up to $25M is selective; typical deals are smaller."]),
    "AG06": dict(capital=["majority_equity"], uses=["acquisition"],
                 sectors=["54", "22", "52", "51"],
                 notes=["North America entered as national.",
                        "Targets need not be minority-owned before investment."]),
    "AG07": dict(capital=["minority_equity", "majority_equity"], uses=["acquisition"],
                 notes=["Acquisition equity for searchers; investor stake is negotiated, so both minority and majority equity are allowed."]),
    "AG08": dict(capital=["minority_equity"], uses=["growth"], uses_confirm=["acquisition"],
                 sectors=["54", "56", "62", "31-33", "23", "51", "42"],
                 geos=MID_ATLANTIC, geo_confirm_states=all_but(*MID_ATLANTIC), ownership="minority_or_women",
                 notes=["\"Primarily Mid-Atlantic\" read as DE, MD, DC, NJ, NY, PA, VA, WV; other states flagged to confirm.",
                        "Minority- or women-owned required; a non-minority submission is flagged to confirm women ownership."]),
    "AG09": dict(capital=["senior_debt", "mezzanine", "minority_equity", "majority_equity"],
                 uses=["acquisition", "growth"],
                 geos=["OH", "IN", "KY", "TN", "WV"], geo_confirm_states=["MI", "PA", "IL", "MO", "VA", "NC"], ownership="minority",
                 notes=["Six-hour radius of Cincinnati read as OH, IN, KY, TN, WV; MI, PA, IL, MO, VA and NC flagged to confirm.",
                        "Check size: $250K absolute minimum; typical $1M to $2.5M; maximum is 10% of committed capital, so no maximum entered."],
                 check_min=0.25, check_max=None),
    "AG10": dict(capital=["senior_debt", "mezzanine", "minority_equity"],
                 uses=["acquisition", "recap", "refinance", "growth"],
                 sectors=["62", "61", "54", "56", "51"],
                 notes=["Structured equity read as minority equity."]),
    "AG11": dict(capital=["senior_debt", "mezzanine", "minority_equity"],
                 uses=["growth", "acquisition", "recap"],
                 sectors=["31-33", "54", "56", "72", "51", "62"],
                 geos=ALL_STATES, min_years=3,
                 notes=["Construction exclusion is from 2015 material; not applied, confirm with the fund.",
                        "Puerto Rico is also eligible."]),
    "AG12": dict(capital=["minority_equity", "majority_equity"], uses=["acquisition", "growth"],
                 sectors=["48-49", "52", "56", "54"],
                 notes=["No size criteria published; check size and EBITDA always flagged to confirm."]),
    "AG13": dict(capital=["majority_equity"], uses=["acquisition", "recap"],
                 sectors=["22", "54"],
                 notes=["Add-on acquisitions can start at $1M EBITDA; platform floor of $2M entered."]),
    "AG14": dict(capital=["minority_equity", "majority_equity"], uses=["acquisition", "recap", "growth"],
                 sectors=["44-45", "62", "31-33", "54", "56", "42"], ownership="minority_or_women",
                 notes=["Women- or minority-owned or led businesses only."]),
    "AG15": dict(capital=["minority_equity"], uses=["growth"], uses_confirm=["acquisition"],
                 sectors=["23", "48-49", "22", "31-33", "42", "54", "56"],
                 geos=SOUTH, ownership="minority_or_women", min_years=3,
                 notes=["\"16-state area from Delaware to Texas\" read as the Census South (16 states plus DC); confirm the exact list with the fund.",
                        "EBITDA ceiling and check size are from 2022 launch materials."]),
    "AG16": dict(capital=["senior_debt"], uses=["working_capital", "equipment", "growth", "acquisition"],
                 positive_ebitda=True, min_years=2,
                 notes=["Requires positive EBITDA; no dollar floor published."]),
    "AG18": dict(capital=["majority_equity"], uses=["acquisition", "recap"],
                 sectors=["31-33", "23", "48-49", "56", "11"],
                 notes=["Employee-ownership (ESOP) buyouts only; the seller must want to sell to employees.",
                        "Requires at least 40 employees (not checked automatically)."]),
    "AG19": dict(capital=["revenue_based", "mezzanine"], uses=["growth"], uses_confirm=["acquisition"],
                 sectors=["31-33", "51", "54"], geo_confirm="Company must be in an underserved or qualifying impact location",
                 notes=["Revenue screen conflicts ($5M vs $10M); the lower $5M entered.",
                        "Royalty-enhanced debt read as revenue-based financing or mezzanine."],
                 revenue_min=5),
    "AG20": dict(capital=["revenue_based"], uses=["growth", "working_capital"], uses_confirm=["acquisition"],
                 sectors=["54", "56"], geos=all_but("FL", "TX", "CT", "NV"),
                 notes=["FL, TX, CT and NV are temporarily excluded per their FAQ."]),
    "AG21": dict(capital=["mezzanine", "revenue_based", "minority_equity"], uses=["growth", "acquisition"],
                 sectors=["62"], positive_ebitda=True,
                 notes=["Preferred equity requires a profitable business; entered as positive EBITDA."]),
    "AG25": dict(capital=["mezzanine", "minority_equity", "majority_equity"], uses=["growth", "acquisition", "recap"],
                 sectors=["62", "51", "54", "56", "31-33"], min_years=2,
                 notes=["\"Startups\" exclusion entered as at least 2 years in business."]),
    "AG26": dict(capital=["senior_debt", "mezzanine", "minority_equity"], uses=["acquisition", "growth", "recap"],
                 uses_confirm=["refinance"], sectors=["54", "56", "62", "31-33", "61", "44-45"],
                 notes=["US and Canada entered as national.", "Check size may describe total facility, not Avante's hold."]),
    "AG27": dict(capital=["senior_debt", "mezzanine"], uses=["acquisition"],
                 uses_confirm=["growth", "refinance", "recap"], excluded=["44-45", "72"],
                 notes=["Consumer discretionary exclusion mapped to retail (44-45) and food service (72); commodities not mapped."]),
    "AG28": dict(capital=["majority_equity"], uses=["acquisition", "growth"],
                 sectors=["23", "51", "54"],
                 notes=["North America entered as national."]),
    "CC01": dict(capital=["senior_debt"], uses=["working_capital", "equipment", "refinance", "growth"],
                 uses_confirm=["acquisition"],
                 notes=["Existing borrowers may qualify for up to $1M."]),
    "CC02": dict(capital=["senior_debt"], uses=["working_capital", "refinance", "equipment", "real_estate"],
                 uses_confirm=["acquisition"], geos=["FL", "GA"], min_years=1,
                 notes=["Service area read as FL and GA; confirm whether the loan reaches other states."]),
    "CC03": dict(capital=["senior_debt"], uses=DEBT_ALL),
    "CC04": dict(capital=["senior_debt"], uses=["working_capital", "growth"], uses_confirm=["acquisition"],
                 geos=["NY", "NJ", "GA", "AL", "LA", "TX"], min_years=1,
                 notes=["Core lending states entered; some programs reach further, so ask about other states."]),
    "CC05": dict(capital=["senior_debt"], uses=["working_capital", "growth", "equipment", "real_estate", "acquisition"],
                 sectors=["31-33", "22", "42", "62", "51", "54", "48-49"], geos=["OH"],
                 notes=["Ohio focus entered as Ohio only; confirm the exact service area."]),
    "CC06": dict(capital=["senior_debt"], uses=["growth", "working_capital"], uses_confirm=["acquisition"], geos=["NC"]),
    "CC07": dict(capital=["senior_debt"], uses=["working_capital", "equipment", "growth"], uses_confirm=["acquisition"],
                 geos=["OH"], geo_confirm_states=["IN", "KY", "WV", "PA", "MI"],
                 notes=["Published loan sizes conflict, so no check size entered.", "Ohio-centered regional footprint; neighboring IN, KY, WV, PA and MI flagged to confirm."]),
    "CC08": dict(capital=["senior_debt"], uses=["working_capital", "growth"], uses_confirm=["acquisition"],
                 geos=all_but("DC", "VT", "SD", "ND", "MT", "TN"), min_years=2),
    "CC09": dict(capital=["sba_7a"], uses=["acquisition", "growth", "equipment", "real_estate"], min_years=2,
                 notes=["Two-year operating rule has exceptions for acquisitions."]),
    "CC10": dict(capital=["senior_debt"], uses=["growth", "working_capital"], uses_confirm=["acquisition"],
                 geos=["DC", "MD", "VA"], excluded=["53"], min_years=2,
                 notes=["Puerto Rico is also eligible.", "Real-estate businesses excluded; liquor stores also excluded (not mapped)."]),
    "CC11": dict(capital=["senior_debt"], uses=["working_capital", "equipment", "refinance", "growth"],
                 uses_confirm=["acquisition"], geos=all_but("VT")),
    "CC12": dict(capital=["senior_debt"], uses=["working_capital", "equipment", "growth"], uses_confirm=["acquisition"],
                 geos=["AL", "AZ", "CA", "CO", "FL", "GA", "IL", "IA", "KS", "LA", "MI", "MS", "MO", "NE", "NV", "NM",
                       "NY", "NC", "OH", "OK", "PA", "SC", "TN", "TX", "UT", "WA", "WY"]),
    "CC13": dict(capital=["senior_debt", "mezzanine"], uses=DEBT_ALL,
                 geos=["NC", "WV"], geo_confirm_states=["VA", "KY", "TN"],
                 notes=["NC and WV entered; central Appalachian VA, KY and TN flagged to confirm."]),
    "CC14": dict(capital=["senior_debt"], uses=["working_capital", "equipment", "acquisition"], geos=["NC"],
                 notes=["Larger requests are referred to partner lenders."]),
    "CC15": dict(capital=["senior_debt", "sba_7a"], uses=["acquisition", "real_estate", "equipment", "working_capital", "growth"],
                 ownership="specific", ownership_label="Native American or tribal ownership"),
    "CC16": dict(capital=["senior_debt"], uses=["growth", "working_capital"], uses_confirm=["acquisition"],
                 sectors=["11", "31-33", "42", "72"], sectors_only=True,
                 geos=["ME", "NH", "VT", "RI", "MA", "NY", "CT", "NJ", "PA"],
                 ownership="specific", ownership_label="Black ownership",
                 notes=["Food and agriculture only: mapped to agriculture (11), food manufacturing (31-33), food distribution (42) and restaurants (72)."]),
    "CC17": dict(capital=["senior_debt"], uses=["growth", "working_capital"], uses_confirm=["acquisition"],
                 ownership="specific", ownership_label="Indigenous or tribal ownership"),
    "CC18": dict(capital=["senior_debt"], uses=["real_estate", "equipment", "working_capital"], uses_confirm=["acquisition"],
                 geos=["OK"], geo_confirm_states=all_but("OK"), ownership="specific", ownership_label="Native ownership (Citizen Potawatomi Nation members nationwide)",
                 notes=["Oklahoma entered; Citizen Potawatomi Nation members are eligible in any state."]),
    "VI03": dict(capital=["minority_equity"], uses=["growth"], uses_confirm=["acquisition"],
                 ownership="minority_or_women",
                 notes=["Listed as a research lead: deployable capital not verified."]),
}


def num(v):
    return None if v in (None, "") else round(float(v) * 1_000_000)


def first_url(v):
    m = re.search(r'"(https?://[^"]+)"', str(v or "")) or re.search(r"(https?://\S+)", str(v or ""))
    return m.group(1) if m else None


def main(path):
    wb = openpyxl.load_workbook(path)
    providers = []
    for sheet in SHEETS:
        rows = list(wb[sheet].iter_rows(values_only=True))
        header = rows[5]
        for row in rows[6:]:
            if not row[0]:
                continue
            r = dict(zip(header, row))
            pid = r["ID"]
            m = MAPPING.get(pid)
            if m is None:
                raise SystemExit(f"No MAPPING entry for {pid}; add one before importing.")
            ownership = m.get("ownership", "none")
            providers.append({
                "id": f"prov_{pid.lower()}",
                "ref": pid,
                "name": r["Investor / manager"],
                "fund": r["Fund / strategy"],
                "category": sheet,
                "type": r["Capital provider type"],
                "relevance": r["Relevance to minority businesses"],
                "capitalTypes": m["capital"],
                "checkMin": num(m["check_min"]) if "check_min" in m else num(r["Check min (USD m)"]),
                "checkMax": num(m["check_max"]) if "check_max" in m else num(r["Check max (USD m)"]),
                "checkNote": r["Check-size basis / caveat"] or "",
                "ebitdaMin": num(r["EBITDA min (USD m)"]),
                "ebitdaMax": num(r["EBITDA max (USD m)"]),
                "requiresPositiveEbitda": m.get("positive_ebitda", False),
                "ebitdaNote": r["EBITDA basis / caveat"] or "",
                "revenueMin": num(m["revenue_min"]) if "revenue_min" in m else None,
                "revenueMax": None,
                "revenueNote": r["Revenue / other size screen"] or "",
                "minYears": m.get("min_years"),
                "maxLeverage": None,
                "geographies": m.get("geos", ["National"]),
                "geographiesConfirm": m.get("geo_confirm_states", []),
                "geographyConfirm": m.get("geo_confirm"),
                "geographyNote": r["Geography"] or "",
                "sectorsPreferred": m.get("sectors", []),
                "sectorsOnly": m.get("sectors_only", False),
                "sectorsExcluded": m.get("excluded", []),
                "industriesNote": r["Industries preferred / observed"] or "",
                "exclusionsNote": r["Published exclusions"] or "",
                "useOfFunds": m["uses"],
                "useOfFundsConfirm": m.get("uses_confirm", []),
                "strategyNote": r["Investment strategy / uses"] or "",
                "ownershipRequirement": ownership,
                "ownershipLabel": m.get("ownership_label"),
                "ownershipNote": r["Minority / impact eligibility"] or "",
                "controlNote": r["Ownership / control"] or "",
                "acquisitionNote": r["Acquisition / ETA appetite"] or "",
                "diverseFocus": str(r["Relevance to minority businesses"] or "").startswith(("Explicit", "Creates", "Verify")),
                "status": r["Status / availability evidence"] or "",
                "nextQuestion": r["Diligence gap / next question"] or "",
                "sourceQuality": r["Source quality"] or "",
                "sources": [u for u in (first_url(r[k]) for k in ("Criteria / strategy source", "Mandate / context source", "Additional source")) if u],
                "researchChecked": str(r["Research checked"])[:10] if r["Research checked"] else None,
                "interpretations": m.get("notes", []),
                "contact": None,
            })
    # Revenue screens that are plain ranges in the workbook text.
    revenue_ranges = {"AG01": (10, 200), "AG02": (10, 200), "AG03": (5, None), "AG08": (2, 20), "AG11": (5, 100),
                      "AG14": (10, None), "AG15": (2, None), "AG16": (None, 150), "AG20": (0.5, None), "AG21": (4, None),
                      "AG25": (10, 100), "AG26": (10, 100), "AG28": (20, None), "CC04": (0.2, None), "CC08": (0.3, None)}
    for p in providers:
        if p["ref"] in revenue_ranges:
            lo, hi = revenue_ranges[p["ref"]]
            p["revenueMin"], p["revenueMax"] = num(lo), num(hi)

    seed = json.loads(SEED.read_text())
    seed["providers"] = providers
    SEED.write_text(json.dumps(seed, indent=2) + "\n")
    print(f"Wrote {len(providers)} providers to {SEED}")


if __name__ == "__main__":
    main(sys.argv[1])
