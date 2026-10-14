"""
ingest/providers/model.py
─────────────────────────
Forebet replacement, part 2: generate the probabilities ourselves.

The sheets used to carry two hand-copied Forebet columns:
    "Prob %"   e.g. "61 - 39"     →  the Home/Away probability split
    "Avg"      e.g. 221.5         →  the expected total points line

Both are inputs to brain/forecaster.py (feature "forebetDiff", weight
cfg.forebetWeight).  This module regenerates them from the same historical
results the rest of the pipeline already ingests, using a bivariate Poisson
attack/defence model — the standard approach for basketball totals and a
defensible, reproducible stand-in for a third-party opinion.

It also produces QuarterProfile rows for LeagueQuarterO_U_Stats, which is what
brain/signal_processor.py needs to price quarter Over/Under markets.

Nothing here needs network access if the provider is the fixture provider,
which means the whole pipeline can be regression-tested offline.
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

from ingest.models import Fixture, GameResult, QuarterProfile
from ingest.providers.base import DataProvider, ProbabilitySource
from ingest.teams import TeamResolver

log = logging.getLogger("ingest.provider.model")

_MAX_GOALS = 220          # truncation for the Poisson sum (basketball rarely exceeds this)
_PRIOR_WEIGHT = 6.0       # pseudo-games of league-average regression per team
_MAX_ITERS = 40
_TOLERANCE = 1e-6


# ─────────────────────────────────────────────────────────────────────────
# Poisson strength model
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class MatchPrediction:
    mu_home: float
    mu_away: float
    p_home: float          # 0..1
    p_away: float          # 0..1
    p_draw: float          # 0..1
    expected_total: float
    sample_n: int


class PoissonRatings:
    """
    Attack/defence ratings fitted by iterative proportional fitting.

        E[points_home] = base * att[home] * dfc[away] * home_adv
        E[points_away] = base * att[away] * dfc[home]

    Ratings are shrunk toward the league mean by sample size so a team with
    three games played doesn't get an extreme rating.
    """

    def __init__(self, shrinkage: float = _PRIOR_WEIGHT):
        self.base: float = 0.0
        self.home_adv: float = 1.0
        self.att: Dict[str, float] = {}
        self.dfc: Dict[str, float] = {}
        self.games: Dict[str, int] = {}
        self.league_total_avg: float = 0.0
        self.fitted: bool = False
        self.n_matches: int = 0
        self._shrinkage = shrinkage

    # ── fitting ─────────────────────────────────────────────────────────

    def fit(self, results: Iterable[GameResult], resolver: Optional[TeamResolver] = None) -> "PoissonRatings":
        rows: List[Tuple[str, str, int, int, float]] = []
        for r in results:
            fh, fa = r.ft_h, r.ft_a
            if fh is None or fa is None:
                continue
            h = resolver.key(r.home) if resolver else r.home.strip().lower()
            a = resolver.key(r.away) if resolver else r.away.strip().lower()
            if not h or not a or h == a:
                continue
            rows.append((h, a, int(fh), int(fa), 1.0))

        self.n_matches = len(rows)
        if len(rows) < 4:
            self.fitted = False
            return self

        teams = sorted({t for row in rows for t in (row[0], row[1])})
        total_points = sum(r[2] + r[3] for r in rows)
        self.league_total_avg = total_points / len(rows)
        self.base = self.league_total_avg / 2.0
        self.home_adv = 1.0

        att = {t: 1.0 for t in teams}
        dfc = {t: 1.0 for t in teams}
        played: Dict[str, int] = defaultdict(int)
        scored: Dict[str, int] = defaultdict(int)
        conceded: Dict[str, int] = defaultdict(int)
        for h, a, gh, ga, _w in rows:
            played[h] += 1
            played[a] += 1
            scored[h] += gh
            conceded[h] += ga
            scored[a] += ga
            conceded[a] += gh

        for _ in range(_MAX_ITERS):
            # home advantage: ratio of home points to away points, damped
            home_pts = sum(r[2] for r in rows)
            away_pts = sum(r[3] for r in rows)
            home_adv_new = math.sqrt(max(home_pts, 1e-9) / max(away_pts, 1e-9))

            # attack step
            new_att: Dict[str, float] = {}
            for t in teams:
                denom = 0.0
                for h, a, _gh, _ga, _w in rows:
                    if h == t:
                        denom += self.base * dfc[a] * home_adv_new
                    elif a == t:
                        denom += self.base * dfc[h]
                new_att[t] = scored[t] / denom if denom > 0 else 1.0

            # shrink attack toward 1.0
            new_att = {
                t: _shrink(v, played[t], self._shrinkage) for t, v in new_att.items()
            }
            _normalise(new_att)
            att = new_att

            # defence step
            new_dfc: Dict[str, float] = {}
            for t in teams:
                denom = 0.0
                for h, a, _gh, _ga, _w in rows:
                    if a == t:
                        denom += self.base * att[h] * home_adv_new
                    elif h == t:
                        denom += self.base * att[a]
                new_dfc[t] = conceded[t] / denom if denom > 0 else 1.0
            new_dfc = {
                t: _shrink(v, played[t], self._shrinkage) for t, v in new_dfc.items()
            }
            _normalise(new_dfc)

            delta = max(
                [abs(new_dfc[t] - dfc[t]) for t in teams] + [abs(new_att[t] - att[t]) for t in teams]
            )
            dfc = new_dfc
            self.home_adv = home_adv_new
            if delta < _TOLERANCE:
                break

        # fold normalisation into base so league mean stays anchored
        self.att, self.dfc, self.games = att, dfc, dict(played)
        self.base = self.league_total_avg / (2.0 * max(self.home_adv, 1e-9) ** 0.5)
        self.fitted = True
        return self

    # ── prediction ──────────────────────────────────────────────────────

    def predict(
        self,
        home: str,
        away: str,
        resolver: Optional[TeamResolver] = None,
        quarter_blend: Optional[Dict[str, float]] = None,
    ) -> MatchPrediction:
        if not self.fitted:
            return MatchPrediction(0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0)

        h = resolver.key(home) if resolver else home.strip().lower()
        a = resolver.key(away) if resolver else away.strip().lower()

        att_h = self.att.get(h, 1.0)
        att_a = self.att.get(a, 1.0)
        dfc_h = self.dfc.get(h, 1.0)
        dfc_a = self.dfc.get(a, 1.0)

        mu_h = self.base * att_h * dfc_a * self.home_adv
        mu_a = self.base * att_a * dfc_h

        if quarter_blend:
            mu_h *= quarter_blend.get("home", 1.0)
            mu_a *= quarter_blend.get("away", 1.0)

        mu_h = max(mu_h, 1.0)
        mu_a = max(mu_a, 1.0)

        p_h, p_a, p_d = _poisson_outcome(mu_h, mu_a)
        sample = min(
            self.games.get(h, 0),
            self.games.get(a, 0),
        )
        return MatchPrediction(mu_h, mu_a, p_h, p_a, p_d, mu_h + mu_a, sample)


def _shrink(value: float, n: int, prior_weight: float) -> float:
    """Pull a rating toward 1.0 based on how many games back it."""
    n = max(n, 0)
    return (value * n + 1.0 * prior_weight) / (n + prior_weight)


def _normalise(d: Dict[str, float]) -> None:
    """Scale ratings so their mean is 1.0 (in place)."""
    if not d:
        return
    mean = sum(d.values()) / len(d)
    if mean <= 0:
        return
    for k in d:
        d[k] /= mean


def _poisson_pmf_vector(lam: float, k_max: int = _MAX_GOALS) -> List[float]:
    """
    Poisson pmf computed iteratively: p_k = p_{k-1} * lam / k.

    Never uses factorial or lam**k, both of which overflow long before a
    basketball scoreline (110 points ≈ lambda 110) with the naive formula.
    """
    p = math.exp(-lam)
    out: List[float] = []
    for k in range(k_max):
        out.append(p)
        if p == 0.0 and k > lam:
            break
        p = p * lam / (k + 1)
        if p < 1e-18 and k > lam:
            # tail is below float resolution of the answer; stop early
            out.append(p)
            break
    return out


def _poisson_outcome(mu_h: float, mu_a: float) -> Tuple[float, float, float]:
    """
    P(home win), P(away win), P(draw) under independent Poisson scoring.

    Computed from the away CDF so each outcome is a single O(N) pass rather
    than a double loop over scorelines.
    """
    ph = _poisson_pmf_vector(mu_h)
    pa = _poisson_pmf_vector(mu_a)

    # cumulative distribution of the away score
    cdf_a: List[float] = []
    running = 0.0
    for p in pa:
        running += p
        cdf_a.append(running)

    p_home = p_away = p_draw = 0.0
    for i, phi in enumerate(ph):
        if phi <= 0.0:
            continue
        # away scores strictly below i  → home wins
        if i > 0:
            p_home += phi * cdf_a[min(i - 1, len(cdf_a) - 1)]
        # away exactly i                → draw
        if i < len(pa):
            p_draw += phi * pa[i]

    total_ph_pd = p_home + p_draw
    p_away = max(0.0, 1.0 - total_ph_pd)
    total = p_home + p_away + p_draw
    if total > 0:
        p_home, p_away, p_draw = p_home / total, p_away / total, p_draw / total
    return p_home, p_away, p_draw


# ─────────────────────────────────────────────────────────────────────────
# ProbabilitySource adapter
# ─────────────────────────────────────────────────────────────────────────

class ModelProbabilitySource(ProbabilitySource):
    """
    Fills home_prob / away_prob / pick_side / expected_total on fixtures using
    the Poisson ratings fitted from historical results.

    Draw probability is redistributed proportionally between home and away,
    because the fleet's "Prob %" column is a two-way split ("61 - 39") — the
    downstream consumers never expect a draw bucket.
    """

    name = "poisson_model"

    def __init__(
        self,
        provider: DataProvider,
        resolver: Optional[TeamResolver] = None,
        lookback_days: int = 400,
        min_sample: int = 8,
        blend_history: bool = True,
    ):
        self.provider = provider
        self.resolver = resolver or TeamResolver()
        self.lookback_days = lookback_days
        self.min_sample = min_sample
        self.blend_history = blend_history
        self._ratings_cache: Dict[str, PoissonRatings] = {}

    def ratings_for(self, league_key: str, before: str) -> PoissonRatings:
        cached = self._ratings_cache.get(league_key)
        if cached is not None:
            return cached
        date_from = _shift_days(before, -self.lookback_days)
        try:
            results = self.provider.results(league_key, date_from, _shift_days(before, -1))
        except Exception as exc:  # noqa: BLE001 - provider may not support results
            log.warning("no historical results for %s (%s)", league_key, exc)
            results = []
        ratings = PoissonRatings().fit(results, self.resolver)
        if not ratings.fitted:
            log.warning("league '%s': only %d results — model not fitted", league_key, ratings.n_matches)
        self._ratings_cache[league_key] = ratings
        return ratings

    def annotate(self, fixtures: List[Fixture]) -> List[Fixture]:
        out: List[Fixture] = []
        by_league: Dict[str, List[Fixture]] = defaultdict(list)
        for f in fixtures:
            by_league[f.league_key].append(f)

        for league_key, league_fixtures in by_league.items():
            before = min((f.date for f in league_fixtures if f.date), default="2099-01-01")
            ratings = self.ratings_for(league_key, before)
            for f in league_fixtures:
                out.append(self._annotate_one(f, ratings))
        return out

    def _annotate_one(self, fixture: Fixture, ratings: PoissonRatings) -> Fixture:
        if fixture.home_prob is not None:
            return fixture          # an explicit source already priced it
        pred = ratings.predict(fixture.home, fixture.away, self.resolver)
        if not ratings.fitted or pred.sample_n < self.min_sample:
            fixture.extra["model_note"] = f"insufficient_history({pred.sample_n})"
            return fixture

        two_way_total = pred.p_home + pred.p_away
        if two_way_total <= 0:
            return fixture
        home_share = pred.p_home / two_way_total

        fixture.home_prob = round(home_share * 100.0, 1)
        fixture.away_prob = round(100.0 - fixture.home_prob, 1)
        fixture.prob_source = self.name
        fixture.expected_total = round(pred.expected_total, 1)
        fixture.pick_side = "1" if home_share >= 0.5 else "2"
        fixture.pick_source = self.name
        fixture.extra["model_draw_p"] = round(pred.p_draw, 4)
        fixture.extra["model_mu_home"] = round(pred.mu_home, 2)
        fixture.extra["model_mu_away"] = round(pred.mu_away, 2)
        fixture.extra["model_sample_n"] = pred.sample_n
        return fixture


# ─────────────────────────────────────────────────────────────────────────
# Quarter profiles (LeagueQuarterO_U_Stats)
# ─────────────────────────────────────────────────────────────────────────

def build_quarter_profiles(
    results: Iterable[GameResult],
    resolver: Optional[TeamResolver] = None,
    league_key: str = "",
    min_games: int = 5,
) -> List[QuarterProfile]:
    """
    Per-team quarter mean and sigma, plus the league-wide row.

    brain/signal_processor.py prices quarter Over/Under from mu/sigma, so these
    two numbers are what make the quarter markets work without a sheet.
    """
    buckets: Dict[str, Dict[str, List[float]]] = defaultdict(lambda: defaultdict(list))
    for r in results:
        key = resolver.key(r.home) if resolver else r.home.strip().lower()
        keya = resolver.key(r.away) if resolver else r.away.strip().lower()
        for label, h, a in (
            ("Q1", r.q1h, r.q1a), ("Q2", r.q2h, r.q2a),
            ("Q3", r.q3h, r.q3a), ("Q4", r.q4h, r.q4a),
        ):
            if h is None or a is None:
                continue
            buckets[key][label].append(float(h))
            buckets[keya][label].append(float(a))

    profiles: List[QuarterProfile] = []
    league_q: Dict[str, List[float]] = defaultdict(list)
    for team, per_q in buckets.items():
        prof = QuarterProfile(team=team, league_key=league_key)
        prof.sample_n = min((len(v) for v in per_q.values()), default=0)
        if prof.sample_n < min_games:
            continue
        for label, values in per_q.items():
            mu, sigma = _mean_sigma(values)
            prof.q_mu[label] = round(mu, 2)
            prof.q_sigma[label] = round(sigma, 2)
            league_q[label].extend(values)
        profiles.append(prof)

    league_prof = QuarterProfile(team="__LEAGUE__", league_key=league_key)
    league_prof.sample_n = min((len(v) for v in league_q.values()), default=0)
    for label, values in league_q.items():
        mu, sigma = _mean_sigma(values)
        league_prof.q_mu[label] = round(mu, 2)
        league_prof.q_sigma[label] = round(sigma, 2)
    profiles.append(league_prof)
    profiles.sort(key=lambda p: p.team)
    return profiles


def _mean_sigma(values: List[float]) -> Tuple[float, float]:
    n = len(values)
    if n == 0:
        return 0.0, 0.0
    mu = sum(values) / n
    var = sum((v - mu) ** 2 for v in values) / n if n > 1 else 0.0
    return mu, math.sqrt(max(var, 0.0))


def _shift_days(iso: str, days: int) -> str:
    from datetime import date, timedelta
    try:
        d = date.fromisoformat(iso[:10])
    except ValueError:
        d = date.today()
    return (d + timedelta(days=days)).isoformat()
