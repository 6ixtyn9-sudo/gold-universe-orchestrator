from __future__ import annotations

from typing import Any, Dict, List

from .common import norm, sheet_date_to_iso, to_int

def parse_game_log_table(values: List[List[Any]]) -> List[Dict[str, Any]]:
    """
    Parses CleanH2H_* / CleanRecentHome_* / CleanRecentAway_*.
    Expected header includes:
      Date, Home, Away, Q1H, Q1A, ... Q4H, Q4A, OTH, OTA, Winner, TotalH, TotalA, FT, SumMismatch
    """
    if not values:
        return []
    header = values[0] or []
    hm = {str(h or "").strip().lower(): idx for idx, h in enumerate(header)}

    def get(row, key, default=""):
        idx = hm.get(key)
        return row[idx] if idx is not None and idx < len(row) else default

    out: List[Dict[str, Any]] = []
    for r in values[1:]:
        if not r or all(c == "" or c is None for c in r):
            continue

        home = norm(get(r, "home", ""))
        away = norm(get(r, "away", ""))
        if not home or not away:
            continue

        winner = str(get(r, "winner", "") or "").strip().upper()
        winner_side = "HOME" if winner == "H" else ("AWAY" if winner == "A" else winner)

        out.append(
            {
                "date": sheet_date_to_iso(get(r, "date", "")),
                "home": home,
                "away": away,
                "q1h": to_int(get(r, "q1h", 0), 0),
                "q1a": to_int(get(r, "q1a", 0), 0),
                "q2h": to_int(get(r, "q2h", 0), 0),
                "q2a": to_int(get(r, "q2a", 0), 0),
                "q3h": to_int(get(r, "q3h", 0), 0),
                "q3a": to_int(get(r, "q3a", 0), 0),
                "q4h": to_int(get(r, "q4h", 0), 0),
                "q4a": to_int(get(r, "q4a", 0), 0),
                "oth": to_int(get(r, "oth", 0), 0),
                "ota": to_int(get(r, "ota", 0), 0),
                "totalh": to_int(get(r, "totalh", 0), 0),
                "totala": to_int(get(r, "totala", 0), 0),
                "winner_side": winner_side,
                "ft_text": norm(get(r, "ft", "")),
                "sum_mismatch": norm(get(r, "summismatch", "")),
            }
        )
    return out
