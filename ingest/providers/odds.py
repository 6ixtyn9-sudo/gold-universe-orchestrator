"""
ingest/providers/odds.py
────────────────────────
Forebet replacement, part 1: price the fixtures from the betting market.

Forebet's "Prob %" is a model output; bookmakers publish prices instead.
Removing the bookmaker margin (overround) from a 1X2 market turns those prices
back into probabilities, which is a stronger, fully auditable signal — and
unlike a scraped page it is a documented API with an SLA.

Vendor: The Odds API (the-odds-api.com)
Auth:   ?apiKey=<KEY>            env  ODDS_API_KEY
Docs:   https://the-odds-api.com/liveapi/guides/v4/

If no key is configured the pipeline skips this source and falls back to
ingest/providers/model.py, so ingestion never hard-depends on an odds vendor.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from ingest.models import Fixture
from ingest.providers.base import ProbabilitySource, ProviderError
from ingest.teams import TeamResolver

log = logging.getLogger("ingest.provider.odds")

BASE_URL = "https://api.the-odds-api.com/v4"
DEFAULT_TIMEOUT = 25
CACHE_TTL_SECONDS = 600

# The Odds API sport keys for the basketball competitions the fleet trades.
# Keys not listed here are simply not priced by this vendor — the model source
# covers them.
SPORT_KEYS: Dict[str, str] = {
    "united-states-nba": "basketball_nba",
    "nba": "basketball_nba",
    "euroleague": "basketball_euroleague",
    "europe-league-bnx": "basketball_euroleague",
    "united-states-wnba": "basketball_wnba",
    "australia-nbl": "basketball_nbl",
    "spain-liga-acb": "basketball_spain_acb",
}


class OddsApiProbabilitySource(ProbabilitySource):
    name = "odds_api"

    def __init__(
        self,
        api_key: Optional[str] = None,
        regions: str = "eu",
        markets: str = "h2h,totals",
        bookmakers: Optional[Iterable[str]] = None,
        cache_dir: str | Path = "ingest/.cache",
        cache_ttl: int = CACHE_TTL_SECONDS,
        resolver: Optional[TeamResolver] = None,
        apply_shrinkage: float = 0.0,
    ):
        self.api_key = api_key or os.environ.get("ODDS_API_KEY", "")
        self.regions = regions
        self.markets = markets
        self.bookmakers = list(bookmakers or [])
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.cache_ttl = cache_ttl
        self.resolver = resolver or TeamResolver()
        self.apply_shrinkage = apply_shrinkage
        self.quota_remaining: Optional[str] = None

    # ── HTTP ────────────────────────────────────────────────────────────

    def _cache_path(self, sport: str) -> Path:
        tag = ".".join(self.bookmakers) if self.bookmakers else "all"
        return self.cache_dir / f"odds__{sport}__{self.regions}__{self.markets}__{tag}.json"

    def fetch_markets(self, league_key: str) -> List[Dict[str, Any]]:
        sport = SPORT_KEYS.get(league_key)
        if not sport:
            return []                     # vendor doesn't carry this competition
        cache_file = self._cache_path(sport)
        if cache_file.exists() and (datetime.now().timestamp() - cache_file.stat().st_mtime) < self.cache_ttl:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        if not self.api_key:
            log.info("ODDS_API_KEY not set — skipping market pricing for %s", league_key)
            return []

        params = {
            "apiKey": self.api_key,
            "regions": self.regions,
            "markets": self.markets,
            "oddsFormat": "decimal",
            "dateFormat": "iso",
        }
        if self.bookmakers:
            params["bookmakers"] = ",".join(self.bookmakers)
        url = f"{BASE_URL}/sports/{sport}/odds?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=DEFAULT_TIMEOUT) as resp:
                self.quota_remaining = resp.headers.get("x-requests-remaining")
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise ProviderError(f"The Odds API HTTP {exc.code} for {sport}") from exc
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"The Odds API request failed for {sport}: {exc}") from exc

        cache_file.write_text(json.dumps(payload), encoding="utf-8")
        return payload

    # ── ProbabilitySource ───────────────────────────────────────────────

    def annotate(self, fixtures: List[Fixture]) -> List[Fixture]:
        by_league: Dict[str, List[Fixture]] = {}
        for f in fixtures:
            by_league.setdefault(f.league_key, []).append(f)

        for league_key, league_fixtures in by_league.items():
            try:
                markets = self.fetch_markets(league_key)
            except ProviderError as exc:
                log.warning("odds unavailable for %s: %s", league_key, exc)
                continue
            if not markets:
                continue
            self._apply(league_fixtures, markets)
        return fixtures

    def _apply(self, fixtures: List[Fixture], markets: List[Dict[str, Any]]) -> None:
        index: List[Tuple[str, str, Dict[str, Any]]] = []
        for event in markets:
            kickoff = str(event.get("commence_time", ""))[:10]
            index.append((str(event.get("home_team", "")), str(event.get("away_team", "")), event))

        for f in fixtures:
            if f.home_prob is not None:
                continue
            event = self._match_event(f, index)
            if event is None:
                continue
            probs, used_books = self._consensus_probabilities(event)
            if not probs:
                continue
            p_home, p_away = probs
            f.home_prob = round(p_home * 100.0, 1)
            f.away_prob = round(p_away * 100.0, 1)
            f.prob_source = f"{self.name}:{'+'.join(used_books)}"
            f.pick_side = "1" if p_home >= p_away else "2"
            f.pick_source = f.prob_source
            f.odds_home = f.odds_home or _outcome_price(event, f.home)
            f.odds_away = f.odds_away or _outcome_price(event, f.away)
            f.total_line = f.total_line or _consensus_total(event)
            f.kickoff_utc = str(event.get("commence_time", ""))

    def _match_event(
        self, fixture: Fixture, index: List[Tuple[str, str, Dict[str, Any]]]
    ) -> Optional[Dict[str, Any]]:
        for home, away, event in index:
            if self.resolver.same(home, fixture.home) and self.resolver.same(away, fixture.away):
                return event
        # fall back to date-scoped fuzzy matching — vendor naming drifts
        candidates = [
            (home, away, event) for home, away, event in index
            if str(event.get("commence_time", ""))[:10] == fixture.date
        ]
        for home, away, event in candidates:
            if self.resolver.key(home) == self.resolver.key(fixture.home):
                return event
            if self.resolver.key(away) == self.resolver.key(fixture.away):
                return event
        log.debug("no market matched %s vs %s (%s)", fixture.home, fixture.away, fixture.date)
        return None

    def _consensus_probabilities(
        self, event: Dict[str, Any]
    ) -> Tuple[Optional[Tuple[float, float]], List[str]]:
        """Average de-vigged probabilities across bookmakers."""
        home_team = str(event.get("home_team", ""))
        away_team = str(event.get("away_team", ""))
        samples: List[Tuple[float, float]] = []
        used: List[str] = []

        for book in event.get("bookmakers") or []:
            key = str(book.get("key") or "")
            if self.bookmakers and key not in self.bookmakers:
                continue
            prices = _h2h_prices(book, home_team, away_team)
            if not prices:
                continue
            home_price, away_price = prices
            try:
                ph, pa = devig_two_way(float(home_price), float(away_price))
            except (TypeError, ValueError, ZeroDivisionError):
                continue
            samples.append((ph, pa))
            used.append(key)

        if not samples:
            return None, []
        p_home = sum(s[0] for s in samples) / len(samples)
        p_away = sum(s[1] for s in samples) / len(samples)
        if self.apply_shrinkage > 0:
            w = min(max(self.apply_shrinkage, 0.0), 1.0)
            p_home = p_home * (1 - w) + 0.5 * w
            p_away = p_away * (1 - w) + 0.5 * w
        return (p_home, p_away), used


# ─────────────────────────────────────────────────────────────────────────
# Market maths
# ─────────────────────────────────────────────────────────────────────────

def devig_two_way(home_odds: float, away_odds: float) -> Tuple[float, float]:
    """
    Remove the bookmaker margin from a two-way market.

    Uses the proportional (multiplicative) method — the same convention most
    published closing-line-value work uses, and the cheapest to explain:

        raw_i = 1 / odds_i
        p_i   = raw_i / sum(raw)
    """
    if home_odds <= 1.0 or away_odds <= 1.0:
        raise ValueError("decimal odds must be > 1.0")
    raw_h, raw_a = 1.0 / home_odds, 1.0 / away_odds
    total = raw_h + raw_a
    return raw_h / total, raw_a / total


def overround(home_odds: float, away_odds: float) -> float:
    """Bookmaker margin implied by a two-way market (0.05 = 5%)."""
    return (1.0 / home_odds + 1.0 / away_odds) - 1.0


def implied_probability(decimal_odds: float) -> float:
    if decimal_odds <= 0:
        return 0.0
    return 1.0 / decimal_odds


def _h2h_prices(book: Dict[str, Any], home_team: str, away_team: str) -> Optional[Tuple[float, float]]:
    for market in book.get("markets") or []:
        if market.get("key") != "h2h":
            continue
        prices: Dict[str, float] = {}
        for outcome in market.get("outcomes") or []:
            name = str(outcome.get("name") or "")
            price = outcome.get("price")
            if name and price is not None:
                prices[name] = price
        home_price = _lookup_price(prices, home_team)
        away_price = _lookup_price(prices, away_team)
        if home_price is not None and away_price is not None:
            return home_price, away_price
    return None


def _lookup_price(prices: Dict[str, float], team: str) -> Optional[float]:
    if team in prices:
        return prices[team]
    from ingest.teams import normalise
    target = normalise(team)
    for name, price in prices.items():
        if normalise(name) == target:
            return price
    return None


def _consensus_total(event: Dict[str, Any]) -> Optional[float]:
    """
    Average 'points' line across bookmakers for the game total.

    This is the number the O/U engine prices against — deriving the line from
    our own model would guarantee a zero edge, which is exactly the bug that
    makes a self-referential O/U engine look broken.
    """
    lines: List[float] = []
    for book in event.get("bookmakers") or []:
        for market in book.get("markets") or []:
            if market.get("key") != "totals":
                continue
            for outcome in market.get("outcomes") or []:
                point = outcome.get("point")
                if point is not None:
                    lines.append(float(point))
    if not lines:
        return None
    return round(sum(lines) / len(lines), 1)


def _outcome_price(event: Dict[str, Any], team: str) -> Optional[float]:
    for book in event.get("bookmakers") or []:
        prices = _h2h_prices(book, str(event.get("home_team", "")), str(event.get("away_team", "")))
        if prices is None:
            continue
        home_price, away_price = prices
        if TeamResolver().same(team, str(event.get("home_team", ""))):
            return home_price
        if TeamResolver().same(team, str(event.get("away_team", ""))):
            return away_price
    return None
