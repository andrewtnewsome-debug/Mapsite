"""Runs tests/e2e_dashboard.js in headless Chromium and checks its numbers against profit_model.py.

Skipped when Node.js or the `playwright` npm package is unavailable.
Requires the three build steps to have run (dashboard/index.html must exist).
"""

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

NODE = shutil.which("node")


def playwright_available() -> bool:
    if not NODE:
        return False
    probe = subprocess.run([NODE, "-e", "require('playwright')"], capture_output=True, cwd=ROOT)
    return probe.returncode == 0


@unittest.skipUnless(playwright_available(), "Node.js with the playwright package is not installed")
class TestDashboardEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (ROOT / "dashboard" / "index.html").exists():
            raise unittest.SkipTest("build the dashboard first")
        run = subprocess.run([NODE, str(ROOT / "tests" / "e2e_dashboard.js"), "--json"],
                             capture_output=True, text=True, cwd=ROOT, timeout=180)
        if run.returncode == 2:
            raise unittest.SkipTest(f"browser could not start: {run.stderr[-500:]}")
        cls.report = json.loads(run.stdout)

    def test_every_browser_check_passes(self):
        failed = [r for r in self.report["results"] if not r["ok"]]
        self.assertEqual(failed, [], json.dumps(failed, indent=1))

    def test_coogler_economics_match_python_model(self):
        export = json.loads((ROOT / "dashboard" / "data" / "movies.json").read_text(encoding="utf-8"))
        a = pm.load_assumptions()
        inf = pm.Inflation(pm.load_cpi())
        expected = {m["title"]: pm.compute(m["fin"], m["year"], a, inf)
                    for m in export["movies"] if "Ryan Coogler" in m["people"]["director"]}
        browser = {row["title"]: row for row in self.report["coogler"]}
        self.assertEqual(sorted(browser), sorted(expected))
        self.assertEqual(sorted(browser), sorted([
            "Fruitvale Station", "Creed", "Black Panther", "Black Panther: Wakanda Forever", "Sinners"]))
        for title, metrics in expected.items():
            for key in ("gross_multiple", "est_roi", "est_profit", "breakeven_multiple", "pa_estimate", "rentals_total"):
                self.assertTrue(math.isclose(metrics[key], browser[title][key], rel_tol=1e-12),
                                f"{title} {key}: python {metrics[key]} vs browser {browser[title][key]}")


if __name__ == "__main__":
    unittest.main()
