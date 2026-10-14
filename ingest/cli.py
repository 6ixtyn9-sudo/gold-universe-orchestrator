"""
ingest/cli.py
─────────────
Command line entry point for the API ingestion layer.

    # offline smoke run — no keys, no network
    python -m ingest.cli run --provider fixture \\
        --fixtures examples/provider_fixtures \\
        --leagues nba --date 2026-10-14 --sink local

    # live run against API-Sports
    export API_SPORTS_KEY=...
    python -m ingest.cli run --provider api_sports \\
        --leagues nba euroleague --date 2026-10-14 --sink supabase

    # league registry
    python -m ingest.cli bootstrap-leagues            # mine the fleet registry
    python -m ingest.cli bootstrap-leagues --probe    # + resolve ids via API-Sports

    # environment sanity check
    python -m ingest.cli doctor

    # prove the generated rows still parse with the existing consumers
    python -m ingest.cli verify --bundle ingest/out/<satellite_id>
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from ingest.leagues import (
    LEAGUES_PATH,
    LeagueSpec,
    all_leagues,
    configured_leagues,
    load_leagues,
    save_leagues,
    unconfigured_leagues,
)
from ingest.pipeline import IngestPipeline, IngestRequest
from ingest.providers import make_probability_sources, make_provider
from ingest.sinks import LocalBundleSink, MultiSink, SupabaseSink
from ingest.teams import TeamResolver

log = logging.getLogger("ingest.cli")


# ─────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────

def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


def _split(value) -> List[str]:
    """Accepts 'a,b', 'a b' or ['a', 'b'] — argparse nargs gives us any of them."""
    if not value:
        return []
    items = value if isinstance(value, (list, tuple)) else [value]
    out: List[str] = []
    for item in items:
        out.extend(v.strip() for v in str(item).replace(",", " ").split() if v.strip())
    return out


def _target_leagues(args) -> List[str]:
    requested = _split(args.leagues)
    if requested:
        return requested
    specs = configured_leagues()
    if not specs:
        specs = all_leagues()
    return [s.key for s in specs]


def _build_sinks(args):
    sinks = []
    names = _split(args.sink) or ["local"]
    for name in names:
        if name == "local":
            sinks.append(LocalBundleSink(root=args.out))
        elif name == "supabase":
            sinks.append(SupabaseSink(dry_run=args.dry_run))
        else:
            raise SystemExit(f"unknown sink '{name}' (local, supabase)")
    return MultiSink(sinks) if len(sinks) > 1 else sinks[0]


def _build_provider(args):
    if args.provider == "fixture":
        if not args.fixtures:
            raise SystemExit("--fixtures <dir> is required for the fixture provider")
        return make_provider("fixture", root=args.fixtures)
    if args.provider == "api_sports":
        return make_provider(
            "api_sports",
            api_key=os.environ.get("API_SPORTS_KEY", ""),
            cache_dir=args.cache,
            capture=args.capture,
        )
    raise SystemExit(f"unknown provider '{args.provider}' (fixture, api_sports)")


# ─────────────────────────────────────────────────────────────────────────
# commands
# ─────────────────────────────────────────────────────────────────────────

def cmd_run(args) -> int:
    provider = _build_provider(args)
    resolver = TeamResolver()
    sources = make_probability_sources(_split(args.probability) or ["odds", "model"], provider, resolver)
    sinks = _build_sinks(args)

    pipeline = IngestPipeline(provider, sources, [sinks] if not isinstance(sinks, MultiSink) else sinks.sinks, resolver)

    model_config = {}
    if args.config:
        model_config = json.loads(Path(args.config).read_text(encoding="utf-8"))

    request = IngestRequest(
        leagues=_target_leagues(args),
        model_config=model_config,
        date_from=args.date,
        date_to=args.date_to or args.date,
        results_lookback_days=args.results_lookback,
        enrich=not args.no_enrich,
        standings=not args.no_standings,
        quarter_profiles=not args.no_quarters,
        game_logs=not args.no_game_logs,
        max_games_per_satellite=args.max_games,
    )

    report = pipeline.run(request)
    print(report.summary())

    if args.report:
        Path(args.report).write_text(json.dumps(report.as_dict(), indent=2), encoding="utf-8")
        print(f"\nreport → {args.report}")

    return 1 if report.errors else 0


def cmd_bootstrap_leagues(args) -> int:
    specs = load_leagues(force=True)
    if args.probe:
        _probe_api_sports(specs, args)
    save_leagues(specs.values(), Path(args.out) if args.out else LEAGUES_PATH)
    configured = sum(1 for s in specs.values() if s.api_league_id)
    print(
        f"wrote {len(specs)} leagues → {args.out or LEAGUES_PATH}\n"
        f"  {configured} with an api_league_id, {len(specs) - configured} still unresolved"
    )
    if configured < len(specs):
        print("  fill the rest with:  python -m ingest.cli bootstrap-leagues --probe")
    return 0


def _probe_api_sports(specs: Dict[str, LeagueSpec], args) -> None:
    """
    Ask API-Sports which league id matches each fleet league name.

    We only accept a suggestion when the vendor returns exactly one plausible
    league — a wrong id silently pulls another competition's games, which is
    worse than an unresolved league.
    """
    key = os.environ.get("API_SPORTS_KEY", "")
    if not key:
        print("API_SPORTS_KEY not set — skipping --probe")
        return

    from ingest.providers.api_sports import ApiSportsProvider
    provider = ApiSportsProvider(api_key=key, cache_dir=args.cache)

    for spec in sorted(specs.values(), key=lambda s: s.key):
        if spec.api_league_id:
            continue
        query = spec.display_name.split("(")[0].strip()
        if not query:
            continue
        try:
            payload = provider._get("leagues", {"search": query})
        except Exception as exc:  # noqa: BLE001
            print(f"  {spec.key}: probe failed ({exc})")
            continue
        candidates = [
            (entry.get("id"), entry.get("name"), (entry.get("country") or {}).get("name", ""))
            for entry in payload.get("response") or []
        ]
        if len(candidates) == 1:
            league_id, name, country = candidates[0]
            spec.api_league_id = league_id
            spec.country = country or spec.country
            spec.aliases.append(str(name))
            print(f"  {spec.key} → {league_id} ({name}, {country})")
        elif candidates:
            print(f"  {spec.key}: {len(candidates)} candidates — review manually: {candidates[:5]}")
        else:
            print(f"  {spec.key}: no match for '{query}'")


def cmd_export_config(args) -> int:
    from ingest import configs as ingest_configs
    target = ingest_configs.export_from_bundle(args.bundle, args.league)
    print(f"config → {target}")
    return 0


def cmd_doctor(args) -> int:
    print("Gold Universe — ingest doctor\n" + "─" * 40)

    checks: List[tuple[str, bool, str]] = []

    checks.append(("API_SPORTS_KEY", bool(os.environ.get("API_SPORTS_KEY")),
                   "fixtures/results/standings source (required for api_sports)"))
    checks.append(("ODDS_API_KEY", bool(os.environ.get("ODDS_API_KEY")),
                   "market probabilities (optional — model source covers it)"))
    checks.append(("SUPABASE_URL", bool(os.environ.get("SUPABASE_URL")),
                   "snapshot sink (optional — local sink works without it)"))
    checks.append(("SUPABASE_SERVICE_KEY", bool(os.environ.get("SUPABASE_SERVICE_KEY")),
                   "snapshot sink auth"))

    specs = load_leagues(force=True)
    checks.append(("ingest/leagues.json", LEAGUES_PATH.exists(),
                   f"{len(specs)} leagues known, {sum(1 for s in specs.values() if s.api_league_id)} with api id"))
    checks.append(("registry/registry.json", (Path(__file__).parent.parent / 'registry' / 'registry.json').exists(),
                   "fleet registry available for league mining"))

    for name, ok, note in checks:
        mark = "✓" if ok else "·"
        print(f" {mark} {name:<24} {note}")

    missing = unconfigured_leagues()
    if missing:
        print(f"\n{len(missing)} leagues have no api_league_id, e.g. "
              f"{', '.join(s.key for s in missing[:8])}")
        print("resolve: python -m ingest.cli bootstrap-leagues --probe")
    return 0


def cmd_verify(args) -> int:
    """
    Parse a generated bundle with the EXISTING consumers and report what they saw.

    This is the guard-rail for the whole migration: if these parsers can read
    the API-generated rows, then the Brain, Assayer and Mothership are already
    compatible with the new data source.
    """
    bundle_dir = Path(args.bundle)
    if not bundle_dir.is_dir():
        raise SystemExit(f"not a directory: {bundle_dir}")

    from brain.data_parser import parse_upcoming_clean, parse_results_clean, parse_standings
    from fetcher.parsers.upcoming_clean import parse_upcoming_clean as fe_upcoming
    from fetcher.parsers.results_clean import parse_results_clean as fe_results
    from fetcher.parsers.game_logs import parse_game_log_table

    ok = True
    for path in sorted(bundle_dir.glob("core__*.json")):
        values = json.loads(path.read_text(encoding="utf-8")).get("values") or []
        tab = path.stem.replace("core__", "")
        if tab == "UpcomingClean":
            a, b = parse_upcoming_clean(values), fe_upcoming(values)
            print(f"UpcomingClean      brain={len(a):3d} games   fetcher={len(b):3d} games")
            ok &= len(a) > 0
        elif tab == "ResultsClean":
            a, b = parse_results_clean(values), fe_results(values)
            print(f"ResultsClean       brain={len(a):3d} results fetcher={len(b):3d} results")
        elif tab == "Standings":
            rows = parse_standings(values)
            print(f"Standings          brain={len(rows):3d} teams")
        elif tab.startswith(("CleanH2H", "CleanRecent")):
            rows = parse_game_log_table(values)
            print(f"{tab:<18} {len(rows):3d} games")
        else:
            print(f"{tab:<18} {max(len(values) - 1, 0):3d} rows (not parsed)")

    print("\n" + ("✅ CONTRACT OK — existing consumers parse the API output"
                  if ok else "❌ CONTRACT BROKEN — UpcomingClean did not parse"))
    return 0 if ok else 1


# ─────────────────────────────────────────────────────────────────────────
# parser
# ─────────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m ingest.cli", description="Gold Universe API ingestion")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="ingest fixtures/results/standings into satellite bundles")
    run.add_argument("--provider", default="fixture", choices=["fixture", "api_sports"])
    run.add_argument("--fixtures", help="fixture provider root directory")
    run.add_argument("--probability", nargs="+", default=["odds", "model"],
                     help="probability sources in priority order (default: odds model)")
    run.add_argument("--leagues", nargs="+",
                     help="league keys or display names (default: all configured)")
    run.add_argument("--date", required=True, help="ISO start date, e.g. 2026-10-14")
    run.add_argument("--date-to", help="ISO end date for a multi-day window")
    run.add_argument("--results-lookback", type=int, default=30,
                     help="days of results to pull before the window (accuracy ledger)")
    run.add_argument("--sink", nargs="+", default=["local"],
                     help="local, supabase (several to fan out)")
    run.add_argument("--out", default="ingest/out", help="local sink root")
    run.add_argument("--cache", default="ingest/.cache", help="HTTP cache directory")
    run.add_argument("--capture", action="store_true", help="dump raw provider JSON for mapping review")
    run.add_argument("--dry-run", action="store_true", help="supabase sink: log instead of write")
    run.add_argument("--no-enrich", action="store_true", help="skip t1-*/t2-*/ou-* computation")
    run.add_argument("--no-standings", action="store_true")
    run.add_argument("--no-quarters", action="store_true")
    run.add_argument("--no-game-logs", action="store_true")
    run.add_argument("--max-games", type=int, default=40)
    run.add_argument("--report", help="write a JSON report to this path")
    run.add_argument("--config", help="JSON file of model weights overriding the league config")
    run.set_defaults(func=cmd_run)

    boot = sub.add_parser("bootstrap-leagues", help="build ingest/leagues.json from the fleet registry")
    boot.add_argument("--probe", action="store_true", help="resolve api_league_id via API-Sports")
    boot.add_argument("--out", help=f"output path (default {LEAGUES_PATH})")
    boot.add_argument("--cache", default="ingest/.cache")
    boot.set_defaults(func=cmd_bootstrap_leagues)

    doc = sub.add_parser("doctor", help="check environment and configuration")
    doc.set_defaults(func=cmd_doctor)

    exp = sub.add_parser("export-config",
                         help="export Config_Tier1/Tier2 from a bundle into ingest/configs/<league>.json")
    exp.add_argument("--bundle", required=True)
    exp.add_argument("--league", required=True)
    exp.set_defaults(func=cmd_export_config)

    ver = sub.add_parser("verify", help="parse a generated bundle with the existing consumers")
    ver.add_argument("--bundle", required=True, help="ingest/out/<satellite_id>")
    ver.set_defaults(func=cmd_verify)

    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    _setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
