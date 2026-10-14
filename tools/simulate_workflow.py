#!/usr/bin/env python3
"""
tools/simulate_workflow.py
──────────────────────────
Run the GitHub Actions workflow's *shell* locally, step by step.

GitHub validates the YAML for you; it cannot tell you that a step's bash is
wrong, that a variable never gets set, or that the verify loop trips over its
own globbing. Those failures only show up when you finally dispense with the
fixture provider and burn a real key on a live night.

This harness extracts each `run:` block from .github/workflows/ingest.yml and
executes it in order, with the same environment the runner would provide. Use
`--provider fixture` (the default) to exercise the whole thing offline.

    python3 tools/simulate_workflow.py                     # offline, fixture provider
    python3 tools/simulate_workflow.py --sink local,supabase --dry-run
    python3 tools/simulate_workflow.py --stop-after verify

Requires PyYAML (`pip install pyyaml`) — it is a dev-only tool, not part of the
ingest path, which stays stdlib-only so Actions needs no install step.
"""

from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
WORKFLOW = REPO / ".github" / "workflows" / "ingest.yml"


def load_steps() -> list[tuple[str, str]]:
    try:
        import yaml
    except ImportError:  # pragma: no cover
        sys.exit("PyYAML is required for the simulator: pip install pyyaml")

    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    job = doc["jobs"]["ingest"]
    steps: list[tuple[str, str]] = []
    for step in job["steps"]:
        name = step.get("name") or step.get("uses", "?")
        if "run" in step:
            steps.append((name, step["run"]))
    return steps


def main() -> int:
    parser = argparse.ArgumentParser(description="Simulate the ingest workflow's shell locally.")
    parser.add_argument("--provider", default="fixture")
    parser.add_argument("--leagues", default="nba")
    parser.add_argument("--date", default="2026-10-14")
    parser.add_argument("--sink", default="local")
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--capture", action="store_true", default=False)
    parser.add_argument("--stop-after", default="", help="stop once a step whose name contains this text has run")
    parser.add_argument("--keep", action="store_true", help="keep the temporary run directory")
    args = parser.parse_args()

    steps = load_steps()
    workdir = Path(tempfile.mkdtemp(prefix="wf-sim-"))
    if args.keep:
        print(f"run dir: {workdir}")
    env_file = workdir / "github_env"
    env_file.write_text("", encoding="utf-8")
    summary = workdir / "summary.md"

    env = dict(os.environ)
    env.update(
        {
            "GITHUB_ENV": str(env_file),
            "GITHUB_STEP_SUMMARY": str(summary),
            "GITHUB_RUN_ID": "0",
            "IN_DATE": args.date,
            "IN_LEAGUES": args.leagues,
            "IN_PROVIDER": args.provider,
            "IN_SINK": args.sink,
            "IN_DRY": "true" if args.dry_run else "false",
            "IN_CAPTURE": "true" if args.capture else "false",
            "VAR_SINK": "",
            "VAR_LIVE": "",
            # dummy values so the "is it configured?" guards pass without
            # touching a network or a real project
            "API_SPORTS_KEY": os.environ.get("API_SPORTS_KEY", "simulated-key-not-used"),
            "ODDS_API_KEY": "",
            "HIGHLIGHTLY_KEY": "",
            "SUPABASE_URL": "https://simulated.supabase.co",
            "SUPABASE_SERVICE_KEY": "simulated-service-key",
        }
    )

    failures = 0
    for name, script in steps:
        print(f"\n\033[1m── {name}\033[0m")
        # each step starts from the accumulated GITHUB_ENV, exactly like a runner
        step_env = dict(env)
        for line in env_file.read_text(encoding="utf-8").splitlines():
            if "=" in line:
                key, _, value = line.partition("=")
                step_env[key] = value

        result = subprocess.run(
            ["bash", "-c", script],
            cwd=REPO,
            env=step_env,
            text=True,
            capture_output=True,
        )
        output = (result.stdout + result.stderr).rstrip()
        # a step that prints the whole report is fine; trim for readability
        print(output if len(output) < 4000 else output[:4000] + "\n… (trimmed)")
        if result.returncode != 0:
            failures += 1
            print(f"\033[31mstep failed with exit {result.returncode}\033[0m")
        if args.stop_after and args.stop_after.lower() in name.lower():
            print(f"(stopping after '{name}' as requested)")
            break

    if summary.exists() and summary.read_text(encoding="utf-8").strip():
        print(f"\n\033[1m── run summary ($GITHUB_STEP_SUMMARY)\033[0m")
        print(summary.read_text(encoding="utf-8").rstrip())

    print()
    print(f"{len(steps)} step(s) simulated, {failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
