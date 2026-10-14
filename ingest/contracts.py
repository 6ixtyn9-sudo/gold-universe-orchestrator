"""
ingest/contracts.py
───────────────────
The tab contract.

This module converts canonical models (ingest/models.py) into the **exact**
2-D array shape that every existing consumer in this repo already parses:

  * brain/data_parser.py            parse_upcoming_clean / parse_results_clean / parse_standings
  * fetcher/parsers/*.py            parse_upcoming_clean / parse_results_clean / parse_game_log_table / parse_standings
  * assayer/smoke_assay.py          reads core__<tab>.json bundles

The header fingerprints below were taken from the live fleet
(registry/upcomingclean_schema_audit.json — "league|game type|home|away|date|
time|prob %|pred|...").  Keeping them byte-compatible is the whole point:
it means the Brain, Assayer and Mothership need **zero** changes to work
on API-sourced data instead of sheet-sourced data.

Anything that produces a tab here can therefore feed the existing universe
without a single edit downstream.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ingest.models import Fixture, GameResult, StandingRow

# ─────────────────────────────────────────────────────────────────────────
# Tab names (kept identical to the sheet tab names — not one rename)
# ─────────────────────────────────────────────────────────────────────────

TAB_UPCOMING = "UpcomingClean"
TAB_RESULTS = "ResultsClean"
TAB_STANDINGS = "Standings"
TAB_LEAGUE_QUARTER = "LeagueQuarterO_U_Stats"
TAB_TEAM_QUARTER = "TeamQuarterStats_Tier2"
TAB_CONFIG = "Config_Tier2"
TAB_STATS = "Stats"

TAB_H2H_TMPL = "CleanH2H_{n}"
TAB_RECENT_HOME_TMPL = "CleanRecentHome_{n}"
TAB_RECENT_AWAY_TMPL = "CleanRecentAway_{n}"


# ─────────────────────────────────────────────────────────────────────────
# Headers
# ─────────────────────────────────────────────────────────────────────────

# Superset of the two live UpcomingClean fingerprints observed in the fleet,
# preserving the production column order so the output stays human-diffable
# against a real satellite.
UPCOMING_HEADER: List[str] = [
    "league", "game type", "home", "away", "date", "time",
    "prob %", "prob pair", "pred", "pred score", "avg", "odds",
    "home odds", "away odds",
    "q1", "q2", "q3", "q4", "ot", "status", "ft score",
    # tier-1 side signals
    "t1-q1", "t1-q1-conf", "t1-q2", "t1-q2-conf",
    "t1-q3", "t1-q3-conf", "t1-q4", "t1-q4-conf",
    # tier-2 quarter O/U signals
    "t2-q1", "t2-q1-conf", "t2-q1-line", "t2-q2", "t2-q2-conf", "t2-q2-line",
    "t2-q3", "t2-q3-conf", "t2-q3-line", "t2-q4", "t2-q4-conf", "t2-q4-line",
    "t2-edge-score",
    # full-time O/U signal + per-quarter O/U with edge/push
    "ou-game", "ou-game-tier",
    "ou-q1", "ou-q1-conf", "ou-q1-ev", "ou-q1-edge", "ou-q1-push",
    "ou-q2", "ou-q2-conf", "ou-q2-ev", "ou-q2-edge", "ou-q2-push",
    "ou-q3", "ou-q3-conf", "ou-q3-ev", "ou-q3-edge", "ou-q3-push",
    "ou-q4", "ou-q4-conf", "ou-q4-ev", "ou-q4-edge", "ou-q4-push",
    "ou-best", "ou-best-q", "ou-best-conf", "ou-best-ev", "ou-best-edge",
    "ou-best-dir", "ou-edge-score", "ou-highest", "ou-highest-est",
    "ou-fb-used", "ou-bayesian-used",
    # enhancement layer
    "enh-high-q", "enh-high-q-conf", "enh-1h", "enh-1h-conf",
    "enh-high-q-pq1", "enh-high-q-pq2", "enh-high-q-pq3", "enh-high-q-pq4",
    "enh-high-q-pwin",
    # provenance — so we can always tell where a row came from
    "source", "source_ref", "ingested_at",
]

# Two column dialects are emitted on purpose:
#   q1h/q1a pairs          → fetcher/parsers/results_clean.py and smoke_assay.py
#   q1..q4 combined totals → brain/data_parser.parse_results_clean (_RESULTS_ALIASES)
# Before this, brain's ResultsClean parser silently dropped every quarter split
# because its alias map only knew the combined form.
RESULTS_HEADER: List[str] = [
    "league", "game type", "date", "time", "home", "away",
    "q1h", "q1a", "q2h", "q2a", "q3h", "q3a", "q4h", "q4a", "oth", "ota",
    "fth", "fta", "ft", "home score", "away score", "total", "status",
    "q1", "q2", "q3", "q4", "1h", "2h",
    "source", "source_ref", "ingested_at",
]

# Column names are contract-locked: fetcher/parsers/game_logs.py matches them
# by lowercased exact key ("q1h", "totalh", "ft" ...).
GAME_LOG_HEADER: List[str] = [
    "Date", "Home", "Away",
    "Q1H", "Q1A", "Q2H", "Q2A", "Q3H", "Q3A", "Q4H", "Q4A", "OTH", "OTA",
    "Winner", "TotalH", "TotalA", "FT", "SumMismatch",
]

STANDINGS_HEADER: List[str] = [
    "Position", "Team", "GP", "W", "L", "PCT",
    "PF", "PA", "Streak", "L10", "Home", "Away", "Source",
]

QUARTER_HEADER: List[str] = [
    "Team", "League", "Sample_N",
    "Q1_MU", "Q2_MU", "Q3_MU", "Q4_MU",
    "Q1_SIGMA", "Q2_SIGMA", "Q3_SIGMA", "Q4_SIGMA",
]


# ─────────────────────────────────────────────────────────────────────────
# Formatting helpers
# ─────────────────────────────────────────────────────────────────────────

def _sum_pair(a: Optional[int], b: Optional[int]) -> int:
    return int(a or 0) + int(b or 0)


def _fmt_num(v: Optional[float], digits: int = 2) -> Any:
    if v is None:
        return ""
    return round(float(v), digits)


def _fmt_int(v: Optional[int]) -> Any:
    return "" if v is None else int(v)


def format_prob_pair(home_prob: Optional[float], away_prob: Optional[float]) -> str:
    """
    "61 - 39" — the split form the fleet's sheets historically carried.

    Emitted in the informational 'prob pair' column rather than 'prob %',
    because brain/data_parser accepts either form while
    fetcher/parsers/upcoming_clean.py can only read a plain number.  Writing
    the number in 'prob %' therefore keeps *both* consumers correct, and the
    pair is preserved for human review and diffing against old sheets.
    """
    if home_prob is None:
        return ""
    away = away_prob if away_prob is not None else max(0.0, 100.0 - float(home_prob))
    return f"{round(float(home_prob))} - {round(float(away))}"


def _date_cell(iso: str) -> str:
    return (iso or "").strip()


# ─────────────────────────────────────────────────────────────────────────
# UpcomingClean
# ─────────────────────────────────────────────────────────────────────────

def upcoming_row(fixture: Fixture, enriched: Optional[Dict[str, Any]] = None) -> List[Any]:
    """
    Build one UpcomingClean row.

    `enriched` carries the columns the prediction engine computes locally
    (t1-*, t2-*, ou-*, ou-best*, enh-*) — those are filled in by
    ingest/predict.py, which wraps the existing brain/ modules.  When it is
    omitted the row is still valid and parseable; the computed columns are
    simply blank, exactly like a freshly-pasted raw satellite row.
    """
    e: Dict[str, Any] = dict(enriched or {})
    ft_h, ft_a = e.get("ft_h"), e.get("ft_a")
    ft_cell = ""
    if ft_h is not None and ft_a is not None:
        ft_cell = f"{ft_h}-{ft_a}"

    row: List[Any] = [
        fixture.league_display or fixture.league_key,
        fixture.game_type,
        fixture.home,
        fixture.away,
        _date_cell(fixture.date),
        fixture.time,
        _fmt_num(fixture.home_prob, 1),
        format_prob_pair(fixture.home_prob, fixture.away_prob),
        fixture.pick_side,
        e.get("pred_score", ""),
        _fmt_num(fixture.expected_total),
        _fmt_num(e.get("odds_pick") if e.get("odds_pick") is not None else fixture.odds_home),
        _fmt_num(fixture.odds_home),
        _fmt_num(fixture.odds_away),
        _fmt_num(e.get("q1_total")),
        _fmt_num(e.get("q2_total")),
        _fmt_num(e.get("q3_total")),
        _fmt_num(e.get("q4_total")),
        _fmt_num(e.get("ot_total")),
        e.get("status") or fixture.status,
        ft_cell,
    ]

    # t1-* (first-half / tier-1 quarter side signals)
    for q in ("q1", "q2", "q3", "q4"):
        row.append(e.get(f"t1_{q}", ""))
        row.append(_fmt_num(e.get(f"t1_{q}_conf")))

    # t2-* (tier-2 quarter O/U)
    for q in ("q1", "q2", "q3", "q4"):
        row.append(e.get(f"t2_{q}", ""))
        row.append(_fmt_num(e.get(f"t2_{q}_conf")))
        row.append(_fmt_num(e.get(f"t2_{q}_line")))
    row.append(_fmt_num(e.get("t2_edge_score")))

    # Full-game O/U
    row.append(e.get("ou_game", ""))
    row.append(e.get("ou_game_tier", ""))

    # Per-quarter O/U
    for q in ("q1", "q2", "q3", "q4"):
        row.append(e.get(f"ou_{q}", ""))
        row.append(_fmt_num(e.get(f"ou_{q}_conf")))
        row.append(_fmt_num(e.get(f"ou_{q}_ev")))
        row.append(_fmt_num(e.get(f"ou_{q}_edge")))
        row.append(_fmt_num(e.get(f"ou_{q}_push")))

    # Best O/U across quarters
    row.append(e.get("ou_best", ""))
    row.append(e.get("ou_best_q", ""))
    row.append(_fmt_num(e.get("ou_best_conf")))
    row.append(_fmt_num(e.get("ou_best_ev")))
    row.append(_fmt_num(e.get("ou_best_edge")))
    row.append(e.get("ou_best_dir", ""))
    row.append(_fmt_num(e.get("ou_edge_score")))
    row.append(e.get("ou_highest", ""))
    row.append(_fmt_num(e.get("ou_highest_est")))
    row.append(e.get("ou_fb_used", ""))
    row.append(e.get("ou_bayesian_used", ""))

    # Enhancement layer
    row.append(e.get("enh_high_q", ""))
    row.append(_fmt_num(e.get("enh_high_q_conf")))
    row.append(e.get("enh_1h", ""))
    row.append(_fmt_num(e.get("enh_1h_conf")))
    for k in ("enh_high_q_pq1", "enh_high_q_pq2", "enh_high_q_pq3", "enh_high_q_pq4"):
        row.append(_fmt_num(e.get(k)))
    row.append(_fmt_num(e.get("enh_high_q_pwin")))

    # Provenance
    row.append(fixture.provider or "api")
    row.append(fixture.provider_fixture_id)
    row.append(e.get("ingested_at", ""))

    assert len(row) == len(UPCOMING_HEADER), (
        f"UpcomingClean row/header drift: {len(row)} != {len(UPCOMING_HEADER)}"
    )
    return row


def upcoming_table(rows: List[List[Any]]) -> List[List[Any]]:
    return [list(UPCOMING_HEADER)] + rows


# ─────────────────────────────────────────────────────────────────────────
# ResultsClean
# ─────────────────────────────────────────────────────────────────────────

def results_row(result: GameResult, ingested_at: str = "") -> List[Any]:
    ft_h, ft_a = result.ft_h, result.ft_a
    ft_cell = f"{ft_h}-{ft_a}" if ft_h is not None and ft_a is not None else ""
    total = None if ft_h is None or ft_a is None else ft_h + ft_a
    quarters = result.quarter_totals()
    first_half = _sum_pair(result.q1h, result.q1a) + _sum_pair(result.q2h, result.q2a)
    second_half = _sum_pair(result.q3h, result.q3a) + _sum_pair(result.q4h, result.q4a)

    row: List[Any] = [
        result.league_display or result.league_key,
        result.game_type,
        _date_cell(result.date),
        result.time,
        result.home,
        result.away,
        _fmt_int(result.q1h), _fmt_int(result.q1a),
        _fmt_int(result.q2h), _fmt_int(result.q2a),
        _fmt_int(result.q3h), _fmt_int(result.q3a),
        _fmt_int(result.q4h), _fmt_int(result.q4a),
        _fmt_int(result.oth), _fmt_int(result.ota),
        _fmt_int(ft_h), _fmt_int(ft_a),
        ft_cell,
        _fmt_int(ft_h), _fmt_int(ft_a),
        _fmt_int(total),
        result.status,
        _fmt_int(quarters.get("Q1")),
        _fmt_int(quarters.get("Q2")),
        _fmt_int(quarters.get("Q3")),
        _fmt_int(quarters.get("Q4")),
        _fmt_int(first_half),
        _fmt_int(second_half),
        result.provider or "api",
        result.provider_fixture_id,
        ingested_at,
    ]
    assert len(row) == len(RESULTS_HEADER), (
        f"ResultsClean row/header drift: {len(row)} != {len(RESULTS_HEADER)}"
    )
    return row


def results_table(rows: List[List[Any]]) -> List[List[Any]]:
    return [list(RESULTS_HEADER)] + rows


# ─────────────────────────────────────────────────────────────────────────
# Game logs: CleanH2H_n / CleanRecentHome_n / CleanRecentAway_n
# ─────────────────────────────────────────────────────────────────────────

def game_log_row(result: GameResult) -> List[Any]:
    ft_h, ft_a = result.ft_h, result.ft_a
    ft_cell = f"{ft_h}-{ft_a}" if ft_h is not None and ft_a is not None else ""
    return [
        _date_cell(result.date),
        result.home,
        result.away,
        _fmt_int(result.q1h), _fmt_int(result.q1a),
        _fmt_int(result.q2h), _fmt_int(result.q2a),
        _fmt_int(result.q3h), _fmt_int(result.q3a),
        _fmt_int(result.q4h), _fmt_int(result.q4a),
        _fmt_int(result.oth), _fmt_int(result.ota),
        result.winner_side,
        _fmt_int(ft_h), _fmt_int(ft_a),
        ft_cell,
        result.sum_mismatch(),
    ]


def game_log_table(results: List[GameResult]) -> List[List[Any]]:
    return [list(GAME_LOG_HEADER)] + [game_log_row(r) for r in results]


# ─────────────────────────────────────────────────────────────────────────
# Standings
# ─────────────────────────────────────────────────────────────────────────

def standings_table(rows: List[StandingRow]) -> List[List[Any]]:
    """
    Emits section rows ('East') followed by a full header, because
    brain/data_parser.parse_standings treats a single-cell row as a
    section label and re-reads the header after it.
    """
    out: List[List[Any]] = [list(STANDINGS_HEADER)]
    last_section = None
    by_section: Dict[str, List[StandingRow]] = {}
    for r in rows:
        by_section.setdefault(r.section or "", []).append(r)

    for section, section_rows in by_section.items():
        if section and section != last_section:
            out.append([section])
            out.append(list(STANDINGS_HEADER))
            last_section = section
        for r in section_rows:
            out.append([
                r.position,
                r.team,
                _fmt_int(r.gp),
                _fmt_int(r.w),
                _fmt_int(r.l),
                _fmt_num(r.pct, 3),
                _fmt_num(r.pf),
                _fmt_num(r.pa),
                r.streak,
                r.l10,
                r.home_record,
                r.away_record,
                "api",
            ])
    return out


# ─────────────────────────────────────────────────────────────────────────
# Quarter profiles
# ─────────────────────────────────────────────────────────────────────────

def quarter_table(profiles: List[Any]) -> List[List[Any]]:
    out: List[List[Any]] = [list(QUARTER_HEADER)]
    for p in profiles:
        row = [
            p.team,
            p.league_display if hasattr(p, "league_display") else p.league_key,
            p.sample_n,
            _fmt_num(p.q_mu.get("Q1")),
            _fmt_num(p.q_mu.get("Q2")),
            _fmt_num(p.q_mu.get("Q3")),
            _fmt_num(p.q_mu.get("Q4")),
            _fmt_num(p.q_sigma.get("Q1")),
            _fmt_num(p.q_sigma.get("Q2")),
            _fmt_num(p.q_sigma.get("Q3")),
            _fmt_num(p.q_sigma.get("Q4")),
        ]
        out.append(row)
    return out


def config_table(kv: Dict[str, Any]) -> List[List[Any]]:
    """Config_Tier2 is a key/value sheet; parse_config_tier2 reads col0/col1."""
    out: List[List[Any]] = [["Key", "Value"]]
    for k, v in kv.items():
        out.append([k, v])
    return out
