"""The dashboard's JavaScript model (dashboard_src/model.js) must match profit_model.py.

Runs every film in the staging data through both implementations under several
assumption sets and compares every metric. Skipped when Node.js is not installed.
"""

import copy
import json
import math
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import profit_model as pm  # noqa: E402
from common import STAGING_JSON  # noqa: E402

NODE = shutil.which("node")

NODE_SCRIPT = r"""
const PM = require(process.argv[1]);
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const inf = new PM.Inflation(input.cpi);
const out = input.variants.map(a => input.films.map(f => PM.compute(f.fin, f.year, a, inf)));
process.stdout.write(JSON.stringify(out));
"""


def variants():
    base = pm.load_assumptions()
    nominal = copy.deepcopy(base)
    nominal["pa_tiers_basis"] = "nominal"
    tweaked = copy.deepcopy(base)
    tweaked["rental_rates"].update({"domestic": 0.55, "international_blended": 0.37, "china": 0.22})
    tweaked["pa_tiers"][2]["value"] = 30_000_000
    tweaked["pa_tiers"][0]["max_inclusive"] = True
    return [base, nominal, tweaked]


@unittest.skipUnless(NODE, "Node.js not installed")
class TestJsParity(unittest.TestCase):
    def test_every_film_every_metric(self):
        if not STAGING_JSON.exists():
            self.skipTest("run ingest.py first")
        staging = json.loads(STAGING_JSON.read_text(encoding="utf-8"))
        films = [{"fin": m["financials"], "year": m["release_year"], "title": m["title"]} for m in staging["movies"]]
        # Edge cases the sample does not cover.
        films += [
            {"title": "no budget", "year": 2001, "fin": {"domestic_gross": 5_000_000, "international_gross": 1_000_000, "worldwide_gross": 6_000_000}},
            {"title": "worldwide only", "year": 1988, "fin": {"production_budget": 20_000_000, "worldwide_gross": 70_000_000}},
            {"title": "domestic only", "year": 1960, "fin": {"production_budget": 2_000_000, "domestic_gross": 9_000_000}},
            {"title": "pre-CPI", "year": 1905, "fin": {"production_budget": 10_000, "domestic_gross": 50_000, "international_gross": 0, "worldwide_gross": 50_000}},
        ]
        cpi = pm.load_cpi()
        inflation = pm.Inflation(cpi)
        sets = variants()
        payload = {"cpi": {str(k): v for k, v in cpi.items()}, "variants": sets, "films": films}
        result = subprocess.run(
            [NODE, "-e", NODE_SCRIPT, str(ROOT / "dashboard_src" / "model.js")],
            input=json.dumps(payload), capture_output=True, text=True, check=True,
        )
        js = json.loads(result.stdout)
        checked = 0
        for vi, a in enumerate(sets):
            for fi, film in enumerate(films):
                py = pm.compute(film["fin"], film["year"], a, inflation)
                for key, pv in py.items():
                    jv = js[vi][fi][key]
                    where = f"variant {vi}, {film['title']}, {key}"
                    if isinstance(pv, float) and jv is not None:
                        self.assertTrue(math.isclose(pv, jv, rel_tol=1e-12, abs_tol=1e-6), f"{where}: py {pv} js {jv}")
                    else:
                        self.assertEqual(pv, jv, where)
                    checked += 1
        self.assertGreater(checked, 1000)


if __name__ == "__main__":
    unittest.main()
