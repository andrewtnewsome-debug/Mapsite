"""Find a company's US street address(es) on its website.

Pages fetched: the homepage plus up to six same-site pages whose link text or path
looks like contact / locations / about (falling back to common paths like /contact).
Sources, strongest first:
  1. schema.org data (JSON-LD PostalAddress, microdata, Squarespace business info)
  2. visible text, anchored on "City, ST 12345" and walking back to a line that starts
     with a house number (so "1455 W 29th" works without a street suffix)
  3. map links (Google / Apple / Bing maps URLs carrying an address)
Each candidate is scored by where it was found (contact page > locations page > footer >
about page > other body text) and by how many pages repeat it.

Failure modes are handled quietly: unreachable pages are skipped, JavaScript-rendered
sites are detected and reported, PO boxes are set aside (they cannot be located), and a
site with several locations returns all of them so each can be qualified separately.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, unquote_plus, urljoin, urlparse

from bs4 import BeautifulSoup

from .net import FetchError, Fetcher

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois",
    "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
    "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia",
    "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
    "PR": "Puerto Rico", "VI": "Virgin Islands", "GU": "Guam", "AS": "American Samoa",
    "MP": "Northern Mariana Islands",
}
NAME_TO_ABBR = {v.lower(): k for k, v in STATES.items()}

_STATE_NAMES = "|".join(sorted((re.escape(v) for v in STATES.values()), key=len, reverse=True))
_STATE_ABBRS = "|".join(STATES)
_UNIT = r"(?i:suite|ste\.?|unit|#|floor|fl\.?|bldg\.?|building|room|rm\.?|apt\.?)\s*#?\s*[\w-]{1,8}"

# Text is joined with " | " between visual lines. A street cannot contain a line break.
ADDRESS_RE = re.compile(
    r"(?<![\w-])(?P<street>\d{1,6}[A-Za-z]?(?:-\d{1,6})?\s+(?:[^|\d\s][^|]{1,70}?|\d{1,4}(?:st|nd|rd|th)\b[^|]{0,50}?))"
    r"(?:\s*[|,]\s*(?P<unit>" + _UNIT + r"))?"
    r"\s*[|,\s]\s*"
    r"(?P<city>[A-Za-z][A-Za-z.'\- ]{1,35}?)"
    r"\s*,?\s*"
    r"(?P<state>(?:" + _STATE_ABBRS + r")\b|(?i:" + _STATE_NAMES + r")\b)\.?"
    r"\s*,?\s*"
    r"(?P<zip>\d{5}(?:-\d{4})?)(?!\d)",
)
STREET_SUFFIX = (
    r"street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|court|ct|place|pl|parkway|pkwy|"
    r"highway|hwy|circle|cir|terrace|ter|trail|trl|square|sq|pike|plaza|plz|center|ctr|loop|row|alley|"
    r"crossing|xing|path|commons|point|pt|expressway|expy|freeway|fwy|broadway|turnpike|tpke|walk|run"
)
_SUFFIX_SPLIT_RE = re.compile(r"^(?P<street_tail>.*\b(?:" + STREET_SUFFIX + r")\b\.?(?:\s+(?:N|S|E|W|NE|NW|SE|SW)\b\.?)?)\s+(?P<city>[A-Za-z].*)$", re.I)
_TRAILING_JUNK_RE = re.compile(r"\s+(?:at|in|inside|near|across from|next to|located)\s+.*$|\s*\(.*$", re.I)
PO_BOX_RE = re.compile(r"\b(?:P\.?\s*O\.?\s*Box|Post\s+Office\s+Box)\s*\d+", re.I)
_NOT_STREET_RE = re.compile(r"^\d+\s*(?:am|pm|a\.m|p\.m|%|percent|years?|people|employees|customers|locations?|minutes?|hours?|days?)\b", re.I)

FALLBACK_PATHS = ["/contact", "/contact-us", "/locations", "/about", "/about-us"]
SKIP_EXT = re.compile(r"\.(?:pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|mp4|mp3)$", re.I)

# Base confidence by where an address was found.
WEIGHTS = {
    ("structured", None): 0.95,
    ("main", "contact"): 0.90,
    ("main", "locations"): 0.85,
    ("footer", None): 0.75,
    ("header", None): 0.70,
    ("map_link", None): 0.70,
    ("main", "about"): 0.65,
    ("main", "home"): 0.60,
    ("main", "other"): 0.50,
    ("script", None): 0.50,
}
INCLUDE_THRESHOLD = 0.60
MAX_SUBPAGES = 6
PAGE_CACHE_DAYS = 7


@dataclass
class Source:
    url: str
    page_type: str
    region: str
    snippet: str


@dataclass
class Candidate:
    street: str
    city: str
    state: str
    zip: str
    unit: Optional[str] = None
    sources: List[Source] = field(default_factory=list)
    score: float = 0.0

    @property
    def one_line(self) -> str:
        street = f"{self.street} {self.unit}" if self.unit else self.street
        return f"{street}, {self.city}, {self.state} {self.zip}"

    @property
    def key(self) -> Tuple[str, str, str]:
        num = self.street.split()[0].lower()
        words = [w.strip(".,").lower() for w in self.street.split()[1:]]
        words = [w for w in words if w not in {"n", "s", "e", "w", "north", "south", "east", "west"}]
        return (num, words[0] if words else "", self.zip[:5])

    @property
    def best_source(self) -> Source:
        return max(self.sources, key=lambda s: _weight(s))


@dataclass
class Extraction:
    website: str
    pages: List[Tuple[str, str, str]] = field(default_factory=list)  # (url, page_type, status)
    candidates: List[Candidate] = field(default_factory=list)       # all, best first
    po_boxes: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)

    @property
    def locations(self) -> List[Candidate]:
        """Candidates confident enough to qualify (several when the business has several sites)."""
        return [c for c in self.candidates if c.score >= INCLUDE_THRESHOLD]

    @property
    def best(self) -> Optional[Candidate]:
        return self.candidates[0] if self.candidates else None


def _weight(src: Source) -> float:
    if src.region == "structured" and src.page_type == "other":
        return 0.60  # schema data on a blog, event or product page is weaker evidence
    key = (src.region, src.page_type if src.region == "main" else None)
    return WEIGHTS.get(key, 0.5)


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip(" ,;|")


def _norm_state(state: str) -> Optional[str]:
    s = state.strip(". ").strip()
    if s.upper() in STATES and len(s) == 2:
        return s.upper()
    return NAME_TO_ABBR.get(s.lower())


def _fix_split(street: str, city: str) -> Tuple[str, str]:
    """'2516 Market' + 'Ave. Cleveland' -> '2516 Market Ave.' + 'Cleveland' (no comma in source)."""
    joined = f"{street} {city}"
    m = _SUFFIX_SPLIT_RE.match(joined)
    if m and len(m.group("city")) >= 2:
        street, city = _clean(m.group("street_tail")), _clean(m.group("city"))
    # '2101 Richmond Rd. at LaPlace Beachwood': a landmark phrase ran into the city name.
    words = city.split()
    if len(words) > 1 and words[0].lower() in {"at", "in", "inside", "near", "located"}:
        city = words[-1]
    return street, city


def parse_addresses(text: str) -> List[Candidate]:
    """All US street addresses in text whose visual lines are joined by ' | '."""
    out = []
    for m in ADDRESS_RE.finditer(text):
        street, city = _clean(m.group("street")), _clean(m.group("city"))
        state = _norm_state(m.group("state"))
        if not state:
            continue
        street, city = _fix_split(street, city)
        street = _clean(_TRAILING_JUNK_RE.sub("", street))
        if _NOT_STREET_RE.match(street) or len(street.split()) < 2 or not re.search(r"[A-Za-z]{2}", street):
            continue
        if city.lower() in NAME_TO_ABBR or len(city) < 2:
            continue
        out.append(Candidate(street=street, city=city.title() if city.isupper() else city, state=state,
                             zip=m.group("zip"), unit=_clean(m.group("unit") or "") or None))
    return out


def _text_lines(node) -> str:
    lines = [_clean(t) for t in node.get_text("\n").split("\n")]
    return " | ".join(t for t in lines if t)


def _snippet(text: str, cand: Candidate) -> str:
    i = text.find(cand.street.split()[0])
    return _clean(text[max(0, i - 40): i + 120]) if i >= 0 else ""


def _structured(soup: BeautifulSoup) -> List[Candidate]:
    out: List[Candidate] = []

    def from_postal(d: dict):
        street = _clean(str(d.get("streetAddress") or ""))
        city = _clean(str(d.get("addressLocality") or ""))
        region = _norm_state(str(d.get("addressRegion") or ""))
        zipc = re.search(r"\d{5}(?:-\d{4})?", str(d.get("postalCode") or ""))
        country = str(d.get("addressCountry") or "US")
        if isinstance(d.get("addressCountry"), dict):
            country = str(d["addressCountry"].get("name") or "US")
        if street and city and region and zipc and re.match(r"^\d", street) and country.upper() in {"US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"}:
            out.append(Candidate(street=street, city=city, state=region, zip=zipc.group(0)))

    def is_event(obj) -> bool:
        t = obj.get("@type")
        types = t if isinstance(t, list) else [t]
        return any(isinstance(x, str) and ("Event" in x or x in {"Offer", "Product", "JobPosting"}) for x in types)

    def walk(obj, parent=None):
        if isinstance(obj, list):
            for x in obj:
                walk(x, parent)
        elif isinstance(obj, dict):
            if is_event(obj):
                return  # an event venue or product listing, not where the business is
            if "streetAddress" in obj:
                from_postal(obj)
            addr = obj.get("address")
            if isinstance(addr, str):
                found = parse_addresses(addr.replace("\n", " | "))
                if not found:  # Squarespace puts the street in legalName and the city line in address
                    for k in ("legalName", "name"):
                        v = obj.get(k)
                        if isinstance(v, str) and re.match(r"^\d{1,6}\s+\S", v):
                            found = parse_addresses(f"{v} | {addr}".replace("\n", " | "))
                            break
                out.extend(found)
            for v in obj.values():
                if isinstance(v, (dict, list)):
                    walk(v, obj)

    for tag in soup.find_all("script", type=re.compile(r"ld\+json", re.I)):
        try:
            walk(json.loads(tag.string or tag.get_text() or "null"))
        except (ValueError, TypeError):
            continue
    # Squarespace also stores business info in a data attribute / Static.SQUARESPACE_CONTEXT
    for tag in soup.find_all(attrs={"itemprop": "streetAddress"}):
        scope = tag.find_parent(attrs={"itemprop": "address"}) or tag.find_parent(attrs={"itemscope": True}) or tag.parent

        def prop(name):
            el = scope.find(attrs={"itemprop": name}) if scope else None
            return _clean(el.get("content") or el.get_text(" ")) if el else ""
        street = _clean(tag.get("content") or tag.get_text(" "))
        region = _norm_state(prop("addressRegion"))
        zipc = re.search(r"\d{5}(?:-\d{4})?", prop("postalCode"))
        if street and region and zipc and prop("addressLocality"):
            out.append(Candidate(street=street, city=prop("addressLocality"), state=region, zip=zipc.group(0)))
    return out


def _script_addresses(soup: BeautifulSoup) -> List[Candidate]:
    """Addresses embedded as JSON in scripts (e.g. JavaScript-rendered sites)."""
    out = []
    pat = re.compile(r'"streetAddress"\s*:\s*"([^"]{4,80})".{0,300}?"addressLocality"\s*:\s*"([^"]{2,40})"'
                     r'.{0,300}?"addressRegion"\s*:\s*"([^"]{2,20})".{0,300}?"postalCode"\s*:\s*"(\d{5}(?:-\d{4})?)"', re.S)
    for tag in soup.find_all("script"):
        if re.search(r"ld\+json", tag.get("type") or "", re.I):
            continue
        s = tag.string or ""
        for m in pat.finditer(s):
            region = _norm_state(m.group(3))
            if region and re.match(r"^\d", m.group(1)):
                out.append(Candidate(street=_clean(m.group(1)), city=_clean(m.group(2)), state=region, zip=m.group(4)))
    return out


def _map_link_addresses(soup: BeautifulSoup) -> List[Candidate]:
    out = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if not re.search(r"google\.[a-z.]+/maps|maps\.google|goo\.gl/maps|maps\.apple\.com|bing\.com/maps", href, re.I):
            continue
        u = urlparse(href)
        texts = []
        qs = parse_qs(u.query)
        for k in ("q", "daddr", "address", "destination", "query", "where"):
            texts.extend(qs.get(k, []))
        m = re.search(r"/place/([^/@]+)", u.path)
        if m:
            texts.append(unquote_plus(m.group(1)))
        for t in texts:
            out.extend(parse_addresses(unquote(t).replace("+", " ")))
    return out


_TYPE_PATTERNS = [
    ("contact", re.compile(r"^(?:contact(?:[-_]?us)?|find[-_]?us|how[-_]?(?:to[-_])?find[-_]?us|directions?|visit(?:[-_]?us)?|get[-_]in[-_]touch|reach[-_]us)$", re.I)),
    ("locations", re.compile(r"^(?:locations?|our[-_]locations?|cafes|shops|stores|store[-_]locator|find[-_]a[-_](?:shop|store|location)|offices|branches|where[-_]to[-_]find[-_]us)$", re.I)),
    ("about", re.compile(r"^(?:about(?:[-_]?us)?|our[-_]story|who[-_]we[-_]are|company)$", re.I)),
]
_LINK_TEXT_TYPES = [
    ("contact", re.compile(r"^(?:contact(?: us)?|find us|how to find us|directions|visit us|get in touch)$", re.I)),
    ("locations", re.compile(r"^(?:locations?|our locations|find a (?:shop|store|location)|our (?:shops|stores|cafes)|cafes|shops|stores)$", re.I)),
    ("about", re.compile(r"^(?:about(?: us)?|our story|who we are)$", re.I)),
]


def classify(url: str, link_text: str = "") -> str:
    """Page type from the URL path (last segment, at most two deep) or a short, exact link label."""
    segs = [s for s in urlparse(url).path.lower().strip().split("/") if s]
    if not segs:
        return "home"
    if len(segs) <= 2:
        last = re.sub(r"\.(?:html?|php|aspx?)$", "", segs[-1])
        for ptype, pat in _TYPE_PATTERNS:
            if pat.match(last):
                return ptype
    text = _clean(link_text).lower()
    if len(segs) <= 2 and text and len(text.split()) <= 4:
        for ptype, pat in _LINK_TEXT_TYPES:
            if pat.match(text):
                return ptype
    return "other"


def _same_site(a: str, b: str) -> bool:
    na, nb = urlparse(a).netloc.lower(), urlparse(b).netloc.lower()
    return na.removeprefix("www.") == nb.removeprefix("www.")


def _regions(soup: BeautifulSoup) -> Dict[str, List]:
    """Split a page into footer / header / main subtrees (outermost matches only)."""
    def outermost(nodes):
        nodes = list(nodes)
        return [n for n in nodes if not any(p in nodes for p in n.parents)]

    footer = outermost(soup.find_all(lambda t: t.name == "footer" or t.get("role") == "contentinfo"
                                     or any("footer" in str(v).lower() for v in [t.get("id", "")] + list(t.get("class", [])))))
    for n in footer:
        n.extract()
    header = outermost(soup.find_all(lambda t: t.name == "header" or t.get("role") == "banner"
                                     or str(t.get("id", "")).lower() in ("header", "site-header")))
    for n in header:
        n.extract()
    return {"footer": footer, "header": header, "main": [soup]}


def analyze_page(html: str, url: str, page_type: str) -> Tuple[List[Tuple[Candidate, Source]], List[str], dict]:
    soup = BeautifulSoup(html, "lxml") if html else BeautifulSoup("", "html.parser")
    found: List[Tuple[Candidate, Source]] = []
    for c in _structured(soup):
        found.append((c, Source(url, page_type, "structured", "schema.org data")))
    for c in _map_link_addresses(soup):
        found.append((c, Source(url, page_type, "map_link", "map link")))
    for c in _script_addresses(soup):
        found.append((c, Source(url, page_type, "script", "data embedded in a script")))

    scripts = len(soup.find_all("script"))
    for t in soup(["script", "style", "noscript", "template", "svg"]):
        t.decompose()
    links = [(urljoin(url, a["href"].strip()), _clean(a.get_text(" "))) for a in soup.find_all("a", href=True)]
    text_len = 0
    po = []
    for region, nodes in _regions(soup).items():
        for node in nodes:
            text = _text_lines(node)
            text_len += len(text)
            po.extend(m.group(0) for m in PO_BOX_RE.finditer(text))
            for c in parse_addresses(text):
                found.append((c, Source(url, page_type, region, _snippet(text, c))))
    meta = {"links": links, "text_len": text_len, "scripts": scripts, "po_boxes": po}
    return found, po, meta


def _merge(found: Iterable[Tuple[Candidate, Source]]) -> List[Candidate]:
    merged: Dict[tuple, Candidate] = {}
    for cand, src in found:
        cur = merged.get(cand.key)
        if cur is None:
            cand.sources = [src]
            merged[cand.key] = cand
            continue
        cur.sources.append(src)
        if not cur.unit and cand.unit:
            cur.unit = cand.unit
        # prefer the spelling from the strongest source
        if _weight(src) > max(_weight(s) for s in cur.sources[:-1]):
            cur.street, cur.city = cand.street, cand.city
    for c in merged.values():
        best = max(_weight(s) for s in c.sources)
        pages = {s.url for s in c.sources}
        c.score = round(min(0.99, best + 0.05 * min(3, len(pages) - 1)), 2)
    return sorted(merged.values(), key=lambda c: (-c.score, c.one_line))


def extract_from_website(fetcher: Fetcher, website: str, max_subpages: int = MAX_SUBPAGES) -> Extraction:
    if not re.match(r"^https?://", website, re.I):
        website = "https://" + website.strip().lstrip("/")
    ex = Extraction(website=website)
    found: List[Tuple[Candidate, Source]] = []

    def fetch(url: str):
        try:
            resp = fetcher.get(url, max_age_days=PAGE_CACHE_DAYS)
        except FetchError as exc:
            return None, f"unreachable ({exc.__class__.__name__})"
        if not resp.ok:
            return None, f"HTTP {resp.status}"
        if "html" not in (resp.content_type or "html").lower():
            return None, f"not HTML ({resp.content_type})"
        return resp, "ok"

    home, status = fetch(website)
    if home is None and website.startswith("https://"):
        home, status = fetch("http://" + website[len("https://"):])
    if home is None:
        ex.pages.append((website, "home", status))
        ex.notes.append(f"Could not load the website ({status}). Use --address instead.")
        return ex
    base = home.final_url or website
    ex.pages.append((base, "home", "ok" + (" (cached)" if home.from_cache else "")))
    page_found, po, meta = analyze_page(home.text, base, "home")
    found.extend(page_found)
    ex.po_boxes.extend(po)
    if meta["text_len"] < 400 and meta["scripts"] >= 3:
        ex.notes.append("The homepage shows almost no text without JavaScript, so addresses may be missing. "
                        "If none are found, use --address.")

    # Pick subpages: contact first, then locations, then about.
    ranked: Dict[str, Tuple[int, str]] = {}
    order = {"contact": 0, "locations": 1, "about": 2}
    for href, text in meta["links"]:
        if not href.startswith("http") or not _same_site(href, base) or SKIP_EXT.search(urlparse(href).path):
            continue
        clean = href.split("#")[0].rstrip("/") or href
        ptype = classify(clean, text)
        if ptype in order and clean.rstrip("/") != base.rstrip("/"):
            prev = ranked.get(clean)
            if prev is None or order[ptype] < prev[0]:
                ranked[clean] = (order[ptype], ptype)
    if not any(p == "contact" for _, p in ranked.values()):
        for path in FALLBACK_PATHS:
            u = urljoin(base, path)
            ranked.setdefault(u, (order[classify(u)] + 3, classify(u)))
    todo = sorted(ranked.items(), key=lambda kv: (kv[1][0], len(kv[0])))[:max_subpages]
    for url, (_, ptype) in todo:
        resp, status = fetch(url)
        if resp is None:
            ex.pages.append((url, ptype, status))
            continue
        ex.pages.append((resp.final_url or url, ptype, "ok" + (" (cached)" if resp.from_cache else "")))
        page_found, po, _ = analyze_page(resp.text, resp.final_url or url, ptype)
        found.extend(page_found)
        ex.po_boxes.extend(po)

    ex.candidates = _merge(found)
    ex.po_boxes = sorted(set(ex.po_boxes))
    if not ex.candidates:
        if ex.po_boxes:
            ex.notes.append("Only a PO box was published (" + "; ".join(ex.po_boxes[:3]) + "). A PO box cannot be "
                            "placed in a census tract; supply the physical address with --address.")
        else:
            ex.notes.append("No US street address found on the pages checked. Supply it with --address.")
    elif len(ex.locations) > 1:
        ex.notes.append(f"{len(ex.locations)} locations found; each is qualified separately.")
    return ex
