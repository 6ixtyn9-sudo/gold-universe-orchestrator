#!/usr/bin/env python3
"""
tools/night_was_not_empty.py
────────────────────────────
Did the run actually ingest anything?

The worst failure mode of a scheduled ingestion job is *silence*: the workflow
goes green, no snapshots appear, and nobody notices for a week because a green
check mark looks like success. This asserts that the night produced fixtures,
and says why it thinks otherwise.

    python3 tools/night_was_not_empty.py ingest/out/report.json

Exit 0 = there were fixtures. Exit 1 = the run was empty (report why).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else Path("ingest/out/report.json")
    if not path.exists():
        print(f"no report at {path}")
        return 1

    report = json.loads(path.read_text(encoding="utf-8"))
    totals = report.get("totals") or {}
    fixtures = totals.get("fixtures") or 0
    satellites = totals.get("satellites") or 0
    leagues = totals.get("leagues") or 0
    errors = report.get("errors") or []

    if fixtures:
        print(f"{fixtures} fixture(s) across {leagues} league(s), {satellites} satellite(s) written")
        return 0

    print("no fixtures in this run")
    print(f"  leagues with content : {leagues}")
    print(f"  satellites written   : {satellites}")
    print(f"  bulk date calls made : {report.get('bulk_calls', 0)}")
    for line in errors[:5]:
        print(f"  error: {line}")
    if report.get("bulk_calls", 0) == 0:
        print("hint: no bulk call was made at all — a key/quota/provider problem, not a quiet day")
    elif not errors:
        print("hint: the vendor answered, so this may be a genuine rest day")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
