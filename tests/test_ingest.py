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


# ─────────────────────────────────────────────────────────────────────────
# Bulk mode: 1 request/day for all 166 leagues
# ─────────────────────────────────────────────────────────────────────────

def api_sports_payload():
    """A payload shaped like API-Basketball's /games?date= response."""
    return {"response": [
        {  # finished NBA game
            "id": 55001,
            "date": "2026-10-13T23:00:00+00:00",
            "time": "23:00",
            "status": {"long": "Finished", "short": "FT"},
            "league": {"id": 12, "name": "NBA", "season": "2026-2027"},
            "country": {"id": 5, "name": "USA"},
            "teams": {"home": {"id": 5, "name": "Denver Nuggets"},
                      "away": {"id": 6, "name": "Golden State Warriors"}},
            "scores": {"home": {"quarter_1": 28, "quarter_2": 30, "quarter_3": 27,
                                "quarter_4": 29, "over_time": None, "total": 114},
                       "away": {"quarter_1": 25, "quarter_2": 26, "quarter_3": 30,
                                "quarter_4": 22, "over_time": None, "total": 103}},
        },
        {  # upcoming NBA game
            "id": 55002,
            "date": "2026-10-14T00:30:00+00:00",
            "time": "00:30",
            "status": {"long": "Not Started", "short": "NS"},
            "league": {"id": 12, "name": "NBA", "season": "2026-2027"},
            "country": {"id": 5, "name": "USA"},
            "teams": {"home": {"id": 9, "name": "Boston Celtics"},
                      "away": {"id": 10, "name": "New York Knicks"}},
            "scores": {"home": {"quarter_1": None, "total": None},
                       "away": {"quarter_1": None, "total": None}},
        },
        {  # Brazilian league, finished, overtime
            "id": 55003,
            "date": "2026-10-13T22:00:00+00:00",
            "time": "22:00",
            "status": {"long": "After Over Time", "short": "AOT"},
            "league": {"id": 26, "name": "NBB", "season": "2026-2027"},
            "country": {"id": 26, "name": "Brazil"},
            "teams": {"home": {"id": 40, "name": "Flamengo"},
                      "away": {"id": 41, "name": "Minas"}},
            "scores": {"home": {"quarter_1": 20, "quarter_2": 18, "quarter_3": 22,
                                "quarter_4": 19, "over_time": 12, "total": 91},
                       "away": {"quarter_1": 19, "quarter_2": 21, "quarter_3": 18,
                                "quarter_4": 21, "over_time": 9, "total": 88}},
        },
    ]}


class TestBulkMode(unittest.TestCase):
    """The free-tier precondition: one date call must cover every league."""

    def setUp(self):
        from ingest.providers.api_sports import ApiSportsProvider
        self.provider = ApiSportsProvider(api_key="test", enforce_quota=False)
        self.groups = self.provider.group_games(api_sports_payload()["response"])

    def test_groups_by_vendor_league(self):
        names = sorted(g["vendor_league_name"] for g in self.groups)
        self.assertEqual(names, ["NBA", "NBB"])

    def test_finished_game_parses_with_quarters(self):
        nba = next(g for g in self.groups if g["vendor_league_name"] == "NBA")
        self.assertEqual(len(nba["fixtures"]), 1)
        self.assertEqual(len(nba["results"]), 1)
        result = nba["results"][0]
        self.assertEqual(result.home, "Denver Nuggets")
        self.assertEqual(result.ft_h, 114)
        self.assertEqual(result.ft_a, 103)
        self.assertEqual(result.q1h, 28)
        self.assertEqual(result.status, "FT")

    def test_upcoming_game_becomes_fixture_only(self):
        nba = next(g for g in self.groups if g["vendor_league_name"] == "NBA")
        fixture = nba["fixtures"][0]
        self.assertEqual(fixture.home, "Boston Celtics")
        self.assertEqual(fixture.date, "2026-10-14")
        self.assertEqual(fixture.time, "00:30")

    def test_overtime_is_captured(self):
        nbb = next(g for g in self.groups if g["vendor_league_name"] == "NBB")
        result = nbb["results"][0]
        self.assertEqual(result.oth, 12)
        self.assertEqual(result.ota, 9)
        self.assertEqual(result.ft_h, 91)
        self.assertEqual(result.winner_side, "H")

    def test_vendor_leagues_map_to_fleet_leagues(self):
        from ingest.leagues import match_vendor_league
        spec, conf = match_vendor_league("NBA", "USA", 12)
        self.assertIsNotNone(spec, "NBA did not map")
        self.assertEqual(spec.key, "united-states-nba")
        self.assertGreater(conf, 0.9)

        spec, conf = match_vendor_league("NBB", "Brazil", 26)
        self.assertIsNotNone(spec, "NBB did not map")
        self.assertEqual(spec.key, "brazil-nbb")

    def test_unknown_vendor_league_is_not_guessed(self):
        from ingest.leagues import match_vendor_league
        spec, conf = match_vendor_league("Kraken Invitational League", "Atlantis")
        self.assertIsNone(spec)
        self.assertLess(conf, 0.72)


class TestQuotaLedger(unittest.TestCase):

    def setUp(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.path = Path(tmp) / "quota.json"
        from ingest import quotas
        self.quotas = quotas
        self.ledger = quotas.QuotaLedger(self.path)

    def test_spending_counts_down(self):
        for _ in range(3):
            self.ledger.spend("api_sports")
        self.assertEqual(self.ledger.remaining("api_sports"), 100 - 3)

    def test_reserve_is_honoured(self):
        for _ in range(90):
            self.ledger.spend("api_sports")
        self.assertFalse(self.ledger.check("api_sports", reserve=10))
        self.assertTrue(self.ledger.check("api_sports", 1, reserve=9))

    def test_exhaustion_raises_loudly(self):
        for _ in range(100):
            self.ledger.spend("api_sports", reserve=0)
        with self.assertRaises(self.quotas.QuotaExceeded):
            self.ledger.spend("api_sports", reserve=0)

    def test_unmetered_provider_never_blocks(self):
        for _ in range(5000):
            self.ledger.spend("fixture")
        self.assertTrue(self.ledger.check("fixture"))

    def test_monthly_budget_for_odds(self):
        for _ in range(500):
            self.ledger.spend("odds_api", reserve=0)
        self.assertFalse(self.ledger.check("odds_api"))


class TestBulkPipeline(unittest.TestCase):
    """A stub provider proving the pipeline attributes bulk games correctly."""

    class StubBulkProvider:
        name = "stub_bulk"
        supports_bulk = True
        supports_standings = False

        def __init__(self, groups):
            self._groups = groups
            self.calls = 0

        def bulk_day(self, date_iso):
            """Filter by date, exactly as a real vendor's ?date= call does."""
            self.calls += 1
            out = []
            for group in self._groups:
                fixtures = [f for f in group["fixtures"] if f.date == date_iso]
                results = [r for r in group["results"] if r.date == date_iso]
                if fixtures or results:
                    out.append({**group, "fixtures": fixtures, "results": results})
            return out

        def standings(self, league_key, season=""):
            return []

        def team_history(self, *a, **k):
            return []

        def h2h(self, *a, **k):
            return []

    def test_bulk_run_attributes_games_to_fleet_leagues(self):
        from ingest.providers.api_sports import ApiSportsProvider

        provider = ApiSportsProvider(api_key="test", enforce_quota=False)
        groups = provider.group_games(api_sports_payload()["response"])
        stub = self.StubBulkProvider(groups)

        with tempfile.TemporaryDirectory() as tmp:
            pipeline = IngestPipeline(stub, [], [LocalBundleSink(root=tmp)], TeamResolver())
            report = pipeline.run(IngestRequest(
                leagues=["nba", "nbb"],
                date_from="2026-10-13",
                date_to="2026-10-14",
                results_lookback_days=0,
                auto_learn_leagues=False,
                enrich=False,
            ))

        # one provider call per day regardless of league count
        self.assertEqual(stub.calls, 2)
        self.assertEqual(report.bulk_calls, 2)
        by_key = {lg.league_key: lg for lg in report.leagues}
        self.assertEqual(by_key["united-states-nba"].fixtures, 1)
        self.assertEqual(by_key["united-states-nba"].results, 1)
        self.assertEqual(by_key["brazil-nbb"].results, 1)
        self.assertFalse(report.errors, report.errors)


class TestFailover(unittest.TestCase):
    """Two free keys must behave like one provider, not like a coin flip."""

    class Exhausted:
        name = "exhausted"
        supports_bulk = False
        supports_standings = False

        def fixtures(self, *a, **k):
            from ingest.quotas import QuotaExceeded
            raise QuotaExceeded("today 100 of 100")

    class Broken:
        name = "broken"
        supports_bulk = False
        supports_standings = False

        def fixtures(self, *a, **k):
            from ingest.providers.base import ProviderError
            raise ProviderError("HTTP 503")

    class Good:
        name = "good"
        supports_bulk = True
        supports_standings = True

        def fixtures(self, league_key, date_from, date_to):
            return [Fixture(league_key=league_key, date=date_from, time="20:00",
                            home="Boston Celtics", away="New York Knicks")]

        def results(self, league_key, date_from, date_to):
            return [sample_result()]

        def bulk_day(self, date_iso):
            return [{"vendor_league_name": "NBA", "fixtures": [], "results": []}]

    def test_falls_through_quota_and_errors(self):
        from ingest.providers.failover import FailoverProvider

        chain = FailoverProvider([self.Exhausted(), self.Broken(), self.Good()], verbose=False)
        fixtures = chain.fixtures("united-states-nba", "2026-10-14", "2026-10-14")
        self.assertEqual(len(fixtures), 1)
        self.assertEqual(chain.last_used, "good")
        self.assertTrue(chain.supports_bulk)

    def test_all_failing_raises_with_reasons(self):
        from ingest.providers.base import ProviderError
        from ingest.providers.failover import FailoverProvider

        chain = FailoverProvider([self.Exhausted(), self.Broken()], verbose=False)
        with self.assertRaises(ProviderError) as ctx:
            chain.fixtures("x", "2026-10-14", "2026-10-14")
        message = str(ctx.exception)
        self.assertIn("out of quota", message)
        self.assertIn("503", message)

    def test_usage_is_tracked_per_member(self):
        from ingest.providers.failover import FailoverProvider

        chain = FailoverProvider([self.Exhausted(), self.Good()], verbose=False)
        chain.fixtures("x", "2026-10-14", "2026-10-14")
        chain.results("x", "2026-10-14", "2026-10-14")
        self.assertEqual(chain.usage["good"], 2)
