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

# Trailing date code the fleet appends to satellite names: "J10", "F09", "M13.2"
_DATE_CODE_RE = re.compile(r"\s*[JFMASOND]\d{1,2}(?:\.\d+)?\s*$")


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

    for spec in _mine_fleet_registry():
        specs.setdefault(spec.key, spec)

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


def resolve(league_key: str) -> Optional[LeagueSpec]:
    """Accept either a slug ('nba') or a display name ('United States (NBA)')."""
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
    return None


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
