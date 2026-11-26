/* Theatrical profitability model: a line-for-line port of profit_model.py.
 * Keep the two in sync; tests/test_js_parity.py compares them on every film. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ProfitModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DISCLAIMER = "Theatrical estimate only. Excludes streaming, home entertainment, TV licensing, " +
    "merchandising, participations, and residuals.";

  function Inflation(cpi) {
    // cpi: {year: value}
    var years = Object.keys(cpi).map(Number).sort(function (a, b) { return a - b; });
    this.cpi = cpi;
    this.firstYear = years[0];
    this.latestYear = years[years.length - 1];
  }
  Inflation.prototype.factor = function (year) {
    if (year === null || year === undefined || year >= this.latestYear) return 1.0;
    var y = Math.max(year, this.firstYear);
    return this.cpi[this.latestYear] / this.cpi[y];
  };

  function isNum(v) { return v !== null && v !== undefined && !isNaN(v); }

  function tierIndex(budgetBasis, tiers) {
    for (var i = 0; i < tiers.length; i++) {
      var bound = tiers[i].max_budget;
      if (bound === null || bound === undefined) return i;
      var inclusive = tiers[i].max_inclusive === undefined ? true : tiers[i].max_inclusive;
      if (budgetBasis < bound || (inclusive && budgetBasis === bound)) return i;
    }
    return tiers.length - 1;
  }

  function paEstimate(budget, year, a, inflation) {
    if (!isNum(budget)) return [null, null];
    var factor = (a.pa_tiers_basis || "real") === "real" ? inflation.factor(year) : 1.0;
    var basis = budget * factor;
    var index = tierIndex(basis, a.pa_tiers);
    var tier = a.pa_tiers[index];
    var paBasis = tier.kind === "percent_of_budget" ? basis * tier.value : Number(tier.value);
    return [paBasis / factor, index];
  }

  function rentals(fin, a) {
    var r = a.rental_rates;
    var dom = fin.domestic_gross, intl = fin.international_gross;
    var ww = fin.worldwide_gross, china = fin.china_gross;
    var out = { domestic: null, international: null, china: null, total: null, method: null };
    if (isNum(dom) && isNum(intl)) {
      out.domestic = dom * r.domestic;
      if (isNum(china) && china <= intl) {
        out.international = (intl - china) * r.international_ex_china;
        out.china = china * r.china;
        out.method = "china_split";
      } else {
        out.international = intl * r.international_blended;
        out.china = 0.0;
        out.method = "blended";
      }
      out.total = out.domestic + out.international + out.china;
    } else if (isNum(ww)) {
      out.total = ww * r.worldwide_only;
      out.method = "worldwide_only";
    } else if (isNum(dom)) {
      out.domestic = dom * r.domestic;
      out.total = out.domestic;
      out.method = "domestic_only";
    }
    return out;
  }

  function compute(fin, year, a, inflation) {
    var budget = fin.production_budget, ww = fin.worldwide_gross;
    var dom = fin.domestic_gross, opening = fin.opening_weekend_domestic;
    var rent = rentals(fin, a);
    var pt = paEstimate(budget, year, a, inflation), pa = pt[0];
    var m = {
      rentals_domestic: rent.domestic,
      rentals_international: rent.international,
      rentals_china: rent.china,
      rentals_total: rent.total,
      rental_method: rent.method,
      effective_rental_rate: null,
      pa_estimate: pa,
      budget_tier: pt[1],
      total_cost: null,
      est_profit: null,
      est_roi: null,
      profitable: null,
      gross_multiple: null,
      breakeven_worldwide_gross: null,
      breakeven_multiple: null,
      opening_multiplier: null
    };
    if (ww && rent.total !== null) m.effective_rental_rate = rent.total / ww;
    if (budget) {
      m.total_cost = budget + pa;
      if (isNum(ww)) m.gross_multiple = ww / budget;
      if (rent.total !== null) {
        m.est_profit = rent.total - budget - pa;
        m.est_roi = m.est_profit / m.total_cost;
        m.profitable = m.est_profit > 0;
      }
      var rate = m.effective_rental_rate || a.rental_rates.worldwide_only;
      if (rate > 0) {
        m.breakeven_worldwide_gross = m.total_cost / rate;
        m.breakeven_multiple = m.breakeven_worldwide_gross / budget;
      }
    }
    if (isNum(dom) && opening) m.opening_multiplier = dom / opening;
    return m;
  }

  /* Breakeven worldwide gross for a hypothetical film with the given budget, used for the
   * scatter's reference line. budget is in the dollars of `year`; domShare is the domestic
   * share of worldwide gross. */
  function breakevenGross(budget, year, domShare, a, inflation) {
    var r = a.rental_rates;
    var rate = domShare * r.domestic + (1 - domShare) * r.international_blended;
    var pa = paEstimate(budget, year, a, inflation)[0];
    return rate > 0 ? (budget + pa) / rate : null;
  }

  function validate(a) {
    var keys = ["domestic", "international_ex_china", "china", "international_blended", "worldwide_only"];
    var r = a.rental_rates || {};
    for (var i = 0; i < keys.length; i++) {
      var v = r[keys[i]];
      if (!isNum(v) || v < 0 || v > 1) return "Rental rate '" + keys[i] + "' must be between 0% and 100%.";
    }
    var tiers = a.pa_tiers || [];
    if (!tiers.length) return "Add at least one P&A tier.";
    var prev = -1;
    for (var j = 0; j < tiers.length; j++) {
      var t = tiers[j], last = j === tiers.length - 1;
      if (last && t.max_budget !== null) return "The last P&A tier must have no upper bound.";
      if (!last && (!isNum(t.max_budget) || t.max_budget <= prev)) return "Tier " + (j + 1) + " upper bound must be above the previous tier's.";
      if (!isNum(t.value) || t.value < 0) return "Tier " + (j + 1) + " needs a non-negative value.";
      if (!last) prev = t.max_budget;
    }
    return null;
  }

  return {
    DISCLAIMER: DISCLAIMER,
    Inflation: Inflation,
    tierIndex: tierIndex,
    paEstimate: paEstimate,
    rentals: rentals,
    compute: compute,
    breakevenGross: breakevenGross,
    validate: validate
  };
});
