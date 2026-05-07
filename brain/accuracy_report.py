"""
brain/accuracy_report.py
────────────────────────
Port of Margin_Analyzer.gs — Forensic grading of bet slips.

Matches Bet_Slips entries with Results_Clean snapshots and assigns:
  - Outcome: WIN / LOSS / PUSH / PENDING
  - Margin: Numerical difference
  - Points: Score points (if applicable)
"""

from __future__ import annotations
import logging
import math
from typing import Any, Dict, List, Optional, Tuple

from brain.utils import to_num, parse_score

log = logging.getLogger("brain.accuracy_report")


def grade_bet_slips(
    bet_slips: List[List[Any]],
    results: List[Dict[str, Any]],
) -> List[List[Any]]:
    """
    Grades a 2D array of bet slips against a list of results.
    Modifies the "Outcome" (col 14) and "Notes" (col 23) in place.
    """
    if not bet_slips or len(bet_slips) < 2:
        return bet_slips

    # Header map for bet slips
    from brain.contract_enforcer import BET_SLIPS_HEADERS
    hm = {h: i for i, h in enumerate(BET_SLIPS_HEADERS)}

    # Result map: match_key -> result_dict
    res_map = {r["match_key"]: r for r in results if r.get("match_key")}

    graded_count = 0
    for row in bet_slips[1:]:  # skip header
        if not any(str(c or "").strip() for c in row):
            continue
        if "────────────" in str(row[0]):
            continue

        home = str(row[hm["Home"]] or "").lower().strip()
        away = str(row[hm["Away"]] or "").lower().strip()
        match_key = f"{home} vs {away}".lower()

        res = res_map.get(match_key)
        if not res:
            row[hm["Outcome"]] = "PENDING"
            continue

        outcome, note = _grade_row(row, hm, res)
        row[hm["Outcome"]] = outcome
        row[hm["Notes"]] = note
        if outcome != "PENDING":
            graded_count += 1

    log.info(f"✅ Graded {graded_count} bets")
    return bet_slips


def _grade_row(row: List[Any], hm: Dict[str, int], res: Dict[str, Any]) -> Tuple[str, str]:
    """Grade a single row."""
    bet_type = row[hm["Type"]]
    pick = row[hm["Pick"]]
    side = row[hm["Selection_Side"]]
    line = to_num(row[hm["Selection_Line"]], 0)

    h_score = res.get("home_score")
    a_score = res.get("away_score")

    if h_score is None or a_score is None:
        return "PENDING", "No scores"

    # ── BANKER / ROBBER / 1H_1X2 (Moneyline/1X2) ──
    if bet_type in ("BANKER", "ROBBER", "1H_1X2"):
        target_h = h_score
        target_a = a_score
        if bet_type == "1H_1X2":
            target_h = res.get("1h_home")
            target_a = res.get("1h_away")
            if target_h is None or target_a is None:
                return "PENDING", "1H score missing"

        margin = target_h - target_a
        winner = 1 if margin > 0 else (2 if margin < 0 else 0)

        # pick 1 or 2
        pick_val = 1 if "1" in str(pick) or "HOME" in str(pick).upper() else (2 if "2" in str(pick) or "AWAY" in str(pick).upper() else 0)
        if pick_val == 0:
            return "ERROR", f"Invalid pick: {pick}"

        if winner == 0:
            return "LOSS", f"DRAW {target_h}-{target_a}"
        if winner == pick_val:
            return "WIN", f"{target_h}-{target_a}"
        return "LOSS", f"{target_h}-{target_a}"

    # ── SNIPER MARGIN (Quarter Spread) ──
    if bet_type == "SNIPER_MARGIN":
        q = row[hm["Quarter"]]
        qh = res.get(f"{q.lower()}_home")
        qa = res.get(f"{q.lower()}_away")
        if qh is None or qa is None:
            return "PENDING", f"{q} score missing"

        margin = qh - qa
        pick_side = 1 if "1" in str(side) or "HOME" in str(side).upper() else 2

        # Spread logic: Score + line (spread is for home usually, or for the side)
        # In our contract, Selection_Line is often the spread for that specific team.
        # If line is -3.5, team must win by 4.
        if pick_side == 1:
            diff = qh + line - qa
        else:
            diff = qa + line - qh

        if diff > 0: return "WIN", f"{qh}-{qa}"
        if diff < 0: return "LOSS", f"{qh}-{qa}"
        return "PUSH", f"{qh}-{qa}"

    # ── SNIPER OU / FT OU ──
    if bet_type in ("SNIPER_OU", "FT_OU"):
        q = row[hm["Quarter"]]
        total = res.get(f"{q.lower()}_total") if q != "FT" else res.get("total_score")
        if total is None:
            return "PENDING", f"{q} score missing"

        is_over = "OVER" in str(pick).upper() or "OVER" in str(side).upper()
        if is_over:
            if total > line: return "WIN", f"T:{total}"
            if total < line: return "LOSS", f"T:{total}"
            return "PUSH", f"T:{total}"
        else:
            if total < line: return "WIN", f"T:{total}"
            if total > line: return "LOSS", f"T:{total}"
            return "PUSH", f"T:{total}"

    # ── HIGH QUARTER ──
    if bet_type == "HIGH_QTR":
        qs = [res.get(f"q{i}_total") for i in range(1, 5)]
        if any(v is None for v in qs):
            return "PENDING", "Q scores missing"

        max_q = max(qs)
        winners = [f"Q{i+1}" for i, v in enumerate(qs) if v == max_q]
        if pick in winners:
            return "WIN", f"Qs: {qs}"
        return "LOSS", f"Qs: {qs}"

    return "PENDING", "Unknown type"
