"""
brain/contract_enforcer.py
──────────────────────────
Port of Contract_Enforcement.gs (Module 8) — The core Bet_Slips builder.

Takes processed game predictions and builds the canonical 25-column
Bet_Slips output array ready for sheet write-back.

Bet Types:
  - BANKER (Moneyline favorites)
  - ROBBER (Upset picks)
  - SNIPER MARGIN (Quarter spreads)
  - SNIPER O/U (Quarter over/under)
  - FIRST HALF 1X2
  - FT O/U (Full-time over/under)
  - HIGH_QTR (Highest scoring quarter)
"""

from __future__ import annotations
import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from brain.utils import (
    to_num, to_bool, parse_conf_pct, format_conf_pct,
    get_tier_object, get_tier_name, clamp,
    norm_ou_pick_key, parse_ou_signal,
)

log = logging.getLogger("brain.contract_enforcer")


# ─────────────────────────────────────────────────────────────────────────
# Bet_Slips 25-Column Contract (canonical order)
# ─────────────────────────────────────────────────────────────────────────

BET_SLIPS_HEADERS = [
    "Bet_Record_ID",       # 0
    "League",              # 1
    "Date",                # 2
    "Time",                # 3
    "Home",                # 4
    "Away",                # 5
    "Pick",                # 6
    "Type",                # 7  (BANKER/ROBBER/SNIPER_MARGIN/SNIPER_OU/1H_1X2/FT_OU/HIGH_QTR)
    "Market",              # 8
    "Quarter",             # 9
    "Odds",                # 10
    "Confidence",          # 11
    "EV",                  # 12
    "Tier",                # 13
    "Outcome",             # 14 (empty until graded)
    "Selection_Side",      # 15
    "Selection_Team",      # 16
    "Selection_Line",      # 17
    "Source_Module",        # 18 (M5/M6/M8/M9/M10)
    "Config_Stamp_ID",     # 19
    "Market_Line",         # 20
    "Edge_Score",          # 21
    "Stars",               # 22
    "Notes",               # 23
    "Created_At",          # 24
]

NUM_COLS = len(BET_SLIPS_HEADERS)


def build_bet_slips(
    games: List[Dict[str, Any]],
    config: Dict[str, Any],
    stamp_id: str,
) -> List[List[Any]]:
    """
    Main entry point: builds the complete Bet_Slips 2D array.

    Args:
        games: List of processed game dicts (from game_processor)
        config: Accumulator config dict
        stamp_id: Config stamp ID

    Returns:
        2D list: [header_row, ...data_rows] in 25-col contract format
    """
    now = datetime.now(timezone.utc).isoformat()
    rows: List[List[Any]] = []
    bet_id = 0
    seen_keys = set()  # For O/U duplicate detection

    for game in games:
        game_bets = _extract_bets_from_game(game, config, stamp_id, now)

        for bet in game_bets:
            # Duplicate detection for O/U
            if bet.get("_dedup_key"):
                if bet["_dedup_key"] in seen_keys:
                    continue
                seen_keys.add(bet["_dedup_key"])

            bet_id += 1
            row = _bet_to_row(bet, bet_id)
            rows.append(row)

    # Sort: Stars descending, then by tier weight, then HIGH_QTR last
    rows.sort(key=_sort_key, reverse=True)

    # Add separator banner at top
    banner = _make_banner()
    result = [BET_SLIPS_HEADERS] + banner + rows

    log.info(f"📋 Built {len(rows)} bet slips across {len(games)} games")
    return result


# ─────────────────────────────────────────────────────────────────────────
# Bet Extraction per Game
# ─────────────────────────────────────────────────────────────────────────

def _extract_bets_from_game(
    game: Dict[str, Any],
    config: Dict[str, Any],
    stamp_id: str,
    now: str,
) -> List[Dict[str, Any]]:
    """Extract all bet types from a single processed game."""
    bets = []
    home = game.get("home", "")
    away = game.get("away", "")
    match_key = game.get("match_key", f"{home} vs {away}".lower())

    # ── BANKER ──
    banker = game.get("banker")
    if banker and banker.get("pick"):
        conf = parse_conf_pct(banker.get("confidence"))
        tier = get_tier_object(conf)
        threshold = to_num(config.get("bankerThreshold"), 65)
        if conf is not None and conf >= threshold:
            bets.append(_make_bet(
                game=game, pick=banker["pick"], bet_type="BANKER",
                market="ML", quarter="FT",
                odds=banker.get("odds"), confidence=conf,
                ev=banker.get("ev"), tier=tier,
                side=banker.get("side"), team=banker.get("team"),
                line=None, source="M5", stamp_id=stamp_id,
                edge=banker.get("edge"), stars=tier.tier in ("ELITE", "STRONG"),
                now=now,
            ))

    # ── ROBBER ──
    if to_bool(config.get("enableRobbers", True)):
        robber = game.get("robber")
        if robber and robber.get("pick"):
            conf = parse_conf_pct(robber.get("confidence"))
            tier = get_tier_object(conf)
            bets.append(_make_bet(
                game=game, pick=robber["pick"], bet_type="ROBBER",
                market="ML", quarter="FT",
                odds=robber.get("odds"), confidence=conf,
                ev=robber.get("ev"), tier=tier,
                side=robber.get("side"), team=robber.get("team"),
                line=None, source="M9", stamp_id=stamp_id,
                edge=robber.get("edge"), stars=False,
                now=now,
            ))

    # ── SNIPER MARGIN (Quarter Spreads) ──
    sniper_count = 0
    max_snipers = int(to_num(config.get("maxSnipersPerGame"), 3))

    for q in range(1, 5):
        margin = game.get(f"sniper_margin_q{q}")
        if not margin or not margin.get("pick"):
            continue
        if sniper_count >= max_snipers:
            break

        conf = parse_conf_pct(margin.get("confidence"))
        min_margin = to_num(config.get("sniperMinMargin"), 3.0)
        edge = to_num(margin.get("edge"), 0)

        if edge >= min_margin or (edge == 0 and margin.get("ev")):
            tier = get_tier_object(conf)
            bets.append(_make_bet(
                game=game, pick=margin["pick"], bet_type="SNIPER_MARGIN",
                market="SPREAD", quarter=f"Q{q}",
                odds=margin.get("odds"), confidence=conf,
                ev=margin.get("ev"), tier=tier,
                side=margin.get("side"), team=margin.get("team"),
                line=margin.get("line"), source="M6", stamp_id=stamp_id,
                edge=edge, stars=margin.get("star", False),
                now=now,
            ))
            sniper_count += 1

    # ── SNIPER O/U (Quarter Over/Under) ──
    if to_bool(config.get("includeOUSignals", True)):
        ou_count = 0
        for q in range(1, 5):
            ou = game.get(f"sniper_ou_q{q}")
            if not ou or not ou.get("pick"):
                continue
            if ou_count >= max_snipers:
                break

            conf = parse_conf_pct(ou.get("confidence"))
            min_conf = to_num(config.get("ouMinConf"), 55)

            if conf is not None and conf >= min_conf:
                tier = get_tier_object(conf)
                dedup = norm_ou_pick_key(match_key, ou["pick"])
                bets.append({
                    **_make_bet(
                        game=game, pick=ou["pick"], bet_type="SNIPER_OU",
                        market="O/U", quarter=f"Q{q}",
                        odds=ou.get("odds"), confidence=conf,
                        ev=ou.get("ev"), tier=tier,
                        side=ou.get("direction"), team=None,
                        line=ou.get("line"), source="M6", stamp_id=stamp_id,
                        edge=ou.get("edge"), stars=ou.get("star", False),
                        now=now,
                    ),
                    "_dedup_key": dedup,
                })
                ou_count += 1

    # ── FIRST HALF 1X2 ──
    if to_bool(config.get("enableFirstHalf", True)):
        fh = game.get("first_half")
        if fh and fh.get("pick"):
            conf = parse_conf_pct(fh.get("confidence"))
            tier = get_tier_object(conf)
            bets.append(_make_bet(
                game=game, pick=fh["pick"], bet_type="1H_1X2",
                market="1X2", quarter="1H",
                odds=fh.get("odds"), confidence=conf,
                ev=fh.get("ev"), tier=tier,
                side=fh.get("side"), team=fh.get("team"),
                line=None, source="M9", stamp_id=stamp_id,
                edge=fh.get("edge"), stars=False,
                now=now,
            ))

    # ── FT O/U ──
    if to_bool(config.get("enableFTOU", True)):
        ftou = game.get("ft_ou")
        if ftou and ftou.get("pick"):
            conf = parse_conf_pct(ftou.get("confidence"))
            tier = get_tier_object(conf)
            bets.append(_make_bet(
                game=game, pick=ftou["pick"], bet_type="FT_OU",
                market="O/U", quarter="FT",
                odds=ftou.get("odds"), confidence=conf,
                ev=ftou.get("ev"), tier=tier,
                side=ftou.get("direction"), team=None,
                line=ftou.get("line"), source="M9", stamp_id=stamp_id,
                edge=ftou.get("edge"), stars=ftou.get("star", False),
                now=now,
            ))

    # ── HIGH QUARTER ──
    if to_bool(config.get("includeHighestQuarter", True)):
        hq = game.get("high_quarter")
        if hq and hq.get("pick"):
            conf = parse_conf_pct(hq.get("confidence"))
            hq_min = to_num(config.get("hqMinConfidence"), 55)
            if conf is not None and conf >= hq_min:
                tier = get_tier_object(conf)
                bets.append(_make_bet(
                    game=game, pick=hq["pick"], bet_type="HIGH_QTR",
                    market="HIGH_QTR", quarter="FT",
                    odds=hq.get("odds"), confidence=conf,
                    ev=hq.get("ev"), tier=tier,
                    side=None, team=None,
                    line=None, source="M9", stamp_id=stamp_id,
                    edge=hq.get("edge"), stars=False,
                    now=now,
                ))

    return bets


# ─────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────

def _make_bet(
    game, pick, bet_type, market, quarter,
    odds, confidence, ev, tier, side, team, line,
    source, stamp_id, edge, stars, now,
) -> Dict[str, Any]:
    return {
        "league":     game.get("league", ""),
        "date":       game.get("date", ""),
        "time":       game.get("time", ""),
        "home":       game.get("home", ""),
        "away":       game.get("away", ""),
        "pick":       pick,
        "type":       bet_type,
        "market":     market,
        "quarter":    quarter,
        "odds":       odds,
        "confidence": confidence,
        "ev":         ev,
        "tier":       tier,
        "side":       side,
        "team":       team,
        "line":       line,
        "source":     source,
        "stamp_id":   stamp_id,
        "edge":       edge,
        "stars":      stars,
        "now":        now,
    }


def _bet_to_row(bet: Dict[str, Any], bet_id: int) -> List[Any]:
    """Convert a bet dict to a 25-column row."""
    tier = bet.get("tier")
    tier_display = tier.display if tier else ""
    tier_label = f"{tier.tier} {tier.symbol}".strip() if tier else ""
    stars_display = "★" if bet.get("stars") else ""

    market_line = ""
    if bet.get("line") is not None:
        ml = to_num(bet["line"], 0)
        if math.isfinite(ml):
            market_line = f"{ml:.1f}"

    row = [""] * NUM_COLS
    row[0]  = f"BET-{bet_id:04d}"
    row[1]  = bet.get("league", "")
    row[2]  = bet.get("date", "")
    row[3]  = bet.get("time", "")
    row[4]  = bet.get("home", "")
    row[5]  = bet.get("away", "")
    row[6]  = bet.get("pick", "")
    row[7]  = bet.get("type", "")
    row[8]  = bet.get("market", "")
    row[9]  = bet.get("quarter", "")
    row[10] = bet.get("odds", "")
    row[11] = tier_display
    row[12] = bet.get("ev", "")
    row[13] = tier_label
    row[14] = ""  # Outcome — filled during grading
    row[15] = bet.get("side", "")
    row[16] = bet.get("team", "")
    row[17] = market_line
    row[18] = bet.get("source", "")
    row[19] = bet.get("stamp_id", "")
    row[20] = market_line
    row[21] = bet.get("edge", "")
    row[22] = stars_display
    row[23] = ""
    row[24] = bet.get("now", "")
    return row


def _sort_key(row: List[Any]) -> Tuple:
    """Sort: Stars first, then by type priority, then by confidence."""
    stars = 1 if row[22] == "★" else 0
    type_val = row[7] if len(row) > 7 else ""
    type_priority = {
        "BANKER": 5, "ROBBER": 4, "SNIPER_MARGIN": 3,
        "SNIPER_OU": 2, "1H_1X2": 1, "FT_OU": 1, "HIGH_QTR": 0,
    }.get(type_val, 0)
    return (stars, type_priority)


def _make_banner() -> List[List[Any]]:
    """Create the Ma Golide banner row."""
    banner_row = [""] * NUM_COLS
    banner_row[0] = "──────────── Ma Golide Bet Slips ────────────"
    return [banner_row]
