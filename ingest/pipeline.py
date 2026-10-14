"""
ingest/pipeline.py
──────────────────
The orchestration that replaces "someone copy-pastes Forebet into a sheet".

    provider ──► probability sources ──► contracts ──► sinks
   (fixtures,      (odds then model)      (exact        (local bundle,
    results,                               tab           Supabase
    standings)                             shapes)       snapshots)

One virtual satellite is emitted per (league, date), which is exactly the
granularity the fleet uses today — so Assayer purity, the accuracy ledger and
the Mothership keep their existing meaning.

Run it:
    python -m ingest.cli run --leagues nba --date 2026-10-14 --provider fixture \\
        --fixtures examples/provider_fixtures --sink local
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence

from ingest import configs, contracts
from ingest.leagues import (
    LeagueSpec,
    apply_vendor_match,
    match_vendor_league,
    resolve,
    satellite_id_for,
    satellite_name_for,
)
from ingest.models import Fixture, GameResult, IngestBundle, QuarterProfile
from ingest.predict import Enricher
from ingest.providers.base import DataProvider, ProbabilitySource
from ingest.providers.model import build_quarter_profiles
from ingest.sinks import utc_now_iso
from ingest.teams import TeamResolver

log = logging.getLogger("ingest.pipeline")

DEFAULT_HISTORY_LIMIT = 10


@dataclass
class IngestRequest:
    leagues: List[str]
    date_from: str
    date_to: str = ""
    history_limit: int = DEFAULT_HISTORY_LIMIT
    results_lookback_days: int = 30
    standings: bool = True
    quarter_profiles: bool = True
    game_logs: bool = True
    max_games_per_satellite: int = 40
    enrich: bool = True          # compute t1-*/t2-*/ou-* columns via brain/ ports
    model_config: Dict[str, Any] = field(default_factory=dict)
    bulk: bool = True            # one vendor request per day for ALL leagues
    auto_learn_leagues: bool = True  # persist vendor league ids we matched
    only_with_games: bool = False    # skip satellites for leagues with nothing in window

    def window(self) -> List[str]:
        start = date.fromisoformat(self.date_from[:10])
        end = date.fromisoformat((self.date_to or self.date_from)[:10])
        if end < start:
            start, end = end, start
        return [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]


@dataclass
class LeagueReport:
    league_key: str
    display_name: str
    configured: bool = False
    fixtures: int = 0
    priced: int = 0
    results: int = 0
    standings_rows: int = 0
    satellites: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict[str, Any]:
        return {
            "league_key": self.league_key,
            "display_name": self.display_name,
            "configured": self.configured,
            "fixtures": self.fixtures,
            "priced": self.priced,
            "priced_pct": round(100.0 * self.priced / self.fixtures, 1) if self.fixtures else 0.0,
            "results": self.results,
            "standings_rows": self.standings_rows,
            "satellites": self.satellites,
            "warnings": self.warnings,
        }


@dataclass
class IngestReport:
    started_at: str
    finished_at: str = ""
    provider: str = ""
    probability_sources: List[str] = field(default_factory=list)
    leagues: List[LeagueReport] = field(default_factory=list)
    sink_results: List[Dict[str, Any]] = field(default_factory=list)
    bulk_calls: int = 0
    unresolved_teams: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    # leagues the run deliberately passed over (--only-with-games); kept apart
    # from errors because a quiet league is not a failure
    skipped_leagues: List[str] = field(default_factory=list)

    @property
    def totals(self) -> Dict[str, int]:
        return {
            "leagues": len(self.leagues),
            "fixtures": sum(l.fixtures for l in self.leagues),
            "priced": sum(l.priced for l in self.leagues),
            "results": sum(l.results for l in self.leagues),
            "satellites": sum(len(l.satellites) for l in self.leagues),
            "skipped": len(self.skipped_leagues),
        }

    def as_dict(self) -> Dict[str, Any]:
        return {
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "provider": self.provider,
            "probability_sources": self.probability_sources,
            "totals": self.totals,
            "leagues": [l.as_dict() for l in self.leagues],
            "sinks": self.sink_results,
            "bulk_calls": self.bulk_calls,
            "unresolved_teams": self.unresolved_teams,
            "skipped_leagues": self.skipped_leagues,
            "errors": self.errors,
        }

    def summary(self) -> str:
        t = self.totals
        lines = [
            f"Ingest {self.started_at} → {self.finished_at}",
            f"provider={self.provider}  probability={'+'.join(self.probability_sources) or 'none'}",
            f"{t['leagues']} leagues · {t['fixtures']} fixtures ({t['priced']} priced) · "
            f"{t['results']} results · {t['satellites']} virtual satellites",
            f"vendor requests: {self.bulk_calls} bulk date call(s)",
        ]
        if self.skipped_leagues:
            lines.append(
                f"{len(self.skipped_leagues)} league(s) skipped (no content in window)"
            )
        for lg in self.leagues:
            if lg.fixtures or lg.results:
                flag = ""
            elif not lg.configured:
                flag = "  (no api_league_id — bulk mode resolves this from the vendor's own names)"
            else:
                flag = "  (no games in window)"
            lines.append(f"  • {lg.display_name}: {lg.fixtures} fixtures, {lg.priced} priced{flag}")
            for w in lg.warnings:
                lines.append(f"      ! {w}")
        if self.unresolved_teams:
            lines.append(f"  unresolved team names: {', '.join(self.unresolved_teams[:12])}")
        for e in self.errors:
            lines.append(f"  ERROR {e}")
        return "\n".join(lines)


class IngestPipeline:
    def __init__(
        self,
        provider: DataProvider,
        probability_sources: Optional[Sequence[ProbabilitySource]] = None,
        sinks: Optional[Sequence[Any]] = None,
        resolver: Optional[TeamResolver] = None,
    ):
        self.provider = provider
        self.probability_sources = list(probability_sources or [])
        self.sinks = list(sinks or [])
        self.resolver = resolver or TeamResolver()
        self._enricher: Optional[Enricher] = None

    # ── main entry ──────────────────────────────────────────────────────

    def run(self, request: IngestRequest) -> IngestReport:
        report = IngestReport(
            started_at=utc_now_iso(),
            provider=getattr(self.provider, "name", "?"),
            probability_sources=[getattr(s, "name", "?") for s in self.probability_sources],
        )

        bulk_data: Dict[str, Dict[str, List[Any]]] = {}
        if request.bulk and getattr(self.provider, "supports_bulk", False):
            bulk_data = self._prefetch_bulk(request, report)

        for league_ref in request.leagues:
            spec = resolve(league_ref)
            if spec is None:
                report.errors.append(f"unknown league '{league_ref}'")
                continue
            try:
                self._run_league(spec, request, report, bulk_data.get(spec.key))
            except Exception as exc:  # noqa: BLE001 - one bad league must not kill the run
                log.exception("league %s failed", spec.key)
                report.errors.append(f"{spec.key}: {exc}")

        report.unresolved_teams = self.resolver.drain_unresolved()
        report.finished_at = utc_now_iso()
        return report

    # ── bulk prefetch ───────────────────────────────────────────────────

    def _prefetch_bulk(self, request: IngestRequest, report: IngestReport) -> Dict[str, Dict[str, List[Any]]]:
        """
        One request per day for the whole fleet, then attribute each vendor
        league to a fleet league.

        Quota reality check: 166 leagues × 1 request = 166 requests/day, which
        will not fit a 100/day free tier. One `date=` call per day does fit, by
        an order of magnitude — so bulk mode is not an optimisation, it is the
        precondition for running all 166 leagues on free keys.
        """
        wanted = {resolve(ref).key for ref in request.leagues if resolve(ref)}
        out: Dict[str, Dict[str, List[Any]]] = {key: {"fixtures": [], "results": []} for key in wanted}
        unmapped: Dict[str, int] = {}

        calls = 0
        for day in request.window():
            try:
                groups = self.provider.bulk_day(day)
            except Exception as exc:  # noqa: BLE001
                report.errors.append(f"bulk fetch {day} failed: {exc}")
                continue
            calls += 1
            for group in groups:
                spec, confidence = match_vendor_league(
                    group.get("vendor_league_name", ""),
                    group.get("vendor_country", ""),
                    group.get("vendor_league_id"),
                )
                if spec is None or spec.key not in wanted:
                    if group.get("fixtures") or group.get("results"):
                        unmapped[group.get("vendor_league_name", "?")] = (
                            unmapped.get(group.get("vendor_league_name", "?"), 0)
                            + len(group.get("fixtures", [])) + len(group.get("results", []))
                        )
                    continue

                if request.auto_learn_leagues and spec.api_league_id is None:
                    try:
                        apply_vendor_match(spec, group["vendor_league_id"], group.get("vendor_league_name", ""))
                    except Exception as exc:  # noqa: BLE001
                        log.debug("could not persist vendor league id for %s: %s", spec.key, exc)

                bucket = out[spec.key]
                for fixture in group.get("fixtures", []):
                    bucket["fixtures"].append(_reletter(fixture, spec))
                for result in group.get("results", []):
                    bucket["results"].append(_reletter(result, spec))

            # historical results for the policy lookback, one call per day
            if request.results_lookback_days > 0:
                lookback_day = _shift(day, -request.results_lookback_days)
                try:
                    for group in self.provider.bulk_day(lookback_day):
                        spec, _conf = match_vendor_league(
                            group.get("vendor_league_name", ""),
                            group.get("vendor_country", ""),
                            group.get("vendor_league_id"),
                        )
                        if spec is None or spec.key not in wanted:
                            continue
                        out[spec.key]["results"].extend(
                            _reletter(r, spec) for r in group.get("results", [])
                        )
                except Exception as exc:  # noqa: BLE001
                    log.debug("lookback bulk fetch %s skipped: %s", lookback_day, exc)

        if unmapped:
            top = sorted(unmapped.items(), key=lambda kv: -kv[1])[:8]
            report.errors.append(
                "bulk mode saw competitions with no fleet league: "
                + ", ".join(f"{name} ({n})" for name, n in top)
                + " — add them via bootstrap-leagues"
            )
        report.bulk_calls = calls
        return out

    # ── per league ──────────────────────────────────────────────────────

    def _run_league(
        self,
        spec: LeagueSpec,
        request: IngestRequest,
        report: IngestReport,
        bulk: Optional[Dict[str, List[Any]]] = None,
    ) -> None:
        lg = LeagueReport(league_key=spec.key, display_name=spec.display_name, configured=spec.configured)
        report.leagues.append(lg)

        # Bulk mode resolves leagues at runtime from the vendor's own names, so
        # a missing api_league_id is not fatal there — only in per-league mode.
        if not spec.configured and getattr(self.provider, "name", "") != "fixture" and bulk is None:
            lg.warnings.append(
                "no api_league_id configured — run: python -m ingest.cli bootstrap-leagues --probe"
            )
            return

        window = request.window()
        date_from, date_to = window[0], window[-1]

        if bulk is not None:
            fixtures = list(bulk["fixtures"])
        else:
            fixtures = self.provider.fixtures(spec.key, date_from, date_to)
        fixtures = [f for f in fixtures if f.home and f.away]
        self._learn_teams(fixtures)

        for source in self.probability_sources:
            try:
                fixtures = source.annotate(fixtures)
            except Exception as exc:  # noqa: BLE001
                lg.warnings.append(f"probability source '{getattr(source, 'name', '?')}' failed: {exc}")

        lg.fixtures = len(fixtures)
        lg.priced = sum(1 for f in fixtures if f.home_prob is not None)
        if fixtures and lg.priced < lg.fixtures:
            lg.warnings.append(
                f"{lg.fixtures - lg.priced} fixture(s) unpriced — they will ingest without a 'Prob %'"
            )

        # results for the league over the satellite window (plus a lookback so
        # ResultsClean carries enough history for the accuracy ledger)
        results: List[GameResult] = []
        if bulk is not None:
            results = list(bulk["results"])
        else:
            try:
                results = self.provider.results(
                    spec.key,
                    _shift(date_from, -request.results_lookback_days),
                    date_to,
                )
            except Exception as exc:  # noqa: BLE001
                lg.warnings.append(f"results unavailable: {exc}")
        lg.results = len(results)
        self._learn_results(results)

        standings: List[Any] = []
        if request.standings:
            try:
                standings = self.provider.standings(spec.key, spec.season)
            except Exception as exc:  # noqa: BLE001
                lg.warnings.append(f"standings unavailable: {exc}")
            lg.standings_rows = len(standings)
            self._learn_standings(standings)

        # A satellite per league per day is what the 512-sheet fleet looked
        # like, and downstream reads a present-but-empty tab as "no games".
        # That parity costs ~113 mostly-empty snapshots a night, so it can be
        # switched off; the fleet then only hears about leagues with content.
        if request.only_with_games and not fixtures and not results and not standings:
            lg.warnings.append("skipped: no fixtures, results or standings in window")
            report.leagues[:] = [l for l in report.leagues if l is not lg]
            report.skipped_leagues.append(spec.key)
            return

        quarter_profiles = self._quarter_profiles(spec, results, request, lg)

        # Bind the enrichment engine for this league. It reuses the existing
        # brain/ ports — no new prediction logic, only a new input source.
        if request.enrich:
            # League config wins over repo defaults; an explicit --config wins
            # over both.  This is how a league keeps its tuned weights after
            # the sheets are gone.
            league_cfg = configs.flatten(spec.key)
            self._enricher = Enricher(
                config={**league_cfg, **request.model_config},
                resolver=self.resolver,
                league_key=spec.key,
                history_limit=request.history_limit,
            ).prepare(results, standings, quarter_profiles)
        else:
            self._enricher = None

        by_date: Dict[str, List[Fixture]] = {}
        for f in fixtures:
            by_date.setdefault(f.date, []).append(f)

        if not by_date:
            lg.warnings.append("no fixtures in window")

        for day in window:
            day_fixtures = by_date.get(day, [])
            bundle = self._build_bundle(
                spec, day, day_fixtures, results, standings, quarter_profiles, request, lg
            )
            lg.satellites.append(bundle.satellite_id)
            for sink in self.sinks:
                report.sink_results.append(sink.write(bundle))

    # ── bundle assembly ─────────────────────────────────────────────────

    def _build_bundle(
        self,
        spec: LeagueSpec,
        day: str,
        fixtures: List[Fixture],
        results: List[GameResult],
        standings: List[Any],
        quarter_profiles: List[QuarterProfile],
        request: IngestRequest,
        lg: LeagueReport,
    ) -> IngestBundle:
        ingested_at = utc_now_iso()
        satellite_id = satellite_id_for(spec.key, day)
        bundle = IngestBundle(
            satellite_id=satellite_id,
            satellite_name=satellite_name_for(spec, day),
            league_key=spec.key,
            meta={
                "provider": getattr(self.provider, "name", "?"),
                "probability_sources": [getattr(s, "name", "?") for s in self.probability_sources],
                "fixtures": len(fixtures),
                "priced": sum(1 for f in fixtures if f.home_prob is not None),
                "ingested_at": ingested_at,
            },
        )

        rows = []
        for f in fixtures[: request.max_games_per_satellite]:
            enriched = self._enrich(f, day)
            enriched["ingested_at"] = ingested_at
            rows.append(contracts.upcoming_row(f, enriched))
        bundle.tabs[contracts.TAB_UPCOMING] = contracts.upcoming_table(rows)

        day_results = [r for r in results if r.date == day]
        bundle.tabs[contracts.TAB_RESULTS] = contracts.results_table(
            [contracts.results_row(r, ingested_at) for r in day_results]
        )

        if request.standings and standings:
            bundle.tabs[contracts.TAB_STANDINGS] = contracts.standings_table(standings)

        if request.quarter_profiles and quarter_profiles:
            bundle.tabs[contracts.TAB_LEAGUE_QUARTER] = contracts.quarter_table(quarter_profiles)
            bundle.tabs[contracts.TAB_TEAM_QUARTER] = contracts.quarter_table(
                [p for p in quarter_profiles if p.team and p.team != "__LEAGUE__"]
            )

        if request.game_logs:
            self._add_game_logs(bundle, spec, day, fixtures)

        # Self-describing bundles: carry the config the predictions were made
        # with, so a later diff against the fleet is possible.
        cfg_path = configs.config_path(spec.key)
        if cfg_path.exists():
            try:
                doc = json.loads(cfg_path.read_text(encoding="utf-8"))
                for tab in ("Config_Tier1", "Config_Tier2"):
                    if doc.get(tab):
                        bundle.tabs[tab] = list(doc[tab])
            except Exception as exc:  # noqa: BLE001
                log.warning("config for %s not emitted: %s", spec.key, exc)

        return bundle

    def _add_game_logs(
        self, bundle: IngestBundle, spec: LeagueSpec, day: str, fixtures: List[Fixture]
    ) -> None:
        """
        CleanH2H_<i> / CleanRecentHome_<i> / CleanRecentAway_<i> per upcoming game.

        Index i matches the 1-based row order in UpcomingClean, mirroring the
        fleet's per-game tab convention.
        """
        for i, fixture in enumerate(fixtures, start=1):
            try:
                h2h = self.provider.h2h(spec.key, fixture.home, fixture.away, day, 10)
                recent_home = self.provider.team_history(spec.key, fixture.home, day, 10)
                recent_away = self.provider.team_history(spec.key, fixture.away, day, 10)
            except Exception as exc:  # noqa: BLE001
                log.debug("history unavailable for %s vs %s: %s", fixture.home, fixture.away, exc)
                continue
            if h2h:
                bundle.tabs[contracts.TAB_H2H_TMPL.format(n=i)] = contracts.game_log_table(h2h)
            if recent_home:
                bundle.tabs[contracts.TAB_RECENT_HOME_TMPL.format(n=i)] = contracts.game_log_table(recent_home)
            if recent_away:
                bundle.tabs[contracts.TAB_RECENT_AWAY_TMPL.format(n=i)] = contracts.game_log_table(recent_away)

    # ── enrichment hook ─────────────────────────────────────────────────

    def _enrich(self, fixture: Fixture, day: str) -> Dict[str, Any]:
        """
        Compute the locally-derived columns (t1-*, t2-*, ou-*, enh-*).

        These used to be produced by each satellite's Apps Script.  The Python
        ports already exist in brain/ (forecaster, signal_processor) and the
        Enricher binds them to API-sourced inputs.  When enrichment is switched
        off the columns are emitted blank, exactly like a raw pasted satellite
        row, and every downstream parser keeps working unchanged.
        """
        if self._enricher is None:
            return {}
        return self._enricher.enrich(fixture)

    # ── shared lookups ──────────────────────────────────────────────────

    def _quarter_profiles(
        self,
        spec: LeagueSpec,
        results: List[GameResult],
        request: IngestRequest,
        lg: LeagueReport,
    ) -> List[QuarterProfile]:
        if not request.quarter_profiles or not results:
            return []
        profiles = build_quarter_profiles(results, self.resolver, spec.key)
        if len(profiles) <= 1:
            lg.warnings.append("quarter profiles thin — quarter O/U pricing will be skipped")
        return profiles

    def _learn_teams(self, fixtures: Iterable[Fixture]) -> None:
        for f in fixtures:
            self.resolver.learn(f.home)
            self.resolver.learn(f.away)

    def _learn_results(self, results: Iterable[GameResult]) -> None:
        for r in results:
            self.resolver.learn(r.home)
            self.resolver.learn(r.away)

    def _learn_standings(self, standings: Iterable[Any]) -> None:
        for row in standings:
            team = getattr(row, "team", "")
            if team:
                self.resolver.learn(team)


def _reletter(obj: Any, spec: LeagueSpec) -> Any:
    """Re-key a bulk-fetched game from its vendor league to the fleet league."""
    obj.league_key = spec.key
    obj.league_display = spec.display_name
    return obj


def _shift(iso: str, days: int) -> str:
    return (date.fromisoformat(iso[:10]) + timedelta(days=days)).isoformat()
