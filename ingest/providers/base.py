"""
ingest/providers/base.py
────────────────────────
The provider interface.

A provider is a thin, stateless adapter over one upstream data source.
It must return canonical models (ingest/models.py) — nothing else in the
codebase ever sees provider-specific JSON.

Implementations that ship today:
  * FixtureProvider   — reads local JSON, no network. Powers tests + dry runs.
  * ApiSportsProvider — api-sports.io / api-basketball (needs an API key).

To add a new source, subclass DataProvider and register it in
ingest/providers/__init__.py. Nothing else changes.
"""

from __future__ import annotations

import abc
import logging
from typing import Any, Dict, List, Optional

from ingest.models import Fixture, GameResult, QuarterProfile, StandingRow

log = logging.getLogger("ingest.provider")


class ProviderError(RuntimeError):
    """Raised when a provider cannot fulfil a request (HTTP, quota, bad key)."""


class NotSupported(ProviderError):
    """Raised when a provider legitimately has no data for a capability."""


class DataProvider(abc.ABC):
    """
    Contract for all ingestion sources.

    Dates are ISO 'YYYY-MM-DD'.  Every method takes a `league_key` that
    resolves through ingest/leagues.py — providers never see the fleet's
    sheet names.
    """

    name: str = "base"

    # ── capability flags ────────────────────────────────────────────────
    supports_fixtures: bool = True
    supports_results: bool = True
    supports_standings: bool = False
    supports_quarters: bool = True
    supports_odds: bool = False

    # ── required ────────────────────────────────────────────────────────

    @abc.abstractmethod
    def fixtures(self, league_key: str, date_from: str, date_to: str) -> List[Fixture]:
        """Upcoming (or scheduled) games in the inclusive date window."""

    # ── optional, with sane defaults ────────────────────────────────────

    def results(self, league_key: str, date_from: str, date_to: str) -> List[GameResult]:
        """Completed games with quarter splits, inclusive date window."""
        if not self.supports_results:
            raise NotSupported(f"{self.name} does not expose results")
        return []

    def standings(self, league_key: str, season: str = "") -> List[StandingRow]:
        if not self.supports_standings:
            raise NotSupported(f"{self.name} does not expose standings")
        return []

    def team_history(
        self, league_key: str, team: str, before: str, limit: int = 10
    ) -> List[GameResult]:
        """Most recent `limit` completed games for a team, newest first."""
        return []

    def h2h(
        self, league_key: str, home: str, away: str, before: str, limit: int = 10
    ) -> List[GameResult]:
        """Previous meetings between two teams, newest first."""
        return []

    def quarter_profiles(
        self, league_key: str, season: str = ""
    ) -> List[QuarterProfile]:
        """Per-team quarter means/sigmas. Optional — computed from results when absent."""
        return []

    # ── introspection ───────────────────────────────────────────────────

    def describe(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "fixtures": self.supports_fixtures,
            "results": self.supports_results,
            "standings": self.supports_standings,
            "quarters": self.supports_quarters,
            "odds": self.supports_odds,
        }


class ProbabilitySource(abc.ABC):
    """
    Supplies the 1X2 probabilities that used to be hand-copied from Forebet.

    This is deliberately a separate interface from DataProvider: what the
    games *are* and what the market *thinks* often come from different
    vendors.  Implementations live in ingest/providers/odds.py and
    ingest/providers/model.py.
    """

    name: str = "base"

    @abc.abstractmethod
    def annotate(self, fixtures: List[Fixture]) -> List[Fixture]:
        """
        Return the same fixtures with home_prob / away_prob / pick_side /
        odds_home / odds_away / prob_source filled in where possible.
        Fixtures the source cannot price are returned unchanged.
        """
