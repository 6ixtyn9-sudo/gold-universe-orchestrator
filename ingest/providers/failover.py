"""
ingest/providers/failover.py
────────────────────────────
Chain several free-tier providers into one.

Free keys are small and they run out mid-run. A vendor at 100 req/day will not
tell you politely that it is done — the next call just errors, and you get a
half-ingested day with no explanation (and a satellite that looks complete).

`FailoverProvider` wraps a list of providers and, for every call, walks the
list until one answers, skipping any that are out of budget or erroring. With
API-Basketball + Highlightly you get 200 requests/day that behave like one
provider; add a third and it is 300, without touching the pipeline.

It deliberately does *not* merge partial results: a call is answered by exactly
one provider, because mixing two vendors' fixtures for the same league would
double-count games in the Assayer.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence

from ingest.models import Fixture, GameResult, QuarterProfile, StandingRow
from ingest.providers.base import DataProvider, NotSupported, ProviderError
from ingest.quotas import QuotaExceeded

log = logging.getLogger("ingest.provider.failover")


class FailoverProvider(DataProvider):
    name = "failover"

    def __init__(self, providers: Sequence[DataProvider], verbose: bool = True):
        if not providers:
            raise ProviderError("FailoverProvider needs at least one provider")
        self.providers = list(providers)
        self.verbose = verbose
        self.last_used: Optional[str] = None
        self.usage: Dict[str, int] = {getattr(p, "name", "?"): 0 for p in self.providers}

    # ── capability flags come from the union of members ─────────────────

    @property
    def supports_standings(self) -> bool:  # type: ignore[override]
        return any(getattr(p, "supports_standings", False) for p in self.providers)

    @property
    def supports_bulk(self) -> bool:  # type: ignore[override]
        return any(getattr(p, "supports_bulk", False) for p in self.providers)

    @property
    def supports_odds(self) -> bool:  # type: ignore[override]
        return any(getattr(p, "supports_odds", False) for p in self.providers)

    # ── dispatch ────────────────────────────────────────────────────────

    def _call(self, method: str, *args: Any, **kwargs: Any) -> Any:
        """Try each provider in order; return the first successful answer."""
        errors: List[str] = []
        for provider in self.providers:
            name = getattr(provider, "name", "?")
            try:
                result = getattr(provider, method)(*args, **kwargs)
            except QuotaExceeded as exc:
                errors.append(f"{name}: out of quota ({exc})")
                if self.verbose:
                    log.warning("failover: %s is out of quota, trying next", name)
                continue
            except (NotSupported, AttributeError, NotImplementedError):
                # capability the member simply doesn't have — keep walking
                continue
            except ProviderError as exc:
                errors.append(f"{name}: {exc}")
                if self.verbose:
                    log.warning("failover: %s failed (%s), trying next", name, exc)
                continue
            self.last_used = name
            self.usage[name] = self.usage.get(name, 0) + 1
            return result

        if not errors:
            raise NotSupported(f"no provider in the chain supports {method}")
        raise ProviderError(f"all providers failed for {method}: " + "; ".join(errors))

    # ── DataProvider ────────────────────────────────────────────────────

    def fixtures(self, league_key: str, date_from: str, date_to: str) -> List[Fixture]:
        return self._call("fixtures", league_key, date_from, date_to)

    def results(self, league_key: str, date_from: str, date_to: str) -> List[GameResult]:
        return self._call("results", league_key, date_from, date_to)

    def standings(self, league_key: str, season: str = "") -> List[StandingRow]:
        return self._call("standings", league_key, season)

    def team_history(self, league_key: str, team: str, before: str, limit: int = 10) -> List[GameResult]:
        return self._call("team_history", league_key, team, before, limit)

    def h2h(self, league_key: str, home: str, away: str, before: str, limit: int = 10) -> List[GameResult]:
        return self._call("h2h", league_key, home, away, before, limit)

    def quarter_profiles(self, league_key: str, season: str = "") -> List[QuarterProfile]:
        return self._call("quarter_profiles", league_key, season)

    def bulk_day(self, date_iso: str) -> List[Dict[str, Any]]:
        return self._call("bulk_day", date_iso)

    def describe(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "members": [getattr(p, "name", "?") for p in self.providers],
            "usage": dict(self.usage),
            "bulk": self.supports_bulk,
            "standings": self.supports_standings,
        }
