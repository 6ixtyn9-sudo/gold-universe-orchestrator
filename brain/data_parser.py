"""
brain/data_parser.py
────────────────────
Port of Data_Parser.gs — Parses raw 2D snapshot values from Supabase
into structured Python objects.

Handles all tab variants:
  - UpcomingClean / Upcoming_Clean
  - ResultsClean / Results_Clean
  - Bet_Slips / BetSlips
  - Config_Tier2
  - LeagueQuarterO_U_Stats
"""

from __future__ import annotations
import re
import logging
from typing import Any, Dict, List, Optional

from brain.utils import (
    build_header_map, get_col, to_num, parse_conf_pct,
    parse_score, format_date, format_time, parse_ou_signal,
    normalize_header,
)

log = logging.getLogger("brain.data_parser")


# ─────────────────────────────────────────────────────────────────────────
# Header alias maps (mirrors HiveMind createHeaderMapWithAliases)
# ─────────────────────────────────────────────────────────────────────────

_UPCOMING_ALIASES: Dict[str, List[str]] = {
    "league":     ["league", "competition", "tournament", "league_id"],
    "date":       ["date", "game date", "match date", "event date"],
    "time":       ["time", "kickoff", "start time"],
    "home":       ["home", "home team", "home_team", "team1"],
    "away":       ["away", "away team", "away_team", "team2"],
    "home_odds":  ["home odds", "home_odds", "odds_home", "h_odds", "1", "odds"],
    "away_odds":  ["away odds", "away_odds", "odds_away", "a_odds", "2"],
    "spread":     ["spread", "handicap", "line", "pts spread"],
    "total":      ["total", "o/u", "over/under", "ou_line", "game total", "avg"],
    "prediction": ["prediction", "pred", "pick", "forecast"],
    # 'Prob %' in real satellites = 'HH - AA' format, e.g. '61 - 39'
    "confidence": ["confidence", "conf", "conf%", "probability", "prob", "prob %"],
    "ev":         ["ev", "expected value"],
    "home_form":  ["home form", "home_form", "h_form"],
    "away_form":  ["away form", "away_form", "a_form"],
    # Quarter totals
    "q1_total":   ["q1", "quarter 1", "1st quarter"],
    "q2_total":   ["q2", "quarter 2", "2nd quarter"],
    "q3_total":   ["q3", "quarter 3", "3rd quarter"],
    "q4_total":   ["q4", "quarter 4", "4th quarter"],
    # OU signals (real column names from production)
    "ou_q1":      ["ou-q1", "ou_q1", "q1_ou", "q1 o/u"],
    "ou_q2":      ["ou-q2", "ou_q2", "q2_ou", "q2 o/u"],
    "ou_q3":      ["ou-q3", "ou_q3", "q3_ou", "q3 o/u"],
    "ou_q4":      ["ou-q4", "ou_q4", "q4_ou", "q4 o/u"],
    "ou_q1_conf": ["ou-q1-conf", "ou_q1_conf"],
    "ou_q2_conf": ["ou-q2-conf", "ou_q2_conf"],
    "ou_q3_conf": ["ou-q3-conf", "ou_q3_conf"],
    "ou_q4_conf": ["ou-q4-conf", "ou_q4_conf"],
    "ou_q1_ev":   ["ou-q1-ev", "ou_q1_ev"],
    "ou_q2_ev":   ["ou-q2-ev", "ou_q2_ev"],
    "ou_q3_ev":   ["ou-q3-ev", "ou_q3_ev"],
    "ou_q4_ev":   ["ou-q4-ev", "ou_q4_ev"],
    "ou_q1_edge": ["ou-q1-edge", "ou_q1_edge"],
    "ou_q2_edge": ["ou-q2-edge", "ou_q2_edge"],
    "ou_q3_edge": ["ou-q3-edge", "ou_q3_edge"],
    "ou_q4_edge": ["ou-q4-edge", "ou_q4_edge"],
    # Enhanced signals
    "enh_1h":        ["enh-1h"],
    "enh_1h_conf":   ["enh-1h-conf"],
    "enh_high_q":    ["enh-high-q"],
    "enh_high_q_conf": ["enh-high-q-conf"],
    "ou_best":       ["ou-best"],
    "ou_best_conf":  ["ou-best-conf"],
    "ou_best_ev":    ["ou-best-ev"],
    "ou_best_edge":  ["ou-best-edge"],
    "ou_best_q":     ["ou-best-q"],
    "ou_best_dir":   ["ou-best-dir"],
}

_RESULTS_ALIASES: Dict[str, List[str]] = {
    "league":      ["league", "competition"],
    "date":        ["date", "game date"],
    "home":        ["home", "home team", "home_team"],
    "away":        ["away", "away team", "away_team"],
    "home_score":  ["home score", "home_score", "h_score", "home_pts"],
    "away_score":  ["away score", "away_score", "a_score", "away_pts"],
    "final_score": ["final score", "final_score", "score", "result"],
    "total_score": ["total score", "total_score", "total points", "total"],
    "q1":          ["q1", "quarter 1", "1st quarter", "q1_score"],
    "q2":          ["q2", "quarter 2", "2nd quarter", "q2_score"],
    "q3":          ["q3", "quarter 3", "3rd quarter", "q3_score"],
    "q4":          ["q4", "quarter 4", "4th quarter", "q4_score"],
    "1h":          ["1h", "first half", "1st half", "1h_score"],
    "2h":          ["2h", "second half", "2nd half", "2h_score"],
}

_SEP_RE = re.compile(r"^[\-=━✦•\s]+$")
_SUMMARY_TERMS = {"summary", "total", "totals", "grand total", "subtotal"}


# ─────────────────────────────────────────────────────────────────────────
# Enhanced Header Map with Aliases
# ─────────────────────────────────────────────────────────────────────────

def _build_aliased_header_map(
    header_row: List[Any], aliases: Dict[str, List[str]]
) -> Dict[str, int]:
    """Build header map with canonical alias resolution."""
    hm = build_header_map(header_row)

    for canonical, alias_list in aliases.items():
        for alias in alias_list:
            idx = hm.get(alias.lower()) or hm.get(normalize_header(alias))
            if idx is not None:
                hm.setdefault(canonical, idx)
                break
    return hm


def _is_skip_row(row: List[Any], hm: Dict[str, int]) -> bool:
    """Check if row is a separator, banner, or summary row."""
    if not any(str(c or "").strip() for c in row):
        return True  # blank row
    first = str(row[0] or "").strip()
    if _SEP_RE.match(first):
        return True
    if "━" in first or "===" in first:
        return True
    if first.lower() in _SUMMARY_TERMS:
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────
# UpcomingClean Parser
# ─────────────────────────────────────────────────────────────────────────

def parse_upcoming_clean(raw_values: List[List[Any]]) -> List[Dict[str, Any]]:
    """
    Parse raw 2D UpcomingClean values into structured game dicts.
    Handles real production column names including 'Prob %', 'Pred', 'ou-q*' etc.
    """
    if not raw_values or len(raw_values) < 2:
        return []

    # Find header row (scan first 10 rows)
    header_idx = _find_header_row(raw_values, ["home", "away"], ["prediction", "pred", "pick"])
    if header_idx == -1:
        # Try without prediction requirement
        header_idx = _find_header_row(raw_values, ["home", "away"], ["league", "date"])

    if header_idx == -1:
        log.warning("UpcomingClean: no header row found")
        return []

    hm = _build_aliased_header_map(raw_values[header_idx], _UPCOMING_ALIASES)
    games = []

    for row in raw_values[header_idx + 1:]:
        if _is_skip_row(row, hm):
            continue

        home = get_col(row, hm, "home")
        away = get_col(row, hm, "away")
        if not home or not away:
            continue

        # Parse confidence from "Prob %" column: "61 - 39" → 61.0
        raw_conf = get_col(row, hm, "confidence")
        confidence = _parse_prob_pct(raw_conf)

        # Parse home_odds from "Odds" column (single value = home odds in this schema)
        home_odds_raw = get_col(row, hm, "home_odds")
        away_odds_raw = get_col(row, hm, "away_odds")
        home_odds = to_num(home_odds_raw, None)
        away_odds = to_num(away_odds_raw, None)

        # Quarter total lines (used as OU line for sniper bets)
        q_totals = {}
        for q in range(1, 5):
            v = get_col(row, hm, f"q{q}_total")
            if v:
                q_totals[f"q{q}_total"] = to_num(v, None)

        game = {
            "league":     get_col(row, hm, "league"),
            "date":       format_date(get_col(row, hm, "date")),
            "time":       format_time(get_col(row, hm, "time")),
            "home":       home,
            "away":       away,
            "home_odds":  home_odds,
            "away_odds":  away_odds,
            "spread":     to_num(get_col(row, hm, "spread"), None),
            "total":      to_num(get_col(row, hm, "total"), None),
            "prediction": get_col(row, hm, "prediction"),
            "confidence": confidence,
            "ev":         to_num(get_col(row, hm, "ev"), None),
            "home_form":  get_col(row, hm, "home_form"),
            "away_form":  get_col(row, hm, "away_form"),
            "match_key":  f"{home} vs {away}".lower(),
            **q_totals,
        }

        # Capture per-quarter O/U signals using aliased hm keys
        for q in range(1, 5):
            val = get_col(row, hm, f"ou_q{q}")
            if val:
                game[f"ou_q{q}"] = parse_ou_signal(val) or val
            for suffix in ["ev", "edge", "conf"]:
                sv = get_col(row, hm, f"ou_q{q}_{suffix}")
                if sv:
                    game[f"ou_q{q}_{suffix}"] = to_num(sv, None)

        # Enhanced 1H signal
        enh_1h = get_col(row, hm, "enh_1h")
        enh_1h_conf = get_col(row, hm, "enh_1h_conf")
        if enh_1h:
            game["enh_1h"] = enh_1h
            game["enh_1h_conf"] = parse_conf_pct(enh_1h_conf)

        # Enhanced highest-quarter signal
        enh_hq = get_col(row, hm, "enh_high_q")
        enh_hq_conf = get_col(row, hm, "enh_high_q_conf")
        if enh_hq:
            game["enh_high_q"] = enh_hq
            game["enh_high_q_conf"] = parse_conf_pct(enh_hq_conf)

        # Best OU pick (pre-computed best across all quarters)
        best_ou = get_col(row, hm, "ou_best")
        if best_ou:
            game["ou_best"] = best_ou
            game["ou_best_conf"] = parse_conf_pct(get_col(row, hm, "ou_best_conf"))
            game["ou_best_ev"] = to_num(get_col(row, hm, "ou_best_ev"), None)
            game["ou_best_edge"] = to_num(get_col(row, hm, "ou_best_edge"), None)
            game["ou_best_q"] = get_col(row, hm, "ou_best_q")
            game["ou_best_dir"] = get_col(row, hm, "ou_best_dir")

        games.append(game)

    log.info(f"UpcomingClean: parsed {len(games)} games")
    return games


def _parse_prob_pct(raw: Any) -> Optional[float]:
    """
    Parse various confidence formats from UpcomingClean:
      - "61 - 39" → 61.0  (home - away prob split)
      - "78%"     → 78.0
      - "0.78"    → 78.0
      - None      → None
    """
    if raw is None or str(raw).strip() == "":
        return None
    s = str(raw).strip()
    # "HH - AA" format — take the first number
    if " - " in s:
        parts = s.split(" - ")
        v = to_num(parts[0].strip(), None)
        return v  # Already in percentage form (61 not 0.61)
    # Standard pct/decimal
    return parse_conf_pct(s)



# ─────────────────────────────────────────────────────────────────────────
# ResultsClean Parser
# ─────────────────────────────────────────────────────────────────────────

def parse_results_clean(raw_values: List[List[Any]]) -> List[Dict[str, Any]]:
    """
    Parse raw 2D ResultsClean values into structured result dicts.
    """
    if not raw_values or len(raw_values) < 2:
        return []

    header_idx = _find_header_row(raw_values, ["home", "away"], ["score", "result", "home_score", "home score"])
    if header_idx == -1:
        log.warning("ResultsClean: no header row found")
        return []

    hm = _build_aliased_header_map(raw_values[header_idx], _RESULTS_ALIASES)
    results = []

    for row in raw_values[header_idx + 1:]:
        if _is_skip_row(row, hm):
            continue

        home = get_col(row, hm, "home")
        away = get_col(row, hm, "away")
        if not home or not away:
            continue

        # Try to get scores from individual columns or combined "score" column
        home_score = to_num(get_col(row, hm, "home_score"), None)
        away_score = to_num(get_col(row, hm, "away_score"), None)

        if home_score is None or away_score is None:
            final = get_col(row, hm, "final_score")
            parsed = parse_score(final)
            if parsed:
                home_score, away_score = parsed

        # Parse quarter scores
        quarters = {}
        for q in range(1, 5):
            q_val = get_col(row, hm, f"q{q}")
            if q_val:
                q_parsed = parse_score(q_val)
                if q_parsed:
                    quarters[f"q{q}_home"] = q_parsed[0]
                    quarters[f"q{q}_away"] = q_parsed[1]
                    quarters[f"q{q}_total"] = q_parsed[0] + q_parsed[1]
                else:
                    quarters[f"q{q}_total"] = to_num(q_val, None)

        # Parse half scores
        for h in ["1h", "2h"]:
            h_val = get_col(row, hm, h)
            if h_val:
                h_parsed = parse_score(h_val)
                if h_parsed:
                    quarters[f"{h}_home"] = h_parsed[0]
                    quarters[f"{h}_away"] = h_parsed[1]
                    quarters[f"{h}_total"] = h_parsed[0] + h_parsed[1]

        result = {
            "league":      get_col(row, hm, "league"),
            "date":        format_date(get_col(row, hm, "date")),
            "home":        home,
            "away":        away,
            "home_score":  home_score,
            "away_score":  away_score,
            "total_score": (home_score + away_score) if home_score is not None and away_score is not None else None,
            "match_key":   f"{home} vs {away}".lower(),
            **quarters,
        }
        results.append(result)

    log.info(f"ResultsClean: parsed {len(results)} results")
    return results


# ─────────────────────────────────────────────────────────────────────────
# Config_Tier2 Parser
# ─────────────────────────────────────────────────────────────────────────

def parse_config_tier2(raw_values: List[List[Any]]) -> Dict[str, Any]:
    """
    Parse Config_Tier2 sheet — typically key-value pairs.
    Returns a dict of configuration settings.
    """
    cfg: Dict[str, Any] = {}
    if not raw_values:
        return cfg

    for row in raw_values:
        if len(row) < 2:
            continue
        key = normalize_header(row[0])
        val = row[1]
        if key:
            cfg[key] = val

    return cfg


# ─────────────────────────────────────────────────────────────────────────
# Accumulator Config Loader (Port of loadAccumulatorConfig)
# ─────────────────────────────────────────────────────────────────────────

def load_accumulator_config(config_tier2: Dict[str, Any]) -> Dict[str, Any]:
    """
    Port of loadAccumulatorConfig from Contract_Enforcement.gs.
    Reads tuning parameters from Config_Tier2 data.
    """
    def get(key, default=None):
        for k in [key, normalize_header(key)]:
            if k in config_tier2:
                return config_tier2[k]
        return default

    return {
        "bankerThreshold":      to_num(get("banker_threshold", get("bankerthreshold", 65))),
        "sniperMinMargin":      to_num(get("sniper_min_margin", get("sniperminmargin", 3.0))),
        "maxSnipersPerGame":    to_num(get("max_snipers_per_game", get("maxsniperspergame", 3))),
        "ouMinConf":            to_num(get("ou_min_conf", get("ouminconf", 55))),
        "ouMinEV":              to_num(get("ou_min_ev", get("ouminev", 0.02))),
        "minEdgeScore":         to_num(get("min_edge_score", get("minedgescore", 1.0))),
        "includeOUSignals":     get("include_ou", get("includeousignals", True)),
        "includeHighestQuarter": get("include_hq", get("includehighestquarter", True)),
        "enableRobbers":        get("enable_robbers", get("enablerobbers", True)),
        "enableFirstHalf":      get("enable_1h", get("enablefirsthalf", True)),
        "enableFTOU":           get("enable_ftou", get("enableftou", True)),
        "hqMinConfidence":      to_num(get("hq_min_conf", get("hqminconfidence", 55))),
        "preferStrongTier":     get("prefer_strong_tier", get("preferstrongtier", True)),
        # Tier thresholds
        "even_target":          to_num(get("even_target", 55)),
        "medium_target":        to_num(get("medium_target", 65)),
        "strong_target":        to_num(get("strong_target", 75)),
    }


# ─────────────────────────────────────────────────────────────────────────
# Internal Helpers
# ─────────────────────────────────────────────────────────────────────────

def _find_header_row(
    raw_values: List[List[Any]],
    required_any: List[str],
    also_any: List[str],
    max_scan: int = 20,
) -> int:
    """Scan first N rows to find the header row."""
    for scan in range(min(max_scan, len(raw_values))):
        row_strs = [str(c or "").strip().lower() for c in raw_values[scan]]
        row_norm = [normalize_header(c) for c in raw_values[scan]]
        all_strs = set(row_strs) | set(row_norm)

        has_required = any(r in all_strs for r in required_any)
        has_also = any(a in all_strs for a in also_any)

        if has_required and has_also:
            return scan

    return -1
