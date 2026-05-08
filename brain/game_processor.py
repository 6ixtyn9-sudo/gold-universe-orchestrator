"""
brain/game_processor.py
───────────────────────
Port of analyzeTier1 orchestrator.
Connects standings, historical results, and the forecaster to compute MaGolide predictions.
"""

import logging
from typing import Dict, Any, List, Optional
import datetime

from brain.forecaster import (
    calculate_rank_difference, calculate_pct_difference,
    calculate_net_rating_difference, calculate_home_court_effect,
    calculate_momentum_difference, calculate_streak_difference,
    calculate_form_difference, calculate_h2h_difference,
    calculate_forebet_difference, calculate_variance_penalty,
    calculate_magolide_score, get_forebet_favored_probability
)
from brain.utils import to_num
from brain.signal_processor import predict_ft_over_under

log = logging.getLogger("brain.game_processor")

def analyze_historical_h2h(home_team: str, away_team: str, results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Port of analyzeHistoricalHeadToHead"""
    default_result = {"homeWins": 0, "awayWins": 0, "avgMargin": 0, "totalGames": 0}
    if not home_team or not away_team or not results:
        return default_result

    h2h_games = []
    for r in results:
        r_home = r.get("home", "")
        r_away = r.get("away", "")
        if (r_home == home_team and r_away == away_team) or (r_home == away_team and r_away == home_team):
            if r.get("total_score") is not None:
                h2h_games.append(r)

    if not h2h_games:
        return default_result

    home_wins = 0
    away_wins = 0
    total_margin = 0
    valid_games = 0

    for g in h2h_games:
        home_score = g.get("home_score")
        away_score = g.get("away_score")
        if home_score is None or away_score is None:
            continue

        valid_games += 1
        if g.get("home") == home_team:
            total_margin += (home_score - away_score)
            if home_score > away_score:
                home_wins += 1
            elif away_score > home_score:
                away_wins += 1
        else:
            total_margin += (away_score - home_score)
            if away_score > home_score:
                home_wins += 1
            elif home_score > away_score:
                away_wins += 1

    avg_margin = total_margin / valid_games if valid_games > 0 else 0

    return {
        "homeWins": home_wins,
        "awayWins": away_wins,
        "avgMargin": avg_margin,
        "totalGames": valid_games,
    }


def calculate_historical_streak(team: str, results: List[Dict[str, Any]]) -> str:
    if not team or not results:
        return "N/A"
    
    streak_val = 0
    streak_type = None
    
    for r in results:
        h = r.get("home", "")
        a = r.get("away", "")
        if team != h and team != a:
            continue
        h_score = r.get("home_score")
        a_score = r.get("away_score")
        if h_score is None or a_score is None:
            continue
            
        is_home = (team == h)
        won = (h_score > a_score) if is_home else (a_score > h_score)
        tied = (h_score == a_score)
        
        if tied:
            continue
            
        t = "W" if won else "L"
        if streak_type is None:
            streak_type = t
            streak_val = 1
        elif streak_type == t:
            streak_val += 1
        else:
            break
            
    if streak_type is None:
        return "N/A"
    return f"{streak_type}{streak_val}"


def calculate_last_10(team: str, results: List[Dict[str, Any]]) -> str:
    if not team or not results:
        return "N/A"
        
    wins = 0
    losses = 0
    count = 0
    
    for r in results:
        h = r.get("home", "")
        a = r.get("away", "")
        if team != h and team != a:
            continue
        h_score = r.get("home_score")
        a_score = r.get("away_score")
        if h_score is None or a_score is None:
            continue
            
        is_home = (team == h)
        won = (h_score > a_score) if is_home else (a_score > h_score)
        tied = (h_score == a_score)
        
        if not tied:
            if won:
                wins += 1
            else:
                losses += 1
        count += 1
        if count >= 10:
            break
            
    if count == 0:
        return "N/A"
    return f"{wins}-{losses}"


def normalize_lookup(name: str) -> str:
    if not name: return ""
    return str(name).lower().replace("'", "").replace(".", "").replace("-", " ").strip()


def compute_magolide_predictions(
    games: List[Dict[str, Any]], 
    standings: Dict[str, Dict[str, Any]], 
    results: List[Dict[str, Any]], 
    config_tier1: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """
    Port of analyzeTier1 orchestration loop.
    Iterates through games, enriches them with features from standings and results,
    computes the MaGolide Score and modifies the games in-place (or returns updated).
    """
    log.info(f"Computing predictions for {len(games)} games using Tier 1 config")
    
    for game in games:
        home_team = game.get("home", "")
        away_team = game.get("away", "")
        
        home_key = normalize_lookup(home_team)
        away_key = normalize_lookup(away_team)
        
        home_standings = standings.get(home_key, {})
        away_standings = standings.get(away_key, {})
        
        rank_diff = calculate_rank_difference(home_standings, away_standings)
        pct_diff = calculate_pct_difference(home_standings, away_standings)
        net_rtg_diff = calculate_net_rating_difference(home_standings, away_standings)
        home_court_effect = calculate_home_court_effect(home_standings, away_standings)
        momentum_diff = calculate_momentum_difference(home_standings, away_standings)
        streak_diff = calculate_streak_difference(home_standings, away_standings)
        
        # Historical Form
        home_streak_hist = calculate_historical_streak(home_team, results)
        away_streak_hist = calculate_historical_streak(away_team, results)
        home_l10 = calculate_last_10(home_team, results)
        away_l10 = calculate_last_10(away_team, results)
        
        # Fallback to standings if history failed
        if home_streak_hist == "N/A" or home_l10 == "N/A":
            if home_streak_hist == "N/A" and "streak" in home_standings:
                s = home_standings["streak"]
                home_streak_hist = f"W{s}" if s > 0 else f"L{-s}"
            if home_l10 == "N/A": home_l10 = home_standings.get("wl", "N/A")
            
        if away_streak_hist == "N/A" or away_l10 == "N/A":
            if away_streak_hist == "N/A" and "streak" in away_standings:
                s = away_standings["streak"]
                away_streak_hist = f"W{s}" if s > 0 else f"L{-s}"
            if away_l10 == "N/A": away_l10 = away_standings.get("wl", "N/A")
            
        form_diff = calculate_form_difference(home_streak_hist, away_streak_hist, home_l10, away_l10)
        
        # H2H Features
        h2h_stats = analyze_historical_h2h(home_team, away_team, results)
        h2h_diff = calculate_h2h_difference(h2h_stats)
        
        # Forebet Features
        # Original script reads forebet pred/prob from game directly.
        forebet_pred = game.get("prediction", "")
        forebet_prob = game.get("confidence", "")
        # Because we already parsed confidence into a float in game['confidence'] in parse_upcoming_clean,
        # calculate_forebet_difference needs to handle it.
        # Wait, if confidence is already parsed to a number (e.g. 61.0), calculate_forebet_difference handles it as float.
        forebet_diff = calculate_forebet_difference(forebet_pred, forebet_prob, home_team, away_team)
        
        # Variance Penalty
        # For now, default variance map is empty as in legacy
        variance_penalty = calculate_variance_penalty(home_team, away_team, {})
        
        features = {
            "rankDiff": rank_diff,
            "pctDiff": pct_diff,
            "netRtgDiff": net_rtg_diff,
            "homeCourtEffect": home_court_effect,
            "momentumDiff": momentum_diff,
            "streakDiff": streak_diff,
            "formDiff": form_diff,
            "h2hDiff": h2h_diff,
            "forebetDiff": forebet_diff,
            "variancePenalty": variance_penalty,
        }
        
        # Calculate Prediction
        result = calculate_magolide_score(features, config_tier1)
        
        # Enrich the game dictionary directly
        game["computed_prediction"] = result["prediction"]
        game["computed_confidence"] = result["confidence"]
        game["computed_score"] = result["score"]
        game["computed_prob"] = result["probability"]
        game["magolide_meta"] = result["meta"]
        
        # O/U Predictions
        game["computed_ft_ou"] = predict_ft_over_under(game, {}, config_tier1)
        
    return games
