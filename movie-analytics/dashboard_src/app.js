/* Movie profitability dashboard. Plain JS + hand-rolled SVG; no network access. */
(function () {
  "use strict";

  // Data is inlined for the local file; a hosted copy may ship it beside the page instead.
  var holder = document.getElementById("movie-data");
  var inline = holder.textContent.trim();
  if (inline) boot(JSON.parse(inline));
  else {
    fetch(holder.getAttribute("data-src") || "movies.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(boot)
      .catch(function (e) {
        document.getElementById("subtitle").textContent = "Could not load the film data (" + e.message + "). Reload the page to try again.";
      });
  }

  function boot(DATA) {
  var PM = window.ProfitModel;
  var INF = new PM.Inflation(DATA.cpi);
  var LATEST = INF.latestYear;
  var DEFAULTS = DATA.assumptions;
  var STORE_KEY = "movie-analytics.assumptions.v1";
  var ROLE_KEYS = ["director", "producer", "executive_producer", "lead_cast"];
  var ROLE_LABEL = { director: "Director", producer: "Producer", executive_producer: "Executive producer", lead_cast: "Lead actor" };
  var ROLE_PLURAL = { director: "Directors", producer: "Producers", executive_producer: "Executive producers", lead_cast: "Lead cast" };
  var ROLE_HASH = { director: "dir", producer: "prod", executive_producer: "ep", lead_cast: "cast" };
  // Fixed genre -> categorical slot. Color follows the genre, never its rank; the rest share "Other".
  var GENRE_SLOT = { "Action": 1, "Adventure": 2, "Science Fiction": 3, "Comedy": 4, "Animation": 5, "Thriller": 6, "Drama": 7, "Horror": 8 };
  var GENRE_ORDER = ["Action", "Adventure", "Science Fiction", "Comedy", "Animation", "Thriller", "Drama", "Horror"];
  var MAX_GROUPS = 16;
  var PAGE = 100;

  // ------------------------------------------------------------------ utilities
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  var NS = "http://www.w3.org/2000/svg";
  function S(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function T(parent, x, y, text, cls, anchor) {
    var t = S("text", { x: x, y: y, "class": cls || "tick", "text-anchor": anchor || "start" }, parent);
    t.textContent = text;
    return t;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fold(s) { return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
  function isNum(v) { return v !== null && v !== undefined && typeof v === "number" && isFinite(v); }
  function median(arr) {
    var a = arr.filter(isNum).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
  function sum(arr) { return arr.reduce(function (s, v) { return s + v; }, 0); }
  function log10(v) { return Math.log(v) / Math.LN10; }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  // ------------------------------------------------------------------ formatting
  function money(v) {
    if (!isNum(v)) return "—";
    var a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 1e9) return s + "$" + (a / 1e9).toFixed(a >= 1e10 ? 1 : 2) + "B";
    if (a >= 1e6) return s + "$" + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + "M";
    if (a >= 1e3) return s + "$" + Math.round(a / 1e3) + "K";
    return s + "$" + Math.round(a);
  }
  function moneyFull(v) {
    if (!isNum(v)) return "—";
    return (v < 0 ? "−$" : "$") + Math.round(Math.abs(v)).toLocaleString("en-US");
  }
  function mult(v) {
    if (!isNum(v)) return "—";
    if (v >= 100) return Math.round(v).toLocaleString("en-US") + "×";
    if (v >= 10) return v.toFixed(1) + "×";
    return v.toFixed(2) + "×";
  }
  function pct(v) {
    if (!isNum(v)) return "—";
    var p = v * 100, a = Math.abs(p);
    var t = a >= 1000 ? Math.round(a).toLocaleString("en-US") : a >= 100 ? a.toFixed(0) : a.toFixed(1);
    return (p < 0 ? "−" : "+") + t + "%";
  }
  function share(v) { return isNum(v) ? Math.round(v * 100) + "%" : "—"; }
  function rate(v) { return +(v * 100).toFixed(2) + "%"; }
  function millions(v) { return "$" + +(v / 1e6).toFixed(2) + "M"; }
  function ordinal(n) {
    var r = Math.round(n), s = ["th", "st", "nd", "rd"], v = r % 100;
    return r + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  // ------------------------------------------------------------------ storage
  function storeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function storeSet(key, val) { try { if (val === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, val); } catch (e) { /* private mode */ } }

  // ------------------------------------------------------------------ assumptions
  function canonical(a) {
    var r = a.rental_rates || {};
    return JSON.stringify({
      r: ["domestic", "international_ex_china", "china", "international_blended", "worldwide_only"].map(function (k) { return +(+r[k]).toFixed(9); }),
      b: a.pa_tiers_basis || "real",
      t: (a.pa_tiers || []).map(function (t) {
        return [t.max_budget === null ? null : Math.round(t.max_budget), t.max_inclusive !== false, t.kind, +(+t.value).toFixed(9)];
      }),
      f: Math.round(a.roi_table_min_budget || 0)
    });
  }
  var DEFAULT_SIG = canonical(DEFAULTS);
  function loadAssumptions() {
    var raw = storeGet(STORE_KEY);
    if (raw) {
      try {
        var saved = JSON.parse(raw);
        // Only honour browser edits made on top of the current config file.
        if (saved.base === DEFAULT_SIG && !PM.validate(saved.value)) return saved.value;
      } catch (e) { /* ignore */ }
    }
    return clone(DEFAULTS);
  }
  function isDefault() { return canonical(A) === DEFAULT_SIG; }
  function saveAssumptions() {
    storeSet(STORE_KEY, isDefault() ? null : JSON.stringify({ base: DEFAULT_SIG, value: A }));
  }
  var A = loadAssumptions();

  function basisReal() { return (A.pa_tiers_basis || "real") === "real"; }
  function tierLabel(i) {
    var t = A.pa_tiers, lo = i > 0 ? t[i - 1].max_budget : null, hi = t[i].max_budget;
    if (hi === null || hi === undefined) return lo === null ? "Any budget" : "Over " + millions(lo);
    if (lo === null) return (t[i].max_inclusive === false ? "Under " : "Up to ") + millions(hi);
    return millions(lo) + "–" + millions(hi);
  }
  function tierCharge(t) { return t.kind === "percent_of_budget" ? rate(t.value) + " of budget" : millions(t.value); }
  function assumptionText() {
    var r = A.rental_rates;
    var tiers = A.pa_tiers.map(function (t, i) { return tierLabel(i) + " " + tierCharge(t); });
    return "rentals " + rate(r.domestic) + " of domestic gross, " + rate(r.international_blended) +
      " of international (China " + rate(r.china) + ", rest of world " + rate(r.international_ex_china) +
      " where a China split is known). P&A by budget tier" + (basisReal() ? " in " + LATEST + " dollars" : "") +
      ": " + tiers.join(" · ") + ".";
  }

  // ------------------------------------------------------------------ films
  var FILMS = DATA.movies.map(function (m) {
    m.k = INF.factor(m.year);
    m.decade = Math.floor(m.year / 10) * 10;
    m.genres = m.genres || [];
    m.people = m.people || {};
    if (m.franchise_known === undefined) m.franchise_known = true;
    return m;
  });
  var BY_ID = {};
  FILMS.forEach(function (f) { BY_ID[f.id] = f; });
  function recompute() { FILMS.forEach(function (f) { f.m = PM.compute(f.fin, f.year, A, INF); }); }
  recompute();
  function D(v, f) { return isNum(v) ? v * (state.infl ? f.k : 1) : null; }
  var UNKNOWN_FRANCHISE = FILMS.filter(function (f) { return !f.franchise_known; }).length;
  var YMIN = Math.min.apply(null, FILMS.map(function (f) { return f.year; }));
  var YMAX = Math.max.apply(null, FILMS.map(function (f) { return f.year; }));

  var PEOPLE = {};
  ROLE_KEYS.forEach(function (r) { PEOPLE[r] = {}; });
  FILMS.forEach(function (f) {
    ROLE_KEYS.forEach(function (r) {
      (f.people[r] || []).forEach(function (n) { (PEOPLE[r][n] = PEOPLE[r][n] || []).push(f.id); });
    });
  });
  var PEOPLE_LIST = {};
  ROLE_KEYS.forEach(function (r) {
    PEOPLE_LIST[r] = Object.keys(PEOPLE[r]).map(function (n) { return { name: n, n: PEOPLE[r][n].length, key: fold(n) }; })
      .sort(function (a, b) { return b.n - a.n || a.name.localeCompare(b.name); });
  });

  // ------------------------------------------------------------------ state
  function freshFilters() {
    return { y0: YMIN, y1: YMAX, genre: "", sd: "", tier: "", rating: "", fr: "all", minww: "", micro: false,
      people: { director: "", producer: "", executive_producer: "", lead_cast: "" } };
  }
  var state = {
    view: "dash", infl: false, f: freshFilters(), group: "genre", tab: "top",
    sorts: { top: { key: "roi", dir: -1 }, bottom: { key: "roi", dir: 1 }, all: { key: "ww", dir: -1 } },
    allLimit: PAGE, isolate: "", tableView: { groupbar: false, yearline: false },
    lb: { role: "director", min: 3, q: "", sort: { key: "profit", dir: -1 }, limit: PAGE },
    movie: null
  };

  function passes(f) {
    var F = state.f;
    if (f.year < F.y0 || f.year > F.y1) return false;
    if (F.genre && f.genres.indexOf(F.genre) < 0) return false;
    if (F.sd) {
      var v = F.sd.slice(2);
      if (F.sd.charAt(0) === "s" ? f.studio !== v : f.distributor !== v) return false;
    }
    if (F.tier !== "" && String(f.m.budget_tier) !== F.tier) return false;
    if (F.rating && (f.rating || "Not rated") !== F.rating) return false;
    if (F.fr === "franchise" && !f.franchise) return false;
    if (F.fr === "original" && (f.franchise || !f.franchise_known)) return false;
    var minww = parseFloat(F.minww);
    if (isNum(minww) && minww > 0) {
      var ww = D(f.fin.worldwide_gross, f);
      if (!isNum(ww) || ww < minww * 1e6) return false;
    }
    if (F.micro) {
      var b = D(f.fin.production_budget, f);
      if (isNum(b) && b < 1e6) return false;
    }
    for (var i = 0; i < ROLE_KEYS.length; i++) {
      var name = F.people[ROLE_KEYS[i]];
      if (name && (f.people[ROLE_KEYS[i]] || []).indexOf(name) < 0) return false;
    }
    return true;
  }
  function filtered() { return FILMS.filter(passes); }

  // ------------------------------------------------------------------ URL hash (shareable state)
  var lastHash = null;
  function writeHash() {
    var p = [], F = state.f;
    function add(k, v) { p.push(k + "=" + encodeURIComponent(v)); }
    if (state.view !== "dash") add("v", state.view);
    if (state.infl) add("infl", 1);
    if (F.y0 !== YMIN || F.y1 !== YMAX) add("y", F.y0 + "-" + F.y1);
    if (F.genre) add("g", F.genre);
    if (F.sd) add("sd", F.sd);
    if (F.tier !== "") add("t", F.tier);
    if (F.rating) add("r", F.rating);
    if (F.fr !== "all") add("fr", F.fr);
    if (F.minww) add("mw", F.minww);
    if (F.micro) add("mb", 1);
    ROLE_KEYS.forEach(function (r) { if (F.people[r]) add(ROLE_HASH[r], F.people[r]); });
    if (state.group !== "genre") add("grp", state.group);
    if (state.tab !== "top") add("tab", state.tab);
    if (state.lb.role !== "director") add("lbr", state.lb.role);
    if (state.lb.min !== 3) add("lbm", state.lb.min);
    if (state.movie) add("m", state.movie);
    var h = p.length ? "#" + p.join("&") : "";
    lastHash = h;
    if ((location.hash || "") === h) return;
    try { history.replaceState(null, "", h || location.pathname + location.search); }
    catch (e) { try { location.replace(h || "#"); } catch (e2) { /* ignore */ } }
  }
  function readHash() {
    var F = freshFilters(), raw = (location.hash || "").replace(/^#/, "");
    var q = {};
    raw.split("&").forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf("=");
      var k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? "" : kv.slice(i + 1);
      try { q[k] = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e) { q[k] = v; }
    });
    state.view = ["dash", "people", "assumptions"].indexOf(q.v) >= 0 ? q.v : "dash";
    state.infl = q.infl === "1";
    if (q.y && /^\d{4}-\d{4}$/.test(q.y)) {
      F.y0 = Math.max(YMIN, Math.min(YMAX, +q.y.slice(0, 4)));
      F.y1 = Math.max(F.y0, Math.min(YMAX, +q.y.slice(5)));
    }
    F.genre = q.g || ""; F.sd = q.sd || ""; F.tier = q.t || ""; F.rating = q.r || "";
    F.fr = ["franchise", "original"].indexOf(q.fr) >= 0 ? q.fr : "all";
    F.minww = q.mw || ""; F.micro = q.mb === "1";
    ROLE_KEYS.forEach(function (r) { F.people[r] = q[ROLE_HASH[r]] || ""; });
    state.f = F;
    state.group = GROUPS[q.grp] ? q.grp : "genre";
    state.tab = ["top", "bottom", "all"].indexOf(q.tab) >= 0 ? q.tab : "top";
    state.lb.role = ROLE_KEYS.indexOf(q.lbr) >= 0 ? q.lbr : "director";
    state.lb.min = q.lbm && isFinite(+q.lbm) ? +q.lbm : 3;
    state.movie = q.m && BY_ID[q.m] ? +q.m : null;
    lastHash = location.hash || "";
  }

  // ------------------------------------------------------------------ tooltip
  var tip = $("tooltip");
  function showTip(evt, title, rows) {
    tip.textContent = "";
    if (title) tip.appendChild(el("div", "tt-title", title));
    rows.forEach(function (r) {
      var row = el("div", "tt-row");
      var lab = el("span");
      if (r.cls) { var key = el("i", "tt-key " + r.cls); lab.appendChild(key); }
      lab.appendChild(document.createTextNode(r.label));
      row.appendChild(lab);
      row.appendChild(el("b", null, r.value));
      tip.appendChild(row);
    });
    tip.hidden = false;
    var x = evt.clientX, y = evt.clientY;
    if (x === undefined) { var b = evt.target.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var left = x + 14, top = y + 14;
    if (left + w > window.innerWidth - 8) left = x - w - 14;
    if (top + h > window.innerHeight - 8) top = y - h - 14;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
  }
  function hideTip() { tip.hidden = true; }

  // ------------------------------------------------------------------ scales & ticks
  function logDomain(lo, hi) {
    var a = log10(lo) - 0.12, b = log10(hi) + 0.12;
    if (b - a < 1) { var c = (a + b) / 2; a = c - 0.5; b = c + 0.5; }
    return [a, b];
  }
  function logTicks(d) {
    var out = [], span = d[1] - d[0], steps = span > 3.2 ? [1] : span > 1.6 ? [1, 3] : [1, 2, 5];
    for (var k = Math.floor(d[0]); k <= Math.ceil(d[1]); k++) {
      steps.forEach(function (s) { var v = s * Math.pow(10, k); var l = log10(v); if (l >= d[0] && l <= d[1]) out.push(v); });
    }
    return out;
  }
  function niceStep(span, count) {
    var raw = span / Math.max(1, count), mag = Math.pow(10, Math.floor(log10(raw))), r = raw / mag;
    return (r >= 5 ? 10 : r >= 2 ? 5 : r >= 1 ? 2 : 1) * mag;
  }
  function linTicks(lo, hi, count) {
    var step = niceStep(hi - lo, count), out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function axisMoney(v) {
    if (v >= 1e9) return "$" + +(v / 1e9).toFixed(1) + "B";
    if (v >= 1e6) return "$" + +(v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + +(v / 1e3).toFixed(1) + "K";
    return "$" + v;
  }
  function axisMult(v) { return (v >= 1000 ? (v / 1000) + "K" : +v.toFixed(2)) + "×"; }
  // Horizontal bar with a 4px rounded data end and a square baseline end.
  function hbarPath(x0, x1, y, h) {
    var r = Math.min(4, Math.abs(x1 - x0), h / 2);
    if (x1 >= x0) return "M" + x0 + "," + y + "H" + (x1 - r) + "Q" + x1 + "," + y + " " + x1 + "," + (y + r) + "V" + (y + h - r) + "Q" + x1 + "," + (y + h) + " " + (x1 - r) + "," + (y + h) + "H" + x0 + "Z";
    return "M" + x0 + "," + y + "H" + (x1 + r) + "Q" + x1 + "," + y + " " + x1 + "," + (y + r) + "V" + (y + h - r) + "Q" + x1 + "," + (y + h) + " " + (x1 + r) + "," + (y + h) + "H" + x0 + "Z";
  }
  function vbarPath(x, w, y0, y1) { // rounded at the data end (y1)
    var r = Math.min(4, Math.abs(y1 - y0), w / 2);
    if (y1 <= y0) return "M" + x + "," + y0 + "V" + (y1 + r) + "Q" + x + "," + y1 + " " + (x + r) + "," + y1 + "H" + (x + w - r) + "Q" + (x + w) + "," + y1 + " " + (x + w) + "," + (y1 + r) + "V" + y0 + "Z";
    return "M" + x + "," + y0 + "V" + (y1 - r) + "Q" + x + "," + y1 + " " + (x + r) + "," + y1 + "H" + (x + w - r) + "Q" + (x + w) + "," + y1 + " " + (x + w) + "," + (y1 - r) + "V" + y0 + "Z";
  }
  function genreSlot(g) { return GENRE_SLOT[g] || 0; }

  // ------------------------------------------------------------------ assumption notes
  function noteEl() {
    var d = el("div", "assume");
    var p = el("p");
    p.appendChild(el("strong", null, isDefault() ? "Assumptions: " : "Custom assumptions: "));
    p.appendChild(document.createTextNode(assumptionText() + " "));
    var b = el("button", "linkish", "Edit");
    b.type = "button";
    b.addEventListener("click", function () { setView("assumptions"); });
    p.appendChild(b);
    d.appendChild(p);
    d.appendChild(el("p", "disclaimer", PM.DISCLAIMER));
    return d;
  }
  function renderNotes() {
    Array.prototype.forEach.call(document.querySelectorAll(".note-slot"), function (slot) {
      slot.textContent = "";
      slot.appendChild(noteEl());
    });
    $("a-disclaimer").textContent = PM.DISCLAIMER;
  }

  // ------------------------------------------------------------------ header, banner, filters
  function renderHeader() {
    var ds = DATA.dataset || {};
    $("subtitle").textContent = FILMS.length.toLocaleString("en-US") + " films, " + YMIN + "–" + YMAX + " · source: " + (ds.file || "?") +
      (ds.tmdb_enriched ? " + TMDb" : "") + " · built " + String(DATA.generated_at || "").slice(0, 10);
    $("infl-real-btn").textContent = "Adjusted (" + LATEST + " $)";
    var banner = $("banner");
    banner.textContent = "";
    if (ds.source === "sample") {
      var b = el("div", "banner");
      b.appendChild(el("strong", null, "Sample data. "));
      b.appendChild(document.createTextNode(FILMS.length + " well-known films with approximate, widely reported figures, " +
        "so every view can be tested end to end. To analyse a real dataset, save it as data/boxoffice.csv " +
        "(columns in data/README.md) and rerun the three build commands."));
      banner.appendChild(b);
    }
  }

  function fillSelect(sel, options, value) {
    sel.textContent = "";
    options.forEach(function (o) {
      if (o.group) {
        var g = el("optgroup"); g.label = o.group;
        o.options.forEach(function (x) { var op = el("option", null, x.label); op.value = x.value; g.appendChild(op); });
        sel.appendChild(g);
      } else {
        var op = el("option", null, o.label); op.value = o.value; sel.appendChild(op);
      }
    });
    sel.value = value;
    if (sel.value !== value) sel.value = "";
  }
  function counts(fn) {
    var c = {};
    FILMS.forEach(function (f) { [].concat(fn(f)).forEach(function (k) { if (k) c[k] = (c[k] || 0) + 1; }); });
    return Object.keys(c).sort(function (a, b) { return a.localeCompare(b); }).map(function (k) { return { label: k + " (" + c[k] + ")", value: k }; });
  }
  function syncControls() {
    var F = state.f;
    fillSelect($("f-genre"), [{ label: "All genres", value: "" }].concat(counts(function (f) { return f.genres; })), F.genre);
    var studios = counts(function (f) { return f.studio; }).map(function (o) { return { label: o.label, value: "s:" + o.value }; });
    var dists = counts(function (f) { return f.distributor; }).map(function (o) { return { label: o.label, value: "d:" + o.value }; });
    fillSelect($("f-sd"), [{ label: "All studios & distributors", value: "" }, { group: "Distributor", options: dists }, { group: "Studio", options: studios }], F.sd);
    if (F.tier !== "" && +F.tier >= A.pa_tiers.length) F.tier = "";
    fillSelect($("f-tier"), [{ label: "All budgets", value: "" }].concat(A.pa_tiers.map(function (t, i) {
      return { label: tierLabel(i) + (basisReal() ? " (" + LATEST + " $)" : ""), value: String(i) };
    })), F.tier);
    fillSelect($("f-rating"), [{ label: "All ratings", value: "" }].concat(counts(function (f) { return f.rating || "Not rated"; })), F.rating);
    $("y0").min = $("y1").min = YMIN; $("y0").max = $("y1").max = YMAX;
    $("y0").value = F.y0; $("y1").value = F.y1;
    syncYears();
    $("f-minww").value = F.minww;
    $("f-micro").checked = F.micro;
    pressed($("f-fr"), "fr", F.fr);
    pressed($("infl-toggle"), "infl", state.infl ? "1" : "0");
    pressed($("group-toggle"), "group", state.group);
    pressed($("films-tabs"), "tab", state.tab, "aria-selected");
    pressed($("view-tabs"), "view", state.view, "aria-selected");
    pressed($("lb-role"), "role", state.lb.role);
    $("lb-min").value = String(state.lb.min);
    syncPickers();
  }
  function pressed(group, attr, value, aria) {
    Array.prototype.forEach.call(group.querySelectorAll("button[data-" + attr + "]"), function (b) {
      b.setAttribute(aria || "aria-pressed", String(b.getAttribute("data-" + attr) === String(value)));
    });
  }
  function syncYears() {
    var F = state.f, span = Math.max(1, YMAX - YMIN);
    $("year-out").textContent = F.y0 === F.y1 ? String(F.y0) : F.y0 + "–" + F.y1;
    $("y0").style.zIndex = F.y0 > YMIN + span / 2 ? 3 : 1; // keep the low thumb grabbable at the top end
    var a = (F.y0 - YMIN) / span, b = (F.y1 - YMIN) / span;
    var fill = $("year-fill");
    fill.style.left = "calc(8px + " + a + " * (100% - 16px))";
    fill.style.width = "calc(" + (b - a) + " * (100% - 16px))";
  }

  // Searchable name pickers fed from the people table.
  var pickerEls = {};
  function makePicker(role) {
    var wrap = el("div", "f picker");
    var id = "pick-" + role;
    var lab = el("label", null, ROLE_LABEL[role]);
    lab.htmlFor = id;
    var box = el("div", "box");
    var inp = el("input");
    inp.id = id; inp.type = "text"; inp.placeholder = "Any (" + PEOPLE_LIST[role].length + " names)"; inp.autocomplete = "off";
    inp.setAttribute("role", "combobox"); inp.setAttribute("aria-autocomplete", "list");
    inp.setAttribute("aria-expanded", "false"); inp.setAttribute("aria-controls", id + "-list");
    var clr = el("button", "clear", "×");
    clr.type = "button"; clr.setAttribute("aria-label", "Clear " + ROLE_LABEL[role] + " filter");
    var ul = el("ul"); ul.id = id + "-list"; ul.setAttribute("role", "listbox"); ul.hidden = true;
    box.appendChild(inp); box.appendChild(clr); box.appendChild(ul);
    wrap.appendChild(lab); wrap.appendChild(box);

    var items = [], active = -1;
    function open(q) {
      var key = fold(q);
      items = PEOPLE_LIST[role].filter(function (p) { return !key || p.key.indexOf(key) >= 0; }).slice(0, 50);
      ul.textContent = "";
      if (!items.length) ul.appendChild(el("li", "empty", "No matches"));
      items.forEach(function (p, i) {
        var li = el("li");
        li.id = id + "-opt-" + i;
        li.setAttribute("role", "option");
        li.appendChild(el("span", null, p.name));
        li.appendChild(el("span", "n", p.n + (p.n === 1 ? " film" : " films")));
        li.addEventListener("mousedown", function (e) { e.preventDefault(); choose(p.name); });
        ul.appendChild(li);
      });
      active = -1;
      ul.hidden = false;
      inp.setAttribute("aria-expanded", "true");
    }
    function close() { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); }
    function highlight(i) {
      active = Math.max(0, Math.min(items.length - 1, i));
      Array.prototype.forEach.call(ul.children, function (li, j) { li.setAttribute("aria-selected", String(j === active)); });
      var li = ul.children[active];
      if (li) { inp.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); }
    }
    function choose(name) {
      close();
      state.f.people[role] = name;
      if (state.view === "dash") { state.tab = "all"; state.allLimit = PAGE; }
      update();
      inp.blur();
    }
    inp.addEventListener("focus", function () { inp.select(); open(""); });
    inp.addEventListener("input", function () { open(inp.value); });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (ul.hidden) open(inp.value); highlight(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
      else if (e.key === "Enter") { e.preventDefault(); var p = items[active >= 0 ? active : 0]; if (p) choose(p.name); }
      else if (e.key === "Escape") { close(); inp.value = state.f.people[role]; inp.blur(); }
    });
    inp.addEventListener("blur", function () { close(); inp.value = state.f.people[role]; });
    clr.addEventListener("click", function () { state.f.people[role] = ""; update(); });
    pickerEls[role] = { inp: inp, clr: clr };
    return wrap;
  }
  function syncPickers() {
    ROLE_KEYS.forEach(function (r) {
      var p = pickerEls[r], v = state.f.people[r];
      if (document.activeElement !== p.inp) p.inp.value = v;
      p.inp.classList.toggle("has-value", !!v);
      p.clr.hidden = !v;
    });
  }

  function renderActive(rows) {
    var bar = $("active-bar"), F = state.f;
    bar.textContent = "";
    var lead = el("span", null, "Showing " + rows.length.toLocaleString("en-US") + " of " + FILMS.length.toLocaleString("en-US") + " films");
    lead.setAttribute("data-testid", "showing");
    bar.appendChild(lead);
    function chip(label, clear) {
      var c = el("span", "chip", label);
      var x = el("button", null, "×");
      x.type = "button"; x.setAttribute("aria-label", "Remove filter " + label);
      x.addEventListener("click", function () { clear(); update(); });
      c.appendChild(x);
      bar.appendChild(c);
    }
    if (F.y0 !== YMIN || F.y1 !== YMAX) chip("Years " + F.y0 + "–" + F.y1, function () { F.y0 = YMIN; F.y1 = YMAX; });
    if (F.genre) chip("Genre: " + F.genre, function () { F.genre = ""; });
    if (F.sd) chip((F.sd.charAt(0) === "s" ? "Studio: " : "Distributor: ") + F.sd.slice(2), function () { F.sd = ""; });
    if (F.tier !== "") chip("Budget " + tierLabel(+F.tier), function () { F.tier = ""; });
    if (F.rating) chip("Rated " + F.rating, function () { F.rating = ""; });
    if (F.fr !== "all") chip(F.fr === "franchise" ? "Franchise films" : "Original films", function () { F.fr = "all"; });
    if (F.fr !== "all" && UNKNOWN_FRANCHISE) bar.appendChild(el("span", null, "(excludes " + UNKNOWN_FRANCHISE.toLocaleString("en-US") + " films with unknown franchise status)"));
    if (parseFloat(F.minww) > 0) chip("Worldwide ≥ $" + F.minww + "M", function () { F.minww = ""; });
    if (F.micro) chip("Budget ≥ $1M", function () { F.micro = false; });
    ROLE_KEYS.forEach(function (r) {
      if (F.people[r]) chip(ROLE_LABEL[r] + ": " + F.people[r], function () { F.people[r] = ""; });
    });
  }

  // ------------------------------------------------------------------ overview tiles
  function renderTiles(rows) {
    var box = $("tiles");
    box.textContent = "";
    var mults = rows.map(function (f) { return f.m.gross_multiple; });
    var rois = rows.map(function (f) { return f.m.est_roi; });
    var scored = rows.filter(function (f) { return f.m.profitable !== null; });
    var wins = scored.filter(function (f) { return f.m.profitable; }).length;
    [
      ["films", "Films", rows.length.toLocaleString("en-US"), "of " + FILMS.length.toLocaleString("en-US") + " in the database"],
      ["mult", "Median gross multiple", mult(median(mults)), "worldwide gross ÷ reported budget"],
      ["roi", "Median estimated ROI", pct(median(rois)), "est. profit ÷ (budget + P&A)"],
      ["share", "Estimated profitable", scored.length ? share(wins / scored.length) : "—", wins.toLocaleString("en-US") + " of " + scored.length.toLocaleString("en-US") + " films with budget and gross"]
    ].forEach(function (t) {
      var tile = el("div", "tile");
      tile.setAttribute("data-testid", "tile-" + t[0]);
      tile.appendChild(el("div", "label", t[1]));
      tile.appendChild(el("div", "value", t[2]));
      tile.appendChild(el("div", "detail", t[3]));
      box.appendChild(tile);
    });
  }

  // ------------------------------------------------------------------ scatter
  function renderScatter(rows) {
    var box = $("scatter");
    box.textContent = "";
    var pts = rows.filter(function (f) { return f.fin.production_budget > 0 && f.fin.worldwide_gross > 0; })
      .map(function (f) { return { f: f, x: D(f.fin.production_budget, f), y: D(f.fin.worldwide_gross, f) }; });
    renderScatterLegend(pts);
    var missing = rows.length - pts.length;
    if (!pts.length) {
      box.appendChild(el("div", "empty-state", "No films with both a budget and a worldwide gross match these filters."));
      $("scatter-caption").textContent = "";
      return;
    }
    var W = Math.max(300, box.clientWidth || 800), H = W < 560 ? 320 : 430;
    var m = { l: 68, r: 18, t: 12, b: 46 };
    var xd = logDomain(Math.min.apply(null, pts.map(function (p) { return p.x; })), Math.max.apply(null, pts.map(function (p) { return p.x; })));
    var yd = logDomain(Math.min.apply(null, pts.map(function (p) { return p.y; })), Math.max.apply(null, pts.map(function (p) { return p.y; })));
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    function X(v) { return m.l + (log10(v) - xd[0]) / (xd[1] - xd[0]) * pw; }
    function Y(v) { return m.t + ph - (log10(v) - yd[0]) / (yd[1] - yd[0]) * ph; }
    var svg = S("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img",
      "aria-label": "Scatter of reported budget against worldwide gross for " + pts.length + " films" }, box);
    var clipId = "clip-scatter";
    var defs = S("defs", {}, svg);
    S("rect", { x: m.l, y: m.t, width: pw, height: ph }, S("clipPath", { id: clipId }, defs));

    logTicks(xd).forEach(function (v) {
      var x = X(v);
      S("line", { x1: x, x2: x, y1: m.t, y2: m.t + ph, "class": "gridline" }, svg);
      T(svg, x, m.t + ph + 16, axisMoney(v), "tick", "middle");
    });
    logTicks(yd).forEach(function (v) {
      var y = Y(v);
      S("line", { x1: m.l, x2: m.l + pw, y1: y, y2: y, "class": "gridline" }, svg);
      T(svg, m.l - 6, y + 4, axisMoney(v), "tick", "end");
    });
    S("line", { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph, "class": "axisline" }, svg);
    var narrow = W < 560, dollars = state.infl ? LATEST + " $" : "nominal $";
    T(svg, m.l + pw / 2, H - 6, narrow ? "Reported budget* (log, " + dollars + ")" : "Reported production budget* (log scale, " + dollars + ")", "axis-title", "middle");
    var yt = T(svg, 0, 0, narrow ? "Worldwide gross (log)" : "Worldwide gross (log scale)", "axis-title", "middle");
    yt.setAttribute("transform", "translate(12," + (m.t + ph / 2) + ") rotate(-90)");

    // Breakeven reference line under the active assumptions.
    var shares = rows.map(function (f) { return f.fin.worldwide_gross > 0 && isNum(f.fin.domestic_gross) ? f.fin.domestic_gross / f.fin.worldwide_gross : null; });
    var domShare = median(shares);
    if (!isNum(domShare)) domShare = 0.4;
    var refYear = state.infl ? LATEST : Math.round(median(pts.map(function (p) { return p.f.year; })));
    var d = "", N = 320, lastBe = null;
    for (var i = 0; i <= N; i++) {
      var b = Math.pow(10, xd[0] + (xd[1] - xd[0]) * i / N);
      var be = PM.breakevenGross(b, refYear, domShare, A, INF);
      if (!isNum(be) || be <= 0) continue;
      d += (d ? "L" : "M") + X(b).toFixed(2) + "," + Y(be).toFixed(2);
      lastBe = { x: X(b), y: Y(be) };
    }
    var g = S("g", { "clip-path": "url(#" + clipId + ")" }, svg);
    if (d) {
      var line = S("path", { d: d, "class": "be-line" }, g);
      line.setAttribute("data-testid", "breakeven-line");
    }

    // Dots: largest grosses first so small films sit on top.
    pts.sort(function (a, b) { return b.y - a.y; });
    var dotsG = S("g", {}, g);
    pts.forEach(function (p) {
      p.cx = X(p.x); p.cy = Y(p.y);
      var slot = genreSlot(p.f.genre);
      var cls = "dot gc-" + slot + (p.f.m.profitable === false ? " hollow" : "");
      var iso = state.isolate;
      if (iso && !(iso === "__other" ? slot === 0 : p.f.genre === iso)) cls += " dim";
      p.node = S("circle", { cx: p.cx.toFixed(2), cy: p.cy.toFixed(2), r: 5, "class": cls }, dotsG);
    });

    // Selective direct labels: the biggest grosser and the best / worst ROI (budget >= floor).
    var floor = A.roi_table_min_budget || 0;
    var ranked = pts.filter(function (p) { return isNum(p.f.m.est_roi) && p.x >= floor; })
      .sort(function (a, b) { return b.f.m.est_roi - a.f.m.est_roi; });
    var picks = [pts[0]];
    if (ranked.length) { picks.push(ranked[0]); picks.push(ranked[ranked.length - 1]); }
    var labelled = {};
    picks.forEach(function (p) {
      if (!p || labelled[p.f.id]) return;
      labelled[p.f.id] = true;
      var right = p.cx + 9 + p.f.title.length * 6.6 < W - 4; // estimated label width must fit
      var t = T(svg, p.cx + (right ? 9 : -9), p.cy + 4, p.f.title, "lbl-ink halo", right ? "start" : "end");
      t.setAttribute("pointer-events", "none");
    });

    // Nearest-point hover layer (24px reach) + click to open the film.
    var hot = null;
    var overlay = S("rect", { x: m.l, y: m.t, width: pw, height: ph, "class": "hit" }, svg);
    function nearest(evt) {
      var r = svg.getBoundingClientRect(), sx = W / r.width;
      var mx = (evt.clientX - r.left) * sx, my = (evt.clientY - r.top) * sx;
      var best = null, bd = 24 * sx * 24 * sx;
      pts.forEach(function (p) {
        var dx = p.cx - mx, dy = p.cy - my, dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = p; }
      });
      return best;
    }
    overlay.addEventListener("pointermove", function (evt) {
      var p = nearest(evt);
      if (hot && hot !== p) hot.node.classList.remove("hot");
      hot = p;
      if (!p) { hideTip(); overlay.style.cursor = "default"; return; }
      overlay.style.cursor = "pointer";
      p.node.classList.add("hot");
      dotsG.appendChild(p.node);
      var f = p.f;
      showTip(evt, f.title + " (" + f.year + ")", [
        { label: f.genre || "Unknown genre", value: f.m.profitable === null ? "—" : f.m.profitable ? "Est. profitable" : "Est. unprofitable", cls: "gc-" + genreSlot(f.genre) },
        { label: "Reported budget", value: money(p.x) },
        { label: "Worldwide gross", value: money(p.y) },
        { label: "Gross multiple", value: mult(f.m.gross_multiple) },
        { label: "Breakeven multiple", value: mult(f.m.breakeven_multiple) },
        { label: "Est. profit", value: money(D(f.m.est_profit, f)) },
        { label: "Est. ROI", value: pct(f.m.est_roi) }
      ]);
    });
    overlay.addEventListener("pointerleave", function () { if (hot) hot.node.classList.remove("hot"); hot = null; hideTip(); });
    overlay.addEventListener("click", function (evt) { var p = nearest(evt); if (p) { hideTip(); openMovie(p.f.id); } });

    var cap = "Dashed line: worldwide gross at which estimated rentals cover budget + P&A, assuming a " +
      Math.round(domShare * 100) + "% domestic share (median of films shown)" +
      (!state.infl && basisReal() ? "; P&A tiers deflated to " + refYear + " dollars (median release year)" : "") +
      ". Dots above it roughly break even; each dot's fill uses the film's own mix (hollow = estimated unprofitable)." +
      (missing > 0 ? " " + missing + " film" + (missing === 1 ? "" : "s") + " without a budget or gross not plotted." : "") +
      " Colour = primary genre; click a legend entry to isolate it.";
    $("scatter-caption").textContent = cap;
    box.setAttribute("data-breakeven", d.slice(0, 60));
  }

  function renderScatterLegend(pts) {
    var box = $("scatter-legend");
    box.textContent = "";
    var c = {};
    pts.forEach(function (p) { var k = genreSlot(p.f.genre) ? p.f.genre : "__other"; c[k] = (c[k] || 0) + 1; });
    GENRE_ORDER.concat(["__other"]).forEach(function (g) {
      if (!c[g]) return;
      var b = el("button");
      b.type = "button";
      b.className = "gc-" + (g === "__other" ? 0 : GENRE_SLOT[g]);
      b.setAttribute("aria-pressed", String(state.isolate === g));
      b.appendChild(el("span", "sw"));
      b.appendChild(document.createTextNode(g === "__other" ? "Other genres" : g));
      b.appendChild(el("span", "n", String(c[g])));
      b.addEventListener("click", function () { state.isolate = state.isolate === g ? "" : g; renderScatter(filtered()); });
      box.appendChild(b);
    });
    var hollow = el("span", "static"); hollow.appendChild(el("span", "sw hollow")); hollow.appendChild(document.createTextNode("Hollow = est. unprofitable"));
    var be = el("span", "static"); be.appendChild(el("span", "sw line")); be.appendChild(document.createTextNode("Breakeven under current assumptions"));
    box.appendChild(hollow);
    box.appendChild(be);
  }

  // ------------------------------------------------------------------ grouped ROI bars
  var GROUPS = {
    genre: { label: "genre", key: function (f) { return f.genre || "Unknown"; } },
    studio: { label: "studio", key: function (f) { return f.studio || "Unknown"; } },
    distributor: { label: "distributor", key: function (f) { return f.distributor || "Unknown"; } },
    decade: { label: "decade", key: function (f) { return f.decade + "s"; }, order: function (f) { return f.decade; } },
    tier: { label: "budget tier", key: function (f) { return isNum(f.m.budget_tier) ? tierLabel(f.m.budget_tier) + (basisReal() ? " (" + LATEST + " $)" : "") : "No budget"; },
      order: function (f) { return isNum(f.m.budget_tier) ? f.m.budget_tier : 99; } },
    rating: { label: "MPAA rating", key: function (f) { return f.rating || "Not rated"; } },
    franchise: { label: "franchise status", key: function (f) { return f.franchise ? "Franchise" : f.franchise_known ? "Original" : "Status unknown"; } }
  };
  function statsFor(key, films, order) {
    var scored = films.filter(function (f) { return f.m.profitable !== null; });
    return {
      key: key, films: films, n: films.length, order: order,
      roi: median(films.map(function (f) { return f.m.est_roi; })),
      mult: median(films.map(function (f) { return f.m.gross_multiple; })),
      share: scored.length ? scored.filter(function (f) { return f.m.profitable; }).length / scored.length : null,
      nRoi: films.filter(function (f) { return isNum(f.m.est_roi); }).length
    };
  }
  function groupStats(rows, dim) {
    var g = GROUPS[dim], map = {}, ord = {};
    rows.forEach(function (f) { var k = g.key(f); (map[k] = map[k] || []).push(f); if (g.order) ord[k] = g.order(f); });
    var list = Object.keys(map).map(function (k) { return statsFor(k, map[k], ord[k]); }).filter(function (s) { return s.nRoi > 0; });
    if (!g.order && list.length > MAX_GROUPS) {
      list.sort(function (a, b) { return b.n - a.n || a.key.localeCompare(b.key); });
      var rest = list.slice(MAX_GROUPS - 1);
      list = list.slice(0, MAX_GROUPS - 1);
      list.push(statsFor("All others (" + rest.length + " groups)", [].concat.apply([], rest.map(function (s) { return s.films; })), 1e9));
      list[list.length - 1].other = true;
    }
    list.sort(function (a, b) {
      if (g.order) return a.order - b.order;
      if (a.other !== b.other) return a.other ? 1 : -1;
      return b.roi - a.roi;
    });
    return list;
  }
  // Cap the axis when one or two medians dwarf the rest, so the others stay readable.
  function axisCap(values) {
    var pos = values.filter(function (v) { return v > 0; }).sort(function (a, b) { return b - a; });
    if (pos.length < 2) return pos[0] || 0;
    var cap = pos[0];
    for (var i = 0; i < Math.max(1, Math.floor(pos.length / 2)); i++) {
      if (pos[i] > 5 * pos[i + 1] && pos[i + 1] > 0) cap = pos[i + 1] * 1.25; else break;
    }
    return cap;
  }
  function renderGroupBar(rows) {
    var box = $("groupbar"), dim = state.group;
    box.textContent = "";
    $("group-name").textContent = GROUPS[dim].label;
    var list = groupStats(rows, dim);
    if (!list.length) { box.appendChild(el("div", "empty-state", "No films with an ROI estimate match these filters.")); return; }
    if (state.tableView.groupbar) {
      renderTable(box, [
        { key: "key", label: GROUPS[dim].label.charAt(0).toUpperCase() + GROUPS[dim].label.slice(1), get: function (s) { return s.key; } },
        { key: "n", label: "Films", num: true, get: function (s) { return s.n; }, fmt: String },
        { key: "roi", label: "Median est. ROI", num: true, get: function (s) { return s.roi; }, fmt: pct },
        { key: "mult", label: "Median gross ×", num: true, get: function (s) { return s.mult; }, fmt: mult },
        { key: "share", label: "Est. profitable", num: true, get: function (s) { return s.share; }, fmt: share }
      ], list, null, null);
      return;
    }
    var W = Math.max(300, box.clientWidth || 600), rowH = 30, labelW = Math.min(210, Math.round(W * 0.38));
    var m = { l: labelW, r: 70, t: 22, b: 8 }, H = m.t + list.length * rowH + m.b, pw = W - m.l - m.r;
    var vals = list.map(function (s) { return s.roi; });
    var cap = axisCap(vals);
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, cap);
    if (hi - lo < 0.05) hi = lo + 0.05;
    function X(v) { return m.l + (v - lo) / (hi - lo) * pw; }
    var svg = S("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": "Median estimated ROI by " + GROUPS[dim].label }, box);
    linTicks(lo, hi, W < 500 ? 3 : 5).forEach(function (v) {
      S("line", { x1: X(v), x2: X(v), y1: m.t - 4, y2: H - m.b, "class": "gridline" }, svg);
      T(svg, X(v), m.t - 8, Math.round(v * 100).toLocaleString("en-US").replace("-", "−") + "%", "tick", "middle");
    });
    var maxChars = Math.floor((labelW - 12) / 6.6);
    list.forEach(function (s, i) {
      var y = m.t + i * rowH, bh = 16, by = y + (rowH - bh) / 2;
      var name = s.key.length > maxChars - 5 ? s.key.slice(0, maxChars - 6) + "…" : s.key;
      var lt = T(svg, m.l - 10, by + 12, "", "lbl-ink", "end");
      var t1 = S("tspan", {}, lt); t1.textContent = name + " ";
      var t2 = S("tspan", { "class": "lbl-2" }, lt); t2.textContent = "(" + s.n + ")";
      S("title", {}, lt).textContent = s.key;
      var v = s.roi, truncated = v > cap, vEnd = truncated ? cap : v;
      var bar = S("path", { d: hbarPath(X(0), X(vEnd), by, bh), "class": "bar " + (v >= 0 ? "pos" : "neg") }, svg);
      if (truncated) {
        var bx = X(cap) - 14;
        S("line", { x1: bx, y1: by + bh + 2, x2: bx + 6, y2: by - 2, "class": "brk" }, svg);
        S("line", { x1: bx + 5, y1: by + bh + 2, x2: bx + 11, y2: by - 2, "class": "brk" }, svg);
      }
      if (truncated) T(svg, X(cap) - 20, by + 12, pct(v), "val-in", "end"); // bar runs past the cut axis
      else T(svg, v >= 0 ? X(vEnd) + 6 : X(0) + 6, by + 12, pct(v), "val", "start");
      var hit = S("rect", { x: 0, y: y, width: W, height: rowH, "class": "hit", tabindex: 0 }, svg);
      function tipFor(evt) {
        bar.classList.add("hot");
        showTip(evt, s.key, [
          { label: "Median est. ROI" + (truncated ? " (bar cut to fit)" : ""), value: pct(s.roi) },
          { label: "Median gross multiple", value: mult(s.mult) },
          { label: "Est. profitable", value: share(s.share) },
          { label: "Films", value: String(s.n) }
        ]);
      }
      hit.addEventListener("pointermove", tipFor);
      hit.addEventListener("focus", tipFor);
      hit.addEventListener("pointerleave", function () { bar.classList.remove("hot"); hideTip(); });
      hit.addEventListener("blur", function () { bar.classList.remove("hot"); hideTip(); });
    });
    S("line", { x1: X(0), x2: X(0), y1: m.t - 4, y2: H - m.b, "class": "axisline" }, svg);
  }

  // ------------------------------------------------------------------ gross multiple by year
  function renderYearLine(rows) {
    var box = $("yearline");
    box.textContent = "";
    var map = {};
    rows.forEach(function (f) { if (isNum(f.m.gross_multiple)) (map[f.year] = map[f.year] || []).push(f); });
    var pts = Object.keys(map).map(Number).sort(function (a, b) { return a - b; }).map(function (y) {
      var fs = map[y];
      return { year: y, films: fs, n: fs.length, v: median(fs.map(function (f) { return f.m.gross_multiple; })),
        roi: median(fs.map(function (f) { return f.m.est_roi; })) };
    });
    if (!pts.length) { box.appendChild(el("div", "empty-state", "No films with a budget and gross match these filters.")); return; }
    var be = median(rows.map(function (f) { return f.m.breakeven_multiple; }));
    if (state.tableView.yearline) {
      renderTable(box, [
        { key: "year", label: "Year", get: function (p) { return p.year; }, fmt: String },
        { key: "n", label: "Films", num: true, get: function (p) { return p.n; }, fmt: String },
        { key: "v", label: "Median gross ×", num: true, get: function (p) { return p.v; }, fmt: mult },
        { key: "roi", label: "Median est. ROI", num: true, get: function (p) { return p.roi; }, fmt: pct }
      ], pts, null, null);
      return;
    }
    var W = Math.max(280, box.clientWidth || 480), H = W < 420 ? 260 : 300;
    var m = { l: 50, r: 16, t: 18, b: 30 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
    var vals = pts.map(function (p) { return p.v; }).concat(isNum(be) ? [be] : []).concat([1]);
    var yd = logDomain(Math.min.apply(null, vals), Math.max.apply(null, vals));
    var x0 = pts[0].year - 0.5, x1 = pts[pts.length - 1].year + 0.5;
    if (x1 - x0 < 4) { x0 -= 2; x1 += 2; }
    function X(y) { return m.l + (y - x0) / (x1 - x0) * pw; }
    function Y(v) { return m.t + ph - (log10(v) - yd[0]) / (yd[1] - yd[0]) * ph; }
    var svg = S("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": "Median gross multiple by release year" }, box);
    logTicks(yd).forEach(function (v) {
      S("line", { x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v), "class": "gridline" }, svg);
      T(svg, m.l - 6, Y(v) + 4, axisMult(v), "tick", "end");
    });
    var span = x1 - x0, step = span <= 12 ? 2 : span <= 30 ? 5 : span <= 80 ? 10 : 20;
    for (var yr = Math.ceil(x0 / step) * step; yr <= x1; yr += step) T(svg, X(yr), m.t + ph + 18, String(yr), "tick", "middle");
    S("line", { x1: m.l, x2: m.l + pw, y1: m.t + ph, y2: m.t + ph, "class": "axisline" }, svg);
    $("yearline-be").textContent = isNum(be) ? " (" + mult(be) + ")" : "";
    if (isNum(be)) S("line", { x1: m.l, x2: m.l + pw, y1: Y(be), y2: Y(be), "class": "ref-line" }, svg);
    var d = "";
    pts.forEach(function (p, i) {
      var cmd = i > 0 && p.year - pts[i - 1].year === 1 ? "L" : "M";
      d += cmd + X(p.year).toFixed(2) + "," + Y(p.v).toFixed(2);
    });
    S("path", { d: d, "class": "series-line" }, svg);
    pts.forEach(function (p) { p.node = S("circle", { cx: X(p.year), cy: Y(p.v), r: 4, "class": "series-dot" }, svg); });
    var last = pts[pts.length - 1];
    T(svg, X(last.year) - 8, Y(last.v) - 9, mult(last.v), "val halo", "end");

    var cross = S("line", { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, "class": "crosshair", visibility: "hidden" }, svg);
    var overlay = S("rect", { x: m.l, y: m.t, width: pw, height: ph, "class": "hit" }, svg);
    overlay.addEventListener("pointermove", function (evt) {
      var r = svg.getBoundingClientRect(), mx = (evt.clientX - r.left) * W / r.width;
      var best = pts[0];
      pts.forEach(function (p) { if (Math.abs(X(p.year) - mx) < Math.abs(X(best.year) - mx)) best = p; });
      cross.setAttribute("x1", X(best.year)); cross.setAttribute("x2", X(best.year)); cross.setAttribute("visibility", "visible");
      var rowsT = [
        { label: "Median gross multiple", value: mult(best.v) },
        { label: "Median est. ROI", value: pct(best.roi) },
        { label: "Films", value: String(best.n) }
      ];
      if (best.n <= 4) best.films.forEach(function (f) { rowsT.push({ label: f.title, value: mult(f.m.gross_multiple) }); });
      showTip(evt, String(best.year), rowsT);
    });
    overlay.addEventListener("pointerleave", function () { cross.setAttribute("visibility", "hidden"); hideTip(); });
  }

  // ------------------------------------------------------------------ generic sortable table
  function renderTable(box, cols, rows, sort, onSort, opts) {
    opts = opts || {};
    var wrap = el("div", "table-wrap");
    var table = el("table", "data");
    var thead = el("thead"), tr = el("tr");
    var local = sort || { key: null, dir: -1 };
    var sorted = rows.slice();
    if (local.key) {
      var col = cols.filter(function (c) { return c.key === local.key; })[0];
      if (col) {
        sorted.sort(function (a, b) {
          var va = col.get(a), vb = col.get(b);
          var na = va === null || va === undefined || va === "", nb = vb === null || vb === undefined || vb === "";
          if (na || nb) return na === nb ? 0 : na ? 1 : -1; // blanks last either way
          if (typeof va === "string") return local.dir * va.localeCompare(vb);
          return local.dir * (va - vb);
        });
      }
    }
    cols.forEach(function (c) {
      var th = el("th", c.num ? "num" : null);
      th.scope = "col";
      if (c.title) th.title = c.title;
      if (onSort) {
        var b = el("button");
        b.type = "button";
        b.appendChild(el("span", null, c.label));
        if (local.key === c.key) {
          th.setAttribute("aria-sort", local.dir > 0 ? "ascending" : "descending");
          b.appendChild(el("span", "sort-ind", local.dir > 0 ? "▲" : "▼"));
        }
        b.addEventListener("click", function () {
          var dir = local.key === c.key ? -local.dir : (c.num ? -1 : 1);
          onSort({ key: c.key, dir: dir });
        });
        th.appendChild(b);
      } else {
        th.textContent = c.label;
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    var tbody = el("tbody");
    var shown = opts.limit ? sorted.slice(0, opts.limit) : sorted;
    shown.forEach(function (row, i) {
      var r = el("tr");
      cols.forEach(function (c) {
        var td = el("td", (c.num ? "num " : "") + (c.cls || ""));
        if (c.render) c.render(td, row, i);
        else {
          var v = c.get(row);
          td.textContent = c.fmt ? c.fmt(v) : (v === null || v === undefined ? "—" : v);
          if (c.signed && isNum(v)) td.classList.add(v >= 0 ? "pos-t" : "neg-t");
        }
        r.appendChild(td);
      });
      tbody.appendChild(r);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    box.appendChild(wrap);
    return sorted.length;
  }

  // ------------------------------------------------------------------ films table
  function filmCols() {
    return [
      { key: "title", label: "Film", cls: "title", get: function (f) { return f.title; },
        render: function (td, f) {
          var b = el("button", "linkish", f.title);
          b.type = "button";
          b.addEventListener("click", function () { openMovie(f.id); });
          td.appendChild(b);
        } },
      { key: "year", label: "Year", get: function (f) { return f.year; }, fmt: String, num: true },
      { key: "genre", label: "Genre", get: function (f) { return f.genre || ""; } },
      { key: "distributor", label: "Distributor", get: function (f) { return f.distributor || ""; } },
      { key: "rating", label: "Rating", get: function (f) { return f.rating || ""; } },
      { key: "budget", label: "Budget*", num: true, title: "Reported production budget: often wrong", get: function (f) { return D(f.fin.production_budget, f); }, fmt: money },
      { key: "ww", label: "Worldwide", num: true, get: function (f) { return D(f.fin.worldwide_gross, f); }, fmt: money },
      { key: "mult", label: "Gross ×", num: true, title: "Worldwide gross ÷ reported budget", get: function (f) { return f.m.gross_multiple; }, fmt: mult },
      { key: "be", label: "Breakeven ×", num: true, title: "Gross multiple needed to cover budget + P&A at this film's market mix", get: function (f) { return f.m.breakeven_multiple; }, fmt: mult },
      { key: "profit", label: "Est. profit", num: true, signed: true, get: function (f) { return D(f.m.est_profit, f); }, fmt: money },
      { key: "roi", label: "Est. ROI", num: true, signed: true, get: function (f) { return f.m.est_roi; }, fmt: pct },
      { key: "legs", label: "Legs", num: true, title: "Domestic gross ÷ opening weekend", get: function (f) { return f.m.opening_multiplier; }, fmt: mult }
    ];
  }
  function personFilterText() {
    var parts = [];
    ROLE_KEYS.forEach(function (r) { if (state.f.people[r]) parts.push(state.f.people[r] + " (" + ROLE_LABEL[r].toLowerCase() + ")"); });
    return parts.join(", ");
  }
  function renderFilms(rows) {
    var box = $("films-table"), more = $("films-more"), tab = state.tab;
    box.textContent = ""; more.textContent = "";
    var floor = A.roi_table_min_budget || 0;
    var eligible = rows.filter(function (f) { var b = D(f.fin.production_budget, f); return isNum(f.m.est_roi) && isNum(b) && b >= floor; })
      .sort(function (a, b) { return b.m.est_roi - a.m.est_roi; });
    $("tab-all").textContent = "All films (" + rows.length + ")";
    var set, sub;
    var person = personFilterText();
    if (tab === "all") {
      set = rows;
      $("films-title").textContent = person ? "Filmography: " + person : "All films matching the filters";
      sub = rows.length + " films. Click a column to sort, a title for the full breakdown.";
    } else {
      set = tab === "top" ? eligible.slice(0, 25) : eligible.slice(-25).reverse();
      $("films-title").textContent = (tab === "top" ? "Top 25" : "Bottom 25") + " films by estimated ROI";
      sub = "Only films with a reported budget of at least " + money(floor) + " (" + eligible.length + " of " + rows.length + " shown qualify)." +
        (eligible.length < 50 && eligible.length > 25 ? " Fewer than 50 qualify, so the top and bottom lists overlap." : "");
    }
    $("films-sub").textContent = sub;
    if (!set.length) { box.appendChild(el("div", "empty-state", "No films match these filters.")); return; }
    var total = renderTable(box, filmCols(), set, state.sorts[tab], function (s) { state.sorts[tab] = s; renderFilms(filtered()); },
      { limit: tab === "all" ? state.allLimit : 0 });
    if (tab === "all" && total > state.allLimit) {
      var b = el("button", "btn", "Show " + Math.min(PAGE, total - state.allLimit) + " more (" + (total - state.allLimit) + " hidden)");
      b.type = "button";
      b.addEventListener("click", function () { state.allLimit += PAGE; renderFilms(filtered()); });
      more.appendChild(b);
    }
  }

  // ------------------------------------------------------------------ people leaderboard
  function leaderboard(rows) {
    var role = state.lb.role, map = {};
    rows.forEach(function (f) { (f.people[role] || []).forEach(function (n) { (map[n] = map[n] || []).push(f); }); });
    var q = fold(state.lb.q);
    return Object.keys(map).map(function (n) {
      var fs = map[n];
      var profits = fs.map(function (f) { return D(f.m.est_profit, f); }).filter(isNum);
      var scored = fs.filter(function (f) { return f.m.profitable !== null; });
      return {
        name: n, films: fs.length,
        mult: median(fs.map(function (f) { return f.m.gross_multiple; })),
        roi: median(fs.map(function (f) { return f.m.est_roi; })),
        profit: profits.length ? sum(profits) : null,
        share: scored.length ? scored.filter(function (f) { return f.m.profitable; }).length / scored.length : null
      };
    }).filter(function (p) { return p.films >= state.lb.min && (!q || fold(p.name).indexOf(q) >= 0); });
  }
  function applyPerson(role, name) {
    state.f.people[role] = name;
    state.view = "dash";
    state.tab = "all";
    state.allLimit = PAGE;
    closeMovie(true);
    update();
    var card = $("films-card");
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function renderPeople(rows) {
    var box = $("lb-table"), more = $("lb-more"), role = state.lb.role;
    box.textContent = ""; more.textContent = "";
    var list = leaderboard(rows);
    var credited = rows.filter(function (f) { return (f.people[role] || []).length; }).length;
    $("lb-sub").textContent = ROLE_PLURAL[role] + " ranked by the economics of their films: " + list.length + " " +
      (list.length === 1 ? "person" : "people") + " with at least " + state.lb.min + " film" + (state.lb.min === 1 ? "" : "s") +
      ". " + credited.toLocaleString("en-US") + " of the " + rows.length.toLocaleString("en-US") + " films matching the dashboard filters have " +
      ROLE_LABEL[role].toLowerCase() + " credits in the data" + (credited < rows.length ? " (a TMDb key fills the rest)" : "") +
      ". Click a name to filter the dashboard to their films.";
    if (!list.length) { box.appendChild(el("div", "empty-state", "Nobody meets the minimum film count for these filters. Lower the minimum or widen the filters.")); return; }
    var cols = [
      { key: "rank", label: "#", cls: "rank", get: function () { return null; }, render: function (td, p, i) { td.textContent = String(i + 1); } },
      { key: "name", label: "Name", get: function (p) { return p.name; },
        render: function (td, p) {
          var b = el("button", "linkish", p.name);
          b.type = "button";
          b.setAttribute("data-person", p.name);
          b.addEventListener("click", function () { applyPerson(role, p.name); });
          td.appendChild(b);
        } },
      { key: "films", label: "Films", num: true, get: function (p) { return p.films; }, fmt: String },
      { key: "mult", label: "Median gross ×", num: true, get: function (p) { return p.mult; }, fmt: mult },
      { key: "roi", label: "Median est. ROI", num: true, signed: true, get: function (p) { return p.roi; }, fmt: pct },
      { key: "profit", label: "Total est. profit", num: true, signed: true, get: function (p) { return p.profit; }, fmt: money },
      { key: "share", label: "Est. profitable", num: true, get: function (p) { return p.share; }, fmt: share }
    ];
    var total = renderTable(box, cols, list, state.lb.sort, function (s) {
      if (s.key === "rank") return;
      state.lb.sort = s; renderPeople(filtered());
    }, { limit: state.lb.limit });
    if (total > state.lb.limit) {
      var b = el("button", "btn", "Show more (" + (total - state.lb.limit) + " hidden)");
      b.type = "button";
      b.addEventListener("click", function () { state.lb.limit += PAGE; renderPeople(filtered()); });
      more.appendChild(b);
    }
  }

  // ------------------------------------------------------------------ assumptions editor
  function field(label, value, unit, onInput, help) {
    var f = el("div", "field");
    var id = "a-" + label.replace(/\W+/g, "-").toLowerCase();
    var l = el("label", null, label); l.htmlFor = id;
    var row = el("div", "inp");
    var inp = el("input"); inp.id = id; inp.type = "number"; inp.step = "any"; inp.min = "0"; inp.value = value; inp.inputMode = "decimal";
    inp.addEventListener("input", function () { onInput(inp.value === "" ? NaN : +inp.value); });
    row.appendChild(inp);
    if (unit) row.appendChild(el("span", "unit", unit));
    f.appendChild(l); f.appendChild(row);
    if (help) { var h = el("div", "footnote", help); h.style.margin = "0"; f.appendChild(h); }
    return f;
  }
  var draft = null;
  function renderAssumptionsForm() {
    var box = $("assumptions-form");
    box.textContent = "";
    draft = clone(A);
    var r = draft.rental_rates;
    box.appendChild(el("h3", "section-title", "Rental rates: the studio's share of box office gross"));
    var g = el("div", "form-grid");
    [["Domestic", "domestic", "US + Canada"],
      ["International (blended)", "international_blended", "all international gross when no China split is known"],
      ["International ex-China", "international_ex_china", "used only for films with a China split"],
      ["China", "china", "used only for films with a China split"],
      ["Worldwide-only fallback", "worldwide_only", "films with a worldwide figure but no domestic split"]
    ].forEach(function (x) {
      g.appendChild(field(x[0], +(r[x[1]] * 100).toFixed(4), "%", function (v) { r[x[1]] = v / 100; applyDraft(); }, x[2]));
    });
    box.appendChild(g);

    box.appendChild(el("h3", "section-title", "Prints & advertising (P&A) estimate by budget tier"));
    var t = el("table", "tier-table");
    var head = el("tr");
    ["Tier", "Budget up to ($M)", "Includes bound", "Charge", "Value"].forEach(function (h) { head.appendChild(el("th", null, h)); });
    var thead = el("thead"); thead.appendChild(head); t.appendChild(thead);
    var tb = el("tbody");
    draft.pa_tiers.forEach(function (tier, i) {
      var tr = el("tr"), last = i === draft.pa_tiers.length - 1;
      tr.appendChild(el("td", null, String(i + 1)));
      var c1 = el("td");
      if (last) c1.textContent = "No upper limit";
      else {
        var ub = el("input"); ub.type = "number"; ub.step = "any"; ub.min = "0"; ub.value = +(tier.max_budget / 1e6).toFixed(4);
        ub.setAttribute("aria-label", "Tier " + (i + 1) + " upper bound in millions");
        ub.addEventListener("input", function () { tier.max_budget = ub.value === "" ? NaN : +ub.value * 1e6; applyDraft(); });
        c1.appendChild(ub);
      }
      tr.appendChild(c1);
      var c2 = el("td", "c");
      if (!last) {
        var cb = el("input"); cb.type = "checkbox"; cb.checked = tier.max_inclusive !== false;
        cb.setAttribute("aria-label", "Tier " + (i + 1) + " includes its upper bound");
        cb.addEventListener("change", function () { tier.max_inclusive = cb.checked; applyDraft(); });
        c2.appendChild(cb);
      } else c2.textContent = "—";
      tr.appendChild(c2);
      var c3 = el("td"), sel = el("select");
      [["flat", "Flat amount ($M)"], ["percent_of_budget", "% of budget"]].forEach(function (o) {
        var op = el("option", null, o[1]); op.value = o[0]; sel.appendChild(op);
      });
      sel.value = tier.kind;
      sel.setAttribute("aria-label", "Tier " + (i + 1) + " charge type");
      var c4 = el("td"), val = el("input");
      val.type = "number"; val.step = "any"; val.min = "0";
      val.setAttribute("aria-label", "Tier " + (i + 1) + " value");
      function showVal() { val.value = tier.kind === "flat" ? +(tier.value / 1e6).toFixed(4) : +(tier.value * 100).toFixed(4); }
      showVal();
      sel.addEventListener("change", function () {
        tier.kind = sel.value;
        tier.value = sel.value === "flat" ? 12e6 : 0.5;
        showVal(); applyDraft();
      });
      val.addEventListener("input", function () {
        var v = val.value === "" ? NaN : +val.value;
        tier.value = tier.kind === "flat" ? v * 1e6 : v / 100;
        applyDraft();
      });
      c3.appendChild(sel); c4.appendChild(val);
      tr.appendChild(c3); tr.appendChild(c4);
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    var tw = el("div", "table-wrap"); tw.appendChild(t);
    box.appendChild(tw);
    var acts = el("div", "form-actions");
    var add = el("button", "btn", "Add tier"); add.type = "button";
    add.addEventListener("click", function () {
      var n = A.pa_tiers.length, prev = n > 1 ? A.pa_tiers[n - 2].max_budget : 5e6;
      A.pa_tiers.splice(n - 1, 0, { label: "", max_budget: prev * 2, max_inclusive: true, kind: "flat", value: A.pa_tiers[n - 1].kind === "flat" ? A.pa_tiers[n - 1].value : 12e6 });
      commitAssumptions(); renderAssumptionsForm();
    });
    var rem = el("button", "btn", "Remove tier above the open-ended one"); rem.type = "button";
    rem.disabled = A.pa_tiers.length < 2;
    rem.addEventListener("click", function () {
      if (A.pa_tiers.length < 2) return;
      A.pa_tiers.splice(A.pa_tiers.length - 2, 1);
      commitAssumptions(); renderAssumptionsForm();
    });
    acts.appendChild(add); acts.appendChild(rem);
    box.appendChild(acts);

    box.appendChild(el("h3", "section-title", "Which dollars the tiers are in"));
    var basis = el("div", "seg"); basis.setAttribute("role", "group"); basis.setAttribute("aria-label", "Tier basis");
    [["real", "Inflation-adjusted (" + LATEST + " $)"], ["nominal", "Nominal (as reported)"]].forEach(function (o) {
      var b = el("button", null, o[1]); b.type = "button";
      b.setAttribute("aria-pressed", String((draft.pa_tiers_basis || "real") === o[0]));
      b.addEventListener("click", function () { A.pa_tiers_basis = o[0]; commitAssumptions(); renderAssumptionsForm(); });
      basis.appendChild(b);
    });
    box.appendChild(basis);
    box.appendChild(el("p", "footnote", "Inflation-adjusted (default): a film's budget is converted to " + LATEST +
      " dollars to pick its tier, and flat amounts are read as " + LATEST + " dollars, so a $10.5M film from 1982 is not charged a modern $12M marketing spend."));
    box.appendChild(el("h3", "section-title", "Top / bottom ROI tables"));
    var g2 = el("div", "form-grid");
    g2.appendChild(field("Minimum budget", +((draft.roi_table_min_budget || 0) / 1e6).toFixed(4), "$M", function (v) { draft.roi_table_min_budget = v * 1e6; applyDraft(); },
      "films below this are left out of the ranked tables"));
    box.appendChild(g2);
    renderAssumptionStatus(null);
    renderImplied();
  }
  function applyDraft() {
    var err = PM.validate(draft);
    if (!err && !(draft.roi_table_min_budget >= 0)) err = "Minimum budget must be zero or more.";
    if (err) { renderAssumptionStatus(err); return; }
    A = clone(draft);
    commitAssumptions();
  }
  function commitAssumptions() {
    A.pa_tiers.forEach(function (t, i) { t.label = tierLabel(i); });
    recompute();
    saveAssumptions();
    renderAssumptionStatus(null);
    renderImplied();
    update(true);
  }
  function renderAssumptionStatus(err) {
    var s = $("a-status");
    s.textContent = "";
    s.className = "";
    if (err) { s.className = "error"; s.textContent = err + " Showing the last valid assumptions."; return; }
    if (isDefault()) { s.className = "ok-text"; s.textContent = "Matches config/assumptions.json."; }
    else s.textContent = "Custom assumptions, saved in this browser only. Download to make them the default.";
  }
  function renderImplied() {
    var box = $("a-implied");
    box.textContent = "";
    var rows = [5e6, 25e6, 75e6, 150e6, 300e6].map(function (b) {
      var pa = PM.paEstimate(b, LATEST, A, INF);
      var be = PM.breakevenGross(b, LATEST, 0.4, A, INF);
      return { b: b, tier: tierLabel(pa[1]), pa: pa[0], cost: b + pa[0], be: be, mult: be / b };
    });
    renderTable(box, [
      { key: "b", label: "Budget (" + LATEST + " $)", num: true, get: function (r) { return r.b; }, fmt: money },
      { key: "tier", label: "Tier", get: function (r) { return r.tier; } },
      { key: "pa", label: "P&A estimate", num: true, get: function (r) { return r.pa; }, fmt: money },
      { key: "cost", label: "Budget + P&A", num: true, get: function (r) { return r.cost; }, fmt: money },
      { key: "be", label: "Breakeven worldwide gross", num: true, get: function (r) { return r.be; }, fmt: money },
      { key: "mult", label: "Breakeven multiple", num: true, get: function (r) { return r.mult; }, fmt: mult }
    ], rows, null, null);
  }
  function assumptionsJson() {
    var out = clone(A);
    out.pa_tiers.forEach(function (t, i) { t.label = tierLabel(i).replace("–", "-"); });
    return JSON.stringify(out, null, 2) + "\n";
  }
  function copyAssumptions() {
    var text = assumptionsJson(), box = $("a-json"), status = $("a-status");
    function fallback() { // clipboard refused: show the JSON selected so it can be copied by hand
      box.value = text; box.hidden = false; box.focus(); box.select();
      status.className = ""; status.textContent = "Select-all and copy the JSON below.";
    }
    try {
      navigator.clipboard.writeText(text).then(function () {
        box.hidden = true; status.className = "ok-text"; status.textContent = "Copied. Paste it into config/assumptions.json.";
      }, fallback);
    } catch (e) { fallback(); }
  }
  function downloadAssumptions() {
    var blob = new Blob([assumptionsJson()], { type: "application/json" });
    var a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = "assumptions.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ------------------------------------------------------------------ movie detail
  var returnFocus = null;
  function openMovie(id) {
    returnFocus = document.activeElement;
    state.movie = id;
    writeHash();
    renderDetail();
  }
  function closeMovie(silent) {
    if (!state.movie && $("detail").hidden) return;
    state.movie = null;
    $("detail").hidden = true;
    document.body.style.overflow = "";
    if (!silent) {
      writeHash();
      if (returnFocus && returnFocus.focus) returnFocus.focus();
    }
  }
  function kvTable(pairs) {
    var t = el("table", "kv");
    pairs.forEach(function (p) {
      var tr = el("tr");
      var th = el("th", null, p[0]); th.scope = "row";
      var td = el("td", null, p[1]);
      if (p[2]) td.title = p[2];
      tr.appendChild(th); tr.appendChild(td); t.appendChild(tr);
    });
    return t;
  }
  function pctRank(value, values) {
    var below = 0, eq = 0;
    values.forEach(function (v) { if (v < value) below++; else if (v === value) eq++; });
    return (below + 0.5 * eq) / values.length * 100;
  }
  var METHOD_TEXT = {
    china_split: "domestic, international ex-China and China rates",
    blended: "domestic rate + blended international rate (no China split in the data)",
    worldwide_only: "worldwide-only fallback rate (no domestic/international split)",
    domestic_only: "domestic only (no international or worldwide figure; profit understated)"
  };
  function renderDetail() {
    var f = BY_ID[state.movie], ov = $("detail"), dr = $("drawer");
    if (!f) { ov.hidden = true; return; }
    dr.textContent = "";
    var head = el("div", "drawer-head");
    var hl = el("div");
    var h = el("h2", null, f.title); h.id = "d-title";
    hl.appendChild(h);
    hl.appendChild(el("div", "meta", [f.year, f.rating || "Not rated", f.runtime ? f.runtime + " min" : null,
      f.distributor, f.studio && f.studio !== f.distributor ? f.studio : null].filter(Boolean).join(" · ")));
    var tags = el("div", "tags");
    f.genres.forEach(function (g) { tags.appendChild(el("span", "tag", g)); });
    tags.appendChild(el("span", "tag", f.franchise ? "Franchise: " + f.franchise : f.franchise_known ? "Original" : "Franchise status unknown"));
    hl.appendChild(tags);
    var x = el("button", "close", "×"); x.type = "button"; x.setAttribute("aria-label", "Close");
    x.addEventListener("click", function () { closeMovie(); });
    head.appendChild(hl); head.appendChild(x);
    dr.appendChild(head);

    var fin = f.fin, mm = f.m;
    var dollars = state.infl ? LATEST + " dollars (CPI-adjusted from " + Math.min(f.year, LATEST) + ")" : "nominal dollars";
    var cav = el("div", "caveat");
    cav.appendChild(el("strong", null, "Reported budget. "));
    cav.appendChild(document.createTextNode("Production budgets come from studio statements and press reports. They are often wrong, usually understated, and exclude marketing. Every multiple, ROI and profit figure below inherits that error."));
    dr.appendChild(cav);

    var card1 = el("div", "card"); card1.style.marginTop = "14px";
    card1.appendChild(el("h2", null, "Profit waterfall"));
    card1.appendChild(el("p", "card-sub", "Gross to estimated theatrical profit under the current assumptions, in " + dollars + "."));
    var wf = el("div", "chart"); card1.appendChild(wf);
    var calc = el("ul", "calc");
    function li(t) { calc.appendChild(el("li", null, t)); }
    var r = A.rental_rates;
    if (mm.rental_method === "china_split") {
      li("Domestic " + money(D(fin.domestic_gross, f)) + " × " + rate(r.domestic) + " = " + money(D(mm.rentals_domestic, f)));
      li("International ex-China " + money(D(fin.international_gross - fin.china_gross, f)) + " × " + rate(r.international_ex_china) + " = " + money(D(mm.rentals_international, f)));
      li("China " + money(D(fin.china_gross, f)) + " × " + rate(r.china) + " = " + money(D(mm.rentals_china, f)));
    } else if (mm.rental_method === "blended") {
      li("Domestic " + money(D(fin.domestic_gross, f)) + " × " + rate(r.domestic) + " = " + money(D(mm.rentals_domestic, f)));
      li("International " + money(D(fin.international_gross, f)) + " × " + rate(r.international_blended) + " = " + money(D(mm.rentals_international, f)));
    } else if (mm.rental_method) {
      li("Rentals via " + METHOD_TEXT[mm.rental_method] + " = " + money(D(mm.rentals_total, f)));
    }
    if (isNum(mm.pa_estimate)) {
      var tier = A.pa_tiers[mm.budget_tier];
      li("P&A: " + tierLabel(mm.budget_tier) + (basisReal() ? " (" + LATEST + " $)" : "") + " tier, " + tierCharge(tier) +
        (basisReal() && f.year < LATEST ? " in " + LATEST + " dollars" : "") + " = " + money(D(mm.pa_estimate, f)));
    }
    card1.appendChild(calc);
    card1.appendChild(noteEl());
    dr.appendChild(card1);

    var two = el("div", "two-col"); two.style.marginTop = "14px";
    var cRaw = el("div", "card");
    cRaw.appendChild(el("h2", null, "Reported figures"));
    cRaw.appendChild(el("p", "card-sub", "In " + dollars + "."));
    cRaw.appendChild(kvTable([
      ["Production budget*", moneyFull(D(fin.production_budget, f)), "Reported; often wrong"],
      ["Opening weekend (domestic)", moneyFull(D(fin.opening_weekend_domestic, f))],
      ["Domestic gross", moneyFull(D(fin.domestic_gross, f))],
      ["International gross", moneyFull(D(fin.international_gross, f))],
      ["of which China", isNum(fin.china_gross) ? moneyFull(D(fin.china_gross, f)) : "not split out"],
      ["Worldwide gross", moneyFull(D(fin.worldwide_gross, f))],
      ["Release date", f.date || String(f.year)],
      ["Data source", fin.source + (f.tmdb_id ? " · TMDb " + f.tmdb_id : "")]
    ]));
    var cDer = el("div", "card");
    cDer.appendChild(el("h2", null, "Estimated economics"));
    cDer.appendChild(el("p", "card-sub", "Theatrical only, current assumptions."));
    cDer.appendChild(kvTable([
      ["Studio rentals", moneyFull(D(mm.rentals_total, f))],
      ["P&A estimate", moneyFull(D(mm.pa_estimate, f))],
      ["Estimated profit", moneyFull(D(mm.est_profit, f))],
      ["Estimated ROI", pct(mm.est_roi)],
      ["Gross multiple", mult(mm.gross_multiple)],
      ["Breakeven multiple", mult(mm.breakeven_multiple)],
      ["Breakeven worldwide gross", moneyFull(D(mm.breakeven_worldwide_gross, f))],
      ["Opening multiplier (legs)", mult(mm.opening_multiplier)],
      ["Budget tier", isNum(mm.budget_tier) ? tierLabel(mm.budget_tier) + (basisReal() ? " (" + LATEST + " $)" : "") : "—"]
    ]));
    two.appendChild(cRaw); two.appendChild(cDer);
    dr.appendChild(two);

    // Percentile ranks within genre and decade (all films in the database).
    var cP = el("div", "card"); cP.style.marginTop = "14px";
    cP.appendChild(el("h2", null, "Percentile rank"));
    var gPeers = FILMS.filter(function (o) { return o.genre === f.genre; });
    var dPeers = FILMS.filter(function (o) { return o.decade === f.decade; });
    cP.appendChild(el("p", "card-sub", "Against every film in the database with the same primary genre (" + (f.genre || "unknown") + ", " +
      gPeers.length + " films) or release decade (" + f.decade + "s, " + dPeers.length + " films). 100th = best."));
    var metrics = [
      ["Worldwide gross", function (o) { return D(o.fin.worldwide_gross, o); }],
      ["Gross multiple", function (o) { return o.m.gross_multiple; }],
      ["Estimated ROI", function (o) { return o.m.est_roi; }],
      ["Estimated profit", function (o) { return D(o.m.est_profit, o); }]
    ];
    var prow = metrics.map(function (mt) {
      var v = mt[1](f);
      function rank(peers) {
        var vals = peers.map(mt[1]).filter(isNum);
        return isNum(v) && vals.length ? ordinal(pctRank(v, vals)) + " of " + vals.length : "—";
      }
      return { metric: mt[0], genre: rank(gPeers), decade: rank(dPeers) };
    });
    renderTable(cP, [
      { key: "metric", label: "Metric", get: function (x) { return x.metric; } },
      { key: "genre", label: "Within " + (f.genre || "genre"), num: true, get: function (x) { return x.genre; } },
      { key: "decade", label: "Within the " + f.decade + "s", num: true, get: function (x) { return x.decade; } }
    ], prow, null, null);
    dr.appendChild(cP);

    var cPe = el("div", "card"); cPe.style.marginTop = "14px";
    cPe.appendChild(el("h2", null, "People"));
    cPe.appendChild(el("p", "card-sub", "Click a name to filter the whole dashboard to their films in that role."));
    var anyone = false;
    ROLE_KEYS.forEach(function (role) {
      var names = f.people[role] || [];
      if (!names.length) return;
      anyone = true;
      var row = el("div", "role-row");
      row.appendChild(el("div", "rl", names.length > 1 ? ROLE_PLURAL[role] : ROLE_LABEL[role]));
      var list = el("div", "people-list");
      names.forEach(function (n) {
        var b = el("button", "person", n); b.type = "button";
        b.title = "Filter to " + n + " as " + ROLE_LABEL[role].toLowerCase();
        b.addEventListener("click", function () { applyPerson(role, n); });
        list.appendChild(b);
      });
      row.appendChild(list);
      cPe.appendChild(row);
    });
    if (!anyone) cPe.appendChild(el("p", "card-sub", "No credits in the data."));
    dr.appendChild(cPe);

    ov.hidden = false;
    document.body.style.overflow = "hidden";
    renderWaterfall(wf, f);
    dr.scrollTop = 0;
    dr.focus();
  }

  function renderWaterfall(box, f) {
    var mm = f.m, G = D(f.m.rental_method === "domestic_only" ? f.fin.domestic_gross : f.fin.worldwide_gross, f);
    var R = D(mm.rentals_total, f), B = D(f.fin.production_budget, f), P = D(mm.pa_estimate, f), Pr = D(mm.est_profit, f);
    if (!isNum(G) || !isNum(R) || !isNum(B) || !isNum(P)) {
      box.appendChild(el("div", "empty-state", "Needs a budget and a gross to build the waterfall."));
      return;
    }
    var steps = [
      { label: "Worldwide gross", from: 0, to: G, cls: "total" },
      { label: "Theaters' share", from: G, to: R, cls: "deduct" },
      { label: "Studio rentals", from: 0, to: R, cls: "total" },
      { label: "Production budget*", from: R, to: R - B, cls: "deduct" },
      { label: "P&A estimate", from: R - B, to: R - B - P, cls: "deduct" },
      { label: "Est. profit", from: 0, to: Pr, cls: Pr >= 0 ? "pos" : "neg" }
    ];
    var W = Math.max(300, box.clientWidth || 640), H = 280, m = { l: 56, r: 10, t: 22, b: 40 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var lo = Math.min(0, R - B - P, Pr), hi = Math.max(G, R);
    function Y(v) { return m.t + (hi - v) / (hi - lo) * ph; }
    var svg = S("svg", { viewBox: "0 0 " + W + " " + H, height: H, role: "img", "aria-label": "Profit waterfall for " + f.title }, box);
    linTicks(lo, hi, 4).forEach(function (v) {
      S("line", { x1: m.l, x2: m.l + pw, y1: Y(v), y2: Y(v), "class": "gridline" }, svg);
      T(svg, m.l - 6, Y(v) + 4, money(v), "tick", "end");
    });
    S("line", { x1: m.l, x2: m.l + pw, y1: Y(0), y2: Y(0), "class": "axisline" }, svg);
    var slot = pw / steps.length, bw = Math.min(24, slot * 0.5);
    steps.forEach(function (s, i) {
      var cx = m.l + slot * i + slot / 2, x = cx - bw / 2;
      var y0 = Y(s.from), y1 = Y(s.to);
      var bar;
      if (s.cls === "deduct") {
        var top = Math.min(y0, y1), hgt = Math.max(1, Math.abs(y1 - y0));
        bar = S("rect", { x: x, y: top, width: bw, height: hgt, rx: 2, "class": "bar deduct" }, svg);
      } else {
        bar = S("path", { d: vbarPath(x, bw, y0, y1), "class": "bar " + s.cls }, svg);
      }
      if (i < steps.length - 1) {
        var nx = m.l + slot * (i + 1) + slot / 2 - bw / 2;
        S("line", { x1: x + bw, x2: nx, y1: y1, y2: y1, "class": "connector" }, svg);
      }
      var delta = s.cls === "deduct" ? s.to - s.from : s.to;
      var ly = s.to >= s.from ? Math.min(y0, y1) - 6 : Math.max(y0, y1) + 14;
      if (s.cls !== "deduct" && s.to < 0) ly = y1 + 14;
      T(svg, cx, ly, money(delta), "val", "middle");
      var words = s.label.split(" ");
      var lab = T(svg, cx, H - m.b + 16, "", "lbl-2", "middle");
      if (words.length > 1 && slot < 120) {
        var a = S("tspan", { x: cx }, lab); a.textContent = words[0];
        var b = S("tspan", { x: cx, dy: 13 }, lab); b.textContent = words.slice(1).join(" ");
      } else lab.textContent = s.label;
      bar.addEventListener("pointermove", function (evt) { showTip(evt, s.label, [{ label: "Amount", value: moneyFull(delta) }]); });
      bar.addEventListener("pointerleave", hideTip);
    });
  }

  // ------------------------------------------------------------------ views & update loop
  function setView(v) {
    state.view = v;
    closeMovie(true);
    update();
    window.scrollTo(0, 0);
  }
  var renderedAssumptions = false;
  function update(fromAssumptions) {
    hideTip();
    var rows = filtered();
    syncControls();
    renderActive(rows);
    $("view-dash").hidden = state.view !== "dash";
    $("view-people").hidden = state.view !== "people";
    $("view-assumptions").hidden = state.view !== "assumptions";
    $("filters").hidden = state.view === "assumptions";
    $("active-bar").hidden = state.view === "assumptions";
    renderNotes();
    if (state.view === "dash") {
      renderTiles(rows);
      renderScatter(rows);
      renderGroupBar(rows);
      renderYearLine(rows);
      renderFilms(rows);
    } else if (state.view === "people") {
      renderPeople(rows);
    } else if (state.view === "assumptions" && (!renderedAssumptions || !fromAssumptions)) {
      renderAssumptionsForm();
      renderedAssumptions = true;
    }
    if (state.movie) renderDetail();
    writeHash();
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    var pick = $("pickers");
    ROLE_KEYS.forEach(function (r) { pick.appendChild(makePicker(r)); });
    $("view-tabs").addEventListener("click", function (e) { var b = e.target.closest("button[data-view]"); if (b) setView(b.getAttribute("data-view")); });
    $("infl-toggle").addEventListener("click", function (e) { var b = e.target.closest("button[data-infl]"); if (b) { state.infl = b.getAttribute("data-infl") === "1"; update(); } });
    $("group-toggle").addEventListener("click", function (e) { var b = e.target.closest("button[data-group]"); if (b) { state.group = b.getAttribute("data-group"); update(); } });
    $("films-tabs").addEventListener("click", function (e) { var b = e.target.closest("button[data-tab]"); if (b) { state.tab = b.getAttribute("data-tab"); state.allLimit = PAGE; update(); } });
    $("f-fr").addEventListener("click", function (e) { var b = e.target.closest("button[data-fr]"); if (b) { state.f.fr = b.getAttribute("data-fr"); update(); } });
    $("lb-role").addEventListener("click", function (e) { var b = e.target.closest("button[data-role]"); if (b) { state.lb.role = b.getAttribute("data-role"); state.lb.limit = PAGE; update(); } });
    $("lb-min").addEventListener("change", function () { state.lb.min = +$("lb-min").value; update(); });
    $("lb-q").addEventListener("input", function () { state.lb.q = $("lb-q").value; renderPeople(filtered()); });
    $("f-genre").addEventListener("change", function () { state.f.genre = this.value; update(); });
    $("f-sd").addEventListener("change", function () { state.f.sd = this.value; update(); });
    $("f-tier").addEventListener("change", function () { state.f.tier = this.value; update(); });
    $("f-rating").addEventListener("change", function () { state.f.rating = this.value; update(); });
    $("f-minww").addEventListener("input", debounce(function () { state.f.minww = $("f-minww").value; update(); }, 250));
    $("f-micro").addEventListener("change", function () { state.f.micro = this.checked; update(); });
    var yearUpdate = debounce(update, 60);
    $("y0").addEventListener("input", function () { state.f.y0 = Math.min(+this.value, state.f.y1); this.value = state.f.y0; syncYears(); yearUpdate(); });
    $("y1").addEventListener("input", function () { state.f.y1 = Math.max(+this.value, state.f.y0); this.value = state.f.y1; syncYears(); yearUpdate(); });
    $("clear-all").addEventListener("click", function () { state.f = freshFilters(); state.isolate = ""; update(); });
    $("a-reset").addEventListener("click", function () { A = clone(DEFAULTS); commitAssumptions(); renderAssumptionsForm(); });
    $("a-download").addEventListener("click", downloadAssumptions);
    $("a-copy").addEventListener("click", copyAssumptions);
    var framed = true;
    try { framed = window.self !== window.top; } catch (e) { framed = true; }
    if (framed) $("a-download").hidden = true; // embedded viewers block file downloads; Copy still works
    Array.prototype.forEach.call(document.querySelectorAll("[data-tableview]"), function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-tableview");
        state.tableView[k] = !state.tableView[k];
        b.textContent = state.tableView[k] ? "Show as chart" : "Show as table";
        update();
      });
    });
    $("detail").addEventListener("click", function (e) { if (e.target === $("detail")) closeMovie(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && state.movie) closeMovie(); });
    window.addEventListener("hashchange", function () {
      if ((location.hash || "") === lastHash) return;
      readHash();
      if (!state.movie) closeMovie(true);
      update();
    });
    var lastW = window.innerWidth;
    window.addEventListener("resize", debounce(function () { if (window.innerWidth !== lastW) { lastW = window.innerWidth; update(true); } }, 150));
  }

  renderHeader();
  wire();
  readHash();
  update();

  // Hook for automated checks (tests/e2e_dashboard.js); not used by the page itself.
  window.__dashboard = {
    state: state, films: FILMS, filtered: filtered, update: update, leaderboard: leaderboard,
    setAssumptions: function (a) { A = a; commitAssumptions(); }, assumptions: function () { return A; }
  };
  }
})();
