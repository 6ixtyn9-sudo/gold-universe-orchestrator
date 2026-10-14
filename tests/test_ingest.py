"""
tests/test_ingest.py
────────────────────
The guard-rails for the migration off Google Sheets.

The central claim of this work is: *API-sourced rows are indistinguishable
from sheet-sourced rows to everything downstream.*  These tests prove it by
feeding generated rows to the real, unmodified consumers in the repo.

Run:
    python3 -m unittest discover -s tests -t . -v
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ingest import configs, contracts
from ingest.leagues import satellite_id_for
from ingest.models import Fixture, GameResult, QuarterProfile, StandingRow
from ingest.pipeline import IngestPipeline, IngestRequest
from ingest.providers import make_probability_sources, make_provider
from ingest.providers.model import PoissonRatings, build_quarter_profiles
from ingest.providers.odds import devig_two_way, overround
from ingest.sinks import LocalBundleSink
from ingest.teams import TeamResolver

FIXTURES_DIR = REPO_ROOT / "examples" / "provider_fixtures"


def sample_fixture() -> Fixture:
    return Fixture(
        league_key="united-states-nba",
        league_display="United States (NBA)",
        date="2026-10-14",
        time="00:30",
        home="Boston Celtics",
        away="New York Knicks",
        home_prob=67.0,
        away_prob=33.0,
        prob_source="poisson_model",
        pick_side="1",
        pick_source="poisson_model",
        odds_home=1.42,
        odds_away=2.95,
        expected_total=221.2,
        total_line=221.5,
        provider="fixture",
        provider_fixture_id="1001",
    )


def sample_result() -> GameResult:
    return GameResult(
        league_key="united-states-nba", date="2026-10-13", time="19:30",
        home="Boston Celtics", away="New York Knicks",
        q1h=28, q1a=25, q2h=30, q2a=27, q3h=26, q3a=29, q4h=31, q4a=24,
        provider="fixture", provider_fixture_id="9001",
    )


class TestContractShapes(unittest.TestCase):
    """Row/header alignment is the cheapest bug to ship and the worst to find."""

    def test_upcoming_row_matches_header(self):
        row = contracts.upcoming_row(sample_fixture(), {"pred_score": 42.0, "t2_q1": "Over"})
        self.assertEqual(len(row), len(contracts.UPCOMING_HEADER))

    def test_results_row_matches_header(self):
        row = contracts.results_row(sample_result())
        self.assertEqual(len(row), len(contracts.RESULTS_HEADER))

    def test_game_log_row_matches_header(self):
        row = contracts.game_log_row(sample_result())
        self.assertEqual(len(row), len(contracts.GAME_LOG_HEADER))

    def test_prob_pair_format(self):
        self.assertEqual(contracts.format_prob_pair(61.2, 38.8), "61 - 39")
        self.assertEqual(contracts.format_prob_pair(61.2, None), "61 - 39")
        # the format the sheet used, which brain/data_parser splits on " - "
        self.assertIn(" - ", contracts.format_prob_pair(50, 50))


class TestDownstreamCompatibility(unittest.TestCase):
    """Feed generated rows to the real consumers, unmodified."""

    def test_upcoming_clean_parses_both_consumers(self):
        from brain.data_parser import parse_upcoming_clean as brain_parse
        from fetcher.parsers.upcoming_clean import parse_upcoming_clean as fetcher_parse

        fixtures = [sample_fixture()]
        values = contracts.upcoming_table([contracts.upcoming_row(f, {"pred_score": 42.0}) for f in fixtures])

        brain_games = brain_parse(values)
        fetcher_games = fetcher_parse(values)
        self.assertEqual(len(brain_games), 1, "brain parser found no games")
        self.assertEqual(len(fetcher_games), 1, "fetcher parser found no games")

        # each consumer keeps its own vocabulary — but they must agree on facts
        self.assertEqual(brain_games[0]["home"], "Boston Celtics")
        self.assertEqual(brain_games[0]["prediction"], "1")
        self.assertEqual(brain_games[0]["confidence"], 67.0)

        self.assertEqual(fetcher_games[0]["home"], "Boston Celtics")
        self.assertEqual(fetcher_games[0]["pred"], "1")
        self.assertEqual(fetcher_games[0]["prob_pct"], 67.0)
        self.assertIn("bostonceltics", str(fetcher_games[0]["game_id"]))

    def test_results_clean_parses_both_consumers(self):
        from brain.data_parser import parse_results_clean as brain_parse
        from fetcher.parsers.results_clean import parse_results_clean as fetcher_parse

        values = contracts.results_table([contracts.results_row(sample_result())])

        fetcher_rows = fetcher_parse(values)
        self.assertEqual(len(fetcher_rows), 1, "fetcher parser found no results")
        self.assertEqual(fetcher_rows[0]["ft_h"], 115)
        self.assertEqual(fetcher_rows[0]["ft_a"], 105)
        self.assertEqual(fetcher_rows[0]["q1_h"], 28)

        brain_rows = brain_parse(values)
        self.assertEqual(len(brain_rows), 1, "brain parser found no results")
        self.assertEqual(brain_rows[0]["home_score"], 115)
        self.assertEqual(brain_rows[0]["away_score"], 105)
        # the brain parser only understood the combined dialect — now populated
        self.assertEqual(brain_rows[0]["q1_total"], 53)

    def test_game_log_parses(self):
        from fetcher.parsers.game_logs import parse_game_log_table

        values = contracts.game_log_table([sample_result()])
        rows = parse_game_log_table(values)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["winner_side"], "HOME")
        self.assertEqual(rows[0]["totalh"], 115)

    def test_standings_parse(self):
        from brain.data_parser import parse_standings

        rows = [
            StandingRow(team="Boston Celtics", position="1", gp=60, w=45, l=15, pct=0.75, section="East"),
            StandingRow(team="New York Knicks", position="4", gp=60, w=33, l=27, pct=0.55, section="East"),
        ]
        parsed = parse_standings(contracts.standings_table(rows))
        self.assertTrue(parsed, "standings did not parse")
        key = next(k for k in parsed if "celtics" in k)
        self.assertEqual(parsed[key]["wins"], 45)
        self.assertAlmostEqual(parsed[key]["pct"], 0.75)


class TestPoissonModel(unittest.TestCase):

    def setUp(self):
        self.results = [
            GameResult(league_key="x", date=f"2026-09-{i+1:02d}", home="Strong", away="Weak",
                       q1h=30, q1a=20, q2h=30, q2a=20, q3h=30, q3a=20, q4h=30, q4a=20)
            for i in range(8)
        ] + [
            GameResult(league_key="x", date=f"2026-09-{i+1:02d}", home="Weak", away="Strong",
                       q1h=20, q1a=30, q2h=20, q2a=30, q3h=20, q3a=30, q4h=20, q4a=30)
            for i in range(8)
        ]

    def test_fit_separates_strong_from_weak(self):
        ratings = PoissonRatings().fit(self.results)
        self.assertTrue(ratings.fitted)
        self.assertGreater(ratings.att["strong"], ratings.att["weak"])

    def test_probabilities_are_coherent(self):
        ratings = PoissonRatings().fit(self.results)
        pred = ratings.predict("Strong", "Weak")
        self.assertAlmostEqual(pred.p_home + pred.p_away + pred.p_draw, 1.0, places=6)
        self.assertGreater(pred.p_home, pred.p_away)
        self.assertGreater(pred.mu_home, pred.mu_away)
        self.assertGreater(pred.expected_total, 0)

    def test_large_lambdas_do_not_overflow(self):
        """A 200-point expected total must not blow up (the naive pmf does)."""
        ratings = PoissonRatings().fit(self.results)
        p_home, p_away, p_draw = __import__(
            "ingest.providers.model", fromlist=["_poisson_outcome"]
        )._poisson_outcome(210.0, 205.0)
        self.assertAlmostEqual(p_home + p_away + p_draw, 1.0, places=6)

    def test_unfitted_model_is_neutral(self):
        pred = PoissonRatings().predict("A", "B")
        self.assertEqual(pred.p_home, 0.5)
        self.assertEqual(pred.sample_n, 0)


class TestMarketMaths(unittest.TestCase):

    def test_devig_removes_margin(self):
        p_home, p_away = devig_two_way(1.42, 2.95)
        self.assertAlmostEqual(p_home + p_away, 1.0, places=9)
        self.assertGreater(p_home, p_away)
        self.assertGreater(overround(1.42, 2.95), 0.0)

    def test_invalid_odds_raise(self):
        with self.assertRaises(ValueError):
            devig_two_way(0.5, 2.0)


class TestTeamResolver(unittest.TestCase):

    def test_alias_and_fuzzy_match(self):
        resolver = TeamResolver(aliases={"LA Clippers": "Los Angeles Clippers"})
        self.assertTrue(resolver.same("LA Clippers", "Los Angeles Clippers"))
        match = resolver.match("Golden State Warriors", ["Golden State Warriors", "Sacramento Kings"])
        self.assertEqual(match, "Golden State Warriors")

    def test_unresolved_is_recorded(self):
        resolver = TeamResolver()
        resolver.match("Nonexistent Rovers", ["Boston Celtics", "New York Knicks"])
        self.assertIn("Nonexistent Rovers", resolver.unresolved)


class TestPipelineEndToEnd(unittest.TestCase):
    """The whole path, offline, with the real parsers at the end of it."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls._tmp.name)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_fixture_run_produces_parseable_satellites(self):
        provider = make_provider("fixture", root=str(FIXTURES_DIR))
        resolver = TeamResolver()
        sources = make_probability_sources(["model"], provider, resolver)
        sink = LocalBundleSink(root=self.out)
        pipeline = IngestPipeline(provider, sources, [sink], resolver)

        report = pipeline.run(IngestRequest(
            leagues=["nba"],
            date_from="2026-10-14",
            date_to="2026-10-15",
        ))

        self.assertFalse(report.errors, report.errors)
        totals = report.totals
        self.assertEqual(totals["leagues"], 1)
        self.assertGreater(totals["fixtures"], 0)
        self.assertEqual(totals["priced"], totals["fixtures"], "every fixture should be priced")

        # one satellite per (league, date), named the way the fleet names them
        expected_id = satellite_id_for("united-states-nba", "2026-10-14")
        bundle_dir = self.out / expected_id.replace(":", "_")
        self.assertTrue(bundle_dir.is_dir(), f"missing bundle {bundle_dir}")

        upcoming = json.loads((bundle_dir / "core__UpcomingClean.json").read_text())
        from brain.data_parser import parse_upcoming_clean
        games = parse_upcoming_clean(upcoming["values"])
        self.assertGreater(len(games), 0)
        for game in games:
            self.assertTrue(game["home"] and game["away"])
            self.assertIsNotNone(game["confidence"], "no probability reached the row")
            self.assertIn(game["prediction"], ("1", "2"))

        self.assertTrue((bundle_dir / "core__Standings.json").exists())
        self.assertTrue((bundle_dir / "core__LeagueQuarterO_U_Stats.json").exists())
        self.assertTrue((bundle_dir / "manifest.json").exists())

    def test_enricher_emits_quarter_picks(self):
        provider = make_provider("fixture", root=str(FIXTURES_DIR))
        resolver = TeamResolver()
        sources = make_probability_sources(["model"], provider, resolver)
        pipeline = IngestPipeline(provider, sources, [LocalBundleSink(root=self.out)], resolver)

        report = pipeline.run(IngestRequest(leagues=["nba"], date_from="2026-10-14"))
        self.assertFalse(report.errors, report.errors)

        bundle_dir = self.out / satellite_id_for("united-states-nba", "2026-10-14").replace(":", "_")
        values = json.loads((bundle_dir / "core__UpcomingClean.json").read_text())["values"]
        header = {name: i for i, name in enumerate(values[0])}
        row = values[1]

        # a market total line must produce a full-game O/U call
        self.assertNotEqual(row[header["ou-game"]], "")
        # quarter lines come from the market line, and at least one quarter is priced
        self.assertNotEqual(row[header["t2-q1-line"]], "")


class TestConfigs(unittest.TestCase):

    def test_defaults_load(self):
        cfg = configs.flatten("no-such-league")
        self.assertIn("pctWeight", cfg)
        self.assertIn("ou_min_conf", cfg)

    def test_export_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            bundle = tmp_path / "bundle"
            bundle.mkdir()
            (bundle / "core__Config_Tier2.json").write_text(json.dumps({
                "values": [["Key", "Value"], ["ou_min_conf", 61], ["banker_threshold", 70]],
            }))
            target = configs.export_from_bundle(bundle, "test-league", out_dir=tmp_path)
            self.assertTrue(target.exists())
            doc = json.loads(target.read_text())
            self.assertEqual(doc["Config_Tier2"][1][1], 61)


if __name__ == "__main__":
    unittest.main(verbosity=2)
