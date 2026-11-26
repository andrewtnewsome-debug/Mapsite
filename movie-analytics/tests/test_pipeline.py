"""Tests for ingest parsing, merge rules, TMDb caching and the database loader."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import build_db  # noqa: E402
import ingest  # noqa: E402
import sample_data  # noqa: E402
from common import parse_money, split_names  # noqa: E402
from tmdb import TMDbClient, extract  # noqa: E402

M = 1_000_000


def tmdb_payload(**overrides):
    payload = {
        "id": 999,
        "budget": 0,
        "revenue": 0,
        "runtime": 101,
        "release_date": "2010-05-01",
        "genres": [{"id": 1, "name": "Drama"}, {"id": 2, "name": "Thriller"}],
        "belongs_to_collection": {"name": "Example Collection"},
        "production_companies": [{"name": "Example Pictures"}],
        "release_dates": {"results": [
            {"iso_3166_1": "GB", "release_dates": [{"certification": "15", "type": 3}]},
            {"iso_3166_1": "US", "release_dates": [{"certification": "", "type": 1}, {"certification": "R", "type": 3}]},
        ]},
        "credits": {
            "cast": [{"name": "Third", "order": 2}, {"name": "Lead", "order": 0}, {"name": "Fourth", "order": 3},
                     {"name": "Second", "order": 1}],
            "crew": [
                {"name": "Dee Rector", "job": "Director"},
                {"name": "Pro Ducer", "job": "Producer"},
                {"name": "Exec One", "job": "Executive Producer"},
                {"name": "Pro Ducer", "job": "Executive Producer"},
                {"name": "Some Editor", "job": "Editor"},
            ],
        },
    }
    payload.update(overrides)
    return payload


def record(**fin):
    raw = {"title": "Example", "release_year": "2010", "genre": "", "genres": ""}
    raw.update(fin)
    return ingest.normalize_row(raw, "seed", ingest.ConflictLog())


class TestParsing(unittest.TestCase):
    def test_parse_money(self):
        self.assertEqual(parse_money("$1,234,567"), 1_234_567)
        self.assertEqual(parse_money("237M"), 237 * M)
        self.assertEqual(parse_money("2.92B"), 2_920 * M)
        self.assertEqual(parse_money(" 15000 "), 15_000)
        for blank in ("", "n/a", None, "-", "abc"):
            self.assertIsNone(parse_money(blank))
        self.assertIsNone(parse_money("-5"))  # negatives become missing, never stored

    def test_split_names_keeps_order(self):
        self.assertEqual(split_names("Anthony Russo; Joe Russo ;; anthony russo"), ["Anthony Russo", "Joe Russo"])
        self.assertEqual(split_names(""), [])

    def test_derives_missing_gross(self):
        r = record(domestic_gross="100", worldwide_gross="250")
        self.assertEqual(r["financials"]["international_gross"], 150)
        r = record(domestic_gross="100", international_gross="50")
        self.assertEqual(r["financials"]["worldwide_gross"], 150)

    def test_zero_budget_is_unknown(self):
        self.assertIsNone(record(production_budget="0")["financials"]["production_budget"])

    def test_primary_genre_added_to_genres(self):
        r = record(genre="Horror", genres="Thriller; Mystery")
        self.assertEqual(r["primary_genre"], "Horror")
        self.assertEqual(r["genres"], ["Horror", "Thriller", "Mystery"])


class TestMergeRules(unittest.TestCase):
    def test_fills_nulls_but_never_overwrites(self):
        log = ingest.ConflictLog()
        r = record(production_budget="", domestic_gross="40", international_gross="60", worldwide_gross="100",
                   mpaa_rating="PG-13", director="Seed Director")
        info = extract(tmdb_payload(budget=20 * M, revenue=0, runtime=95))
        ingest.merge_tmdb(r, info, log)
        self.assertEqual(r["financials"]["production_budget"], 20 * M)   # null filled
        self.assertEqual(r["financials"]["worldwide_gross"], 100)       # TMDb revenue 0 = null, never overwrites
        self.assertEqual(r["mpaa_rating"], "PG-13")                     # seed metadata kept
        self.assertEqual(r["runtime_min"], 95)                          # missing metadata filled
        self.assertEqual(r["franchise"], "Example")                     # " Collection" stripped
        self.assertEqual(r["people"]["director"], ["Seed Director"])    # seed credits kept
        self.assertEqual(r["people"]["producer"], ["Pro Ducer"])        # missing roles filled
        self.assertEqual(r["people"]["executive_producer"], ["Exec One", "Pro Ducer"])
        self.assertEqual(r["people"]["lead_cast"], ["Lead", "Second", "Third"])
        self.assertEqual(r["financials"]["source"], "seed+tmdb")
        self.assertEqual(log.lines, [])

    def test_conflict_over_10_percent_keeps_seed_and_logs(self):
        log = ingest.ConflictLog()
        r = record(production_budget="100000000", worldwide_gross="500000000", domestic_gross="200000000")
        ingest.merge_tmdb(r, {"production_budget": 120 * M, "worldwide_gross": 520 * M}, log)
        self.assertEqual(r["financials"]["production_budget"], 100 * M)
        self.assertEqual(r["financials"]["worldwide_gross"], 500 * M)
        self.assertEqual(len(log.lines), 1)  # 20% budget gap logged; 4% gross gap is not
        self.assertIn("production_budget", log.lines[0])
        self.assertIn("kept seed value", log.lines[0])


class TestTmdbClient(unittest.TestCase):
    def test_cache_means_one_fetch_per_movie(self):
        calls = []

        def fetcher(path, params):
            calls.append(path)
            return tmdb_payload()

        with tempfile.TemporaryDirectory() as tmp:
            client = TMDbClient("key", Path(tmp), fetcher=fetcher, log=lambda *_: None)
            self.assertEqual(client.movie(999)["id"], 999)
            self.assertEqual(client.movie(999)["id"], 999)
            client2 = TMDbClient("key", Path(tmp), fetcher=fetcher, log=lambda *_: None)  # a later run
            client2.movie(999)
            self.assertEqual(calls, ["/movie/999"])
            self.assertTrue((Path(tmp) / "movie_999.json").exists())

    def test_network_failure_never_raises(self):
        def fetcher(path, params):
            raise OSError("network down")

        with tempfile.TemporaryDirectory() as tmp:
            client = TMDbClient("key", Path(tmp), fetcher=fetcher, log=lambda *_: None)
            self.assertIsNone(client.movie(1))
            self.assertTrue(client.offline)
            self.assertIsNone(client.search_movie("Anything", 2000))

    def test_extract_credits_and_rating(self):
        info = extract(tmdb_payload())
        self.assertEqual(info["mpaa_rating"], "R")
        self.assertEqual(info["people"]["director"], ["Dee Rector"])
        self.assertIsNone(info["production_budget"])


class TestDatabase(unittest.TestCase):
    def test_sample_loads_cleanly(self):
        log = ingest.ConflictLog()
        movies = [ingest.normalize_row({k: str(v) for k, v in row.items()}, "sample", log)
                  for row in sample_data.sample_rows()]
        self.assertEqual(len(movies), 25)
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "t.db"
            conn = build_db.build({"dataset": {"source": "sample"}, "movies": movies}, db_path)
            count = lambda sql: conn.execute(sql).fetchone()[0]
            self.assertEqual(count("SELECT COUNT(*) FROM movies"), 25)
            self.assertEqual(count("SELECT COUNT(*) FROM financials"), 25)
            self.assertEqual(count("SELECT COUNT(*) FROM financials WHERE domestic_gross < 0 OR worldwide_gross < 0 "
                                   "OR international_gross < 0 OR production_budget < 0"), 0)
            coogler = conn.execute(
                "SELECT m.title, p.role FROM people p JOIN movies m ON m.id = p.movie_id "
                "WHERE p.person_name = 'Ryan Coogler' ORDER BY m.release_year, p.role").fetchall()
            self.assertEqual([t for t, r in coogler if r == "director"],
                             ["Fruitvale Station", "Creed", "Black Panther", "Black Panther: Wakanda Forever", "Sinners"])
            self.assertIn(("Sinners", "producer"), coogler)  # two roles on one film -> two rows
            first = conn.execute("SELECT person_name FROM people p JOIN movies m ON m.id = p.movie_id "
                                 "WHERE m.title = 'Avengers: Endgame' AND role = 'director' AND billing_order = 1").fetchone()
            self.assertEqual(first[0], "Anthony Russo")
            conn.close()


if __name__ == "__main__":
    unittest.main()
