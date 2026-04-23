from __future__ import annotations

import json
import re
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fetcher.parsers.results_clean import parse_results_clean
from fetcher.parsers.upcoming_clean import parse_upcoming_clean
from fetcher.parsers.config_parser import parse_config_sheet
from fetcher.satellite_bundle_fetcher import fetch_satellite_bundle


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _norm_team(s: str) -> str:
    s = (s or "").strip().lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def _bundle_dir(cache_root: str, spreadsheet_id: str) -> Path:
    return Path(cache_root) / spreadsheet_id


def _first_existing(dirp: Path, names: List[str]) -> Optional[Path]:
    for n in names:
        p = dirp / n
        if p.exists():
            return p
    return None


def _load_values_json(path: Path) -> List[List[Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload.get("values") or []


def _ft_winner_side(ft_h: Optional[float], ft_a: Optional[float]) -> Optional[str]:
    if ft_h is None or ft_a is None:
        return None
    if ft_h > ft_a:
        return "home"
    if ft_a > ft_h:
        return "away"
    return "draw"


def _parse_ou_pick(pred: str) -> Optional[Dict[str, Any]]:
    """Parse pick like 'OVER 58.5' or 'Q1 UNDER 48.5'."""
    s = (pred or "").strip().upper()
    # Pattern: [Q1-4] [OVER|UNDER] [LINE] ... [CONF%]
    m = re.search(r"(Q[1-4])?\s*(OVER|UNDER)\s+([\d.]+)", s)
    if not m:
        return None
        
    conf = 0.0
    m_conf = re.search(r"\((\d+)%\)", s)
    if m_conf:
        conf = float(m_conf.group(1))

    return {
        "quarter": m.group(1) or "FT",
        "direction": m.group(2),
        "line": float(m.group(3)),
        "prob_pct": conf,
    }


def _grade_ou_pick(pick: Dict[str, Any], actual_scores: Dict[str, float]) -> Optional[bool]:
    q = pick["quarter"]
    actual_total = actual_scores.get(q)
    if actual_total is None:
        return None

    line = pick["line"]
    if pick["direction"] == "OVER":
        return actual_total > line
    if pick["direction"] == "UNDER":
        return actual_total < line
    return None


def _gate_check(pick: Dict[str, Any], config: Dict[str, Any]) -> bool:
    """Check if a pick passes the configured confidence gates."""
    mtype = pick.get("type")
    # prob_pct might be a string like "60%" or a number
    try:
        conf_val = pick.get("prob_pct", 0)
        if isinstance(conf_val, str):
            conf_val = float(conf_val.replace("%", "").strip())
        conf = float(conf_val or 0)
    except:
        conf = 0
    
    if mtype == "ou":
        # ou_min_conf or ouMinConf
        min_conf = float(config.get("ou_min_conf") or config.get("ouminconf") or 60)
        return conf >= min_conf
    
    if mtype == "side":
        # confidence_min or confidencemin
        min_conf = float(config.get("confidence_min") or config.get("confidencemin") or 60)
        return conf >= min_conf
        
    if mtype == "hq":
        # hq_min_confidence or hqminconfidence
        min_conf = float(config.get("hq_min_confidence") or config.get("hqminconfidence") or 50)
        return conf >= min_conf
        
    return True # Default to pass if unknown type


def _grade_hq_pick(pick_q: str, actual_scores: Dict[str, float]) -> Optional[bool]:
    """Grade High Scoring Quarter. pick_q like 'Q1'."""
    qs = ["Q1", "Q2", "Q3", "Q4"]
    scores = {q: actual_scores.get(q) for q in qs}
    if any(v is None for v in scores.values()):
        return None
        
    max_val = max(scores.values())
    # Find all quarters with max score (handle ties)
    winners = [q for q, s in scores.items() if s == max_val]
    
    # If the picked quarter is among the winners, it's a hit
    return pick_q in winners


def _get_ft_line_fallback(u: Dict[str, Any]) -> Optional[float]:
    """FT Line fallback: ou-game -> FT Score -> Q1-Q4 sum -> Avg."""
    val = u.get("ou_game")
    if val and val > 100:
        return val

    # Try FT Score if it looks like a line
    ft_raw = u.get("ft_score_raw")
    if ft_raw:
        try:
            f = float(re.sub(r"[^\d.]", "", ft_raw))
            if f > 100:
                return f
        except:
            pass

    # Try sum of quarters
    q1, q2, q3, q4 = u.get("q1"), u.get("q2"), u.get("q3"), u.get("q4")
    if all(v is not None and v > 0 for v in [q1, q2, q3, q4]):
        return q1 + q2 + q3 + q4

    # Try Avg
    avg = u.get("avg")
    if avg and avg > 100:
        return avg

    return None


def _pick_side(pred: str, home: str, away: str) -> Optional[str]:
    p = (pred or "").strip().lower()
    if not p:
        return None

    if p in {"1", "home", "h"}:
        return "home"
    if p in {"2", "away", "a"}:
        return "away"
    if p in {"x", "draw", "d"}:
        return "draw"

    # sometimes pred is a team name
    ph = _norm_team(p)
    if ph and ph == _norm_team(home):
        return "home"
    if ph and ph == _norm_team(away):
        return "away"

    return None


def _league_key(s: str) -> str:
    return (s or "").strip() or "Unknown"


@dataclass
class SmokeAssayReport:
    spreadsheet_id: str
    bundle_dir: str
    generated_at: str
    used_cache: bool
    counts: Dict[str, Any]
    leagues: List[Dict[str, Any]]
    samples: List[Dict[str, Any]]


def run_smoke_assay(
    spreadsheet_id: str,
    *,
    cache_root: str = "cache/satellites",
    use_cache: bool = True,
    include_patterns: bool = False,
    min_interval_s: float = 1.2,
    credentials: Optional[Any] = None,
    max_samples: int = 80,
) -> Dict[str, Any]:
    """Bundle-based smoke assay: grades UpcomingClean pred vs ResultsClean FT winner."""
    if not spreadsheet_id or not str(spreadsheet_id).strip():
        raise ValueError("spreadsheet_id is required")

    bdir = _bundle_dir(cache_root, spreadsheet_id)
    manifest = bdir / "manifest.json"

    used_cache = False
    if use_cache and manifest.exists():
        used_cache = True
    else:
        fetch_satellite_bundle(
            spreadsheet_id=spreadsheet_id,
            out_dir=str(bdir),
            include_patterns=include_patterns,
            min_interval_s=min_interval_s,
            credentials=credentials,
        )

    # bundle file candidates
    upcoming_file = _first_existing(
        bdir,
        [
            "core__UpcomingClean.json",
            "core__Upcoming_Clean.json",
            "core__Upcoming.json",
            "core__UpcomingRaw.json",
        ],
    )
    results_file = _first_existing(
        bdir,
        [
            "core__ResultsClean.json",
            "core__Results_Clean.json",
            "core__Results.json",
            "core__ResultsRaw.json",
        ],
    )
    bet_slips_file = _first_existing(
        bdir,
        [
            "core__Bet_Slips.json",
            "core__BetSlips.json",
        ],
    )
    profiles_file = bdir / "core__LeagueQuarterO_U_Stats.json"
    config_file = bdir / "core__Config_Tier2.json"

    if not upcoming_file and not bet_slips_file:
        raise RuntimeError(f"Missing both Upcoming and Bet_Slips core tabs in bundle dir: {bdir}")

    upcoming_values = _load_values_json(upcoming_file) if upcoming_file else []
    results_values = _load_values_json(results_file) if results_file else []
    profiles_values = _load_values_json(profiles_file) if profiles_file.exists() else []
    config_values = _load_values_json(config_file) if config_file.exists() else []
    
    upcoming = parse_upcoming_clean(upcoming_values) if upcoming_values else []
    results = parse_results_clean(results_values) if results_values else []
    config = parse_config_sheet(config_values) if config_values else {}

    # Parse profiles: league -> { Q1: {mean: ...}, ... }
    profiles: Dict[str, Dict[str, Any]] = {}
    if profiles_values:
        from fetcher.parsers.common import build_header_map
        phm = build_header_map(profiles_values[0])
        for row in profiles_values[1:]:
            lname_raw = row[phm.get("league", 0)] if phm.get("league", 0) < len(row) else ""
            lname = str(lname_raw).strip().lower()
            prof = {}
            for q in ["q1", "q2", "q3", "q4"]:
                for mkey in [f"{q}_mean", f"{q}mean"]:
                    if mkey in phm and phm[mkey] < len(row):
                        try:
                            prof[q.upper()] = {"mean": float(str(row[phm[mkey]]))}
                        except:
                            pass
            if prof:
                profiles[lname] = prof

    # Build results index: game_id -> result row
    result_by_id: Dict[str, Dict[str, Any]] = {}
    for r in results:
        gid = r.get("game_id")
        if gid:
            result_by_id[gid] = r

    graded: List[Dict[str, Any]] = []
    league_stats: Dict[str, Dict[str, Any]] = {}

    for u in upcoming:
        gid = u.get("game_id")
        if not gid:
            continue
        rr = result_by_id.get(gid)
        if not rr:
            continue

        ft_h = rr.get("ft_h")
        ft_a = rr.get("ft_a")

        # Build actual scores map
        actual_scores = {
            "FT": (ft_h + ft_a) if ft_h is not None and ft_a is not None else None,
            "Q1": rr.get("q1_h", 0) + rr.get("q1_a", 0) if rr.get("q1_h") is not None else None,
            "Q2": rr.get("q2_h", 0) + rr.get("q2_a", 0) if rr.get("q2_h") is not None else None,
            "Q3": rr.get("q3_h", 0) + rr.get("q3_a", 0) if rr.get("q3_h") is not None else None,
            "Q4": rr.get("q4_h", 0) + rr.get("q4_a", 0) if rr.get("q4_h") is not None else None,
        }

        league = _league_key(u.get("league") or rr.get("league"))

        # --- 1. Main Pick (Side or O/U) ---
        pred_raw = u.get("pred", "")
        ou_pick = _parse_ou_pick(pred_raw)
        
        main_rec = None
        if ou_pick:
            # OU Logic
            if ou_pick["line"] <= 0:
                if ou_pick["quarter"] == "FT":
                    fb_line = _get_ft_line_fallback(u)
                    if fb_line: ou_pick["line"] = fb_line
                else:
                    prof = profiles.get(league.lower())
                    if prof and ou_pick["quarter"] in prof:
                        q_mean = prof[ou_pick["quarter"]]["mean"]
                        total_hist = sum(p["mean"] for p in prof.values())
                        game_ft = _get_ft_line_fallback(u) or total_hist
                        scaled = game_ft * (q_mean / total_hist)
                        ou_pick["line"] = math.floor(scaled) + 0.5
            
            # If line is still missing, we can't grade
            if ou_pick["line"] > 0:
                hit = _grade_ou_pick(ou_pick, actual_scores)
                if hit is not None:
                    main_rec = {
                        "type": "ou",
                        "prob_pct": ou_pick["prob_pct"] or u.get("prob_pct", 0),
                        "pick_side": f"{ou_pick['quarter']} {ou_pick['direction']} {ou_pick['line']}",
                        "actual_side": f"Total: {actual_scores.get(ou_pick['quarter'])}",
                        "hit": hit
                    }
        else:
            # Side Logic
            actual = _ft_winner_side(ft_h, ft_a)
            pick = _pick_side(pred_raw, u.get("home", ""), u.get("away", ""))
            if actual and pick:
                main_rec = {
                    "type": "side",
                    "prob_pct": u.get("prob_pct", 0),
                    "pick_side": pick,
                    "actual_side": actual,
                    "hit": (pick == actual)
                }

        if main_rec and _gate_check(main_rec, config):
            rec = {
                "game_id": gid, "league": league, "home": u.get("home"), "away": u.get("away"),
                "date": u.get("date"), "source": "upcoming",
                **main_rec
            }
            graded.append(rec)

        # --- 2. Explicit O/U signals ---
        for sig_obj in u.get("ou_signals", []):
            sig_str = sig_obj.get("signal", "")
            parsed = _parse_ou_pick(sig_str)
            if not parsed: continue
            
            if parsed["line"] <= 0:
                 q_key = parsed["quarter"].lower()
                 val = u.get(q_key)
                 if val and val > 0: parsed["line"] = val
            
            if parsed["line"] > 0:
                hit_ou = _grade_ou_pick(parsed, actual_scores)
                if hit_ou is not None:
                    rec_ou = {
                        "type": "ou", "prob_pct": parsed["prob_pct"],
                        "pick_side": f"{parsed['quarter']} {parsed['direction']} {parsed['line']}",
                        "actual_side": f"Total: {actual_scores.get(parsed['quarter'])}",
                        "hit": hit_ou
                    }
                    if _gate_check(rec_ou, config):
                        graded.append({
                            "game_id": f"{gid}_{parsed['quarter']}", "league": league,
                            "home": u.get("home"), "away": u.get("away"),
                            "date": u.get("date"), "source": "upcoming_ou",
                            **rec_ou
                        })

        # --- 3. HQ Pick ---
        hq_q = u.get("hq_pick")
        if hq_q:
            hit_hq = _grade_hq_pick(hq_q, actual_scores)
            if hit_hq is not None:
                rec_hq = {
                    "type": "hq", "prob_pct": u.get("hq_conf", 0),
                    "pick_side": f"Highest: {hq_q}",
                    "actual_side": f"Scores: Q1:{actual_scores['Q1']} Q2:{actual_scores['Q2']} Q3:{actual_scores['Q3']} Q4:{actual_scores['Q4']}",
                    "hit": hit_hq
                }
                if _gate_check(rec_hq, config):
                    graded.append({
                        "game_id": f"{gid}_HQ", "league": league,
                        "home": u.get("home"), "away": u.get("away"),
                        "date": u.get("date"), "source": "upcoming_hq",
                        **rec_hq
                    })

    # (Keep the league_stats aggregation at the end)
    for g in graded:
        st = league_stats.setdefault(g["league"], {"league": g["league"], "graded": 0, "hits": 0})
        st["graded"] += 1
        st["hits"] += 1 if g["hit"] else 0

    if bet_slips_file:
        from fetcher.parsers.common import build_header_map
        bs_vals = _load_values_json(bet_slips_file)
        if len(bs_vals) > 1:
            hm = build_header_map(bs_vals[0])
            for row in bs_vals[1:]:
                def _get_bs(keys):
                    for k in keys:
                        if k in hm and hm[k] < len(row):
                            return row[hm[k]]
                    return ""

                outcome_str = str(_get_bs(["outcome", "result"])).strip().lower()
                if outcome_str in ("win", "w", "1", "yes", "correct", "hit", "true"):
                    hit = True
                elif outcome_str in ("loss", "l", "0", "no", "wrong", "miss", "false"):
                    hit = False
                else:
                    continue

                league = _league_key(_get_bs(["league"]))
                date_val = str(_get_bs(["date"]))
                time_val = str(_get_bs(["time"]))
                pred_val = str(_get_bs(["selection_side", "selection_team", "pick"]))
                prob_val = _get_bs(["confidence", "confidence_pct"])
                try:
                    prob_pct = float(str(prob_val).replace("%", ""))
                except:
                    prob_pct = 0.0

                rec = {
                    "game_id": "bs_" + str(len(graded)),
                    "league": league,
                    "date": date_val,
                    "time": time_val,
                    "home": "N/A",
                    "away": "N/A",
                    "pred_raw": pred_val,
                    "pick_side": pred_val,
                    "actual_side": "N/A",
                    "hit": hit,
                    "prob_pct": prob_pct,
                    "ft_h": None,
                    "ft_a": None,
                    "source": "bet_slips",
                    "type": "bet_slip",
                }
                graded.append(rec)

                st = league_stats.setdefault(league, {"league": league, "graded": 0, "hits": 0})
                st["graded"] += 1
                st["hits"] += 1 if hit else 0

    leagues_out: List[Dict[str, Any]] = []
    for league, st in league_stats.items():
        graded_n = int(st["graded"])
        hits_n = int(st["hits"])
        hit_rate = (hits_n / graded_n) if graded_n else 0.0
        leagues_out.append(
            {
                "league": league,
                "graded": graded_n,
                "hits": hits_n,
                "hit_rate": hit_rate,
            }
        )

    leagues_out.sort(key=lambda x: (x["hit_rate"], x["graded"]), reverse=True)
    samples = sorted(graded, key=lambda x: (x.get("prob_pct", 0.0), x["date"] or ""), reverse=True)[:max_samples]

    counts = {
        "upcoming_parsed": len(upcoming),
        "results_parsed": len(results),
        "results_indexed": len(result_by_id),
        "graded": len(graded),
        "hits": sum(1 for r in graded if r["hit"]),
        "hit_rate": (sum(1 for r in graded if r["hit"]) / len(graded)) if graded else 0.0,
    }

    return {
        "spreadsheet_id": spreadsheet_id,
        "bundle_dir": str(bdir),
        "generated_at": _utc_now_iso(),
        "used_cache": used_cache,
        "counts": counts,
        "leagues": leagues_out,
        "samples": samples,
        "source_files": {
            "upcoming": str(upcoming_file) if upcoming_file else None,
            "results": str(results_file) if results_file else None,
            "bet_slips": str(bet_slips_file) if bet_slips_file else None,
            "profiles": str(profiles_file) if profiles_file.exists() else None,
        },
    }
