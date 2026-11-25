# data/

| Path | What it is | Who edits it |
|---|---|---|
| `sources.json` | Manifest of every designation dataset: source URL, vintage, designation period, tract vintage, geocoder vintage, column mapping | You, when a source changes or a new round is published |
| `state_incentives.csv` | Hand-maintained state program table (loaded into SQLite `state_incentives`) | You, by hand. Check each `official_url` and bump `as_of` |
| `raw/` | Downloaded official source files (not committed) | `build_data.py` |
| `sample/` | Tiny test sets of real tracts, used only when an official file is unavailable | Rarely |
| `designations.sqlite` | Built database (not committed) | `build_data.py` |
| `cache.sqlite` | Cached geocoder, HUBZone and web-page answers (not committed) | `qualify.py` |

## If a download fails: drop the file in by hand

`build_data.py` prints the exact URL and destination when it cannot download a file. The files it expects in `raw/`:

| Dataset id | Save as `data/raw/...` | Download from |
|---|---|---|
| `qoz_2018` | `designated-qozs.12.14.18.xlsx` | https://www.cdfifund.gov/system/files/documents/designated-qozs.12.14.18.xlsx (linked from https://www.cdfifund.gov/opportunity-zones, "List of designated Qualified Opportunity Zones") |
| `qoz_2018` (rural flag) | `QOZ-Rural-2018-Area-Zones-as-in-2025-50.xlsx` | https://home.treasury.gov/system/files/131/QOZ-Rural-2018-Area-Zones-as-in-2025-50.xlsx (Treasury OTP data transparency page) |
| `qoz_2027` | `final_oz2_designations.xlsx` | https://www.cdfifund.gov/system/files/2026-11/final_oz2_designations.xlsx (CDFI Fund OZ page, "Full list of designated Qualified Opportunity Zones") |
| `nmtc_2016_2020` | `NMTC_2016-2020_ACS_LIC_Sept1_2023.xlsb` | https://www.cdfifund.gov/system/files/2023-08/NMTC_2016-2020_ACS_LIC_Sept1_2023.xlsb (linked from https://www.cdfifund.gov/news/537) |
| `hubzone_tracts_file` (disabled) | `hubzone_qualified_tracts.csv` | No current SBA bulk file exists. See below |

Then run `python build_data.py --only <dataset id>`.

When neither the download nor a local file is available, the loader uses `sample/<dataset id>.csv`. That holds a handful of real tracts copied from the official list, plus negative test cases. Reports built on sample data say **SAMPLE DATA** in the header and must not be relied on.

## HUBZone

SBA does not publish a current bulk file of HUBZone areas. The data.gov files stop at 2018 and were replaced by the July 1, 2023 redesignation. So the tool asks the official SBA HUBZone map about the exact point (`hubzone_sba_map` in `sources.json`). It caches the answer for 30 days and prints the query date in the report. That one lookup covers every HUBZone type: qualified census tracts, non-metro counties, Indian lands, base closure areas, governor-designated areas, disaster areas and redesignated areas.

If SBA does publish a tract file, save it as a CSV with a `GEOID` column, set `"enabled": true` on `hubzone_tracts_file` in `sources.json`, fix its `columns`, `tract_vintage` and `geocoder_vintage`, and rebuild.
