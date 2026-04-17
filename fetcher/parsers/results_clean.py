from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .common import (
    build_header_map,
    norm,
    norm_lower,
    row_is_blank,
    sheet_date_to_iso,
    sheet_time_to_hhmm,
    to_int,
)

_SCORE_PAIR_RE = re.compile(r"(-?\d+)\s*[-:]\s*(-?\d+)")

def normalize_game_id(date_iso: str, home: str, away: str) -> str:
    d = (date_iso or "nodate").strip()[:10] or "nodate"
    h = re.sub(r"[^a-z0-9]", "", (home or "").lower())
    a = re.sub(r"[^a-z0-9]", "", (away or "").lower())
    return f"{d}|{h}|{a}"

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

def _parse_pair(v: Any) -> Tuple[Optional[int], Optional[int]]:
    if v is None or v == "":
        return None, None
    if isinstance(v, (int, float)):
        return None, None
    s = str(v).strip()
    m = _SCORE_PAIR_RE.search(s)
    if not m:
        return None, None
    return to_int(m.group(1), 0), to_int(m.group(2), 0)

def _extract_period_scores(hm: Dict[str, int], row: List[Any], period: str) -> Tuple[Optional[int], Optional[int]]:
    p = period.upper().replace(" ", "")
    if p == "FT":
        aliases_pair = ["ft", "final", "score", "result"]
        aliases_h = ["fth", "ft_h", "ft home", "home ft", "home_score", "home score", "totalh", "total_h"]
        aliases_a = ["fta", "ft_a", "ft away", "away ft", "away_score", "away score", "totala", "total_a"]
    else:
        q = p
        aliases_pair = [q, q.replace("Q", "")]
        aliases_h = [f"{q}h", f"{q}_h", f"{q} home", f"home {q}", f"{q}home"]
        aliases_a = [f"{q}a", f"{q}_a", f"{q} away", f"away {q}", f"{q}away"]

    vh = _get(hm, row, aliases_h, default=None)
    va = _get(hm, row, aliases_a, default=None)
    if vh not in (None, "") and va not in (None, ""):
        return to_int(vh, 0), to_int(va, 0)

    vpair = _get(hm, row, aliases_pair, default=None)
    h, a = _parse_pair(vpair)
    if h is not None and a is not None:
        return h, a

    return None, None

def parse_results_clean(values: List[List[Any]]) -> List[Dict[str, Any]]:
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
        time_hhmm = sheet_time_to_hhmm(_get(hm, r, ["time", "kickoff"], ""))  # now HH:MM when numeric
        league = norm(_get(hm, r, ["league", "comp", "competition"], ""))

        q1h, q1a = _extract_period_scores(hm, r, "Q1")
        q2h, q2a = _extract_period_scores(hm, r, "Q2")
        q3h, q3a = _extract_period_scores(hm, r, "Q3")
        q4h, q4a = _extract_period_scores(hm, r, "Q4")
        oth = to_int(_get(hm, r, ["oth", "ot_h", "ot home"], 0), 0)
        ota = to_int(_get(hm, r, ["ota", "ot_a", "ot away"], 0), 0)

        fth, fta = _extract_period_scores(hm, r, "FT")

        # If FT missing but quarters exist, compute FT from quarters (+OT if present)
        if (fth is None or fta is None) and all(v is not None for v in [q1h,q2h,q3h,q4h,q1a,q2a,q3a,q4a]):
            fth = (q1h or 0) + (q2h or 0) + (q3h or 0) + (q4h or 0) + (oth or 0)
            fta = (q1a or 0) + (q2a or 0) + (q3a or 0) + (q4a or 0) + (ota or 0)

        rec = {
            "league": league,
            "date": date_iso,
            "time": time_hhmm,
            "home": home,
            "away": away,
            "q1_h": q1h, "q1_a": q1a,
            "q2_h": q2h, "q2_a": q2a,
            "q3_h": q3h, "q3_a": q3a,
            "q4_h": q4h, "q4_a": q4a,
            "ot_h": oth, "ot_a": ota,
            "ft_h": fth, "ft_a": fta,
        }
        rec["game_id"] = normalize_game_id(rec["date"], rec["home"], rec["away"])
        out.append(rec)

    return out
