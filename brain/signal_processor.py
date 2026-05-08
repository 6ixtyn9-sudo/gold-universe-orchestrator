"""
brain/signal_processor.py
─────────────────────────
Port of O/U statistical prediction models from Accumulator_Builder.gs and Game_Processor.gs.
Contains predictFTOverUnder, t2ou_scoreOverUnderPick_, and calculateFTVariance.
"""

import logging
import math
from typing import Dict, Any, Optional

from brain.utils import to_num, clamp, elite_round, norm_cdf

log = logging.getLogger("brain.signal_processor")

def calculate_ft_variance(stats: Dict[str, Any], home: str, away: str, config: Dict[str, Any]) -> float:
    """
    Port of calculateFTVariance from Accumulator_Builder.gs
    Returns SIGMA (standard deviation), not raw variance.
    """
    sigma_floor = to_num(config.get("sigmaFloor"), 15.0)
    sigma_scale = to_num(config.get("sigmaScale"), 1.0)
    sigma_cap = to_num(config.get("sigmaCap"), 60.0)
    fallback_sigma = to_num(config.get("fallbackSigma"), 20.0)
    
    use_team_variance = config.get("useTeamVariance", True)
    
    # In Python we don't have the full spreadsheet cache mechanism yet,
    # we rely on the stats object passed in (which contains margin stats).
    # For now, default to fallback or league stats.
    # Note: the full team-based variance calculation requires variance maps.
    # We will use fallback for now, as the main FT_OU uses dynamic derivation from line.
    return fallback_sigma

def t2ou_score_over_under_pick(model: Dict[str, Any], line: float, cfg: Dict[str, Any], calibrator: Any = None, meta: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Port of t2ou_scoreOverUnderPick_ from Game_Processor.gs
    """
    if not meta:
        meta = {}
        
    line_num = to_num(line, float('nan'))
    if not math.isfinite(line_num):
        return {"play": False, "reason": "invalid_line"}
        
    mu = to_num(model.get("mu"), float('nan'))
    sigma = to_num(model.get("sigma"), float('nan'))
    samples = to_num(model.get("samples"), 0)
    
    if not math.isfinite(mu):
        return {"play": False, "reason": "invalid_mu"}
    if not math.isfinite(sigma) or sigma <= 0:
        return {"play": False, "reason": "invalid_sigma"}
        
    min_samples = to_num(cfg.get("ou_min_samples"), 1)
    if samples < min_samples:
        return {"play": False, "reason": "insufficient_samples", "samples": samples, "minSamples": min_samples}
        
    tiny_thr = 15.0
    if mu >= 35 and line_num <= tiny_thr:
        return {"play": False, "reason": "scale_mismatch_tiny_line", "line": line_num, "mu": mu, "sigma": sigma, "samples": samples}
        
    push_width = clamp(to_num(cfg.get("ou_push_width"), 0.5), 0.0, 1.5)
    conf_scale = max(1.0, to_num(cfg.get("ou_confidence_scale"), 30.0))
    odds = to_num(cfg.get("ou_american_odds"), -110.0)
    if odds == 0: odds = -110.0
    edge_threshold = to_num(cfg.get("ou_edge_threshold"), 0.02)
    min_ev = to_num(cfg.get("ou_min_ev"), 0.005)
    
    is_integer_line = abs(line_num - round(line_num)) < 0.001
    
    if is_integer_line and push_width > 0:
        z_lo = (line_num - push_width - mu) / sigma
        z_hi = (line_num + push_width - mu) / sigma
        cdf_lo = norm_cdf(z_lo)
        cdf_hi = norm_cdf(z_hi)
        p_under_raw = cdf_lo
        p_push_raw = max(0.0, cdf_hi - cdf_lo)
        p_over_raw = max(0.0, 1.0 - cdf_hi)
    else:
        z = (line_num - mu) / sigma
        cdf = norm_cdf(z)
        p_under_raw = cdf
        p_over_raw = 1.0 - cdf
        p_push_raw = 0.0
        
    p_under_raw = clamp(p_under_raw, 0.0, 1.0)
    p_over_raw = clamp(p_over_raw, 0.0, 1.0)
    p_push_raw = clamp(p_push_raw, 0.0, 1.0)
    
    p_sum = p_under_raw + p_over_raw + p_push_raw
    if p_sum > 0 and abs(p_sum - 1.0) > 0.001:
        p_under_raw /= p_sum
        p_over_raw /= p_sum
        p_push_raw /= p_sum
        
    non_push = clamp(p_under_raw + p_over_raw, 1e-12, 1.0)
    
    p_over_cond_raw = p_over_raw / non_push
    p_under_cond_raw = p_under_raw / non_push
    
    sample_ratio = clamp(samples / conf_scale, 0.0, 1.0)
    shrink = 0.5 + 0.5 * sample_ratio
    
    p_over_cond = clamp(0.5 + (p_over_cond_raw - 0.5) * shrink, 0.0, 1.0)
    p_under_cond = clamp(0.5 + (p_under_cond_raw - 0.5) * shrink, 0.0, 1.0)
    
    line_source = str(meta.get("lineSource", "")).upper()
    is_league_stats = any(x in line_source for x in ["LEAGUE_STATS", "PROXY", "SUM", "FALLBACK"]) or line_source in ["NONE", ""]
    
    if is_league_stats:
        bias_shrink = 0.7
        p_over_cond = 0.5 + (p_over_cond - 0.5) * bias_shrink
        p_under_cond = 0.5 + (p_under_cond - 0.5) * bias_shrink
        
    direction = "OVER" if p_over_cond >= p_under_cond else "UNDER"
    p_win_cond = p_over_cond if direction == "OVER" else p_under_cond
    
    p_win = non_push * p_win_cond
    p_lose = non_push * (1.0 - p_win_cond)
    p_push = p_push_raw
    
    profit = (100.0 / abs(odds)) if odds < 0 else (odds / 100.0)
    ev = p_win * profit - p_lose
    
    p_break_even = (1.0 - p_push) / (1.0 + profit)
    edge = p_win - p_break_even
    
    if edge < edge_threshold:
        return {
            "play": False,
            "reason": "edge_below_threshold",
            "edge": elite_round(edge, 4),
            "threshold": edge_threshold,
            "dir": "Over" if direction == "OVER" else "Under",
            "ev": elite_round(ev, 4),
            "confPct": clamp(round(p_win_cond * 100), 45, 95)
        }
        
    if ev < min_ev:
        return {
            "play": False,
            "reason": "ev_below_threshold",
            "ev": elite_round(ev, 4),
            "minEV": min_ev,
            "dir": "Over" if direction == "OVER" else "Under",
            "edge": elite_round(edge, 4),
            "confPct": clamp(round(p_win_cond * 100), 45, 95)
        }
        
    raw_conf_pct = round(p_win_cond * 100)
    conf_pct = clamp(raw_conf_pct, 45, 95)
    
    # League weight mitigation
    league_name = str(meta.get("league", "")).upper()
    league_name = "".join(c for c in league_name if c.isalnum())
    if league_name:
        l_weight = to_num(cfg.get(f"league_weight_{league_name}"), 1.0)
        if l_weight < 1.0:
            conf_pct = 50 + (conf_pct - 50) * l_weight
            
    tier = "WEAK"
    sym = "○"
    if edge >= 0.06 and conf_pct >= 60 and ev >= 0.05:
        tier = "STRONG"
        sym = "★"
    elif edge >= 0.035 and conf_pct >= 55 and ev >= 0.02:
        tier = "MEDIUM"
        sym = "●"
        
    dir_display = "Over" if direction == "OVER" else "Under"
    text = f"{dir_display} {line_num:.1f} {sym} ({round(conf_pct)}%)"
    
    tier_weight = 1.0 if tier == "STRONG" else (0.7 if tier == "MEDIUM" else 0.4)
    points_from_line = abs(mu - line_num)
    edge_score = elite_round(points_from_line * tier_weight * (conf_pct / 100.0), 2)
    
    return {
        "play": True,
        "dir": dir_display,
        "direction": dir_display,
        "line": line_num,
        "mu": elite_round(mu, 2),
        "sigma": elite_round(sigma, 2),
        "samples": samples,
        "pWin": elite_round(p_win, 4),
        "pWinCond": elite_round(p_win_cond, 4),
        "pPush": elite_round(p_push, 4),
        "pLose": elite_round(p_lose, 4),
        "pBreakEven": elite_round(p_break_even, 4),
        "edge": elite_round(edge, 4),
        "ev": elite_round(ev, 4),
        "rawConfPct": raw_conf_pct,
        "confPct": elite_round(conf_pct, 1),
        "tier": tier,
        "text": text,
        "edgeScore": edge_score
    }

def predict_ft_over_under(game: Dict[str, Any], stats: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Port of predictFTOverUnder from Accumulator_Builder.gs
    """
    def pick_num(*args):
        for a in args:
            n = to_num(a, float('nan'))
            if math.isfinite(n):
                return n
        return float('nan')
        
    def pick_bool(*args):
        for a in args:
            if isinstance(a, bool): return a
            s = str(a).lower().strip()
            if s == 'true': return True
            if s == 'false': return False
        return False
        
    user_ft = config.get("ft", {})
    
    min_conf = pick_num(user_ft.get("minConf"), config.get("ou_min_conf"), 55.0)
    min_ev = pick_num(user_ft.get("minEV"), config.get("ou_min_ev"), 0.005)
    edge_threshold = pick_num(user_ft.get("edgeThreshold"), config.get("ou_edge_threshold"), 0.04)
    american_odds = pick_num(user_ft.get("americanOdds"), config.get("ou_american_odds"), -110.0)
    
    sigma_floor = pick_num(user_ft.get("sigmaFloor"), config.get("ou_sigma_floor"), 6.0)
    sigma_scale = pick_num(user_ft.get("sigmaScale"), config.get("ou_sigma_scale"), 1.0)
    sigma_from_line_pct = pick_num(user_ft.get("sigmaFromLinePct"), 0.075)
    
    shrink_k = pick_num(user_ft.get("shrinkK"), config.get("ou_shrink_k"), 8.0)
    confidence_scale = pick_num(user_ft.get("confidenceScale"), config.get("ou_confidence_scale"), 20.0)
    min_samples = pick_num(user_ft.get("minSamples"), config.get("ou_min_samples"), 5.0)
    
    model_error = pick_num(user_ft.get("modelError"), config.get("ou_model_error"), 4.0)
    prob_temp = pick_num(user_ft.get("probTemp"), config.get("ou_prob_temp"), 1.15)
    
    forebet_weight = pick_num(user_ft.get("forebetWeight"), config.get("forebet_ou_weight_ft"), 0.35)
    forebet_enabled = pick_bool(user_ft.get("forebetEnabled"), config.get("forebet_blend_enabled"), True)
    
    dynamic_sigma_k = pick_num(user_ft.get("dynamicSigmaK"), 1.15)
    dynamic_sigma_floor = pick_num(user_ft.get("dynamicSigmaFloor"), 10.0)
    dynamic_clamp_pct = pick_num(user_ft.get("dynamicClampPct"), 0.25)
    dynamic_forebet_bias = pick_num(user_ft.get("dynamicForebetBias"), 0.06)
    
    known_fallback_value = pick_num(user_ft.get("knownFallbackValue"), 105.0)
    
    def skip_result(reason: str, ctx: Dict[str, Any] = None) -> Dict[str, Any]:
        if ctx is None: ctx = {}
        return {
            "direction": "N/A",
            "line": ctx.get("line"),
            "pick": "Pass",
            "expectedTotal": ctx.get("expectedTotal"),
            "confidence": 0,
            "ev": ctx.get("ev"),
            "edge": ctx.get("edge"),
            "tier": "SKIP",
            "tierDisplay": "○",
            "sigma": ctx.get("sigma"),
            "skip": True,
            "reason": reason,
            "forebetUsed": ctx.get("forebetUsed", False),
            "forebetTotal": ctx.get("forebetTotal"),
            "historicalTotal": ctx.get("historicalTotal"),
            "muSource": ctx.get("muSource", "NONE"),
            "push": 0,
            "lineSource": ctx.get("lineSource")
        }
        
    home = str(game.get("home", "")).strip()
    away = str(game.get("away", "")).strip()
    if not home or not away:
        return skip_result("Missing teams")
        
    league_key = str(game.get("leagueKey") or game.get("league") or game.get("competition") or config.get("league") or "").strip()
    
    line_source = "NONE"
    raw_line = None
    for k in ["ftBookLine", "ou-ft-line", "ftLine", "line", "total"]:
        if game.get(k) is not None and str(game.get(k)) != "":
            raw_line = game.get(k)
            line_source = k
            break
            
    ft_line = to_num(raw_line, float('nan'))
    
    if not math.isfinite(ft_line) or ft_line <= 0:
        avg_val = to_num(game.get("avg") or game.get("Avg") or game.get("average"), float('nan'))
        if math.isfinite(avg_val) and avg_val > 0:
            if not (math.isfinite(to_num(game.get("forebetTotal"), float('nan'))) and to_num(game.get("forebetTotal"), 0) > 0):
                ft_line = avg_val
                line_source = "FOREBET_AVG_FALLBACK"
                
    if not math.isfinite(ft_line) or ft_line <= 0:
        q1 = to_num(game.get("q1") or game.get("Q1"), float('nan'))
        q2 = to_num(game.get("q2") or game.get("Q2"), float('nan'))
        q3 = to_num(game.get("q3") or game.get("Q3"), float('nan'))
        q4 = to_num(game.get("q4") or game.get("Q4"), float('nan'))
        if math.isfinite(q1) and math.isfinite(q2) and math.isfinite(q3) and math.isfinite(q4):
            q_sum = q1 + q2 + q3 + q4
            if q_sum > 0:
                ft_line = q_sum
                line_source = "QUARTER_SUM"
                
    if not math.isfinite(ft_line) or ft_line <= 0:
        return skip_result("No valid FT line found", {"lineSource": line_source})
        
    # Resolve league prior dynamically
    dyn_mu = ft_line
    dyn_sigma = max(math.sqrt(ft_line) * dynamic_sigma_k, dynamic_sigma_floor)
    league_prior = {
        "mu": dyn_mu,
        "sigma": dyn_sigma,
        "forebetBias": dynamic_forebet_bias,
        "clampMin": round(dyn_mu * (1.0 - dynamic_clamp_pct)),
        "clampMax": round(dyn_mu * (1.0 + dynamic_clamp_pct)),
        "dynamic": True
    }
    league_prior_source = "DYNAMIC"
    
    fb_bias = dynamic_forebet_bias
    
    forebet_total = float('nan')
    forebet_valid = False
    forebet_source = "NONE"
    
    fb_tot = to_num(game.get("forebetTotal"), float('nan'))
    if math.isfinite(fb_tot) and fb_tot > 0:
        forebet_total = fb_tot
        forebet_valid = True
        forebet_source = "game.forebetTotal"
    elif game.get("predScore"):
        parts = str(game.get("predScore")).split("-")
        if len(parts) >= 2:
            ph = to_num(parts[0], float('nan'))
            pa = to_num(parts[1], float('nan'))
            if math.isfinite(ph) and math.isfinite(pa) and ph > 0 and pa > 0:
                forebet_total = ph + pa
                forebet_valid = True
                forebet_source = "predScore"
    
    if not forebet_valid:
        avg_fb = to_num(game.get("avg") or game.get("Avg"), float('nan'))
        if math.isfinite(avg_fb) and avg_fb > 0 and abs(avg_fb - ft_line) > 0.5:
            forebet_total = avg_fb
            forebet_valid = True
            forebet_source = "avg"
            
    fb_enabled = forebet_enabled
    fb_weight = forebet_weight
    if not math.isfinite(fb_weight) or fb_weight <= 0:
        fb_enabled = False
        
    historical_total = float('nan')
    historical_source = "NONE"
    actual_team_samples = 0
    
    # We lack sumQuarterPredictions in Python for now.
    # Fallback to Forebet as prior.
    if forebet_valid:
        historical_total = forebet_total
        historical_source = "FOREBET_AS_PRIOR"
        
    if not math.isfinite(historical_total):
        historical_total = league_prior["mu"]
        historical_source = "LEAGUE_PRIOR"
        
    if not math.isfinite(historical_total):
        historical_total = ft_line
        historical_source = "LINE_AS_PRIOR"
        
    expected_total = historical_total
    forebet_used = False
    
    if historical_source == "FOREBET_AS_PRIOR":
        forebet_used = True
        if league_prior and math.isfinite(league_prior["mu"]):
            expected_total = 0.85 * historical_total + 0.15 * league_prior["mu"]
    elif historical_source == "LEAGUE_PRIOR":
        if fb_enabled and forebet_valid and math.isfinite(fb_weight) and fb_weight > 0:
            fb_adj_lp = forebet_total + fb_bias
            boosted_weight = min(fb_weight * 2, 0.75)
            expected_total = (1 - boosted_weight) * historical_total + boosted_weight * fb_adj_lp
            forebet_used = True
            
    sigma = float('nan')
    if league_prior and math.isfinite(league_prior["sigma"]):
        sigma = league_prior["sigma"]
        
    if not math.isfinite(sigma):
        sigma = sigma_from_line_pct * ft_line
        
    if math.isfinite(model_error) and model_error > 0:
        sigma = math.sqrt(sigma * sigma + model_error * model_error)
        
    sigma = max(sigma * sigma_scale, sigma_floor)
    
    sample_counts = {
        "TEAM_SUMQTR": actual_team_samples if actual_team_samples > 0 else 20,
        "FOREBET_AS_PRIOR": 50,
        "LEAGUE_PRIOR": 100,
        "LINE_AS_PRIOR": 200
    }
    sample_count = sample_counts.get(historical_source, 50)
    
    ctx = {
        "line": ft_line,
        "lineSource": line_source,
        "expectedTotal": round(expected_total, 1),
        "sigma": round(sigma, 1),
        "forebetUsed": forebet_used,
        "forebetTotal": forebet_total if forebet_valid else None,
        "historicalTotal": round(historical_total, 1),
        "muSource": historical_source
    }
    
    model = {
        "mu": expected_total,
        "sigma": sigma,
        "samples": sample_count,
        "source": "FT_SOP"
    }
    
    ou_cfg = config.copy()
    ou_cfg["ou_edge_threshold"] = edge_threshold
    ou_cfg["ou_min_ev"] = min_ev
    ou_cfg["ou_min_samples"] = min_samples
    ou_cfg["ou_confidence_scale"] = confidence_scale
    
    scored = t2ou_score_over_under_pick(model, ft_line, ou_cfg, None, ctx)
    if not scored:
        return skip_result("Scorer returned null", ctx)
        
    if not scored.get("play"):
        ctx["ev"] = scored.get("ev")
        ctx["edge"] = scored.get("edge")
        ctx["confidence"] = scored.get("confPct")
        return skip_result(scored.get("reason", "Scorer declined"), ctx)
        
    if scored.get("confPct", 0) < min_conf:
        ctx["ev"] = scored.get("ev")
        ctx["edge"] = scored.get("edge")
        ctx["confidence"] = scored.get("confPct")
        return skip_result(f"Conf {scored.get('confPct')}% < {min_conf}%", ctx)
        
    return {
        "direction": scored.get("dir", "Over"),
        "line": ft_line,
        "pick": scored.get("text", f"{scored.get('dir')} {ft_line} ({scored.get('confPct')}%)"),
        "expectedTotal": round(expected_total, 1),
        "confidence": scored.get("confPct"),
        "ev": round(scored.get("ev", 0), 4),
        "edge": round(scored.get("edge", 0), 4),
        "tier": scored.get("tier", "MEDIUM"),
        "tierDisplay": "★" if scored.get("tier") == "STRONG" else ("●" if scored.get("tier") == "MEDIUM" else "○"),
        "sigma": round(sigma, 1),
        "skip": False,
        "reason": "",
        "forebetUsed": forebet_used,
        "forebetTotal": forebet_total if forebet_valid else None,
        "historicalTotal": round(historical_total, 1),
        "muSource": historical_source,
        "push": scored.get("push", 0),
        "lineSource": line_source
    }
