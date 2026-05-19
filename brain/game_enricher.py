"""
brain/game_enricher.py
──────────────────────
Phase 1 Enricher: Maps raw UpcomingClean game dicts into the structured
dict format expected by contract_enforcer.py.

This is the "enrichment bridge" that replaces the logic normally handled
by the Apps Script Game_Processor / Forecaster modules.

Phase 1 Strategy:
  - Reads pre-existing predictions from UpcomingClean (e.g. "1", "2", "Home", "Away")
  - Populates banker/robber/first_half/ft_ou/sniper structs from these signals
  - Confidence and EV come from corresponding columns where available
  - Falls back to defaults when columns are missing (common in raw satellites)

Phase 2 (Future): Replace this with full Forecaster port.
"""

from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional

from brain.utils import to_num, parse_conf_pct, normalize_header

log = logging.getLogger("brain.game_enricher")


# ─────────────────────────────────────────────────────────────────────────
# Prediction normalization
# ─────────────────────────────────────────────────────────────────────────

def _normalize_pick(prediction: Any, home: str, away: str) -> Optional[str]:
    """
    Normalize a raw prediction value ("1", "2", "Home", "Away", team name)
    into a canonical display pick string.

    Returns the winning team name, or None if unparseable.
    """
    if not prediction:
        return None
    pred = str(prediction).strip()

    # Numeric: "1" = Home, "2" = Away, "X" = Draw
    if pred == "1":
        return home
    elif pred == "2":
        return away
    elif pred.upper() in ("X", "D", "DRAW"):
        return "Draw"
    
    # Text match
    p_lower = pred.lower()
    if "home" in p_lower or (home and p_lower == home.lower()):
        return home
    if "away" in p_lower or (away and p_lower == away.lower()):
        return away

    # Direct team name — pass through as-is if non-empty
    return pred if pred else None


def _derive_side(pick: Optional[str], home: str, away: str) -> str:
    """Return 'HOME' or 'AWAY' based on pick."""
    if not pick:
        return ""
    if pick.lower() == home.lower():
        return "HOME"
    if pick.lower() == away.lower():
        return "AWAY"
    return ""


def _pick_odds(side: str, home_odds: Optional[float], away_odds: Optional[float]) -> Optional[float]:
    """Return the odds for the selected side."""
    if side == "HOME":
        return home_odds
    if side == "AWAY":
        return away_odds
    return None


# ─────────────────────────────────────────────────────────────────────────
# OU Signal Enrichment
# ─────────────────────────────────────────────────────────────────────────

def _build_ou_struct(
    game: Dict[str, Any],
    quarter: int,
    config: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    Build a sniper_ou_q{q} struct from raw OU columns in the game dict.
    Handles both string values ('Over 33.5 ★ (80%)') and pre-parsed dicts.
    Returns None if no usable signal found.
    """
    computed = game.get(f"computed_sniper_ou_q{quarter}")
    if computed and not computed.get("skip"):
        hq_min = to_num(config.get("hqMinConfidence"), 55)
        # Build clean pick string: "Q2 Over 33.5"
        direction_cap = str(computed.get("direction")).capitalize()
        line_val = computed.get("line")
        line_str = f" {line_val:.1f}" if line_val is not None else ""
        pick = f"Q{quarter} {direction_cap}{line_str}"
        return {
            "pick": pick,
            "direction": str(computed.get("direction")).upper(),
            "confidence": computed.get("confidence"),
            "ev": computed.get("ev"),
            "edge": computed.get("edge"),
            "line": line_val,
            "star": computed.get("confidence", 0) >= hq_min,
        }

    # Fallback to legacy
    ou_key = f"ou_q{quarter}"
    ou_val = game.get(ou_key)
    if not ou_val:
        return None

    # Case 1: ou_val is already a parsed dict from parse_ou_signal
    if isinstance(ou_val, dict):
        direction = ou_val.get("direction", "")
        if not direction or direction.upper() not in ("OVER", "UNDER"):
            return None
        parsed_line = ou_val.get("line")
        parsed_conf = ou_val.get("conf")
        line = game.get(f"q{quarter}_total") or parsed_line or game.get("total")
        conf_raw = game.get(f"ou_q{quarter}_conf") or parsed_conf
    else:
        # Case 2: ou_val is a raw string like 'Over 33.5 ★ (80%)'
        pick_str = str(ou_val).strip()
        if not pick_str or pick_str.lower() in ("", "n/a", "-"):
            return None
        direction = "OVER" if "over" in pick_str.lower() else "UNDER" if "under" in pick_str.lower() else None
        if not direction:
            return None
        line = game.get(f"q{quarter}_total") or game.get("total")
        conf_raw = game.get(f"ou_q{quarter}_conf")

    # Resolve numeric conf
    if isinstance(conf_raw, (int, float)) and not (isinstance(conf_raw, float) and conf_raw != conf_raw):
        conf = float(conf_raw)
    else:
        conf = parse_conf_pct(conf_raw)

    ev_raw = game.get(f"ou_q{quarter}_ev")
    edge_raw = game.get(f"ou_q{quarter}_edge")
    ev = to_num(ev_raw, None) if ev_raw not in (None, "") else None
    edge = to_num(edge_raw, 0) if edge_raw not in (None, "") else 0

    # Sanitize NaN
    if ev is not None and isinstance(ev, float) and ev != ev:
        ev = None
    if edge is not None and isinstance(edge, float) and edge != edge:
        edge = 0

    # Build clean pick string: "Q2 Over 33.5"
    line_str = f" {line:.1f}" if line is not None else ""
    pick = f"Q{quarter} {direction.capitalize()}{line_str}"

    hq_min = to_num(config.get("hqMinConfidence"), 55)
    return {
        "pick": pick,
        "direction": direction.upper(),
        "confidence": conf,
        "ev": ev,
        "edge": edge,
        "line": line,
        "star": conf is not None and conf >= hq_min,
    }


def _build_ftou_struct(game: Dict[str, Any], config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Build ft_ou struct from raw game data."""
    computed = game.get("computed_ft_ou")
    if computed and not computed.get("skip"):
        return {
            "pick": computed.get("pick"),
            "direction": str(computed.get("direction")).upper(),
            "confidence": computed.get("confidence"),
            "ev": computed.get("ev"),
            "edge": computed.get("edge"),
            "line": computed.get("line"),
            "star": computed.get("tier") == "STRONG" or computed.get("tierDisplay") == "★",
        }

    # Fallback to legacy
    ft_ou_pred = game.get("ft_ou_pred") or game.get("ou_ft")
    if not ft_ou_pred:
        return None

    pick = str(ft_ou_pred).strip()
    direction = "OVER" if "over" in pick.lower() else "UNDER" if "under" in pick.lower() else None
    if not direction:
        return None

    conf = parse_conf_pct(game.get("confidence"))
    ev = to_num(game.get("ev"), None)

    return {
        "pick": pick,
        "direction": direction,
        "confidence": conf,
        "ev": ev,
        "edge": 0,
        "line": game.get("total"),
        "star": False,
    }


# ─────────────────────────────────────────────────────────────────────────
# Banker / Robber classification
# ─────────────────────────────────────────────────────────────────────────

def _classify_banker_or_robber(
    game: Dict[str, Any],
    pick: str,
    side: str,
    config: Dict[str, Any],
) -> str:
    """
    Classify a ML pick as BANKER or ROBBER based on odds.

    BANKER  = favourite (odds < ~1.80 implied)
    ROBBER  = underdog pick (upset)

    Uses home/away odds if available; defaults to BANKER when unknown.
    """
    home_odds = to_num(game.get("home_odds"), None)
    away_odds = to_num(game.get("away_odds"), None)

    pick_odds = _pick_odds(side, home_odds, away_odds)
    other_odds = _pick_odds("AWAY" if side == "HOME" else "HOME", home_odds, away_odds)

    print(f"DEBUG ROBBER [Game: {game.get('home')} vs {game.get('away')}]: "
          f"pick={pick}, side={side}, home_odds={home_odds}, away_odds={away_odds}, "
          f"pick_odds={pick_odds}, other_odds={other_odds}")

    if pick_odds is None or other_odds is None:
        print(f"DEBUG ROBBER -> BANKER (missing odds)")
        return "BANKER"

    # If we're picking the underdog (higher odds), it's a ROBBER
    if pick_odds > other_odds:
        print(f"DEBUG ROBBER -> ROBBER (pick_odds {pick_odds} > other_odds {other_odds})")
        return "ROBBER"
        
    print(f"DEBUG ROBBER -> BANKER (pick_odds {pick_odds} <= other_odds {other_odds})")
    return "BANKER"


# ─────────────────────────────────────────────────────────────────────────
# First Half Enrichment
# ─────────────────────────────────────────────────────────────────────────

def _build_first_half_struct(
    game: Dict[str, Any],
    pick: str,
    side: str,
    config: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    Build a first_half struct from raw game data.
    Currently mirrors the main ML pick unless a dedicated 1H column exists.
    """
    fh_pick = game.get("first_half_pred") or game.get("1h_pred")
    if not fh_pick:
        # For Phase 1: propagate the main pick as a 1H signal with reduced confidence
        if not pick:
            print(f"DEBUG 1H [Game: {game.get('home')} vs {game.get('away')}]: no fh_pick, no main pick. Returning None.")
            return None
        conf = parse_conf_pct(game.get("confidence"))
        if conf is None:
            print(f"DEBUG 1H [Game: {game.get('home')} vs {game.get('away')}]: no fh_pick, no parsed confidence for main pick. Returning None.")
            return None
        # Reduce confidence for the 1H signal (heuristic)
        fh_conf = max(50.0, conf - 5.0)
        print(f"DEBUG 1H [Game: {game.get('home')} vs {game.get('away')}]: no fh_pick, propagating main pick '{pick}' with reduced conf: {conf} -> {fh_conf}")
        return {
            "pick": pick,
            "side": side,
            "team": pick,
            "confidence": fh_conf,
            "ev": to_num(game.get("ev"), None),
            "edge": 0,
            "odds": _pick_odds(side, to_num(game.get("home_odds"), None), to_num(game.get("away_odds"), None)),
        }

    fh_side = _derive_side(fh_pick, game.get("home", ""), game.get("away", ""))
    print(f"DEBUG 1H [Game: {game.get('home')} vs {game.get('away')}]: found explicit fh_pick '{fh_pick}', side={fh_side}")
    return {
        "pick": fh_pick,
        "side": fh_side,
        "team": fh_pick,
        "confidence": parse_conf_pct(game.get("1h_conf") or game.get("confidence")),
        "ev": to_num(game.get("1h_ev") or game.get("ev"), None),
        "edge": 0,
        "odds": _pick_odds(fh_side, to_num(game.get("home_odds"), None), to_num(game.get("away_odds"), None)),
    }


# ─────────────────────────────────────────────────────────────────────────
# Main Enrichment Entry Point
# ─────────────────────────────────────────────────────────────────────────

def enrich_games(
    games: List[Dict[str, Any]],
    config: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """
    Phase 1 enrichment: takes raw parsed games and populates structured
    sub-dicts (banker, robber, first_half, ft_ou, sniper_ou_q1-q4)
    needed by contract_enforcer.build_bet_slips().

    Args:
        games: Output of parse_upcoming_clean()
        config: Accumulator config dict from load_accumulator_config()

    Returns:
        The same list with in-place enrichment of each game dict.
    """
    banker_thresh = to_num(config.get("bankerThreshold"), 65)
    robber_enabled = config.get("enableRobbers", True)
    fh_enabled = config.get("enableFirstHalf", True)
    ftou_enabled = config.get("enableFTOU", True)
    ou_enabled = config.get("includeOUSignals", True)

    for game in games:
        home = game.get("home", "")
        away = game.get("away", "")
        pred = game.get("computed_prediction")
        if not pred or pred == "RISKY":
            pred = game.get("prediction")
        
        conf = parse_conf_pct(game.get("computed_confidence")) or parse_conf_pct(game.get("confidence"))
        ev = to_num(game.get("ev"), None) # EV is not computed by Tier1
        home_odds = to_num(game.get("home_odds"), None)
        away_odds = to_num(game.get("away_odds"), None)

        pick = _normalize_pick(pred, home, away)
        if not pick:
            continue

        side = _derive_side(pick, home, away)
        pick_odds_val = _pick_odds(side, home_odds, away_odds)
        bet_category = _classify_banker_or_robber(game, pick, side, config)

        # Build ML struct shared between banker/robber
        ml_struct = {
            "pick": pick,
            "side": side,
            "team": pick,
            "confidence": conf,
            "ev": ev,
            "edge": 0,
            "odds": pick_odds_val,
        }

        # Assign to correct category
        if bet_category == "BANKER" and conf is not None and conf >= banker_thresh:
            game["banker"] = ml_struct
        elif bet_category == "ROBBER" and robber_enabled:
            game["robber"] = ml_struct
        elif conf is not None and conf >= banker_thresh:
            # Fallback: if odds are unavailable but conf is high, treat as banker
            game["banker"] = ml_struct

        # First Half — prefer enh_1h signal if available
        if fh_enabled:
            enh_1h = game.get("enh_1h")
            if enh_1h:
                enh_1h_conf = game.get("enh_1h_conf")
                fh_side = _derive_side(enh_1h, home, away)
                # Parse "1H: Home" → team name
                fh_pick = home if "home" in enh_1h.lower() else (away if "away" in enh_1h.lower() else enh_1h)
                fh_struct = {
                    "pick": fh_pick,
                    "side": fh_side or ("HOME" if fh_pick == home else "AWAY"),
                    "team": fh_pick,
                    "confidence": enh_1h_conf,
                    "ev": None,
                    "edge": 0,
                    "odds": _pick_odds(fh_side, home_odds, away_odds),
                }
            else:
                fh_struct = _build_first_half_struct(game, pick, side, config)
            if fh_struct:
                game["first_half"] = fh_struct

        # FT O/U
        if ftou_enabled:
            ftou = _build_ftou_struct(game, config)
            if ftou:
                game["ft_ou"] = ftou

        # Quarter O/U
        if ou_enabled:
            for q in range(1, 5):
                ou_struct = _build_ou_struct(game, q, config)
                if ou_struct:
                    game[f"sniper_ou_q{q}"] = ou_struct

    log.info(f"game_enricher: enriched {len(games)} games")
    return games
