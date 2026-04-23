"""
fetcher/parsers/bet_slips.py
────────────────────────────
Parse raw 2-D values from a satellite Bet_Slips tab into structured dicts.

Handles:
  - Title / metadata rows above the real header (scans first 20 rows).
  - Legacy 'Match' column  OR  split 'Home' + 'Away' columns.
  - All header aliases used by HiveMind (Confidence, EV, Tier, Outcome …).
  - Separator / summary rows (━━━, =====, "Total" rows etc.).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Header aliases  (mirrors HiveMind createHeaderMapWithAliases)
# ─────────────────────────────────────────────────────────────────────────────
_ALIASES: Dict[str, List[str]] = {
    "league":         ["league", "competition", "tournament", "league id", "league_id"],
    "date":           ["date", "game date", "match date", "event date"],
    "time":           ["time", "kickoff", "start time", "datetime"],
    "match":          ["match", "game", "matchup", "teams"],
    "home":           ["home", "home team", "home_team", "team1"],
    "away":           ["away", "away team", "away_team", "team2"],
    "pick":           ["pick", "selection", "bet", "prediction", "selection_text"],
    "type":           ["type", "bet type", "bettype", "category"],
    "market":         ["market"],
    "quarter":        ["quarter", "qtr", "period"],
    "odds":           ["odds", "price", "decimal odds"],
    "confidence":     ["confidence", "conf", "conf%", "probability", "prob",
                       "confidence_pct", "confidence pct", "confidence/info"],
    "ev":             ["ev", "expected value", "expectedvalue", "value"],
    "tier":           ["tier", "tier_code", "risk tier", "risktier", "risk_tier",
                       "tier display"],
    "outcome":        ["outcome", "result", "win/loss", "w/l", "hit"],
    "selection_side": ["selection_side"],
    "selection_team": ["selection_team"],
    "selection_line": ["selection_line", "line"],
}

_SEP_RE    = re.compile(r"^[-=━✦•\s]+$")
_SUMMARY_T = {"summary", "total", "totals", "grand total", "subtotal"}


def _build_header_map(header_row: List[Any]) -> Dict[str, int]:
    hm: Dict[str, int] = {}
    for i, cell in enumerate(header_row):
        raw = str(cell or "").strip().lower()
        if not raw:
            continue
        hm.setdefault(raw, i)
        for canonical, aliases in _ALIASES.items():
            if raw in aliases:
                hm.setdefault(canonical, i)
    return hm


def _get(row: List[Any], hm: Dict[str, int], *keys: str) -> str:
    for k in keys:
        idx = hm.get(k)
        if idx is not None and idx < len(row):
            v = str(row[idx] or "").strip()
            if v:
                return v
    return ""


def _parse_outcome(val: str) -> Optional[str]:
    v = val.strip().lower()
    if v in ("win", "w", "1", "yes", "correct", "hit", "true"):
        return "win"
    if v in ("loss", "lose", "l", "0", "no", "wrong", "miss", "false"):
        return "loss"
    return None


def parse_bet_slips(raw_values: List[List[Any]]) -> List[Dict[str, Any]]:
    """
    Parse raw 2-D Bet_Slips values into a list of structured dicts.

    Each returned dict has at minimum:
        league, date, time, match, home, away,
        pick, type, market, quarter,
        odds, confidence, ev, tier,
        outcome (\"win\" | \"loss\" | None), outcome_raw,
        selection_side, selection_team, selection_line
    """
    if not raw_values or len(raw_values) < 2:
        return []

    # Find the real header row (scan up to row 20)
    header_idx = -1
    for scan in range(min(20, len(raw_values))):
        rs = [str(c or "").strip().lower() for c in raw_values[scan]]
        has_teams = ("match" in rs or "game" in rs
                     or ("home" in rs and "away" in rs))
        has_pick  = any(x in rs for x in ("pick", "selection", "selection_text"))
        if has_teams and has_pick:
            header_idx = scan
            break
    if header_idx == -1:
        return []

    hm  = _build_header_map(raw_values[header_idx])
    out: List[Dict[str, Any]] = []

    for row in raw_values[header_idx + 1:]:
        if not any(str(c or "").strip() for c in row):
            continue  # blank row

        # Build match string
        match_str = _get(row, hm, "match", "game")
        home_str  = _get(row, hm, "home")
        away_str  = _get(row, hm, "away")

        if not match_str and home_str and away_str:
            match_str = f"{home_str} vs {away_str}"
        if not match_str:
            continue

        # Skip separators / summary rows
        if _SEP_RE.match(match_str):
            continue
        if any(t in match_str.lower() for t in _SUMMARY_T):
            if not _get(row, hm, "pick", "selection_text"):
                continue
        if "━" in match_str or "===" in match_str:
            continue

        pick = _get(row, hm, "pick", "selection_text", "selection")
        if not pick:
            continue

        outcome_raw = _get(row, hm, "outcome", "result")
        outcome     = _parse_outcome(outcome_raw)

        out.append({
            "league":         _get(row, hm, "league"),
            "date":           _get(row, hm, "date"),
            "time":           _get(row, hm, "time"),
            "match":          match_str,
            "home":           home_str or match_str.split(" vs ")[0].strip(),
            "away":           away_str or (match_str.split(" vs ")[-1].strip()
                                          if " vs " in match_str else ""),
            "pick":           pick,
            "type":           _get(row, hm, "type"),
            "market":         _get(row, hm, "market"),
            "quarter":        _get(row, hm, "quarter"),
            "odds":           _get(row, hm, "odds"),
            "confidence":     _get(row, hm, "confidence"),
            "ev":             _get(row, hm, "ev"),
            "tier":           _get(row, hm, "tier"),
            "outcome":        outcome,
            "outcome_raw":    outcome_raw,
            "selection_side": _get(row, hm, "selection_side"),
            "selection_team": _get(row, hm, "selection_team"),
            "selection_line": _get(row, hm, "selection_line", "line"),
        })

    return out
