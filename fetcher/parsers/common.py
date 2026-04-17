from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, List

SHEETS_EPOCH = date(1899, 12, 30)

def sheet_date_to_iso(v: Any) -> str:
    if v is None or v == "":
        return ""
    if isinstance(v, str):
        s = v.strip()
        if len(s) >= 10 and s[4] == "-" and s[7] == "-" and s[:4].isdigit():
            return s[:10]
        return s
    if isinstance(v, (int, float)):
        d = SHEETS_EPOCH + timedelta(days=int(v))
        return d.isoformat()
    return str(v)

def sheet_time_to_hhmm(v: Any) -> str:
    """
    Handles:
      - float day fractions (0..1): 0.5 -> 12:00
      - float datetime serials: use fractional part
      - strings like "13:30" -> "13:30"
      - strings like "0.9375" -> parsed as float fraction
    """
    if v is None or v == "":
        return ""
    if isinstance(v, str):
        s = v.strip()
        if ":" in s and len(s) >= 4:
            return s[:5]
        try:
            fv = float(s)
            v = fv
        except Exception:
            return s

    if isinstance(v, (int, float)):
        fv = float(v)
        frac = fv % 1.0
        mins = int(round(frac * 24 * 60))
        mins = mins % (24 * 60)
        hh = mins // 60
        mm = mins % 60
        return f"{hh:02d}:{mm:02d}"

    return str(v)

def to_int(v: Any, default: int = 0) -> int:
    if v is None or v == "":
        return default
    try:
        return int(float(v))
    except Exception:
        return default

def to_float(v: Any, default: float = 0.0) -> float:
    if v is None or v == "":
        return default
    try:
        return float(v)
    except Exception:
        return default

def norm(s: Any) -> str:
    return str(s or "").strip()

def norm_lower(s: Any) -> str:
    return norm(s).lower()

def row_is_blank(row: List[Any]) -> bool:
    return (row is None) or all(c is None or c == "" for c in row)

def build_header_map(header_row: List[Any]) -> Dict[str, int]:
    hm: Dict[str, int] = {}
    for i, h in enumerate(header_row or []):
        k = norm_lower(h)
        if not k:
            continue
        k2 = "".join(ch for ch in k if ch.isalnum())
        if k not in hm:
            hm[k] = i
        if k2 and k2 not in hm:
            hm[k2] = i
    return hm
