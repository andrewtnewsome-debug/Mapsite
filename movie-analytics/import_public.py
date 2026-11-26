"""Optional step 0: build data/boxoffice.csv from two public datasets (about 1,000 films).

    python import_public.py            # films in both datasets that have director + cast (~1,000)
    python import_public.py --all      # every usable film in movie_profit (~3,300); credits where matched
    python import_public.py --no-sample
    python import_public.py --force    # replace an existing data/boxoffice.csv

Then run the usual three commands (ingest, build_db, build_dashboard).

Sources (downloaded once into data/public/, which is git-ignored):
  movie_profit.csv  TidyTuesday 2018-10-23. Production budget, domestic and worldwide gross,
                    distributor, MPAA rating and one of five genres, originally from The Numbers.
                    It is a partial list: only Action, Adventure, Comedy, Drama and Horror, and
                    several of the biggest films (Avatar, Titanic, The Dark Knight) are absent.
  movies.csv        TidyTuesday 2021-03-09 (FiveThirtyEight's Bechdel-test data joined to OMDb),
                    1970-2013. Supplies director, top-billed cast, all genres, runtime, rating.

Financial figures come from movie_profit. The 25 curated sample films are kept (they carry
producers, opening weekends, franchises and post-2018 releases); where one is also in the
public data the sample row wins and the public row is dropped. Every disagreement over 10
percent between sources goes to data/public/import_report.txt.

Neither dataset has producers, executive producers, opening weekends or franchise status;
those films are marked franchise status unknown. A TMDb key (see README) fills those gaps.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import re
import sys
import unicodedata
import urllib.request

from common import DATA_DIR, SEED_CSV
from sample_data import COLUMNS, sample_rows

PUBLIC_DIR = DATA_DIR / "public"
REPORT = PUBLIC_DIR / "import_report.txt"
SOURCES = {
    "movie_profit.csv": "https://raw.githubusercontent.com/rfordatascience/tidytuesday/master/data/2018/2018-10-23/movie_profit.csv",
    "bechdel_movies.csv": "https://raw.githubusercontent.com/rfordatascience/tidytuesday/master/data/2021/2021-03-09/movies.csv",
}
# movie_profit was collected in October 2018; later releases had not finished their runs.
SNAPSHOT_CUTOFF = dt.date(2018, 6, 30)
OUT_COLUMNS = COLUMNS + ["source", "franchise_known"]
SRC_PROFIT = "public: The Numbers via TidyTuesday 2018-10-23"
SRC_BOTH = SRC_PROFIT + "; credits: OMDb via FiveThirtyEight/TidyTuesday 2021-03-09"
OMDB_GENRES = {"Sci-Fi": "Science Fiction"}
RATINGS = {"G", "PG", "PG-13", "R", "NC-17"}
PROFIT_GENRES = {"Action", "Adventure", "Comedy", "Drama", "Horror"}  # the only genres in movie_profit


def key(title: str) -> str:
    text = unicodedata.normalize("NFKD", html.unescape(title or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower().replace("&", "and")
    text = re.sub(r"\bvolume\b", "vol", text)
    text = re.sub(r"^(the|a|an)\s+", "", text)
    text = re.sub(r",\s*(the|a|an)$", "", text)
    return re.sub(r"[^a-z0-9]+", "", text)


STOPWORDS = {"the", "a", "an", "of", "and", "in", "on", "to", "ep", "episode", "part", "movie", "film"}
NUMBER_WORDS = {"one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
                "eight": "8", "nine": "9", "ten": "10", "sixty": "60", "ii": "2", "iii": "3", "iv": "4",
                "vi": "6", "vii": "7", "viii": "8", "volume": "vol"}


def words(title: str) -> set[str]:
    text = unicodedata.normalize("NFKD", html.unescape(title or "")).lower()
    text = "".join(c for c in text if not unicodedata.combining(c))
    parts = set()
    for w in re.split(r"[^a-z0-9]+", text):
        w = NUMBER_WORDS.get(w, w)
        if w and w not in STOPWORDS:
            parts.add(w.rstrip("s") if len(w) > 3 else w)
    return parts


def same_title(a: str, b: str) -> bool:
    """Loose title check for the budget/gross fallback match.

    Sequel numbers must not conflict (Kill Bill Vol. 1 vs Vol. 2); words under three letters
    do not count (Step Up 3D vs Up in the Air); one-word titles must share a word of four or
    more letters; otherwise two significant words must be shared (Ghost Ship vs Thir13en Ghosts).
    """
    wa, wb = words(a), words(b)
    na, nb = {w for w in wa if w.isdigit()}, {w for w in wb if w.isdigit()}
    if na and nb and na != nb:
        return False
    sa = {w for w in wa if len(w) >= 3 or w.isdigit()}
    sb = {w for w in wb if len(w) >= 3 or w.isdigit()}
    shared = sa & sb
    if min(len(sa), len(sb)) <= 1:
        return any(len(w) >= 4 for w in shared)
    return len(shared) >= 2


def num(value) -> int | None:
    text = (value or "").strip()
    if text in ("", "NA", "N/A"):
        return None
    try:
        return int(round(float(text)))
    except ValueError:
        return None


def close(a, b, tolerance) -> bool:
    return a is not None and b is not None and abs(a - b) <= tolerance * max(abs(a), abs(b), 1)


def download(refresh: bool) -> bool:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    ok = True
    for name, url in SOURCES.items():
        path = PUBLIC_DIR / name
        if path.exists() and not refresh:
            continue
        print(f"  downloading {name}")
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                path.write_bytes(response.read())
        except Exception as exc:  # noqa: BLE001
            print(f"  could not download {url}\n    ({exc})\n    Save it by hand as {path} and rerun.")
            ok = False
    return ok


def read(name: str) -> list[dict]:
    with open(PUBLIC_DIR / name, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def load_profit(report: list[str]) -> list[dict]:
    films, skipped = [], {"no worldwide gross": 0, "no budget": 0, "released after cutoff": 0, "bad date": 0}
    for row in read("movie_profit.csv"):
        try:
            date = dt.datetime.strptime(row["release_date"].strip(), "%m/%d/%Y").date()
        except ValueError:
            skipped["bad date"] += 1
            continue
        budget, dom, ww = num(row["production_budget"]), num(row["domestic_gross"]), num(row["worldwide_gross"])
        if date > SNAPSHOT_CUTOFF:
            skipped["released after cutoff"] += 1
            continue
        if not ww:
            skipped["no worldwide gross"] += 1  # mostly unreleased titles listed at 0
            continue
        if not budget:
            skipped["no budget"] += 1
            continue
        title = html.unescape(row["movie"]).strip()
        intl = ww - dom if dom is not None and ww >= dom else None
        if dom is not None and ww < dom:
            report.append(f"[data] {title} ({date.year}): domestic {dom:,} exceeds worldwide {ww:,}; international left blank")
        rating = (row["mpaa_rating"] or "").strip()
        films.append({
            "title": title, "year": date.year, "date": date.isoformat(), "budget": budget, "dom": dom,
            "intl": intl, "ww": ww, "distributor": (row["distributor"] or "").replace("\xa0", " ").strip(),
            "rating": rating if rating in RATINGS else "", "genre": (row["genre"] or "").strip(), "credits": None,
        })
    report.append(f"movie_profit: {len(films)} usable films; skipped " +
                  ", ".join(f"{n} {why}" for why, n in skipped.items() if n))
    return films


def load_credits() -> list[dict]:
    films = []
    for row in read("bechdel_movies.csv"):
        director = (row.get("director") or "").strip()
        if director in ("", "NA", "N/A"):
            director = ""
        split = lambda text: [p.strip() for p in (text or "").split(",") if p.strip() and p.strip() not in ("NA", "N/A")]
        genres = [OMDB_GENRES.get(g, g) for g in split(row.get("genre"))]
        runtime = re.match(r"(\d+)", row.get("runtime") or "")
        rated = (row.get("rated") or "").strip()
        films.append({
            "title": html.unescape(row["title"]).strip(), "year": int(row["year"]),
            "budget": num(row["budget"]), "dom": num(row["domgross"]), "ww": num(row["intgross"]),
            "directors": split(director), "cast": split(row.get("actors"))[:3], "genres": genres,
            "runtime": int(runtime.group(1)) if runtime else None, "rating": rated if rated in RATINGS else "",
        })
    return films


def matcher(candidates: list[dict]):
    """Find a film by title + year (allowing a year either way), else by its money fingerprint."""
    by_key: dict = {}
    by_year: dict = {}
    for film in candidates:
        by_key.setdefault((key(film["title"]), film["year"]), []).append(film)
        by_year.setdefault(film["year"], []).append(film)

    used: set = set()  # each candidate row is matched at most once

    def find(title, year, budget, ww, exact_only=False):
        for y in (year, year - 1, year + 1):
            for hit in by_key.get((key(title), y), []):
                if id(hit) not in used:
                    used.add(id(hit))
                    return hit, "title"
        if exact_only:
            return None, None
        nearby = by_year.get(year - 1, []) + by_year.get(year, []) + by_year.get(year + 1, [])
        prints = [f for f in nearby if id(f) not in used and close(f["budget"], budget, 0.05)
                  and close(f["ww"], ww, 0.15) and same_title(f["title"], title)]
        if len(prints) != 1:
            return None, None
        used.add(id(prints[0]))
        return prints[0], "fingerprint"

    return find


def disagreements(label, title, year, pairs, report):
    for field, ours, theirs in pairs:
        if ours and theirs and not close(ours, theirs, 0.10):
            report.append(f"[conflict] {title} ({year}): {field} {ours:,} vs {label} {theirs:,} "
                          f"({abs(ours - theirs) / max(ours, theirs):.0%} apart); kept {ours:,}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true", help="include films without credits (about 3,300)")
    parser.add_argument("--no-sample", action="store_true", help="leave out the 25 curated sample films")
    parser.add_argument("--force", action="store_true", help="overwrite an existing data/boxoffice.csv")
    parser.add_argument("--refresh", action="store_true", help="download the public files again")
    args = parser.parse_args(argv)

    if SEED_CSV.exists() and not args.force:
        print(f"import_public: {SEED_CSV.relative_to(DATA_DIR.parent)} already exists. "
              "Rerun with --force to replace it.")
        return 1
    print("import_public: building data/boxoffice.csv from public datasets")
    if not download(args.refresh):
        return 1

    report: list[str] = []
    profit = load_profit(report)
    credits = load_credits()
    find_credit = matcher(credits)
    matched = by_fingerprint = 0
    for film in profit:  # pass 1: exact titles claim their credits rows first
        hit, how = find_credit(film["title"], film["year"], film["budget"], film["ww"], exact_only=True)
        film["_hit"] = (hit, how)
    for film in profit:  # pass 2: fallback by budget/gross for the rest
        hit, how = film.pop("_hit")
        if not hit:
            hit, how = find_credit(film["title"], film["year"], film["budget"], film["ww"])
        if hit:
            matched += 1
            by_fingerprint += how == "fingerprint"
            film["credits"] = hit
            if how == "fingerprint":
                report.append(f"[match] {film['title']} ({film['year']}) = credits row '{hit['title']}' "
                              f"({hit['year']}) by budget and gross")
            disagreements("OMDb/538", film["title"], film["year"],
                          [("budget", film["budget"], hit["budget"]), ("domestic", film["dom"], hit["dom"]),
                           ("worldwide", film["ww"], hit["ww"])], report)
    with_credits = [f for f in profit if f["credits"] and f["credits"]["directors"]]
    report.append(f"credits matched for {matched} films ({by_fingerprint} by budget/gross fingerprint); "
                  f"{len(with_credits)} have director and cast")
    chosen = profit if args.all else with_credits

    rows = []
    if not args.no_sample:
        find_public = matcher(profit)
        dropped = set()
        for row in sample_rows():
            hit, how = find_public(row["title"], row["release_year"], row["production_budget"], row["worldwide_gross"])
            if hit:
                dropped.add(id(hit))
                report.append(f"[sample] {row['title']} ({row['release_year']}) is '{hit['title']}' in movie_profit "
                              f"(matched by {how}); sample row kept, primary genre set to {hit['genre']}")
                disagreements("movie_profit", row["title"], row["release_year"],
                              [("budget", row["production_budget"], hit["budget"]),
                               ("worldwide", row["worldwide_gross"], hit["ww"])], report)
                row["genre"] = hit["genre"] or row["genre"]  # one genre scheme for the charts
            elif row["genre"] not in PROFIT_GENRES:
                # Not in movie_profit: take the first of the film's own genres that fits the scheme.
                fits = [g.strip() for g in row["genres"].split(";") if g.strip() in PROFIT_GENRES]
                if fits:
                    report.append(f"[sample] {row['title']} ({row['release_year']}): primary genre "
                                  f"{row['genre']} -> {fits[0]} to match movie_profit's five genres")
                    row["genre"] = fits[0]
            rows.append({**row, "source": "sample (curated)", "franchise_known": 1})
        chosen = [f for f in chosen if id(f) not in dropped]

    for f in chosen:
        c = f["credits"] or {}
        rows.append({
            "title": f["title"], "release_year": f["year"], "release_date": f["date"], "studio": "",
            "distributor": f["distributor"], "genre": f["genre"],
            "genres": "; ".join(c.get("genres") or []), "mpaa_rating": f["rating"] or c.get("rating", ""),
            "runtime_min": c.get("runtime") or "", "production_budget": f["budget"],
            "opening_weekend_domestic": "", "domestic_gross": "" if f["dom"] is None else f["dom"],
            "international_gross": "" if f["intl"] is None else f["intl"], "worldwide_gross": f["ww"],
            "china_gross": "", "director": "; ".join(c.get("directors") or []), "producers": "",
            "executive_producers": "", "lead_cast": "; ".join(c.get("cast") or []), "franchise": "",
            "tmdb_id": "", "source": SRC_BOTH if c else SRC_PROFIT, "franchise_known": 0,
        })
    rows.sort(key=lambda r: (int(r["release_year"]), str(r["title"])))

    SEED_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(SEED_CSV, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUT_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    summary = (f"wrote {len(rows)} films to {SEED_CSV.relative_to(DATA_DIR.parent)} "
               f"({len(rows) - len(chosen)} curated sample + {len(chosen)} public)")
    stamp = dt.datetime.now().isoformat(timespec="seconds")
    REPORT.write_text(f"# import_public.py report, {stamp}\n# {summary}\n" + "\n".join(report) + "\n", encoding="utf-8")
    print(f"  {summary}")
    print(f"  {sum(1 for line in report if line.startswith('[conflict]'))} source disagreements over 10% "
          f"logged to {REPORT.relative_to(DATA_DIR.parent)}")
    print("  next: python ingest.py && python build_db.py && python build_dashboard.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
