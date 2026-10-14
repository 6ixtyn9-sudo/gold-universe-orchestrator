"""
ingest/models.py
────────────────
Canonical, source-agnostic data models for the API ingestion layer.

Every provider (API-Sports, The Odds API, Fixture/CSV, future scrapers)
normalises its payload into these models. Everything downstream of a
provider — contract builders, sinks, the Brain, the Assayer — only ever
sees these objects, never provider JSON.

This is the seam that lets us swap data sources without touching the
prediction engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ─────────────────────────────────────────────────────────────────────────
# Fixtures (upcoming games)
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class Fixture:
    """An upcoming game, normalised across providers."""

    league_key: str                 # canonical key, e.g. "nba"
    date: str                       # ISO "YYYY-MM-DD" (league-local, as published)
    time: str                       # "HH:MM" 24h, or "" when TBC
    home: str
    away: str
    league_display: str = ""        # human name, e.g. "United States (NBA)"
    game_type: str = "Regular"

    # 1X2 probabilities, 0-100. These replace the hand-copied "Prob %" column.
    home_prob: Optional[float] = None
    away_prob: Optional[float] = None
    prob_source: str = ""           # "odds" | "poisson" | "provider" | "manual"

    # The pick that replaces the hand-copied "Pred" column.
    pick_side: str = ""             # "1" (home), "2" (away), "" (no pick)
    pick_source: str = ""           # "odds" | "poisson" | "provider" | "manual"

    odds_home: Optional[float] = None
    odds_away: Optional[float] = None
    expected_total: Optional[float] = None  # replaces the forebet "Avg" column
    total_line: Optional[float] = None      # market O/U line (odds feed), the line
                                            # the O/U engine prices against

    provider_fixture_id: str = ""
    provider: str = ""
    kickoff_utc: str = ""           # ISO8601 Z, when the provider gives it
    status: str = ""
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def match_key(self) -> str:
        return f"{self.home} vs {self.away}".lower()


# ─────────────────────────────────────────────────────────────────────────
# Results (completed games)
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class GameResult:
    """A completed game with quarter splits — drives ResultsClean + CleanH2H/Recent."""

    league_key: str
    date: str                       # ISO "YYYY-MM-DD"
    home: str
    away: str
    time: str = ""
    league_display: str = ""
    game_type: str = "Regular"

    q1h: Optional[int] = None
    q1a: Optional[int] = None
    q2h: Optional[int] = None
    q2a: Optional[int] = None
    q3h: Optional[int] = None
    q3a: Optional[int] = None
    q4h: Optional[int] = None
    q4a: Optional[int] = None
    oth: Optional[int] = None       # overtime — home
    ota: Optional[int] = None       # overtime — away

    provider: str = ""
    provider_fixture_id: str = ""
    status: str = "FT"

    # ── derived ──────────────────────────────────────────────────────
    @property
    def ft_h(self) -> Optional[int]:
        return _sum_optional(
            [self.q1h, self.q2h, self.q3h, self.q4h, self.oth]
        )

    @property
    def ft_a(self) -> Optional[int]:
        return _sum_optional(
            [self.q1a, self.q2a, self.q3a, self.q4a, self.ota]
        )

    @property
    def winner_side(self) -> str:
        """'H' | 'A' | 'D' | '' — mirrors the CleanH2H Winner column."""
        h, a = self.ft_h, self.ft_a
        if h is None or a is None:
            return ""
        if h > a:
            return "H"
        if a > h:
            return "A"
        return "D"

    def quarter_totals(self) -> Dict[str, Optional[int]]:
        """{'Q1': 210, 'Q2': ..., 'FT': ...} — totals, home+away."""
        out: Dict[str, Optional[int]] = {}
        for label, h, a in (
            ("Q1", self.q1h, self.q1a),
            ("Q2", self.q2h, self.q2a),
            ("Q3", self.q3h, self.q3a),
            ("Q4", self.q4h, self.q4a),
        ):
            out[label] = None if (h is None or a is None) else h + a
        total = None
        ft = self.ft_h
        fta = self.ft_a
        if ft is not None and fta is not None:
            total = ft + fta
        out["FT"] = total
        return out

    def sum_mismatch(self) -> str:
        """'OK' when quarter splits reconcile with the final total, else a note."""
        ft, fta = self.ft_h, self.ft_a
        if ft is None or fta is None:
            return "NO_FT"
        quarters = [self.q1h, self.q2h, self.q3h, self.q4h]
        if any(q is None for q in quarters):
            return "NO_QUARTERS"
        return "OK"


def _sum_optional(values: List[Optional[int]]) -> Optional[int]:
    present = [v for v in values if v is not None]
    if not present:
        return None
    return int(sum(present))


# ─────────────────────────────────────────────────────────────────────────
# Standings
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class StandingRow:
    team: str
    section: str = ""               # "East", "Group A", ...
    position: str = ""
    gp: Optional[int] = None
    w: Optional[int] = None
    l: Optional[int] = None
    pct: Optional[float] = None     # 0..1
    pf: Optional[float] = None      # points for (total or per-game — provider decides)
    pa: Optional[float] = None      # points against
    streak: str = ""
    l10: str = ""
    home_record: str = ""
    away_record: str = ""
    league_key: str = ""


# ─────────────────────────────────────────────────────────────────────────
# Quarter profile (LeagueQuarterO_U_Stats / TeamQuarterStats_Tier2)
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class QuarterProfile:
    """
    Per-team (or league-wide) quarter scoring distribution used by
    brain/signal_processor.py to price quarter Over/Under markets.
    """

    team: str = ""                  # "" for a league-wide profile
    league_key: str = ""
    sample_n: int = 0
    q_mu: Dict[str, float] = field(default_factory=dict)      # {'Q1': 54.2, ...}
    q_sigma: Dict[str, float] = field(default_factory=dict)   # {'Q1': 9.8, ...}
    q_mu_for: Dict[str, float] = field(default_factory=dict)   # team scoring
    q_mu_against: Dict[str, float] = field(default_factory=dict)


# ─────────────────────────────────────────────────────────────────────────
# Bundle: everything one ingestion run produces for one virtual satellite
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class IngestBundle:
    """
    One "virtual satellite" — the API-era replacement for a Google Sheets
    satellite. `satellite_id` keeps the same key space the rest of the
    universe already uses, so downstream code needs no changes.
    """

    satellite_id: str
    satellite_name: str
    league_key: str
    tabs: Dict[str, List[List[Any]]] = field(default_factory=dict)
    meta: Dict[str, Any] = field(default_factory=dict)

    def tab_names(self) -> List[str]:
        return sorted(self.tabs.keys())
