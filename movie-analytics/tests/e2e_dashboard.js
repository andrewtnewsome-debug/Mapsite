/* End-to-end checks of the generated dashboard in headless Chromium.
 *
 *   node tests/e2e_dashboard.js [--json]
 *
 * Needs Node.js and the `playwright` package with Chromium. Prints PASS/FAIL per check
 * (or a JSON report with --json, used by tests/test_dashboard_e2e.py). Exit code 1 on failure. */
const path = require("path");
const { chromium } = require("playwright");

const URL = "file://" + path.resolve(__dirname, "..", "dashboard", "index.html");
const asJson = process.argv.includes("--json");
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail: detail === undefined ? null : detail }); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push("page error: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") problems.push("console error: " + m.text()); });
  page.on("request", (r) => { if (!/^(file|data|blob):/.test(r.url())) problems.push("network request: " + r.url()); });

  const tile = (k) => page.locator(`[data-testid="tile-${k}"] .value`).innerText();
  const showing = () => page.locator('[data-testid="showing"]').innerText();
  const lineD = () => page.locator('[data-testid="breakeven-line"]').getAttribute("d");

  await page.goto(URL);
  await page.waitForSelector('[data-testid="tile-films"]');
  const total = await tile("films");
  check("page loads with every film", total === String(await page.evaluate(() => window.__dashboard.films.length)), total);

  // 1. A filter changes the overview strip.
  const before = { films: await tile("films"), roi: await tile("roi"), share: await tile("share") };
  await page.selectOption("#f-genre", "Horror");
  const after = { films: await tile("films"), roi: await tile("roi"), share: await tile("share") };
  check("genre filter changes overview strip", before.films !== after.films && before.roi !== after.roi, { before, after });
  await page.click("#clear-all");
  check("clear filters restores overview", (await tile("films")) === before.films);

  // 2. The scatter's breakeven line moves when an assumption changes.
  const d0 = await lineD();
  await page.click('#view-tabs button[data-view="assumptions"]');
  await page.fill("#a-domestic", "60");
  await page.click('#view-tabs button[data-view="dash"]');
  const d1 = await lineD();
  check("breakeven line moves when the domestic rental rate changes", d0 && d1 && d0 !== d1);
  const roiCustom = await tile("roi");
  check("assumption change recomputes ROI", roiCustom !== before.roi, { before: before.roi, after: roiCustom });
  check("custom assumptions are labelled", (await page.locator(".note-slot").first().innerText()).includes("Custom assumptions"));
  await page.click('#view-tabs button[data-view="assumptions"]');
  await page.click("#a-reset");
  await page.locator("input[aria-label='Tier 4 upper bound in millions']").waitFor();
  const valueInputs = page.locator("input[aria-label$=' value']");
  await valueInputs.nth(3).fill("80"); // $100M-$200M tier: $40M -> $80M
  await page.click('#view-tabs button[data-view="dash"]');
  const d2 = await lineD();
  check("breakeven line moves when a P&A tier changes", d2 !== d0 && d2 !== d1);
  await page.click('#view-tabs button[data-view="assumptions"]');
  await page.click("#a-reset");
  await page.click('#view-tabs button[data-view="dash"]');
  check("reset restores the default line", (await lineD()) === d0);

  // 3. Director filter: exactly Ryan Coogler's films, with their economics.
  await page.click("#pick-director");
  await page.keyboard.type("coogler");
  await page.keyboard.press("Enter");
  const shown = await showing();
  const titles = await page.locator("#films-table tbody td.title").allInnerTexts();
  const coogler = await page.evaluate(() => window.__dashboard.filtered().map((f) => ({
    title: f.title, year: f.year, gross_multiple: f.m.gross_multiple, est_roi: f.m.est_roi, est_profit: f.m.est_profit,
    breakeven_multiple: f.m.breakeven_multiple, pa_estimate: f.m.pa_estimate, rentals_total: f.m.rentals_total })));
  check("director picker narrows to Ryan Coogler's films", /Showing 5 of/.test(shown), shown);
  check("films table shows his filmography", titles.length === 5 && (await page.locator("#films-title").innerText()).includes("Ryan Coogler"), titles);
  const tilesCoogler = { films: await tile("films"), mult: await tile("mult"), roi: await tile("roi") };
  check("overview strip recomputed for his films", tilesCoogler.films === "5", tilesCoogler);
  const scatterDots = await page.locator("#scatter circle.dot").count();
  check("scatter narrowed to his films", scatterDots === 5, scatterDots);

  // 4. People leaderboard: his row is there; clicking applies the filter.
  await page.click("#clear-all");
  await page.click('#view-tabs button[data-view="people"]');
  const row = page.locator('#lb-table button[data-person="Ryan Coogler"]');
  check("Ryan Coogler appears in the director leaderboard (min 3 films)", (await row.count()) === 1);
  const lbRow = (await row.count()) ? await row.locator("xpath=ancestor::tr").innerText() : null;
  await row.click();
  check("clicking a leaderboard name filters the dashboard",
    (await page.locator("#view-dash").isVisible()) && /Showing 5 of/.test(await showing()), lbRow);
  await page.click('#view-tabs button[data-view="people"]');
  await page.click('#lb-role button[data-role="lead_cast"]');
  check("lead actor leaderboard lists Michael B. Jordan", (await page.locator('#lb-table button[data-person="Michael B. Jordan"]').count()) === 1);
  await page.click('#view-tabs button[data-view="dash"]');
  await page.click("#clear-all");

  // 5. Inflation toggle: dollar figures change, ratios do not.
  const multNominal = await tile("mult"), roiNominal = await tile("roi");
  await page.click("#films-tabs button[data-tab=all]");
  const wwNominal = await page.locator("#films-table tbody tr").first().locator("td").nth(6).innerText();
  await page.click('#infl-toggle button[data-infl="1"]');
  const wwReal = await page.locator("#films-table tbody tr").first().locator("td").nth(6).innerText();
  check("inflation toggle changes dollar figures", wwNominal !== wwReal, { wwNominal, wwReal });
  check("inflation toggle leaves multiples and ROI unchanged",
    (await tile("mult")) === multNominal && (await tile("roi")) === roiNominal);
  await page.click('#infl-toggle button[data-infl="0"]');

  // 6. Clicking a scatter dot opens the movie detail; names there filter the dashboard.
  const target = await page.evaluate(() => window.__dashboard.films.find((f) => f.title === "Black Panther").id);
  const plottable = await page.evaluate(() => window.__dashboard.filtered()
    .filter((f) => f.fin.production_budget > 0 && f.fin.worldwide_gross > 0).length);
  const dots = await page.locator("#scatter circle.dot").count();
  check("scatter renders one dot per plottable film", dots === plottable, { dots, plottable });
  await page.evaluate((id) => { location.hash = "m=" + id; }, target);
  await page.waitForSelector("#detail:not([hidden])");
  const detailText = await page.locator("#drawer").innerText();
  check("movie detail shows waterfall, percentiles and people",
    detailText.includes("Profit waterfall") && detailText.includes("Percentile rank") && detailText.includes("Ryan Coogler"));
  check("detail repeats the theatrical-only disclaimer", detailText.includes("Excludes streaming, home entertainment"));
  check("detail flags the reported budget", detailText.includes("Reported budget"));
  await page.locator("#drawer button.person", { hasText: "Ryan Coogler" }).click();
  check("clicking a name in the detail filters the dashboard", /Showing 5 of/.test(await showing()) && (await page.locator("#detail").isHidden()));
  await page.click("#clear-all");
  // A real click on a dot opens the detail.
  const c = await page.locator("#scatter circle.dot").first().boundingBox();
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  check("clicking a scatter dot opens the detail", await page.locator("#detail").isVisible());
  await page.keyboard.press("Escape");

  // 7. Tables sort on every column.
  await page.click("#films-tabs button[data-tab=top]");
  const headers = await page.locator("#films-table thead th button").count();
  let sortable = 0;
  for (let i = 0; i < headers; i++) {
    await page.locator("#films-table thead th button").nth(i).click();
    if ((await page.locator("#films-table thead th").nth(i).getAttribute("aria-sort")) !== null) sortable++;
  }
  check("every films-table column sorts", sortable === headers && headers === 12, { headers, sortable });

  // 8. Phone width: no horizontal page scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL);
  await page.waitForSelector('[data-testid="tile-films"]');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no horizontal page scroll at 390px", overflow <= 0, overflow);

  check("no page errors and no network requests", problems.length === 0, problems);
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  if (asJson) process.stdout.write(JSON.stringify({ results, coogler }, null, 1));
  else {
    results.forEach((r) => console.log((r.ok ? "PASS " : "FAIL ") + r.name + (r.ok || r.detail === null ? "" : "  " + JSON.stringify(r.detail))));
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
