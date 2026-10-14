"""
ingest/providers/fixture.py
───────────────────────────
Offline provider backed by local JSON.

Purpose:
  * development and dry runs with no API key, no network, no quota
  * regression tests that pin the tab contract
  * replaying a real API response captured once, forever

File layout (one file per league per date-window is fine):

    examples/provider_fixtures/nba_2026-10-14.json
    {
      "league_key": "nba",
      "league_display": "United States (NBA)",
      "fixtures": [ { "date": "...", "time": "...", "home": "...", "away": "...",
                      "home_prob": 61, "away_prob": 39, "pick_side": "1",
                      "odds_home": 1.72, "odds_away": 2.10,
                      "expected_total": 221.5 } ],
      "results":  [ { "date": "...", "home": "...", "away": "...",
                      "q1h": 28, "q1a": 25, ... } ],
      "standings": [ { "team": "...", "gp": 10, "w": 7, "l": 3, ... } ]
    }
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from ingest.models import Fixture, GameResult, StandingRow
from ingest.providers.base import DataProvider, ProviderError

log = logging.getLogger("ingest.provider.fixture")


class FixtureProvider(DataProvider):
    name = "fixture"
    supports_standings = True
    supports_odds = True

    def __init__(self, root: str | Path):
        self.root = Path(root)
        if not self.root.exists():
            raise ProviderError(f"fixture root not found: {self.root}")
        self._cache: Dict[str, Dict[str, Any]] = {}

    # ── loading ─────────────────────────────────────────────────────────

    def _docs(self) -> List[Dict[str, Any]]:
        if not self._cache:
            for p in sorted(self.root.glob("*.json")):
                try:
                    doc = json.loads(p.read_text(encoding="utf-8"))
                except Exception as exc:
                    log.warning("skipping %s (%s)", p.name, exc)
                    continue
                key = _slug(str(doc.get("league_key") or p.stem))
                if not key:
                    continue
                bucket = self._cache.setdefault(key, {"fixtures": [], "results": [], "standings": []})
                for section in ("fixtures", "results", "standings"):
                    bucket[section].extend(doc.get(section) or [])
                # also index by the display name so a fixture file written with
                # league_key "nba" is still found when the pipeline asks for
                # "united-states-nba" (the fleet registry's slug).
                display = str(doc.get("league_display") or "")
                if display:
                    self._cache.setdefault(_slug(display), bucket)
        return list(self._cache.values())

    def _section(self, league_key: str, section: str) -> List[Dict[str, Any]]:
        self._docs()
        for candidate in self._candidates(league_key):
            doc = self._cache.get(candidate)
            if doc is not None:
                return list(doc.get(section) or [])
        return []

    @staticmethod
    def _candidates(league_key: str) -> List[str]:
        """Every spelling of a league this provider might be indexed under."""
        out = [_slug(league_key)]
        try:
            from ingest.leagues import resolve
            spec = resolve(league_key)
        except Exception:  # pragma: no cover
            spec = None
        if spec:
            out.append(_slug(spec.key))
            out.append(_slug(spec.display_name))
            out.extend(_slug(a) for a in spec.aliases)
        seen, unique = set(), []
        for key in out:
            if key and key not in seen:
                seen.add(key)
                unique.append(key)
        return unique

    # ── DataProvider ────────────────────────────────────────────────────

    def fixtures(self, league_key: str, date_from: str, date_to: str) -> List[Fixture]:
        out: List[Fixture] = []
        for raw in self._section(league_key, "fixtures"):
            date = str(raw.get("date", ""))[:10]
            if date_from and date < date_from:
                continue
            if date_to and date > date_to:
                continue
            out.append(Fixture(
                league_key=league_key,
                league_display=raw.get("league_display") or raw.get("league") or league_key,
                date=date,
                time=str(raw.get("time", "")),
                home=raw.get("home", ""),
                away=raw.get("away", ""),
                home_prob=raw.get("home_prob"),
                away_prob=raw.get("away_prob"),
                prob_source=raw.get("prob_source", "fixture"),
                pick_side=str(raw.get("pick_side", "")),
                pick_source=raw.get("pick_source", "fixture"),
                odds_home=raw.get("odds_home"),
                odds_away=raw.get("odds_away"),
                expected_total=raw.get("expected_total"),
                total_line=raw.get("total_line"),
                provider=self.name,
                provider_fixture_id=str(raw.get("id", "")),
                status=raw.get("status", ""),
                extra=raw.get("extra") or {},
            ))
        return out

    def results(self, league_key: str, date_from: str, date_to: str) -> List[GameResult]:
        out: List[GameResult] = []
        for raw in self._section(league_key, "results"):
            date = str(raw.get("date", ""))[:10]
            if date_from and date < date_from:
                continue
            if date_to and date > date_to:
                continue
            out.append(self._result(league_key, raw))
        return out

    def _result(self, league_key: str, raw: Dict[str, Any]) -> GameResult:
        return GameResult(
            league_key=league_key,
            league_display=raw.get("league_display") or raw.get("league") or league_key,
            date=str(raw.get("date", ""))[:10],
            time=str(raw.get("time", "")),
            home=raw.get("home", ""),
            away=raw.get("away", ""),
            q1h=_int(raw.get("q1h")), q1a=_int(raw.get("q1a")),
            q2h=_int(raw.get("q2h")), q2a=_int(raw.get("q2a")),
            q3h=_int(raw.get("q3h")), q3a=_int(raw.get("q3a")),
            q4h=_int(raw.get("q4h")), q4a=_int(raw.get("q4a")),
            oth=_int(raw.get("oth")), ota=_int(raw.get("ota")),
            provider=self.name,
            provider_fixture_id=str(raw.get("id", "")),
            status=raw.get("status", "FT"),
        )

    def standings(self, league_key: str, season: str = "") -> List[StandingRow]:
        out: List[StandingRow] = []
        for raw in self._section(league_key, "standings"):
            out.append(StandingRow(
                team=raw.get("team", ""),
                section=raw.get("section", ""),
                position=str(raw.get("position", "")),
                gp=_int(raw.get("gp")),
                w=_int(raw.get("w")),
                l=_int(raw.get("l")),
                pct=raw.get("pct"),
                pf=raw.get("pf"),
                pa=raw.get("pa"),
                streak=raw.get("streak", ""),
                l10=raw.get("l10", ""),
                home_record=raw.get("home_record", ""),
                away_record=raw.get("away_record", ""),
                league_key=league_key,
            ))
        return out

    def team_history(
        self, league_key: str, team: str, before: str, limit: int = 10
    ) -> List[GameResult]:
        from ingest.teams import normalise
        key = normalise(team)
        hits = [
            self._result(league_key, raw)
            for raw in self._section(league_key, "results")
            if before and str(raw.get("date", ""))[:10] < before
            and (normalise(raw.get("home", "")) == key or normalise(raw.get("away", "")) == key)
        ]
        hits.sort(key=lambda r: r.date, reverse=True)
        return hits[:limit]

    def h2h(
        self, league_key: str, home: str, away: str, before: str, limit: int = 10
    ) -> List[GameResult]:
        from ingest.teams import normalise
        kh, ka = normalise(home), normalise(away)
        pair = {kh, ka}
        hits = [
            self._result(league_key, raw)
            for raw in self._section(league_key, "results")
            if before and str(raw.get("date", ""))[:10] < before
            and {normalise(raw.get("home", "")), normalise(raw.get("away", ""))} == pair
        ]
        hits.sort(key=lambda r: r.date, reverse=True)
        return hits[:limit]


def _slug(text: str) -> str:
    from ingest.leagues import _slug as _league_slug
    return _league_slug(text)


def _int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
