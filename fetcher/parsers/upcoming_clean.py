from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .common import build_header_map, norm, norm_lower, row_is_blank, sheet_date_to_iso, sheet_time_to_hhmm, to_float
from .results_clean import normalize_game_id

def _find_header_row(values: List[List[Any]]) -> Optional[int]:
    scan = min(len(values), 15)
    for i in range(scan):
        row = values[i] or []
        cells = [norm_lower(c) for c in row if norm(c)]
        if not cells:
            continue
        joined = " ".join(cells)
        if ("home" in joined) and ("away" in joined):
            return i
    return None

def _get(hm: Dict[str, int], row: List[Any], keys: List[str], default: Any = "") -> Any:
    for k in keys:
        k1 = k.strip().lower()
        k2 = "".join(ch for ch in k1 if ch.isalnum())
        if k1 in hm:
            idx = hm[k1]
            if idx < len(row):
                return row[idx]
        if k2 in hm:
            idx = hm[k2]
            if idx < len(row):
                return row[idx]
    return default

def _pct(v: Any) -> float:
    if v is None or v == "":
        return 0.0
    if isinstance(v, str):
        s = v.strip().replace("%", "")
        try:
            return float(s)
        except Exception:
            return 0.0
    try:
        return float(v)
    except Exception:
        return 0.0

def parse_upcoming_clean(values: List[List[Any]]) -> List[Dict[str, Any]]:
    if not values:
        return []

    hi = _find_header_row(values)
    if hi is None:
        return []

    header = values[hi] or []
    hm = build_header_map(header)

    out: List[Dict[str, Any]] = []
    for r in values[hi + 1 :]:
        if not r or row_is_blank(r):
            continue

        home = norm(_get(hm, r, ["home", "home team", "hometeam"], ""))
        away = norm(_get(hm, r, ["away", "away team", "awayteam"], ""))
        if not home or not away:
            continue

        date_iso = sheet_date_to_iso(_get(hm, r, ["date", "game_date", "gamedate"], ""))
        time_hhmm = sheet_time_to_hhmm(_get(hm, r, ["time", "kickoff"], ""))
        league = norm(_get(hm, r, ["league", "comp", "competition"], ""))

        pred = norm(_get(hm, r, ["pred", "prediction", "pick", "winner"], ""))
        prob = _pct(_get(hm, r, ["prob %", "prob%", "prob", "probability", "confidence", "conf"], 0))
        avg = to_float(_get(hm, r, ["avg"], ""))

        rec = {
            "league": league,
            "date": date_iso,
            "time": time_hhmm,
            "home": home,
            "away": away,
            "pred": pred,
            "prob_pct": prob,
            "avg": avg,
            "q1": to_float(_get(hm, r, ["q1"], "")),
            "q2": to_float(_get(hm, r, ["q2"], "")),
            "q3": to_float(_get(hm, r, ["q3"], "")),
            "q4": to_float(_get(hm, r, ["q4"], "")),
            "ot": to_float(_get(hm, r, ["ot"], "")),
            "ft_score_raw": str(_get(hm, r, ["ft score"], "")),
            "ou_game": to_float(_get(hm, r, ["ou-game", "ou_game"], "")),
            "ou_game_tier": norm(_get(hm, r, ["ou-game-tier", "ou_game_tier"], "")),
        }

        # Extract O/U signals if present
        ou_signals = []
        for q in ["q1", "q2", "q3", "q4", "game"]:
            val = _get(hm, r, [f"ou-{q}", f"ou_{q}"], "")
            if val:
                ou_signals.append({"quarter": q.upper() if q != "game" else "FT", "signal": str(val)})
        rec["ou_signals"] = ou_signals

        # Extract High Scoring Quarter (HQ) signal
        hq_pick = norm(_get(hm, r, ["enh-high-q", "enh_high_q"], ""))
        if hq_pick:
            rec["hq_pick"] = hq_pick
            rec["hq_conf"] = to_float(_get(hm, r, ["enh-high-q-conf", "enh_high_q_conf"], ""))

        rec["game_id"] = normalize_game_id(rec["date"], rec["home"], rec["away"])
        out.append(rec)

    return out
