"""
ingest/predict.py
─────────────────
The enrichment bridge: fills the computed columns of UpcomingClean.

Those columns (t1-*, t2-*, ou-*, ou-best*, enh-*) used to be produced inside
each satellite's Apps Script.  The Python ports already exist in brain/ — this
module is the adapter that feeds them from API-sourced data instead of sheet
cells, so no new prediction logic is invented here:

    features  →  brain.forecaster.calculate_magolide_score     (Tier-1 side)
    quarter   →  brain.signal_processor.t2ou_score_over_under_pick (Tier-2 O/U)
    forebet*  →  brain.forecaster.calculate_forebet_difference

The Forebet-specific twist: `calculate_forebet_difference` consumes two values,
the prediction side and a "61 - 39" probability string.  Both now come from the
ingest layer (market de-vig or Poisson model) instead of a human's copy-paste,
so the model keeps its existing shape and weighting while its inputs come from
an API.  `forebetWeight` therefore remains meaningful — it now weights
"model/market opinion vs our own ratings", which is what it was always doing.
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from typing import Any, Dict, List, Optional, Sequence

from ingest.models import Fixture, GameResult, QuarterProfile, StandingRow
from ingest.teams import TeamResolver
from brain.data_parser import load_accumulator_config, load_tier1_config
from brain.forecaster import (
    calculate_forebet_difference,
    calculate_magolide_score,
    parse_home_away_probability,
)
from brain.signal_processor import t2ou_score_over_under_pick

log = logging.getLogger("ingest.predict")

# The scoring weights are NOT invented here.  They come from the repo's own
# canonical defaults (the port of loadTier1Config), so the API-fed engine
# scores exactly like the sheet-fed one until a league ships its own
# Config_Tier2 overrides.  The snake_case O/U keys are the ones
# brain/signal_processor.t2ou_score_over_under_pick actually reads.
DEFAULT_CONFIG: Dict[str, Any] = {
    **load_tier1_config({}),
    **load_accumulator_config({}),
    # consumed by brain/signal_processor
    "ou_min_samples": 4,
    "ou_min_conf": 55.0,
    "ou_confidence_scale": 30.0,
    "ou_american_odds": -110.0,
    "ou_edge_threshold": 0.02,
    "ou_min_ev": 0.005,
    "ou_push_width": 0.5,
    "sigmaFloor": 15.0,
    "sigmaScale": 1.0,
    "sigmaCap": 60.0,
    "fallbackSigma": 20.0,
    "useTeamVariance": True,
}


def enrich_fixture(fixture: Fixture, day: str) -> Dict[str, Any]:
    """
    Module-level fallback used when no Enricher is bound to the pipeline
    (e.g. a one-off contract test).  Returns an empty enrichment so the row is
    still a valid, parseable UpcomingClean row — the same state a freshly
    pasted satellite row is in before HiveMind runs.
    """
    return {}


class Enricher:
    """
    Produces the derived columns for the games of one league.

    Usage from the pipeline:

        enricher.prepare(results, standings, quarter_profiles)
        cols = enricher.enrich(fixture)
    """

    def __init__(
        self,
        config: Optional[Dict[str, Any]] = None,
        resolver: Optional[TeamResolver] = None,
        league_key: str = "",
        history_limit: int = 10,
    ):
        self.config: Dict[str, Any] = dict(DEFAULT_CONFIG)
        if config:
            self.config.update({k: v for k, v in config.items() if v is not None})
        self.resolver = resolver or TeamResolver()
        self.league_key = league_key
        self.history_limit = history_limit

        self._results_by_team: Dict[str, List[GameResult]] = defaultdict(list)
        self._h2h: Dict[tuple, List[GameResult]] = defaultdict(list)
        self._standings: Dict[str, StandingRow] = {}
        self._quarter: Dict[str, QuarterProfile] = {}
        self._league_quarter: Optional[QuarterProfile] = None
        self.prepared = False

    # ── preparation ─────────────────────────────────────────────────────

    def prepare(
        self,
        results: Sequence[GameResult],
        standings: Sequence[StandingRow] = (),
        quarter_profiles: Sequence[QuarterProfile] = (),
    ) -> "Enricher":
        ordered = sorted(results, key=lambda r: r.date, reverse=True)
        for r in ordered:
            self._results_by_team[self.resolver.key(r.home)].append(r)
            self._results_by_team[self.resolver.key(r.away)].append(r)
            pair = tuple(sorted((self.resolver.key(r.home), self.resolver.key(r.away))))
            self._h2h[pair].append(r)

        for row in standings:
            key = self.resolver.key(getattr(row, "team", ""))
            if key:
                self._standings[key] = row

        for p in quarter_profiles:
            if p.team == "__LEAGUE__":
                self._league_quarter = p
            else:
                self._quarter[self.resolver.key(p.team)] = p

        self.prepared = True
        return self

    # ── enrichment ──────────────────────────────────────────────────────

    def enrich(self, fixture: Fixture) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        if not self.prepared:
            return out

        home_key = self.resolver.key(fixture.home)
        away_key = self.resolver.key(fixture.away)

        features = self._features(fixture, home_key, away_key)
        score = calculate_magolide_score(features, self.config)
        out["pred_score"] = _round(score.get("score"))
        if score.get("prediction"):
            out["magolide_prediction"] = score["prediction"]

        q_cols = self._quarter_columns(home_key, away_key, fixture)
        out.update(q_cols)

        return out

    # ── feature construction ────────────────────────────────────────────

    def _features(self, fixture: Fixture, home_key: str, away_key: str) -> Dict[str, Any]:
        """
        Feature construction matching Forecaster.gs exactly.

        Each block names the .gs function it mirrors so the two can be diffed:
          rankDiff       calculateRankDifference_        (awayRank - homeRank)
          pctDiff        calculatePCTDifference_         (homePct - awayPct) * 100
          netRtgDiff     calculateNetRatingDifference_   homeNetRtg - awayNetRtg
          momentumDiff   calculateMomentumDifference_    avgMargin difference (points/game)
          formDiff       calculateFormDifference_        streak*0.5 + l10Pct*10
          h2hDiff        calculateH2HDifference_         (winRatio*5 + margin/10) * sampleWeight
          forebetDiff    calculateForebetDifference_     now fed by the ingest layer
        """
        home_row = self._standings.get(home_key)
        away_row = self._standings.get(away_key)
        home_hist = self._results_by_team.get(home_key, [])[: self.history_limit]
        away_hist = self._results_by_team.get(away_key, [])[: self.history_limit]

        # rankDiff — default rank 15, matching DEFAULT_RANK in the .gs
        rank_diff = _position(away_row, 15.0) - _position(home_row, 15.0)

        # pctDiff — percentage points
        pct_diff = (_pct(home_row, 0.5) - _pct(away_row, 0.5)) * 100.0

        # netRtgDiff — points per game differential
        home_net = _net_rating(home_row, home_hist, home_key)
        away_net = _net_rating(away_row, away_hist, away_key)
        net_rtg_diff = home_net - away_net

        # momentumDiff — recent average margin (the .gs' preferred path)
        home_margin = _avg_margin(home_hist, home_key)
        away_margin = _avg_margin(away_hist, away_key)
        momentum_diff = home_margin - away_margin

        # formDiff — streak and L10 blend
        streak_factor = (_streak(home_hist, home_key) - _streak(away_hist, away_key)) * 0.5
        l10_factor = (_l10_pct(home_row) - _l10_pct(away_row)) * 10.0
        form_diff = streak_factor + l10_factor

        # h2hDiff
        pair = tuple(sorted((home_key, away_key)))
        h2h = self._h2h.get(pair, [])[: self.history_limit]
        h2h_diff = _h2h_difference(h2h, home_key)

        # forebetDiff — the feature that used to be a hand-copied Forebet cell.
        # Same function, same shape of input ("61 - 39"), new provenance.
        prob_str = ""
        if fixture.home_prob is not None:
            away_prob = fixture.away_prob if fixture.away_prob is not None else 100.0 - fixture.home_prob
            prob_str = f"{round(fixture.home_prob)} - {round(away_prob)}"
        forebet_diff = calculate_forebet_difference(
            fixture.pick_side, prob_str, fixture.home, fixture.away
        )

        return {
            "rankDiff": rank_diff,
            "pctDiff": pct_diff,
            "netRtgDiff": net_rtg_diff,
            "momentumDiff": momentum_diff,
            "streakDiff": _streak(home_hist, home_key) - _streak(away_hist, away_key),
            "formDiff": form_diff,
            "h2hDiff": h2h_diff,
            "forebetDiff": forebet_diff,
            "homeCourtEffect": 1.0,
            "variancePenalty": self._variance_penalty(home_hist, away_hist),
        }

    def _variance_penalty(
        self,
        home_hist: Sequence[GameResult],
        away_hist: Sequence[GameResult],
    ) -> float:
        sigma_ref = float(self.config.get("fallbackSigma", 20.0) or 20.0)
        values = [_total_of(r) for r in list(home_hist) + list(away_hist)]
        values = [v for v in values if v is not None]
        if len(values) < 4:
            return 0.0
        mu = sum(values) / len(values)
        var = sum((v - mu) ** 2 for v in values) / len(values)
        return math.sqrt(max(var, 0.0)) / max(sigma_ref, 1e-9)

    # ── quarter / O-U columns ───────────────────────────────────────────

    def _quarter_columns(self, home_key: str, away_key: str, fixture: Fixture) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        home_q = self._quarter.get(home_key)
        away_q = self._quarter.get(away_key)
        league_q = self._league_quarter

        for label in ("Q1", "Q2", "Q3", "Q4"):
            mu, sigma, samples, model_line = self._quarter_model(home_q, away_q, league_q, label)
            if mu is None:
                continue
            # The line must come from the market. Pricing against our own mean
            # would always produce a ~zero edge — see docs/API_MIGRATION.md.
            line = self._quarter_line(fixture, label)
            if line is None:
                out[f"t2_{label.lower()}_mu"] = _round(mu)
                continue
            lower = label.lower()
            model = {"mu": mu, "sigma": sigma, "samples": samples}
            pick = t2ou_score_over_under_pick(
                model, line, self.config, None,
                {"quarter": label, "league": self.league_key},
            )
            out[f"t2_{lower}_line"] = _round(line)
            if pick.get("play"):
                # {'dir': 'Over', 'direction': 'Over', 'confPct': 61.2,
                #  'edge': 0.041, 'ev': 0.031, 'tier': 'MEDIUM',
                #  'text': 'Over 54.5 ● (61%)', 'edgeScore': 2.31, ...}
                out[f"t2_{lower}"] = pick.get("text") or f"{pick.get('dir', '')} {line:g}".strip()
                out[f"t2_{lower}_conf"] = _round(pick.get("confPct"), 1)
                out[f"t2_{lower}_edge"] = _round(pick.get("edge"), 4)
                out[f"t2_{lower}_ev"] = _round(pick.get("ev"), 4)
                out[f"t2_{lower}_push"] = _round(pick.get("pPush"), 4)
                out[f"t2_{lower}_tier"] = pick.get("tier", "")
                if pick.get("edgeScore") is not None:
                    out["t2_edge_score"] = _round(pick.get("edgeScore"), 2)

        # Full-game O/U, priced against the market total line.
        line = fixture.total_line
        if line and fixture.expected_total:
            delta = fixture.expected_total - float(line)
            direction = "OVER" if delta >= 0 else "UNDER"
            out["ou_game"] = f"{direction} {float(line):g}"
            out["ou_game_tier"] = "MODEL"
            out["ou_edge_score"] = _round(abs(delta), 2)
        return out

    def _quarter_line(self, fixture: Fixture, label: str) -> Optional[float]:
        """
        Quarter line derived from the market's full-game total line.

        Bookmakers publish quarter totals for some leagues; where they don't,
        a flat quarter split of the game line is the same approximation the
        satellites used.  No market line at all → no play.
        """
        if not fixture.total_line:
            return None
        # the model mu is combined (both teams) for the quarter, and so is the
        # market's full-game line — so a flat split is the right comparison
        return round(float(fixture.total_line) / 4.0, 1)

    def _quarter_model(
        self,
        home_q: Optional[QuarterProfile],
        away_q: Optional[QuarterProfile],
        league_q: Optional[QuarterProfile],
        label: str,
    ):
        """Expected combined points + sigma for one quarter, and the market line."""
        if home_q and away_q and label in home_q.q_mu and label in away_q.q_mu:
            mu = home_q.q_mu[label] + away_q.q_mu[label]
            sigma = math.sqrt(home_q.q_sigma.get(label, 0.0) ** 2 + away_q.q_sigma.get(label, 0.0) ** 2)
            samples = min(home_q.sample_n, away_q.sample_n)
        elif league_q and label in league_q.q_mu:
            mu = league_q.q_mu[label] * 2.0
            sigma = league_q.q_sigma.get(label, 0.0) * math.sqrt(2.0)
            samples = league_q.sample_n
        else:
            return None, None, 0, 0.0

        if sigma <= 0:
            sigma = self.config.get("fallbackSigma", 20.0) / 4.0
            samples = min(samples, self.config.get("ou_min_samples", 4))
        line = round(mu / 0.5) * 0.5
        return mu, sigma, samples, line


# ─────────────────────────────────────────────────────────────────────────
# small maths helpers
# ─────────────────────────────────────────────────────────────────────────

def _round(v: Any, digits: int = 2) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return round(f, digits)


def _diff(a: Optional[float], b: Optional[float]) -> float:
    if a is None or b is None:
        return 0.0
    return a - b


def _pct(row: Optional[StandingRow], default: float = 0.5) -> float:
    if row is None:
        return default
    if row.pct is not None:
        return float(row.pct)
    if row.w is not None and row.l is not None and (row.w + row.l) > 0:
        return row.w / (row.w + row.l)
    return default


def _position(row: Optional[StandingRow], default: float = 15.0) -> float:
    if row is None or not row.position:
        return default
    try:
        return float(str(row.position).strip().rstrip("."))
    except (TypeError, ValueError):
        return default


def _net_rating(
    row: Optional[StandingRow],
    history: Sequence[GameResult],
    team_key: str,
) -> float:
    """Points per game differential — standings first, recent results second."""
    if row is not None and row.pf is not None and row.pa is not None:
        games = row.gp or 0
        if games > 0 and (row.pf > games * 3 or row.pa > games * 3):
            return (row.pf - row.pa) / games      # totals, not averages
        return row.pf - row.pa                     # already per-game
    return _avg_margin(history, team_key)


def _avg_margin(history: Sequence[GameResult], team_key: str) -> float:
    values: List[float] = []
    for r in history:
        h, a = r.ft_h, r.ft_a
        if h is None or a is None:
            continue
        values.append(float(h - a) if _norm_key(r.home) == team_key else float(a - h))
    return sum(values) / len(values) if values else 0.0


def _l10_pct(row: Optional[StandingRow]) -> float:
    """'7-3' → 0.7, matching parseL10 in the .gs."""
    if row is None or not row.l10:
        return 0.5
    import re
    m = re.search(r"(\d+)\s*[-–]\s*(\d+)", str(row.l10))
    if not m:
        return 0.5
    w, l = int(m.group(1)), int(m.group(2))
    return w / (w + l) if (w + l) else 0.5


def _h2h_difference(h2h: Sequence[GameResult], home_key: str) -> float:
    """Port of calculateH2HDifference_."""
    total = len(h2h)
    if total == 0:
        return 0.0
    home_wins = 0
    margins: List[float] = []
    for r in h2h:
        is_home = _norm_key(r.home) == home_key
        win = r.winner_side
        if (win == "H" and is_home) or (win == "A" and not is_home):
            home_wins += 1
        margins.append(_signed_margin(r, home_key))
    away_wins = total - home_wins
    win_ratio_factor = (home_wins - away_wins) / total
    avg_margin = sum(margins) / len(margins) if margins else 0.0
    margin_factor = avg_margin / 10.0
    sample_weight = min(1.0, total / 10.0)
    return (win_ratio_factor * 5 + margin_factor) * sample_weight


def _signed_margin(r: GameResult, team_key: str) -> float:
    h, a = r.ft_h, r.ft_a
    if h is None or a is None:
        return 0.0
    return float(h - a) if _norm_key(r.home) == team_key else float(a - h)


def _total_of(r: GameResult) -> Optional[float]:
    h, a = r.ft_h, r.ft_a
    return None if h is None or a is None else float(h + a)


def _win_rate(results: Sequence[GameResult], team_key: str) -> float:
    if not results:
        return 0.5
    wins = 0
    for r in results:
        side = r.winner_side
        if not side:
            continue
        is_home = _norm_key(r.home) == team_key
        if (side == "H" and is_home) or (side == "A" and not is_home):
            wins += 1
    return wins / len(results)


def _streak(results: Sequence[GameResult], team_key: str) -> float:
    """Positive = consecutive wins, negative = consecutive losses."""
    count = 0
    for r in results:
        side = r.winner_side
        if not side:
            break
        is_home = _norm_key(r.home) == team_key
        won = (side == "H" and is_home) or (side == "A" and not is_home)
        if count == 0:
            count = 1 if won else -1
        elif count > 0 and won:
            count += 1
        elif count < 0 and not won:
            count -= 1
        else:
            break
    return float(count)


def _norm_key(name: str) -> str:
    from ingest.teams import normalise
    return normalise(name)
