# oz-qualifier

A local screening tool. Give it a company website or a street address, and in under a minute it says whether the location sits in a designated **Qualified Opportunity Zone**, which designation round that comes from, and whether the location is **NMTC-eligible** or in a **HUBZone**. It also lists the state's incentive programs worth researching. Each location gets a one-page HTML report under `reports/`.

> This is a screening tool. It is not tax, legal, or investment advice, and any Opportunity Zone structure must be confirmed with qualified counsel and against the CDFI Fund's official records before reliance.

## Quick start

```bash
pip install -r requirements.txt          # Python 3.9+; requests, beautifulsoup4, lxml, openpyxl, pyxlsb
python build_data.py                     # downloads the official lists into data/designations.sqlite (~10 s)
python qualify.py --address "9500 Euclid Ave, Cleveland, OH 44195"
python qualify.py --website https://www.greatlakesbrewing.com
python qualify.py --serve                # the same checks from a web form at http://127.0.0.1:8765
```

`--serve` runs a small web form on your own computer (127.0.0.1 only). Type one or more addresses or a website and get the same verdicts and one-page reports, with exact-address geocoding and HUBZone included.

### Browser lookup page (nothing to install)

`web/index.html` is a static page that checks a **ZIP code**, a **street address** or a **census tract number** in the browser. Build its data with `python tools/build_web_data.py` (after `build_data.py`), then serve the `web/` folder or publish it. A ZIP is matched to its census tracts with the Census Bureau's ZIP Code Tabulation Area relationship files. The page shows how much of the ZIP's land is in 2018-round zones, 2027-round zones and NMTC tracts, tract by tract. A static page cannot geocode a street address, so for an address it screens the address's ZIP and links to the Census geocoder's result for the exact tract. Paste that tract number back in for the exact answer. HUBZone status is not checked there.

| Option | What it does |
|---|---|
| `--website URL` | Find the address(es) on the company site, then qualify each location |
| `--address "..."` | Qualify a street address (repeat for several). The most reliable path |
| `--name "..."` | Label for the report. On its own it prints instructions: the tool will not guess an address from a name |
| `--latlon 41.50,-81.62` | Qualify a point directly |
| `--yes` | Don't prompt. The report then says the address was **not confirmed** |
| `--offline` | Use only cached answers (geocoder, HUBZone, web pages) |
| `--today YYYY-MM-DD` | Evaluate designation periods as of another date |
| `--out DIR`, `--no-html`, `--no-hubzone`, `--max-locations N` | Output and scope controls |

In a terminal, the tool shows the address it found and the Census geocoder's match, and asks you to confirm or correct it before treating the verdict as final. Every report prints the address it actually used, where that address came from, and whether a person confirmed it.

## How it works

1. **Resolve the address.** `--website`: the tool fetches the homepage plus up to six contact, locations and about pages, and extracts US addresses. It reads schema.org data, visible text (anchored on "City, ST ZIP", walking back to the line with the house number), and map links. Candidates are scored by where they appear: contact page > locations page > footer > about page > other text. A site with several locations returns all of them, and each is qualified separately. JavaScript-only sites and PO-box-only sites are reported, not guessed at. A company name alone is refused, with instructions.
2. **Geocode to census tracts.** The US Census Bureau Geocoder (free, no key) matches the address once. Then it asks for the tract at that point **in each vintage the datasets need**:

   | Dataset | Tract boundaries | Geocoder vintage | Why |
   |---|---|---|---|
   | QOZ 2018 round | 2010 tracts | `Census2010_Current` | The 2018 list uses 2010 tracts. Boundaries stay fixed for the designation period (IRS Ann. 2021-10) |
   | QOZ 2027 round | 2020 tracts, CT planning regions | `ACS2024_Current` | Rev. Proc. 2026-14 fixes 2020 tract boundaries. The list uses Connecticut's 2022 county codes (`09110`...) |
   | NMTC (2016-2020 ACS) | 2020 tracts, old CT counties | `Census2020_Current` | The CDFI file uses 2020 tracts with pre-2022 Connecticut county codes |

   If a vintage lookup fails, the tool falls back to the current vintage and flags **"tract vintage mismatch, verify manually"**. The flag matters: one Cleveland address sits in 2010 tract `39035118700` but 2020 tract `39035196800`.
3. **Look up the designations** in SQLite. There is one table per dataset (`tracts_<id>`) keyed by 11-digit GEOID, and every row is stamped with the dataset name and vintage date. HUBZone status comes from a live, cached point lookup on SBA's official map (see Limits).
4. **State programs** come from the hand-maintained `state_incentives` table, currently seeded for OH, NC, GA, TX and CA.
5. **Report.** The console summary and HTML page contain the verdict, per-round detail, map links, other designations, state programs, a requirements checklist (on YES only) and a data-and-limits box.

**Verdict.** YES means the tract is on the list for a round whose designation period has not ended as of the report date. The report names the round, and whether it is in effect or upcoming. As of late 2026 both rounds count: the 2018 round runs through Dec 31, 2028, and the 2027 round runs Jan 1, 2027 to Dec 31, 2036. A tract only in an expired round is NO, with a note.

## Refreshing the data

| Dataset | Source | When it changes | How to refresh |
|---|---|---|---|
| `qoz_2018` | CDFI Fund `designated-qozs.12.14.18.xlsx` + Treasury rural list (Notice 2025-50) | Fixed until it expires on Dec 31, 2028 | `python build_data.py --refresh --only qoz_2018` |
| `qoz_2027` | CDFI Fund `final_oz2_designations.xlsx` (designated Nov 5, 2026) | Fixed for 2027-2036 unless Treasury issues corrections | `python build_data.py --refresh --only qoz_2027` |
| `nmtc_2016_2020` | CDFI Fund NMTC 2016-2020 ACS LIC file | When CDFI moves to newer ACS data | Add a new manifest entry (like a new OZ round) or repoint this one; `--refresh` |
| HUBZone | SBA HUBZone map, live, cached 30 days | SBA redraws in July 2028; disaster and redesignation changes happen in between | Automatic. Delete `data/cache.sqlite` to force fresh lookups |
| `state_incentives` | `data/state_incentives.csv`, by hand | Any time | Edit the CSV, `python build_data.py`, then `python tools/check_links.py` |

After any refresh, run the cross-checks:

```bash
python tools/crosscheck.py      # 2018 list vs HUD's OZ layer; 2027 list vs Treasury's own file; NMTC consistency
python tools/verify_points.py "9500 Euclid Ave, Cleveland, OH 44195" "17000 Lorain Ave, Cleveland, OH 44111"
python -m unittest discover -s tests -t .
```

`verify_points.py` checks the tool's answer for an address against sources the tool doesn't use: HUD's OZ polygons for 2018, and Census TIGERweb tract polygons plus Treasury's list for 2027.

If a download fails, `build_data.py` prints the exact URL and the file name to save in `data/raw/`, then loads a small sample so the tool still runs. Reports built on sample data say **SAMPLE DATA** at the top. See `data/README.md`.

## Adding a state

Add rows to `data/state_incentives.csv`:

| Column | Notes |
|---|---|
| `state` | Two-letter code |
| `program_name` | Official name |
| `program_type` | One of `state_oz_conformity`, `state_oz_credit`, `state_oz_designation`, `state_nmtc`, `job_creation_credit`, `location_credit`, `deal_closing_grant`, `property_tax_limitation`, `ssbci` (others are allowed and sort last) |
| `description` | One line: what it is and who it is for |
| `official_url` | The agency's program page, not a news article |
| `notes` | Caveats, deadlines, anything unverified |
| `as_of` | Date you checked it (required) |

Cover at least: the state's treatment of federal OZ gains (conformity), any state OZ credit, any state new markets credit, the main job creation credit, and the state's SSBCI administrator. Then run `python build_data.py` and `python tools/check_links.py`. The table is a starting point for research and never a complete list.

## Adding a new Opportunity Zone round

The program is now permanent, with a new round every ten years. Rounds are data, not code. The 2027 round was added this way (published Nov 5, 2026). For the next round:

1. Copy the `qoz_2027` entry in `data/sources.json` and give it a new `id` (e.g. `qoz_2037`).
2. Set `round_label`, `authority`, `vintage_date`, `effective_date`, `expires_date`, and `expires_by_state_fips` if any state ends early.
3. Set `tract_vintage` and `geocoder_vintage` to match the list's tract boundaries. Check the revenue procedure, and check Connecticut county codes in the file (`09110`... means 2022+ geography). List the vintages with `https://geocoding.geo.census.gov/geocoder/vintages?benchmark=Public_AR_Current&format=json`.
4. Point `source_url`, `local_file`, `columns`, optional `flags` (e.g. rural) and `expected_count` at the new file.
5. Run `python build_data.py --only qoz_2037`. Add an independent cross-check to `tools/crosscheck.py` if Treasury or HUD publish a second copy.

Reports pick up every `QOZ` dataset automatically, state which round a YES comes from, and drop rounds once their period has ended.

## Known limits

- **Screening only.** Nothing here decides whether a fund, business, property or deal complies with §1400Z-2.
- **Geocoder precision.** The Census geocoder interpolates along street segments. Points near a tract boundary, on large campuses, or on parcels spanning tracts can land in the wrong tract, so use the map links. New construction may not match at all, and PO boxes can't be located.
- **2018 list.** The CDFI spreadsheet notes it is "not the official list"; the official lists are IRS Notices 2018-48 and 2019-42. It matched HUD's published OZ layer tract for tract (8,764). A few tracts changed county codes after 2010, which `lookup_county_aliases` handles (Bedford city, VA).
- **Puerto Rico** 2018-round end dates are reported differently by different sources (Dec 31, 2027 is used). Verify.
- **HUBZone** status comes from the endpoint behind SBA's public map. SBA publishes no current bulk file, and the endpoint is undocumented and could change. Answers are cached 30 days, and an offline lookup of a new point returns UNKNOWN.
- **NMTC** shows low-income-community status only (poverty and median family income tests, plus high-migration rural tracts). It does not evaluate "severely distressed" status or targeted populations.
- **Website extraction** reads static HTML only (no JavaScript rendering), checks at most 7 pages, and handles US addresses only. It can pick up an address that isn't the company's own, so review the candidates. Looking up a company by name is not supported in v1.
- **State table** is hand-maintained and incomplete. The OH, NC and GA conformity rows are marked unverified; confirm them with each state's revenue department.

## Files

```
qualify.py            CLI entry point
build_data.py         downloads and loads datasets from data/sources.json
ozq/                  geocode, extract, hubzone, verdict, report, db, loaders, net (HTTP cache)
data/sources.json     dataset manifest (sources, vintages, periods, columns)
data/state_incentives.csv   hand-maintained state programs
ozq/webform.py        local web form behind --serve
web/index.html        static ZIP / address / tract lookup page (data built by tools/build_web_data.py)
tools/                crosscheck.py, verify_points.py, check_links.py, build_web_data.py
tests/                offline unit tests
reports/examples/     sample reports from the verification runs
VERIFICATION.md       what was checked at each build step, with results
```

Network hosts used at runtime: `geocoding.geo.census.gov`, `maps.certify.sba.gov`, and the company websites you screen. `build_data.py` also uses `www.cdfifund.gov` and `home.treasury.gov`. The tools use `services.arcgis.com` (HUD) and `tigerweb.geo.census.gov`.
