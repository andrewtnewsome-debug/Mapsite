# Build verification log

What was checked at each build step, on 2026-11-25. Each check names its official source.

## Step 1: Data layer

`python build_data.py` downloaded and loaded every list from the official URLs:

| Dataset | Tracts loaded | Expected | Notes |
|---|---|---|---|
| `qoz_2018` (CDFI Fund, Dec 14, 2018) | 8,764 (8,566 Low-Income Community + 198 Non-LIC Contiguous) | 8,764 | 3,309 rural tracts flagged from Treasury's Notice 2025-50 list, all matched |
| `qoz_2027` (CDFI Fund, designated Nov 5, 2026) | 6,576 (2,594 Rural / 3,982 Non-Rural) | 6,576 tracts, 2,594 rural, per Treasury's press release | 56 states and territories |
| `nmtc_2016_2020` (CDFI Fund, Sept 1, 2023) | 85,395 (35,229 LIC) | — | Includes 62 high-migration rural tracts, which qualify at an 85% MFI threshold |
| HUBZone | Live point lookup, cached | — | SBA's bulk files on data.gov stop at 2018 and were superseded in July 2023 |

**Full-list cross-checks** (`python tools/crosscheck.py`) against independent official copies:

```
[PASS] qoz_2018 vs HUD feature service: ours 8,764 / theirs 8,764 / in both 8,764
[PASS] qoz_2027 vs Treasury OTP data transparency file: ours 6,576 / theirs 6,576 / in both 6,576
[PASS] nmtc_2016_2020 internal consistency: 85,395 tracts, 0 where the LIC flag disagrees with the poverty/MFI columns
```

**Spot checks** (our tables vs HUD's published Opportunity Zones layer, queried by GEOID):

| Tract | Case | Our 2018 list | HUD layer | Our 2027 list |
|---|---|---|---|---|
| 39035107101 (downtown Cleveland, OH) | known QOZ | YES (LIC) | YES | no |
| 39035107702 (Cleveland, OH) | known non-QOZ | no | no | no |
| 37063002300 (Durham, NC) | other state | YES (LIC) | YES | YES (Non-Rural) |
| 13121003500 (Atlanta, GA) | other state, non-QOZ | no | no | no |
| 51019050100 (Bedford, VA) | rural, county-code change | YES (rural) | YES (Rural = Y) | no |

**Problems found and fixed during this step:**
- Treasury's rural file writes tract 46102940500 with Oglala Lakota County's post-2015 code; the 2018 list has 46113 (Shannon County). The manifest now has a supplement alias, so all 3,309 rural tracts match.
- HUD's layer carries tract 050100 under both 51019 and 51515 (Bedford city, VA, merged into Bedford County in 2013). The Census 2010 geocoder returns 51515050100, which is not on the 2018 list, so it would have given a false NO. The manifest's `lookup_county_aliases` now maps it, and a unit test covers it.

The sample fallback works: with the 2027 file missing and `--offline`, the loader printed the drop-in instructions and loaded `data/sample/qoz_2027.csv`, flagged SAMPLE.

## Step 2: Geocoder and tract vintages

The Census Geocoder (benchmark `Public_AR_Current`) matches the address once, then asks for the tract at that point in `Census2010_Current`, `ACS2024_Current` and `Census2020_Current`.

**Test addresses**, checked by `python tools/verify_points.py` against sources the tool doesn't use. For 2018 that is HUD's OZ polygon layer, a point-in-polygon check with no tract list. For 2027 it is the Census TIGERweb 2020 tract polygon at the point, looked up in Treasury's separate copy of the list.

| Address | Tool verdict | 2018 round: tool / HUD polygons | 2010 tract: geocoder / TIGERweb | 2027 round: tool / TIGERweb + Treasury |
|---|---|---|---|---|
| 9500 Euclid Ave, Cleveland, OH 44195 (inside) | YES, both rounds | YES 39035113101 / YES 39035113101 | agree | YES 39035197200 / YES |
| 17000 Lorain Ave, Cleveland, OH 44111 (outside) | NO | NO 39035123400 / no polygon | agree | NO / NO |
| 1100 E 9th St, Cleveland, OH 44114 | YES, 2018 only | YES 39035107101 / YES | agree | NO / NO |
| 11150 East Blvd, Cleveland, OH 44106 | YES, 2018 only | YES 39035118700 / YES | agree | NO (2020 tract 39035196800) / NO |

The last row is why the 2010 vintage matters. The same point is 2010 tract 39035118700, which is on the 2018 list, and 2020 tract 39035196800. A 2020-tract lookup against the 2018 list would have returned a false NO.

**Connecticut:** a point inside 2027 tract `09110415900` (Capitol Planning Region) returns YES for 2027 and 2010 tract `09003415900` YES for 2018. Using `Census2020_Current` for the 2027 list would have returned the old county code and missed it.

**Fallback:** an unavailable vintage falls back to `Current_Current` and sets "tract vintage mismatch, verify manually"; the verdict is then marked unverified. A test covers it, and it was also run live with a bogus vintage name. Bad addresses return a clear "no match" error.

## Step 3: Website address extraction

Live runs (the crawl stays on the same site and reads the homepage plus contact, locations and about pages):

| Site | Case | Result |
|---|---|---|
| loganberrybooks.com | clean contact page | 1 address: 13015 Larchmere Boulevard, Shaker Heights, OH 44120. Best source: the contact page body; seen on 4 pages; confidence 0.99 |
| greatlakesbrewing.com | address only in footer | 1 address: 2516 Market Ave., Cleveland, OH 44113 (written in the footer without commas: "2516 Market Ave. Cleveland Ohio 44113"); found in the footer on 3 pages |
| risingstarcoffee.com | multiple locations | 7 locations from /locations/, including "1455 W 29th" (no street suffix), a building-name line, and a suite. Each qualified separately: 3 YES (2018 round), 4 NO |

Extra runs: Mitchell's Homemade (9 locations, including "2101 Richmond Rd. at LaPlace") and Phoenix Coffee (4 locations, one found through Squarespace's business-info JSON).

**Problems found and fixed:** product pages such as `/shop/...` were being read as location pages, and schema.org *Event* venues were being taken as the business address. Classification now uses the URL path or an exact short link label, and Event, Product and Offer data is ignored. The unit pattern was case-sensitive, so "Suite 400" on its own line was missed; a unit test caught it.

## Step 4: Report generator

`qualify.py` writes a console summary and one HTML page per location (`reports/examples/` holds the verification runs). Checked:

- **Verdict header:** YES/NO, which round, tract GEOIDs per round with tract vintage, county, state, and the address used. Also shows the input address, where it came from, and whether a person confirmed it.
- **Map links:** Google Maps at the geocoded point; CDFI CIMS centered on the point with the OZ layer; the CDFI CIMS public map; the HUD OZ map; and the SBA HUBZone map pinned to the point.
- **Other designations:** NMTC (yes/no with poverty, MFI and unemployment, plus dataset vintage) and HUBZone (status, designation type and effective date, and query date).
- **State programs:** rows for the state, each with its link and as-of date.
- **Checklist:** shown only on YES. Includes the rural 50% substantial-improvement note when the tract is rural (Bedford, VA example), and a timing note when the tract is 2018-only (Great Lakes Brewing example).
- **Data and limits box:** dataset names, vintages, tract vintages, the geocoder vintage actually used, and the exact required sentence.
- **Designation periods**, checked with `--today`: as of 2027-06-01 both rounds are in effect. As of 2029-03-01, downtown tract 39035107101 is NO ("previously designated in the 2018 round, now expired") and the Cleveland Clinic tract is YES through the 2027 round.
- **Interactive mode**, run in a pseudo-terminal: picking an extracted address, confirming the geocoder match, and rejecting a match then typing a correction all work. The report records the confirmation. With `--yes`, the report says "not confirmed" and the verdict is provisional.
- **Offline:** cached lookups work; a never-seen address fails cleanly.
- **Name only:** `--name` alone prints instructions and exits 2.
- **Rendering:** checked in Chromium at desktop width (light) and 390 px (dark). No horizontal page scroll.

## Step 5: State incentive table and README

- `data/state_incentives.csv` has 22 rows: OH 5, NC 4, GA 4, TX 5, CA 4. Each state covers OZ treatment or designation, job creation incentives and the SSBCI administrator. It also covers state new markets credits where one exists (Ohio), Ohio's OZ credit, and Georgia's separate state OZ job tax credit. Every row has `as_of` 2026-11-25. The schema comment marks the table hand-maintained and incomplete.
- `python tools/check_links.py`: 27/28 links return HTTP 200. That covers 21 of 22 state program pages plus all 6 dataset source URLs and pages. The California IBank SSBCI page could not be fetched from this sandbox: `www.ibank.ca.gov` 301-redirects to the same path on `ibank.ca.gov`, which is outside the sandbox's network allowlist. Two links were corrected during the check: Georgia DCA's SSBCI page moved to `dca.georgia.gov`, and the IBank link now points at the redirect target.
- Conformity rows for OH, NC and GA are deliberately marked unverified. California's nonconformity comes from the FTB's own summary.
- `README.md` covers refreshing every dataset, adding a state, adding a new designation round (the 2027 round was added this way, without code changes), and the known limits.

Unit tests: `python -m unittest discover -s tests -t .` runs 25 tests, all passing, with no network.
