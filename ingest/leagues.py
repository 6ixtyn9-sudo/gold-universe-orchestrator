"""
ingest/leagues.py
─────────────────
The league registry — the API-era replacement for "one Google Sheet per
league per date".

Before:  166 leagues × N dates  =  512 satellites (sheets), each hand-fed.
After:   one LeagueSpec per competition, keyed by a stable slug.

A LeagueSpec answers three questions:
  1. what the universe calls this competition       (display_name)
  2. how an upstream API identifies it              (api_league_id, season)
  3. what id the rest of the universe should see    (satellite_id)

`ingest/leagues.json` is generated, not hand-written:

    python -m ingest.cli bootstrap-leagues          # mine registry.json
    python -m ingest.cli bootstrap-leagues --probe  # + query API-Sports for ids

Anything without an api_league_id is skipped loudly at ingest time — never
silently, because a wrong id would quietly pull another competition's games
into a satellite and poison the accuracy ledger.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional

log = logging.getLogger("ingest.leagues")

REPO_ROOT = Path(__file__).resolve().parent.parent
LEAGUES_PATH = Path(__file__).with_name("leagues.json")
FLEET_REGISTRY = REPO_ROOT / "registry" / "registry.json"

# Trailing date/round code the fleet appends to satellite names.
# Real examples from registry.json:
#   " Brazil (NBB) F10"          → F10
#   " Czech Republic 1. Liga (CZ2) M13.2" → M13.2
#   " South Korea (KBL) JW31"    → JW31
#   " United States (NBA) May 1" → May 1   (these produced duplicate leagues
#   " United States (NBA) 26"    → 26       before they were stripped)
_MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec"
_DATE_CODE_RE = re.compile(
    r"\s*(?:"
    r"(?:" + _MONTHS + r")[a-z]*\.?\s?\d{0,2}"      # May 13 / June
    r"|[JFMASOND]W\d{1,2}"                            # JW30 (week of season)
    r"|[JFMASOND]\d{1,2}(?:\.\d+)?\b\.?"          # J10 / F09 / M13.2
    r"|\d{1,2}"                                       # bare season number, 26
    r")\s*$",
    re.IGNORECASE,
)


@dataclass
class LeagueSpec:
    key: str                                    # canonical slug, e.g. "nba"
    display_name: str                           # "United States (NBA)"
    api_league_id: Optional[int] = None         # API-Sports league id
    season: str = ""                            # API-Sports season, e.g. "2026-2027"
    country: str = ""
    aliases: List[str] = field(default_factory=list)
    team_alias_file: str = ""                   # optional extra alias map
    timezone: str = "UTC"
    satellite_dates: List[str] = field(default_factory=list)  # fleet date codes, if any

    @property
    def configured(self) -> bool:
        return self.api_league_id is not None


# Short human aliases, keyed by the fleet's own competition code so they
# survive a registry re-mine (display names drift; the code does not).
# These are the names the universe actually uses in conversation.
CURATED_ALIASES: Dict[str, tuple] = {
    "NBA": ("nba", "united-states-nba"),
    "BNX": ("euroleague", "euro-league"),
    "EUR": ("euroleague-eur",),
    "ECU": ("eurocup",),
    "NBB": ("nbb",),
    "KBL": ("kbl",),
    "LAA": ("laa", "argentina-liga"),
    "ARW": ("arw",),
    "LEL": ("lel",),
    "KLF": ("klf",),
    "PL2": ("pl2",),
    "ISW": ("isw",),
    "ESW": ("esw",),
    "LKL": ("lkl",),
    "PLW": ("plw",),
    "ESP": ("esp",),
    "IT2": ("it2",),
    "DE2": ("de2",),
    "CZ2": ("cz2",),
    "NBN": ("nbn",),
    "TW4": ("tw4",),
    "CBA": ("cba",),
}


def _apply_curated(specs: Dict[str, LeagueSpec]) -> None:
    for spec in specs.values():
        code = fleet_code(spec.display_name)
        for alias in CURATED_ALIASES.get(code, ()):
            if alias not in spec.aliases:
                spec.aliases.append(alias)


_INDEX: Optional[Dict[str, LeagueSpec]] = None


# ─────────────────────────────────────────────────────────────────────────
# Loading
# ─────────────────────────────────────────────────────────────────────────

def _slug(text: str) -> str:
    s = unicodedata.normalize("NFKD", str(text or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def league_key_for_satellite_name(name: str) -> str:
    """' Brazil (NBB) F10'  →  'brazil-nbb'   (date code stripped)"""
    cleaned = _DATE_CODE_RE.sub("", (name or "").strip())
    return _slug(cleaned)


def load_leagues(force: bool = False) -> Dict[str, LeagueSpec]:
    """Load ingest/leagues.json, falling back to mining the fleet registry."""
    global _INDEX
    if _INDEX is not None and not force:
        return _INDEX

    specs: Dict[str, LeagueSpec] = {}

    if LEAGUES_PATH.exists():
        try:
            raw = json.loads(LEAGUES_PATH.read_text(encoding="utf-8"))
            for entry in raw.get("leagues", []):
                spec = LeagueSpec(**{
                    k: v for k, v in entry.items()
                    if k in LeagueSpec.__dataclass_fields__
                })
                specs[spec.key] = spec
        except Exception as exc:  # pragma: no cover
            log.error("ingest/leagues.json is unreadable: %s", exc)

    if not specs:
        # No index yet — bootstrap straight from the fleet registry so the
        # pipeline is usable before `bootstrap-leagues` has ever been run.
        # Once the file exists it is authoritative: merging duplicates (see
        # merge_same_codes) has to actually stick.
        for spec in _mine_fleet_registry():
            specs[spec.key] = spec
        _apply_curated(specs)

    _INDEX = specs
    return specs


def _mine_fleet_registry() -> List[LeagueSpec]:
    """Every league the fleet has ever traded, straight out of registry.json."""
    if not FLEET_REGISTRY.exists():
        return []
    try:
        data = json.loads(FLEET_REGISTRY.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover
        log.warning("registry.json unreadable: %s", exc)
        return []

    by_key: Dict[str, LeagueSpec] = {}
    for sat in data.get("satellites", []):
        name = str(sat.get("name", "")).strip()
        if not name:
            continue
        key = league_key_for_satellite_name(name)
        display = _DATE_CODE_RE.sub("", name).strip()
        spec = by_key.get(key)
        if spec is None:
            spec = LeagueSpec(key=key, display_name=display)
            by_key[key] = spec
        code = name[len(display):].strip()
        if code and code not in spec.satellite_dates:
            spec.satellite_dates.append(code)
    return list(by_key.values())


def rebuild_from_fleet(preserve_curated: bool = True) -> List[LeagueSpec]:
    """
    Rebuild the league index from the fleet registry, then re-apply anything
    curated in the current file.

    `bootstrap-leagues` must be idempotent: re-running it should *clean* stale
    keys left behind by an earlier naming pass, not accumulate them. Without
    this, a satellite named "South Korea (KBL) JW31" stays a phantom league
    forever and quietly doubles that competition's games.
    """
    previous: Dict[str, LeagueSpec] = {}
    if preserve_curated and LEAGUES_PATH.exists():
        try:
            raw = json.loads(LEAGUES_PATH.read_text(encoding="utf-8"))
            for entry in raw.get("leagues", []):
                spec = LeagueSpec(**{
                    k: v for k, v in entry.items()
                    if k in LeagueSpec.__dataclass_fields__
                })
                previous[spec.key] = spec
        except Exception as exc:  # pragma: no cover
            log.warning("could not read existing leagues.json: %s", exc)

    fresh: Dict[str, LeagueSpec] = {spec.key: spec for spec in _mine_fleet_registry()}

    if preserve_curated:
        by_display = {_slug(v.display_name): v for v in previous.values()}
        for key, spec in fresh.items():
            old = previous.get(key) or by_display.get(_slug(spec.display_name))
            if old is None:
                continue
            for alias in old.aliases:
                if alias not in spec.aliases:
                    spec.aliases.append(alias)
            spec.country = spec.country or old.country
            spec.timezone = old.timezone or spec.timezone
            spec.api_league_id = spec.api_league_id or old.api_league_id
            spec.season = spec.season or old.season

        # keep curated entries that no longer appear in the registry (e.g. a
        # hand-added league, or an API-only competition)
        for key, old in previous.items():
            if key not in fresh and (old.api_league_id or old.aliases):
                fresh[key] = old

    _apply_curated(fresh)
    return list(fresh.values())


_WOMEN_MARKERS = ("women", " w ", "w-", "-w", "feminina", "femenina", "femminile", "dames")


def _looks_womens(name: str) -> bool:
    s = f" {_slug(name).replace('-', ' ')} "
    return any(m in s for m in _WOMEN_MARKERS) or s.strip().endswith(" w")


def merge_same_codes(specs: List[LeagueSpec], dry_run: bool = False) -> List[Dict[str, str]]:
    """
    Merge league entries that share the fleet's competition code.

    registry.json spells the same competition several ways ("Poland (PL2)" and
    "Poland 1 Liga (PL2)"), which would otherwise create two satellites fed by
    one vendor league — and the Assayer would grade the same games twice.

    Women's competitions are never merged into men's: the code is shared but the
    competition is not.
    """
    groups: Dict[str, List[LeagueSpec]] = {}
    for spec in specs:
        code = fleet_code(spec.display_name)
        if code:
            groups.setdefault(code, []).append(spec)

    merged: List[Dict[str, str]] = []
    pending: List[tuple[LeagueSpec, LeagueSpec]] = []

    for code, members in sorted(groups.items()):
        if len(members) < 2:
            continue
        womens = [m for m in members if _looks_womens(m.display_name)]
        mens = [m for m in members if not _looks_womens(m.display_name)]

        for bucket in (mens, womens):
            if len(bucket) < 2:
                continue
            # canonical = the spelling with the most history behind it, so the
            # surviving key is the one the fleet has been trading longest;
            # name length breaks ties.
            canonical = max(
                bucket,
                key=lambda s: (len(s.satellite_dates), len(s.display_name.split())),
            )
            for other in bucket:
                if other is canonical:
                    continue
                pending.append((canonical, other))
                merged.append({
                    "code": code,
                    "kept": canonical.key,
                    "absorbed": other.key,
                    "display": other.display_name,
                })

    if dry_run or not merged:
        # A dry run must not mutate anything — otherwise a "preview" silently
        # rewrites the index that the next save persists.
        return merged

    for canonical, other in pending:
        for alias in [other.display_name, other.key] + other.aliases:
            if alias and alias not in canonical.aliases:
                canonical.aliases.append(alias)
        canonical.satellite_dates.extend(
            d for d in other.satellite_dates if d not in canonical.satellite_dates
        )
        canonical.api_league_id = canonical.api_league_id or other.api_league_id

    absorbed_keys = {m["absorbed"] for m in merged}
    _apply_curated({s.key: s for s in specs})
    save_leagues([s for s in specs if s.key not in absorbed_keys])
    load_leagues(force=True)
    return merged


def resolve(league_key: str) -> Optional[LeagueSpec]:
    """
    Resolve any way a human or a config might name a league:

        'united-states-nba'  the canonical slug
        'nba'                an alias
        'United States (NBA)' the display name
        'NBB'                the fleet's own competition code — this is how the
                             satellites are actually named, so it is supported
                             explicitly rather than left to guesswork
    """
    specs = load_leagues()
    if league_key in specs:
        return specs[league_key]

    slug = _slug(league_key)
    if slug in specs:
        return specs[slug]

    for spec in specs.values():
        if _slug(spec.display_name) == slug:
            return spec
        if any(_slug(a) == slug for a in spec.aliases):
            return spec

    code = (league_key or "").strip().upper()
    if 2 <= len(code) <= 6 and code.isalnum():
        hits = [spec for spec in specs.values() if fleet_code(spec.display_name) == code]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            log.warning("league code '%s' is ambiguous (%s) — use a slug instead",
                        code, ", ".join(h.key for h in hits))
            return None
    return None


# ─────────────────────────────────────────────────────────────────────────
# Vendor league matching (for bulk date queries)
# ─────────────────────────────────────────────────────────────────────────

_CODE_RE = re.compile(r"\(([A-Z0-9]{2,6})\)")


def fleet_code(display_name: str) -> str:
    """'Brazil (NBB) F10' → 'NBB' — the fleet's own competition code."""
    m = _CODE_RE.search(display_name or "")
    return m.group(1).upper() if m else ""


def match_vendor_league(
    vendor_name: str,
    vendor_country: str = "",
    api_id: Optional[int] = None,
    threshold: float = 0.72,
) -> tuple[Optional[LeagueSpec], float]:
    """
    Find the fleet league that corresponds to a vendor's league name.

    A bulk date query returns every competition at once, so this is what turns
    "which of my 166 leagues is this?" into something the pipeline can answer
    without 166 probing requests.

    Matching order:
      1. the fleet's own code inside the vendor name  ('NBB' in 'NBB')
      2. exact normalised name
      3. country + name-token overlap
    Returns (spec, confidence); confidence < threshold means "do not guess".
    """
    from difflib import SequenceMatcher

    if not vendor_name:
        return None, 0.0

    vendor_slug = _slug(vendor_name)
    vendor_upper = (vendor_name or "").upper()
    vendor_tokens = set(vendor_slug.split())
    country_slug = _slug(vendor_country)

    best: tuple[Optional[LeagueSpec], float] = (None, 0.0)
    for spec in load_leagues().values():
        if api_id is not None and spec.api_league_id == api_id:
            return spec, 1.0

        code = fleet_code(spec.display_name)
        score = 0.0

        # 1. code match — by far the strongest signal
        if code and (code in vendor_tokens or re.search(rf"\b{re.escape(code)}\b", vendor_upper)):
            score = 0.95
        else:
            # 2. normalised name equality / containment
            fleet_slug = _slug(spec.display_name)
            fleet_core = _slug(re.sub(r"\([A-Z0-9]+\)", "", spec.display_name))
            if vendor_slug and vendor_slug in (fleet_slug, fleet_core):
                score = 0.93
            elif fleet_core and (fleet_core in vendor_slug or vendor_slug in fleet_core):
                score = 0.88
            else:
                # 3. token overlap, boosted when the country agrees
                fleet_tokens = set(fleet_core.split()) or {fleet_slug}
                overlap = len(vendor_tokens & fleet_tokens) / max(len(vendor_tokens | fleet_tokens), 1)
                score = overlap * 0.85
                if country_slug and spec.country and country_slug == _slug(spec.country):
                    score += 0.12
                score = max(score, SequenceMatcher(None, vendor_slug, fleet_core).ratio() * 0.7)

        if score > best[1]:
            best = (spec, score)

    if best[0] is None or best[1] < threshold:
        return None, best[1]
    return best[0], best[1]


def apply_vendor_match(spec: LeagueSpec, api_id: int, vendor_name: str = "") -> None:
    """Persist a discovered vendor league id onto the fleet league."""
    changed = False
    if spec.api_league_id != api_id:
        spec.api_league_id = api_id
        changed = True
    if vendor_name and vendor_name not in spec.aliases:
        spec.aliases.append(vendor_name)
        changed = True
    if changed:
        save_leagues(load_leagues().values())


def all_leagues() -> List[LeagueSpec]:
    return sorted(load_leagues().values(), key=lambda s: s.key)


def configured_leagues() -> List[LeagueSpec]:
    return [s for s in all_leagues() if s.configured]


def unconfigured_leagues() -> List[LeagueSpec]:
    return [s for s in all_leagues() if not s.configured]


# ─────────────────────────────────────────────────────────────────────────
# Persistence
# ─────────────────────────────────────────────────────────────────────────

def save_leagues(specs: Iterable[LeagueSpec], path: Path = LEAGUES_PATH) -> None:
    payload = {
        "generated_by": "ingest/leagues.py — python -m ingest.cli bootstrap-leagues",
        "leagues": [asdict(s) for s in sorted(specs, key=lambda s: s.key)],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def update_league(key: str, **fields) -> LeagueSpec:
    specs = load_leagues()
    spec = specs.get(key)
    if spec is None:
        raise KeyError(f"unknown league '{key}'")
    for k, v in fields.items():
        if k in LeagueSpec.__dataclass_fields__:
            setattr(spec, k, v)
    save_leagues(specs.values())
    return spec


# ─────────────────────────────────────────────────────────────────────────
# Satellite identity
# ─────────────────────────────────────────────────────────────────────────

def satellite_id_for(league_key: str, date_iso: str) -> str:
    """
    Stable id for a virtual satellite.

    The rest of the universe keys everything off `satellite_id`
    (registry, snapshot rows, assay results).  We keep the same idea but make
    the id deterministic from league + date instead of a Drive file id, so a
    satellite can be regenerated at any time and still be recognised.
    """
    return f"api:{league_key}:{date_iso}"


def satellite_name_for(spec: LeagueSpec, date_iso: str) -> str:
    """Mirrors the fleet convention 'United States (NBA) J10' using real dates."""
    return f"{spec.display_name} {date_iso}"


def parse_satellite_id(satellite_id: str) -> Optional[tuple[str, str]]:
    """'api:nba:2026-10-14' → ('nba', '2026-10-14')"""
    parts = (satellite_id or "").split(":")
    if len(parts) == 3 and parts[0] == "api":
        return parts[1], parts[2]
    return None
