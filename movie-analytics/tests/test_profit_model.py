"""Tests for profit_model.py. Run: python -m pytest tests  (or python -m unittest discover tests)."""

import copy
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import profit_model as pm  # noqa: E402

A = pm.load_assumptions()
CPI = pm.load_cpi()
INF = pm.Inflation(CPI)
M = 1_000_000


def nominal_basis(assumptions=A):
    a = copy.deepcopy(assumptions)
    a["pa_tiers_basis"] = "nominal"
    return a


class TestTiers(unittest.TestCase):
    def test_boundaries_follow_the_spec_wording(self):
        tiers = A["pa_tiers"]
        # "under $10M" excludes $10M; "$10M to $40M" includes both ends; "$100M to $200M" includes $200M.
        self.assertEqual(pm.tier_index(9_999_999, tiers), 0)
        self.assertEqual(pm.tier_index(10 * M, tiers), 1)
        self.assertEqual(pm.tier_index(40 * M, tiers), 1)
        self.assertEqual(pm.tier_index(40 * M + 1, tiers), 2)
        self.assertEqual(pm.tier_index(100 * M, tiers), 2)
        self.assertEqual(pm.tier_index(200 * M, tiers), 3)
        self.assertEqual(pm.tier_index(200 * M + 1, tiers), 4)
        self.assertEqual(pm.tier_index(10_000 * M, tiers), 4)

    def test_pa_nominal_basis_matches_spec_table(self):
        a = nominal_basis()
        expected = [(5 * M, 2.5 * M), (10 * M, 12 * M), (40 * M, 12 * M), (60 * M, 25 * M),
                    (150 * M, 40 * M), (200 * M, 40 * M), (250 * M, 55 * M)]
        for budget, pa in expected:
            got, _ = pm.pa_estimate(budget, 2024, a, INF)
            self.assertAlmostEqual(got, pa, msg=f"budget {budget}")

    def test_real_basis_deflates_flat_tiers_for_old_films(self):
        # E.T. (1982), $10.5M: in 2024 dollars that is ~$34M -> $12M tier in 2024 dollars,
        # which is ~$3.7M in 1982 dollars (not a $12M spend on a $10.5M film).
        pa, tier = pm.pa_estimate(10_500_000, 1982, A, INF)
        self.assertEqual(tier, 1)
        self.assertAlmostEqual(pa, 12 * M * CPI[1982] / CPI[2024], places=4)

    def test_real_basis_is_identity_for_latest_year(self):
        pa, _ = pm.pa_estimate(150 * M, INF.latest_year, A, INF)
        self.assertEqual(pa, 40 * M)
        pa_future, _ = pm.pa_estimate(150 * M, INF.latest_year + 1, A, INF)
        self.assertEqual(pa_future, 40 * M)

    def test_missing_budget(self):
        self.assertEqual(pm.pa_estimate(None, 2020, A, INF), (None, None))


class TestRentals(unittest.TestCase):
    def test_blended_international_when_no_china_split(self):
        r = pm.rentals({"domestic_gross": 100 * M, "international_gross": 200 * M}, A)
        self.assertEqual(r["method"], "blended")
        self.assertAlmostEqual(r["total"], 52 * M + 80 * M)

    def test_china_split(self):
        r = pm.rentals({"domestic_gross": 100 * M, "international_gross": 200 * M, "china_gross": 50 * M}, A)
        self.assertEqual(r["method"], "china_split")
        self.assertAlmostEqual(r["total"], 52 * M + 150 * M * 0.40 + 50 * M * 0.25)

    def test_worldwide_only(self):
        r = pm.rentals({"worldwide_gross": 100 * M}, A)
        self.assertEqual(r["method"], "worldwide_only")
        self.assertAlmostEqual(r["total"], 45 * M)

    def test_nothing_known(self):
        self.assertIsNone(pm.rentals({}, A)["total"])


class TestHandComputedFilm(unittest.TestCase):
    """Black Panther (2018), from the sample dataset, worked by hand.

    Inputs: budget 200,000,000; opening 202,003,951; domestic 700,059,566;
            international 646,853,595 (of which China 105,000,000); worldwide 1,346,913,161.
    CPI: 2018 = 251.107, 2024 = 313.689.
    """

    FIN = {
        "production_budget": 200_000_000,
        "opening_weekend_domestic": 202_003_951,
        "domestic_gross": 700_059_566,
        "international_gross": 646_853_595,
        "worldwide_gross": 1_346_913_161,
        "china_gross": 105_000_000,
    }

    def test_end_to_end(self):
        m = pm.compute(self.FIN, 2018, A, INF)

        dom_rentals = 700_059_566 * 0.52                      # 364,030,974.32
        intl_rentals = (646_853_595 - 105_000_000) * 0.40     # 216,741,438.00
        china_rentals = 105_000_000 * 0.25                    #  26,250,000.00
        rentals = dom_rentals + intl_rentals + china_rentals  # 607,022,412.32
        factor = 313.689 / 251.107                            # 1.249225  (2018 -> 2024)
        # 200M x 1.2492 = 249.8M in 2024 dollars -> "Over $200M" tier -> $55M in 2024 dollars
        pa = 55_000_000 / factor                              #  44,027,316.86 in 2018 dollars
        profit = rentals - 200_000_000 - pa                   # 362,995,095.46
        roi = profit / (200_000_000 + pa)                     # 1.48752 -> 148.8%

        self.assertAlmostEqual(m["rentals_total"], rentals, places=2)
        self.assertAlmostEqual(m["rentals_total"], 607_022_412.32, places=2)
        self.assertEqual(m["budget_tier"], 4)
        self.assertAlmostEqual(m["pa_estimate"], pa, places=4)
        self.assertAlmostEqual(m["pa_estimate"], 44_027_316.86, places=1)
        self.assertAlmostEqual(m["est_profit"], profit, places=2)
        self.assertAlmostEqual(m["est_profit"], 362_995_095.46, places=1)
        self.assertAlmostEqual(m["est_roi"], roi, places=12)
        self.assertAlmostEqual(m["est_roi"], 1.4875, places=4)
        self.assertTrue(m["profitable"])
        self.assertAlmostEqual(m["gross_multiple"], 1_346_913_161 / 200_000_000)
        self.assertAlmostEqual(m["opening_multiplier"], 700_059_566 / 202_003_951)
        # breakeven: worldwide gross at which rentals (at this film's own mix) cover budget + P&A
        effective = rentals / 1_346_913_161
        self.assertAlmostEqual(m["breakeven_multiple"], (200_000_000 + pa) / effective / 200_000_000)
        self.assertAlmostEqual(m["breakeven_multiple"], 2.7073, places=4)


class TestEdgeCases(unittest.TestCase):
    def test_loss_making_film(self):
        fin = {"production_budget": 263_700_000, "domestic_gross": 73_078_100,
               "international_gross": 211_061_000, "worldwide_gross": 284_139_100}
        m = pm.compute(fin, 2012, A, INF)
        self.assertLess(m["est_profit"], 0)
        self.assertFalse(m["profitable"])
        self.assertGreater(m["est_roi"], -1)

    def test_no_budget_means_no_profit(self):
        m = pm.compute({"domestic_gross": 10 * M, "international_gross": 5 * M, "worldwide_gross": 15 * M},
                       2010, A, INF)
        self.assertIsNotNone(m["rentals_total"])
        for key in ("est_profit", "est_roi", "gross_multiple", "breakeven_multiple", "pa_estimate"):
            self.assertIsNone(m[key], key)

    def test_ratios_are_inflation_invariant_under_real_basis(self):
        fin = {"production_budget": 9 * M, "domestic_gross": 260 * M,
               "international_gross": 216.5 * M, "worldwide_gross": 476.5 * M}
        m = pm.compute(fin, 1975, A, INF)
        k = INF.factor(1975)
        scaled = {key: v * k for key, v in fin.items()}
        m2 = pm.compute(scaled, INF.latest_year, A, INF)
        self.assertTrue(math.isclose(m["est_roi"], m2["est_roi"], rel_tol=1e-9))
        self.assertTrue(math.isclose(m["est_profit"] * k, m2["est_profit"], rel_tol=1e-9))

    def test_validation_rejects_bad_tiers(self):
        bad = copy.deepcopy(A)
        bad["pa_tiers"][1]["max_budget"] = 5 * M  # below the previous tier
        with self.assertRaises(ValueError):
            pm.validate_assumptions(bad)
        bad = copy.deepcopy(A)
        bad["rental_rates"]["domestic"] = 52
        with self.assertRaises(ValueError):
            pm.validate_assumptions(bad)

    def test_describe_mentions_every_rate(self):
        text = pm.describe(A, INF)
        for fragment in ("52%", "40%", "25%", "$12M", "$55M", "50% of budget", "2024 dollars"):
            self.assertIn(fragment, text)


class TestInflation(unittest.TestCase):
    def test_cpi_table_is_complete(self):
        years = sorted(CPI)
        self.assertEqual(years, list(range(years[0], years[-1] + 1)))
        self.assertEqual(CPI[2024], 313.689)

    def test_factor(self):
        self.assertAlmostEqual(INF.factor(1997), 313.689 / 160.5)
        self.assertEqual(INF.factor(2024), 1.0)
        self.assertEqual(INF.factor(2030), 1.0)


if __name__ == "__main__":
    unittest.main()
