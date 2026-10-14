"""
Guards for the GitHub Actions ingest workflow.

The workflow is the thing that actually runs the fleet now, and it fails in
ways a unit test of `ingest/` cannot catch: a flag the CLI does not have, a
secret name nobody exports, a scheduled run whose sink goes nowhere.

These checks are deliberately dependency-free (no PyYAML): they assert on the
text of `.github/workflows/ingest.yml` and on the CLI's own argument parser, so
they keep working in a bare python3 environment — which is exactly how the
workflow itself runs.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "ingest.yml"

# Every environment variable the ingest code reads, from ingest/cli.py doctor.
KNOWN_SECRETS = {
    "API_SPORTS_KEY",
    "ODDS_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "HIGHLIGHTLY_KEY",
}


def _workflow_text() -> str:
    if not WORKFLOW.exists():  # pragma: no cover - workflow is committed
        raise unittest.SkipTest(f"no workflow at {WORKFLOW}")
    return WORKFLOW.read_text(encoding="utf-8")


class TestIngestWorkflow(unittest.TestCase):
    def setUp(self) -> None:
        self.text = _workflow_text()

    def test_every_cli_flag_in_the_workflow_exists(self):
        import argparse

        from ingest.cli import build_parser

        def collect(parser: argparse.ArgumentParser, found: set) -> set:
            for action in parser._actions:  # noqa: SLF001 - introspecting argparse on purpose
                found.update(action.option_strings)
                if isinstance(action, argparse._SubParsersAction):  # noqa: SLF001
                    for sub in action.choices.values():
                        collect(sub, found)
            return found

        known = collect(build_parser(), set())
        used = set(re.findall(r"--[a-z][a-z0-9-]*", self.text))
        # `--dry-run`/`--capture` are assembled into shell variables at runtime.
        unknown = {flag for flag in used if flag not in known}
        self.assertEqual(unknown, set(), f"workflow passes flags the CLI does not accept: {sorted(unknown)}")

    def test_secret_names_match_what_the_code_reads(self):
        referenced = set(re.findall(r"secrets\.([A-Z_]+)", self.text))
        self.assertTrue(referenced, "workflow references no secrets at all")
        unknown = referenced - KNOWN_SECRETS
        self.assertEqual(unknown, set(), f"workflow references secrets the code never reads: {sorted(unknown)}")

    def test_supabase_write_cannot_happen_by_accident(self):
        """The standing rule: no production write without an explicit act."""
        # default sink is local in both the dispatch form and the scheduled fallback
        self.assertIn('default: "local"', self.text)
        self.assertIn('sink="${IN_SINK:-${VAR_SINK:-local}}"', self.text)
        # the dry-run flag is only dropped behind two explicit yeses
        self.assertIn('if [ "${IN_DRY:-true}" = "false" ] || [ "${VAR_LIVE:-}" = "true" ]', self.text)

    def test_run_fails_loudly_on_an_empty_night(self):
        """A scheduled run that ingests nothing must not look like a success."""
        self.assertIn("produced no bundles", self.text)

    def test_contract_verification_runs_over_every_bundle(self):
        self.assertIn("ingest.cli verify --bundle", self.text)
        self.assertIn("exit $FAILED", self.text)

    def test_quota_ledger_is_restored_and_saved(self):
        self.assertIn("actions/cache/restore@v4", self.text)
        self.assertIn("actions/cache/save@v4", self.text)
        self.assertIn("ingest/.cache/quota.json", self.text)

    def test_public_repo_artifacts_are_opt_in(self):
        """This repo is public; bundles must never upload by default."""
        self.assertIn("inputs.upload_artifacts == true", self.text)
        self.assertRegex(self.text, r"upload_artifacts:\n(?:.*\n)*?.*default: false")

    def test_per_league_breakdown_is_not_in_the_default_summary(self):
        # ci_summary.py prints aggregates only unless --verbose is passed
        summary = (Path(__file__).resolve().parents[1] / "tools" / "ci_summary.py").read_text(encoding="utf-8")
        self.assertNotIn("--verbose", self.text)
        self.assertIn("verbose: bool = False", summary)

    def test_runs_are_serialized(self):
        """Overlapping runs would spend one daily quota twice."""
        self.assertIn("concurrency:", self.text)
        self.assertIn("cancel-in-progress: false", self.text)


if __name__ == "__main__":
    unittest.main()


class TestWorkflowHygiene(unittest.TestCase):
    """
    The cheap static checks I would otherwise get from actionlint.

    actionlint itself is not installable in this sandbox (its release CDN is
    outside the network allowlist), so these cover the failure modes that
    actually matter for this one file. Pair them with
    `python3 tools/simulate_workflow.py`, which executes the shell for real.
    """

    def setUp(self) -> None:
        self.text = _workflow_text()

    def test_actions_are_version_pinned(self):
        uses = re.findall(r"uses:\s*(\S+?)(?:\s|$)", self.text)
        self.assertTrue(uses)
        for ref in uses:
            self.assertRegex(ref, r"@v\d+(\.\d+)*$", f"action not pinned to a major version: {ref}")

    def test_no_pull_request_target_on_a_public_repo(self):
        """Fork PRs would otherwise get this repo's secrets handed to them."""
        self.assertNotIn("pull_request_target", self.text)
        self.assertNotIn("pull_request:", self.text)

    def test_permissions_are_read_only(self):
        self.assertIn("permissions:\n  contents: read", self.text)
        self.assertNotIn("write-all", self.text)

    def test_every_step_is_a_run_or_a_uses(self):
        """No PyYAML here on purpose: the ingest path is stdlib-only."""
        blocks: list[list[str]] = []
        for line in self.text.splitlines():
            if re.match(r"^ {6}- ", line):
                blocks.append([line])
            elif blocks and line.startswith("        "):
                blocks[-1].append(line)
        self.assertTrue(blocks, "found no steps in the workflow")
        for block in blocks:
            body = "\n".join(block)
            self.assertTrue(
                "run:" in body or "uses:" in body,
                f"step is neither a run nor a uses:\n{body}",
            )

    def test_env_names_written_are_all_read_and_vice_versa(self):
        """A typo in RUN_MONTH vs RUN_MONTHS would silently break the cache key."""
        written = set(re.findall(r'echo "([A-Z_]+)=', self.text))
        # both shell ($NAME) and runner expression (${{ env.NAME }}) reads
        read = set(re.findall(r"\$\{?([A-Z_][A-Z0-9_]*)", self.text))
        read |= set(re.findall(r"env\.([A-Z_][A-Z0-9_]*)", self.text))

        github_builtins = {
            "GITHUB_ENV", "GITHUB_STEP_SUMMARY", "GITHUB_RUN_ID", "GITHUB_SHA",
            "GITHUB_REPOSITORY", "GITHUB_REF", "PATH", "HOME",
        }
        secrets_and_inputs = KNOWN_SECRETS | {
            "IN_DATE", "IN_LEAGUES", "IN_PROVIDER", "IN_SINK", "IN_DRY", "IN_CAPTURE",
            "VAR_SINK", "VAR_LIVE", "RUN_DATE", "RUN_MONTH", "RUN_LEAGUES",
            "RUN_PROVIDER", "RUN_SINK", "RUN_DRY_FLAG", "RUN_DRY_LABEL",
            "RUN_CAPTURE_FLAG", "RUN_GAMES_FLAG", "IN_ONLY_WITH_GAMES", "BASH_SOURCE", "FAILED", "leaked", "hits", "value",
            "name", "bundle", "bundles", "date", "leagues", "provider", "sink",
            "month", "capture", "dry_flag", "dry_label", "capture_flag", "games_flag", "failed",
        }
        unknown = read - written - github_builtins - secrets_and_inputs
        self.assertEqual(unknown, set(), f"workflow reads variables nothing sets: {sorted(unknown)}")

        never_read = written - read
        self.assertEqual(never_read, set(), f"workflow sets variables nothing reads: {sorted(never_read)}")

    def test_numbers_written_to_github_env_are_quoted_or_simple(self):
        """GITHUB_ENV is parsed by the runner; a stray newline ends the file."""
        for value in re.findall(r'echo "([A-Z_]+)=(.*?)"', self.text):
            name, expression = value
            self.assertNotIn("\n", expression, f"{name} value may contain a newline")
