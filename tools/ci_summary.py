#!/usr/bin/env python3
"""
tools/ci_summary.py
───────────────────
Turn an ingest report into a Markdown block for the GitHub Actions run summary.

Deliberately aggregate-only by default. **This repository is public**, so the
run page and every line written to it are world-readable; a full per-league
breakdown of what the fleet ingested is not something to publish on a schedule.
Pass `--verbose` (or run it locally) for the per-league detail.

    python3 tools/ci_summary.py ingest/out/report.json >> "$GITHUB_STEP_SUMMARY"
    python3 tools/ci_summary.py ingest/out/report.json --verbose
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Dict, List

MAX_ERROR_LINES = 10


def _fmt(value: Any, default: str = "—") -> str:
    return default if value is None else str(value)


def render(report: Dict[str, Any], verbose: bool = False, max_errors: int = MAX_ERROR_LINES) -> str:
    totals: Dict[str, Any] = report.get("totals") or {}
    errors: List[str] = [str(e) for e in (report.get("errors") or [])]
    leagues: List[Dict[str, Any]] = report.get("leagues") or []
    unresolved = report.get("unresolved_teams") or []

    lines: List[str] = []
    lines.append("| metric | value |")
    lines.append("|---|---|")
    lines.append(f"| leagues ingested | {_fmt(totals.get('leagues'), '0')} |")
    lines.append(f"| fixtures | {_fmt(totals.get('fixtures'), '0')} |")
    priced, fixtures = totals.get("priced") or 0, totals.get("fixtures") or 0
    share = f" ({(100 * priced / fixtures):.0f}%)" if fixtures else ""
    lines.append(f"| fixtures priced | {priced}{share} |")
    lines.append(f"| results | {_fmt(totals.get('results'), '0')} |")
    lines.append(f"| satellites written | {_fmt(totals.get('satellites'), '0')} |")
    lines.append(f"| bulk vendor calls | {_fmt(report.get('bulk_calls'), '0')} |")
    skipped = totals.get("skipped") or 0
    if skipped:
        lines.append(f"| leagues skipped (empty) | {skipped} |")

    # Unpriced fixtures are the quiet failure mode: the satellite still gets
    # written, but the Assayer has nothing to grade against.
    unpriced = fixtures - priced
    if fixtures and unpriced:
        lines.append("")
        lines.append(f"⚠ **{unpriced} fixture(s) unpriced** — those satellites carry no probability column.")

    if unresolved:
        lines.append("")
        lines.append(f"⚠ {len(unresolved)} unresolved team name(s) — see `unresolved_teams` in the report.")

    if errors:
        lines.append("")
        lines.append(f"### Errors ({len(errors)})")
        lines.append("```")
        lines.extend(errors[:max_errors])
        if len(errors) > max_errors:
            lines.append(f"… and {len(errors) - max_errors} more")
        lines.append("```")

    if verbose and leagues:
        lines.append("")
        lines.append("### Per league")
        lines.append("")
        lines.append("| league | fixtures | priced | results | standings |")
        lines.append("|---|---|---|---|---|")
        for league in sorted(leagues, key=lambda x: str(x.get("league_key"))):
            lines.append(
                "| {key} | {fx} | {priced} | {results} | {standings} |".format(
                    key=league.get("league_key") or league.get("display_name") or "?",
                    fx=league.get("fixtures", 0),
                    priced=league.get("priced", 0),
                    results=league.get("results", 0),
                    standings=league.get("standings_rows", 0),
                )
            )

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Render an ingest report as Markdown.")
    parser.add_argument("report", help="path to the JSON report written by `ingest.cli run --report`")
    parser.add_argument("--verbose", action="store_true",
                        help="include the per-league breakdown (not for public CI logs)")
    parser.add_argument("--max-errors", type=int, default=MAX_ERROR_LINES)
    args = parser.parse_args()

    path = Path(args.report)
    if not path.exists():
        print(f"_no report at {path}_")
        return 0

    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - a summary must never fail the job
        print(f"_report unreadable: {exc}_")
        return 0

    print(render(report, verbose=args.verbose, max_errors=args.max_errors))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
