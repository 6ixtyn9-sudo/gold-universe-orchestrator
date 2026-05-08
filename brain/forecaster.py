"""
brain/forecaster.py
───────────────────
Port of Forecaster.gs (Module 5 / TIER 1 ANALYZERS).
Responsible for generating the core prediction score (MaGolide Score) 
and probabilities from standings, recent form, and external signals.
"""

from __future__ import annotations
import math
import re
import logging
from typing import Any, Dict, List, Optional, Tuple

from brain.utils import (
    to_num,
    clamp,
    normalize_header,
    parse_conf_pct
)

log = logging.getLogger("brain.forecaster")

# ─────────────────────────────────────────────────────────────────────────
# Text Normalization
# ─────────────────────────────────────────────────────────────────────────

def normalize_text(text: Any) -> str:
    """Port of normalizeText_ (Line 129)"""
    if not text:
        return ""
    s = str(text)
    s = s.replace('\u00A0', ' ')
    s = s.replace('\uFEFF', '')
    s = s.replace('\u200B', '')
    return s.strip()

def normalize_team_name(name: Any) -> str:
    """Port of normalizeTeamName_ (Line 149)"""
    s = str(name or '').lower().strip()
    s = re.sub(r"[''`]", "", s)
    s = re.sub(r"[.\-,]", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s

def is_non_zero(n: float) -> bool:
    """Port of isNonZero_ (Line 169)"""
    return math.isfinite(n) and abs(n) > 1e-9

# ─────────────────────────────────────────────────────────────────────────
# Probability Parsing
# ─────────────────────────────────────────────────────────────────────────

def parse_home_away_probability(prob_cell: Any) -> Dict[str, Any]:
    """Port of parseHomeAwayProbability_ (Line 198)"""
    result = {"home": 50.0, "away": 50.0, "ok": False, "source": "default"}
    
    if prob_cell is None or prob_cell == "":
        return result
        
    if isinstance(prob_cell, (int, float)) and math.isfinite(prob_cell):
        home_num = float(prob_cell)
        if 0 <= home_num <= 1:
            home_num *= 100
        home_num = clamp(home_num, 0, 100)
        result["home"] = home_num
        result["away"] = 100.0 - home_num
        result["ok"] = True
        result["source"] = "number"
        return result
        
    s = normalize_text(prob_cell)
    matches = re.findall(r"(\d+(?:\.\d+)?)", s)
    if not matches:
        return result
        
    nums = []
    for m in matches:
        try:
            val = float(m)
            if math.isfinite(val):
                nums.append(val)
        except ValueError:
            pass
            
    if not nums:
        return result
        
    plausible = [x for x in nums if (0 <= x <= 1) or (0 <= x <= 100)]
    if len(plausible) >= 2:
        nums = plausible
        
    home = nums[0]
    away = nums[1] if len(nums) >= 2 else float('nan')
    
    if not math.isfinite(away):
        if 0 <= home <= 1:
            home *= 100
        home = clamp(home, 0, 100)
        result["home"] = home
        result["away"] = 100.0 - home
        result["ok"] = True
        result["source"] = "single"
        return result
        
    if 0 <= home <= 1 and 0 <= away <= 1:
        home *= 100
        away *= 100
        
    home = clamp(home, 0, 100)
    away = clamp(away, 0, 100)
    
    total = home + away
    if total > 0 and abs(total - 100) > 3:
        home = (home / total) * 100
        away = 100.0 - home
        result["source"] = "normalized"
    else:
        result["source"] = "pair"
        
    result["home"] = clamp(home, 0, 100)
    result["away"] = clamp(away, 0, 100)
    result["ok"] = True
    return result

def interpret_prediction_side(pred_cell: Any, home_team: str = "", away_team: str = "") -> str:
    """Port of interpretPredictionSide_ (Line 329)"""
    pred = normalize_text(pred_cell).lower()
    if not pred:
        return "UNKNOWN"
        
    if pred in ("1", "h") or "home" in pred:
        return "HOME"
    if pred in ("2", "a") or "away" in pred:
        return "AWAY"
    if pred == "x" or "draw" in pred:
        return "DRAW"
        
    home_name = normalize_team_name(home_team)
    away_name = normalize_team_name(away_team)
    pred_norm = normalize_team_name(pred)
    
    if home_name and (home_name in pred_norm or pred_norm in home_name):
        return "HOME"
    if away_name and (away_name in pred_norm or pred_norm in away_name):
        return "AWAY"
        
    return "UNKNOWN"

def get_forebet_favored_probability(forebet_pred: Any, prob_cell: Any, home_team: str = "", away_team: str = "") -> float:
    """Port of getForebetFavoredProbability_ (Line 381)"""
    if prob_cell is None or prob_cell == "":
        return 0.0
        
    side = interpret_prediction_side(forebet_pred, home_team, away_team)
    probs = parse_home_away_probability(prob_cell)
    
    if side == "HOME":
        return probs["home"]
    if side == "AWAY":
        return probs["away"]
    if side == "DRAW":
        return max(probs["home"], probs["away"])
        
    return max(probs["home"], probs["away"])

def calculate_forebet_difference(forebet_pred: Any, forebet_prob_str: Any, home_team: str = "", away_team: str = "") -> float:
    """Port of calculateForebetDifference_ (Line 423)"""
    if not forebet_pred or forebet_prob_str is None or forebet_prob_str == "":
        return 0.0
        
    side = interpret_prediction_side(forebet_pred, home_team, away_team)
    probs = parse_home_away_probability(forebet_prob_str)
    
    if side == "HOME":
        return (probs["home"] - 50.0) / 10.0
    if side == "AWAY":
        return -((probs["away"] - 50.0) / 10.0)
        
    return 0.0

# ─────────────────────────────────────────────────────────────────────────
# Feature Calculators
# ─────────────────────────────────────────────────────────────────────────

def calculate_variance_penalty(home_team: str, away_team: str, variance_map: Dict[str, Any] = None) -> float:
    """Port of calculateVariancePenalty_ (Line 467)"""
    variance_map = variance_map or {}
    DEFAULT_VARIANCE = 10.0
    
    home_key = normalize_team_name(home_team)
    away_key = normalize_team_name(away_team)
    
    home_var = to_num(variance_map.get(home_key), DEFAULT_VARIANCE)
    away_var = to_num(variance_map.get(away_key), DEFAULT_VARIANCE)
    
    avg_variance = (home_var + away_var) / 2.0
    return min(1.0, avg_variance / 20.0)

def calculate_rank_difference(home_standings: Dict[str, Any], away_standings: Dict[str, Any]) -> float:
    """Port of calculateRankDifference_ (Line 503)"""
    DEFAULT_RANK = 15.0
    home_rank = to_num(home_standings.get("rank") if home_standings else None, DEFAULT_RANK)
    away_rank = to_num(away_standings.get("rank") if away_standings else None, DEFAULT_RANK)
    return away_rank - home_rank

def calculate_pct_difference(home_standings: Dict[str, Any], away_standings: Dict[str, Any]) -> float:
    """Port of calculatePCTDifference_ (Line 532)"""
    DEFAULT_PCT = 0.5
    home_pct = to_num(home_standings.get("pct") if home_standings else None, DEFAULT_PCT)
    away_pct = to_num(away_standings.get("pct") if away_standings else None, DEFAULT_PCT)
    return (home_pct - away_pct) * 100.0

def calculate_net_rating_difference(home_standings: Dict[str, Any], away_standings: Dict[str, Any]) -> float:
    """Port of calculateNetRatingDifference_ (Line 559)"""
    DEFAULT_NET_RTG = 0.0
    home_net_rtg = to_num(home_standings.get("netRtg") if home_standings else None, DEFAULT_NET_RTG)
    away_net_rtg = to_num(away_standings.get("netRtg") if away_standings else None, DEFAULT_NET_RTG)
    return home_net_rtg - away_net_rtg

def calculate_home_court_effect(home_standings: Dict[str, Any], away_standings: Dict[str, Any]) -> float:
    """Port of calculateHomeCourtEffect_ (Line 587)"""
    DEFAULT_PCT = 0.5
    home_home_pct = to_num(home_standings.get("homePct") if home_standings else None, DEFAULT_PCT)
    away_away_pct = to_num(away_standings.get("awayPct") if away_standings else None, DEFAULT_PCT)
    return (home_home_pct - away_away_pct) * 100.0

def calculate_momentum_difference(home_standings: Dict[str, Any], away_standings: Dict[str, Any]) -> float:
    """Port of calculateMomentumDifference_ (Line 613)"""
    DEFAULT_L10 = 0.5
    home_l10 = to_num(home_standings.get("l10Pct") if home_standings else None, DEFAULT_L10)
    away_l10 = to_num(away_standings.get("l10Pct") if away_standings else None, DEFAULT_L10)
    return (home_l10 - away_l10) * 100.0

def calculate_streak_difference(home_standings: Dict[str, Any], away_standings: Dict[str, Any]) -> float:
    """Port of calculateStreakDifference_ (Line 639)"""
    DEFAULT_STREAK = 0.0
    home_streak = to_num(home_standings.get("streak") if home_standings else None, DEFAULT_STREAK)
    away_streak = to_num(away_standings.get("streak") if away_standings else None, DEFAULT_STREAK)
    return home_streak - away_streak

def calculate_form_difference(home_streak: Any, away_streak: Any, home_l10: Any, away_l10: Any) -> float:
    """Port of calculateFormDifference_ (Line 668)"""
    h_streak = to_num(home_streak, 0.0)
    a_streak = to_num(away_streak, 0.0)
    
    def parse_l10(record: Any) -> float:
        if not record:
            return 0.5
        m = re.search(r"(\d+)\s*[-–]\s*(\d+)", str(record))
        if not m:
            return 0.5
        wins = int(m.group(1))
        losses = int(m.group(2))
        total = wins + losses
        return wins / total if total > 0 else 0.5
        
    home_l10_pct = parse_l10(home_l10)
    away_l10_pct = parse_l10(away_l10)
    
    streak_factor = (h_streak - a_streak) * 0.5
    l10_factor = (home_l10_pct - away_l10_pct) * 10.0
    
    return streak_factor + l10_factor

def calculate_h2h_difference(h2h_stats: Dict[str, Any]) -> float:
    """Port of calculateH2HDifference_ (Line 711)"""
    if not h2h_stats:
        return 0.0
    total_games = to_num(h2h_stats.get("totalGames"), 0.0)
    if total_games < 1:
        return 0.0
        
    home_wins = to_num(h2h_stats.get("homeWins"), 0.0)
    away_wins = to_num(h2h_stats.get("awayWins"), 0.0)
    avg_margin = to_num(h2h_stats.get("avgMargin"), 0.0)
    
    win_ratio_factor = (home_wins - away_wins) / total_games
    margin_factor = avg_margin / 10.0
    sample_weight = min(1.0, total_games / 10.0)
    
    return (win_ratio_factor * 5.0 + margin_factor) * sample_weight

# ─────────────────────────────────────────────────────────────────────────
# Main Scoring
# ─────────────────────────────────────────────────────────────────────────

def calculate_magolide_score(features: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Port of calculateMaGolideScore (Line 773)
    Single Source of Truth for Tier 1 prediction scoring.
    """
    features = features or {}
    config = config or {}
    
    def get_cfg(key1, key2, default=0.0):
        val = config.get(key1)
        if val is None:
            val = config.get(key2)
        return to_num(val, default)
        
    # Extract Features
    rank_diff = to_num(features.get("rankDiff"), 0.0)
    pct_diff = to_num(features.get("pctDiff"), 0.0)
    net_rtg_diff = to_num(features.get("netRtgDiff"), 0.0)
    home_court_effect = to_num(features.get("homeCourtEffect"), 0.0)
    momentum_diff = to_num(features.get("momentumDiff"), 0.0)
    streak_diff = to_num(features.get("streakDiff"), 0.0)
    form_diff = to_num(features.get("formDiff"), 0.0)
    h2h_diff = to_num(features.get("h2hDiff"), 0.0)
    forebet_diff = to_num(features.get("forebetDiff"), 0.0)
    variance_penalty = to_num(features.get("variancePenalty"), 0.0)
    
    # Get Weights
    pct_weight = get_cfg("pctWeight", "pct_weight")
    net_rtg_weight = get_cfg("netRtgWeight", "net_rtg_weight")
    home_court_weight = get_cfg("homeCourtWeight", "home_court_weight")
    momentum_weight = get_cfg("momentumWeight", "momentum_weight")
    streak_weight = get_cfg("streakWeight", "streak_weight")
    rank_weight = get_cfg("rank", "rankWeight")
    form_weight = get_cfg("form", "formWeight")
    h2h_weight = get_cfg("h2h", "h2hWeight")
    forebet_weight = get_cfg("forebet", "forebetWeight")
    variance_weight = get_cfg("variance", "varianceWeight")
    
    # Calculate Weighted Components
    weighted_rank = rank_weight * rank_diff
    weighted_pct = pct_weight * pct_diff
    weighted_net_rtg = net_rtg_weight * net_rtg_diff
    weighted_home_court = home_court_weight * home_court_effect
    weighted_momentum = momentum_weight * momentum_diff
    weighted_streak = streak_weight * streak_diff
    weighted_form = form_weight * form_diff
    weighted_h2h = h2h_weight * h2h_diff
    weighted_forebet = forebet_weight * forebet_diff
    weighted_variance = variance_weight * (-variance_penalty)
    
    # Calculate Total Score
    use_new_features = (
        is_non_zero(pct_weight) or
        is_non_zero(net_rtg_weight) or
        is_non_zero(home_court_weight) or
        is_non_zero(momentum_weight) or
        is_non_zero(streak_weight)
    )
    
    score = 0.0
    if use_new_features:
        score = (weighted_pct + weighted_net_rtg + weighted_home_court + 
                 weighted_momentum + weighted_streak + weighted_form + 
                 weighted_h2h + weighted_forebet + weighted_variance)
    else:
        score = (weighted_rank + weighted_form + weighted_h2h + 
                 weighted_forebet + weighted_variance)
                 
    home_advantage = get_cfg("homeAdv", "home_advantage")
    score += home_advantage
    
    if not math.isfinite(score):
        log.warning("[MaGolide] Non-finite score detected, resetting to 0")
        score = 0.0
        
    # Generate Prediction
    threshold = get_cfg("threshold", "score_threshold", 5.0)
    if not math.isfinite(threshold) or threshold < 0:
        threshold = 5.0
        
    abs_score = abs(score)
    prediction = ""
    
    if abs_score < threshold:
        prediction = "RISKY"
    elif score > 0:
        prediction = "HOME"
    else:
        prediction = "AWAY"
        
    # Calculate Confidence
    conf_min = clamp(get_cfg("confMin", "confidence_min", 50.0), 0.0, 100.0)
    conf_max = clamp(get_cfg("confMax", "confidence_max", 95.0), 0.0, 100.0)
    bounds_reset = False
    
    if conf_min >= conf_max:
        conf_min = 50.0
        conf_max = 95.0
        bounds_reset = True
        
    use_legacy_sigmoid = bool(config.get("useLegacySigmoid"))
    scale_factor = get_cfg("confidence_scale", "confidenceScale", 30.0)
    if not math.isfinite(scale_factor) or scale_factor <= 0:
        scale_factor = 30.0
        
    confidence = conf_min
    home_win_prob = 0.5
    predicted_win_prob = 0.5
    
    try:
        if use_legacy_sigmoid:
            sigmoid_abs = 1.0 / (1.0 + math.exp(-abs_score / scale_factor))
            confidence = conf_min + ((conf_max - conf_min) * sigmoid_abs)
            home_win_prob = 1.0 / (1.0 + math.exp(-score / scale_factor))
            predicted_win_prob = (1.0 - home_win_prob) if prediction == "AWAY" else home_win_prob
        else:
            home_win_prob = 1.0 / (1.0 + math.exp(-score / scale_factor))
            if prediction == "HOME":
                predicted_win_prob = home_win_prob
            elif prediction == "AWAY":
                predicted_win_prob = 1.0 - home_win_prob
            else:
                predicted_win_prob = 0.5
            confidence = clamp(predicted_win_prob * 100.0, conf_min, conf_max)
    except OverflowError:
        # Fallback if exp explodes
        if score > 0:
            home_win_prob = 1.0
        else:
            home_win_prob = 0.0
        predicted_win_prob = 1.0
        confidence = conf_max
        
    cap_risky_confidence = bool(config.get("capRiskyConfidence"))
    risky_confidence_cap = to_num(config.get("riskyConfidenceCap"), conf_min + 5.0)
    
    if cap_risky_confidence and prediction == "RISKY":
        confidence = min(confidence, risky_confidence_cap)
        
    confidence = clamp(confidence, conf_min, conf_max)
    if not math.isfinite(confidence):
        confidence = conf_min
        
    factor_breakdown = {
        "rank": weighted_rank,
        "pct": weighted_pct,
        "netRtg": weighted_net_rtg,
        "homeCourt": weighted_home_court,
        "momentum": weighted_momentum,
        "streak": weighted_streak,
        "form": weighted_form,
        "h2h": weighted_h2h,
        "forebet": weighted_forebet,
        "variance": weighted_variance,
        "homeAdv": home_advantage
    }
    
    meta = {
        "mode": "NEW" if use_new_features else "LEGACY",
        "confidenceMode": "LEGACY_SIGMOID" if use_legacy_sigmoid else "PROBABILITY",
        "scaleFactor": scale_factor,
        "threshold": threshold,
        "confBounds": {"min": conf_min, "max": conf_max, "wasReset": bounds_reset},
        "riskyCapApplied": cap_risky_confidence and prediction == "RISKY",
        "homeWinProbPct": round(home_win_prob * 1000) / 10.0,
        "predictedWinProbPct": round(predicted_win_prob * 1000) / 10.0
    }
    
    return {
        "score": round(score * 100) / 100.0,
        "prediction": prediction,
        "confidence": round(confidence * 10) / 10.0,
        "probability": round(predicted_win_prob * 1000) / 10.0,
        "factorBreakdown": factor_breakdown,
        "meta": meta
    }
