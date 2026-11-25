import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from ozq import db
from ozq.geocode import GeocodeResult, TractResult, tract_at
from ozq.hubzone import parse_response
from ozq.loaders import find_header, iter_records, normalize_geoid
from ozq.net import CachedResponse
from ozq.verdict import evaluate_tract_datasets, qoz_verdict


class Loaders(unittest.TestCase):
    def test_normalize_geoid(self):
        self.assertEqual(normalize_geoid("01001020700"), "01001020700")
        self.assertEqual(normalize_geoid(1001020700), "01001020700")
        self.assertEqual(normalize_geoid(1001020700.0), "01001020700")
        self.assertIsNone(normalize_geoid("abc"))
        self.assertIsNone(normalize_geoid("123456789012"))

    def test_header_detection_like_cdfi_2018_list(self):
        rows = [[None, "Designated Qualified Opportunity Zones", None, None],
                ["This document was updated...", None, None, None],
                ["Click arrow to filter state\n\nState", "County", "Census Tract Number", "Tract Type"],
                ["Alabama", "Autauga", "01001020700", "Low-Income Community"]]
        idx, _ = find_header(rows, "Census Tract Number")
        self.assertEqual(idx, 2)
        ds = {"membership": "listed", "columns": {"geoid": "Census Tract Number", "state": "State",
                                                 "county": "County", "category": "Tract Type"}}
        recs = list(iter_records(ds, rows))
        self.assertEqual(recs[0]["geoid"], "01001020700")
        self.assertEqual(recs[0]["state"], "Alabama")
        self.assertTrue(recs[0]["qualifies"])

    def test_flag_membership(self):
        rows = [["GEOID", "LIC?"], ["39035107101", "NO"], ["39035118900", "YES"]]
        ds = {"membership": "flag", "columns": {"geoid": "GEOID", "qualifies": "LIC?"}, "qualifies_true_values": ["YES"]}
        self.assertEqual([r["qualifies"] for r in iter_records(ds, rows)], [False, True])


def make_db(path: Path):
    conn = db.connect(path)
    now = "2026-01-01"

    def add(ds_id, program, round_label, eff, exp, tract_vintage, geo_vintage, membership, rows, aliases=None):
        db.replace_tract_table(conn, ds_id, [(g, ds_id, now, q, cat, None, None, json.dumps(flags), "{}")
                                             for g, q, cat, flags in rows])
        conn.execute("INSERT INTO datasets (dataset_id, program, name, round_label, effective_date, expires_date,"
                     " expires_by_state_fips, tract_vintage, geocoder_vintage, lookup_aliases, membership, loaded_at,"
                     " is_sample) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)",
                     (ds_id, program, ds_id, round_label, eff, exp, json.dumps({"72": "2027-12-31"}), tract_vintage,
                      geo_vintage, json.dumps(aliases or {}), membership, now))
        conn.commit()

    add("qoz_2018", "QOZ", "2018 round", "2018-04-09", "2028-12-31", "2010", "V2010", "listed",
        [("39035107101", 1, "Low-Income Community", {"rural": False}),
         ("51019050100", 1, "Low-Income Community", {"rural": True})], aliases={"51515": "51019"})
    add("qoz_2027", "QOZ", "2027 round", "2027-01-01", "2036-12-31", "2020", "V2024", "listed",
        [("39035197200", 1, "Non-Rural", {"rural": False})])
    add("nmtc", "NMTC", "NMTC", "2023-09-01", None, "2020", "V2020", "flag",
        [("39035197200", 1, None, {}), ("39035107101", 0, None, {})])
    return conn


def geo(t2010, t2020, mismatch=False, state="39"):
    g = GeocodeResult(input_address="x", matched_address="X", lat=41.5, lon=-81.6, state_fips=state)
    g.tracts = {"V2010": TractResult("V2010", "Current_Current" if mismatch else "V2010", t2010, mismatch=mismatch),
                "V2024": TractResult("V2024", "V2024", t2020), "V2020": TractResult("V2020", "V2020", t2020)}
    return g


class Verdicts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = make_db(Path(self.tmp.name) / "t.sqlite")

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def run_at(self, g, day):
        res = evaluate_tract_datasets(self.conn, g, dt.date.fromisoformat(day))
        return res, qoz_verdict(res)

    def test_both_rounds(self):
        _, v = self.run_at(geo("39035107101", "39035197200"), "2026-11-25")
        self.assertEqual(v.answer, "YES")
        self.assertEqual([r.dataset_id for r in v.rounds_yes], ["qoz_2018", "qoz_2027"])
        self.assertIn("takes effect Jan 1, 2027", v.summary)

    def test_expired_round_is_no(self):
        _, v = self.run_at(geo("39035107101", "39035999999"), "2029-01-01")
        self.assertEqual(v.answer, "NO")
        self.assertIn("now expired", v.summary)

    def test_not_listed_is_no_and_nmtc_missing_is_unknown(self):
        res, v = self.run_at(geo("39035999999", "39035999999"), "2026-11-25")
        self.assertEqual(v.answer, "NO")
        nmtc = [r for r in res if r.program == "NMTC"][0]
        self.assertIsNone(nmtc.qualifies)

    def test_county_alias(self):
        res, v = self.run_at(geo("51515050100", "51019050101", state="51"), "2026-11-25")
        self.assertEqual(v.answer, "YES")
        r18 = [r for r in res if r.dataset_id == "qoz_2018"][0]
        self.assertEqual(r18.geoid_matched, "51019050100")
        self.assertTrue(r18.flags["rural"])

    def test_vintage_mismatch_marks_unverified(self):
        _, v = self.run_at(geo("39035107101", "39035999999", mismatch=True), "2026-11-25")
        self.assertTrue(v.unverified)

    def test_state_override_for_puerto_rico(self):
        res, _ = self.run_at(geo("39035107101", "x", state="72"), "2028-06-01")
        r18 = [r for r in res if r.dataset_id == "qoz_2018"][0]
        self.assertEqual(r18.expires_date, "2027-12-31")
        self.assertEqual(r18.period_status, "expired")


class FakeFetcher:
    """Answers geocoder coordinate lookups; vintage 'Broken' always fails."""

    def get(self, url, params=None, headers=None, max_age_days=None, cache_errors=False):
        if params["vintage"] == "Broken":
            return CachedResponse(url, url, 400, "application/json", "{}", 0, False)
        body = {"result": {"geographies": {"Census Tracts": [{"GEOID": "39035197200", "NAME": "Tract 1972"}]}}}
        return CachedResponse(url, url, 200, "application/json", json.dumps(body), 0, False)


class GeocoderFallback(unittest.TestCase):
    def test_falls_back_to_current_and_flags_mismatch(self):
        t = tract_at(FakeFetcher(), -81.6, 41.5, "Broken")
        self.assertEqual(t.geoid, "39035197200")
        self.assertEqual(t.vintage_used, "Current_Current")
        self.assertTrue(t.mismatch)
        self.assertEqual(t.flag, "tract vintage mismatch, verify manually")

    def test_no_fallback_needed(self):
        t = tract_at(FakeFetcher(), -81.6, 41.5, "Census2010_Current")
        self.assertFalse(t.mismatch)


class Hubzone(unittest.TestCase):
    def test_parse_qualified_with_json(self):
        sidebar = ('<div id="hubzone-status" aria-label="qualified hubzone">Qualified HUBZone</div>'
                   '<div class="hubzone-until-date"></div>')
        payload = json.dumps({"hubzone": [{"hz_type": "qct_e", "tract_fips": "39035197200",
                                           "county": "Cuyahoga County", "effective": "2022-12-30", "expires": None}],
                              "until_date": None})
        text = f"$('#sidebar-content').html({json.dumps(sidebar)});\nvar response = JSON.parse('{payload}');"
        r = parse_response(text)
        self.assertEqual(r.status, "QUALIFIED")
        self.assertEqual(r.designations[0].label, "Qualified census tract")
        self.assertEqual(r.designations[0].details["Tract"], "39035197200")

    def test_parse_not_qualified(self):
        sidebar = '<div id="hubzone-status" aria-label="Not Qualified">Not Qualified</div>'
        r = parse_response(f"$('#sidebar-content').html({json.dumps(sidebar)});")
        self.assertEqual(r.status, "NOT QUALIFIED")
        self.assertEqual(r.designations, [])


if __name__ == "__main__":
    unittest.main()
