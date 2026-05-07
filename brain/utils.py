"""
brain/utils.py
──────────────
Shared utilities ported from .gs helper functions.
Direct ports of: _toNum, _parseConfPct, _formatConfPct, _normCdf,
_headerMap, _formatDate, _formatTime, parseScore, etc.
"""

from __future__ import annotations
import re
import math
from typing import Any, Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────
# Numeric Helpers
# ─────────────────────────────────────────────────────────────────────────

def to_num(v: Any, fallback: float = 0.0) -> float:
    """Port of _toNum / _elite_toNum from .gs"""
    if v is None or v == "":
        return fallback
    if isinstance(v, (int, float)):
        return v if math.isfinite(v) else fallback
    if isinstance(v, list):
        return fallback
    try:
        cleaned = str(v).replace(",", "").replace("%", "").replace(" ", "")
        n = float(cleaned)
        return n if math.isfinite(n) else fallback
    except (ValueError, TypeError):
        return fallback


def clamp(x: float, lo: float, hi: float) -> float:
    """Port of _elite_clamp"""
    try:
        x = float(x)
        if not math.isfinite(x):
            return lo
    except (ValueError, TypeError):
        return lo
    return max(lo, min(hi, x))


def elite_round(x: float, dp: int = 2) -> float:
    """Port of _elite_round"""
    if not math.isfinite(x):
        return 0.0
    p = 10 ** dp
    return round(x * p) / p


def parse_conf_pct(v: Any) -> Optional[float]:
    """
    Port of _parseConfPct from .gs
    Returns confidence as a percentage (0-100 scale).
    """
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        if 0 < v <= 1:
            return v * 100
        return v
    s = str(v).strip().replace("%", "").strip()
    try:
        n = float(s)
    except ValueError:
        return None
    if not math.isfinite(n):
        return None
    if 0 < n <= 1:
        return n * 100
    return n


def format_conf_pct(pct: Optional[float]) -> str:
    """Port of _formatConfPct"""
    if pct is None or not math.isfinite(pct):
        return "N/A"
    rounded = round(pct * 10) / 10
    if rounded == int(rounded):
        return f"{int(rounded)}%"
    return f"{rounded:.1f}%"


# ─────────────────────────────────────────────────────────────────────────
# Statistical Helpers
# ─────────────────────────────────────────────────────────────────────────

def norm_cdf(z: float) -> float:
    """
    Port of _elite_normCdf — Standard normal CDF approximation.
    """
    if not math.isfinite(z):
        return 0.5
    z = clamp(z, -10, 10)

    a1 = 0.254829592
    a2 = -0.284496736
    a3 = 1.421413741
    a4 = -1.453152027
    a5 = 1.061405429
    p = 0.3275911

    sign = -1 if z < 0 else 1
    z = abs(z)
    t = 1.0 / (1.0 + p * z)
    y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * math.exp(-z * z / 2)

    result = 0.5 * (1 + sign * y)
    return clamp(result, 0.0, 1.0)


# ─────────────────────────────────────────────────────────────────────────
# Header / Parsing Helpers
# ─────────────────────────────────────────────────────────────────────────

def normalize_header(s: Any) -> str:
    """Port of __s5_normalizeHeader__ — strip non-alphanumeric, lowercase."""
    if s is None:
        return ""
    return re.sub(r"[^a-z0-9]", "", str(s).lower()).strip()


def build_header_map(header_row: List[Any]) -> Dict[str, int]:
    """
    Port of _headerMap / _elite_headerMap / __s5_createHeaderMap__
    Returns {lowercase_key: column_index} and also normalized variants.
    """
    hm: Dict[str, int] = {}
    if not header_row:
        return hm
    for i, cell in enumerate(header_row):
        raw = str(cell or "").strip()
        if not raw:
            continue
        k1 = raw.lower()
        k2 = normalize_header(raw)
        if k1 not in hm:
            hm[k1] = i
        if k2 and k2 not in hm:
            hm[k2] = i
    return hm


def get_col(row: List[Any], hm: Dict[str, int], *keys: str) -> str:
    """
    Safely get a cell value from a row using header map.
    Tries each key in order.
    """
    for k in keys:
        idx = hm.get(k.lower()) or hm.get(normalize_header(k))
        if idx is not None and idx < len(row):
            v = str(row[idx] or "").strip()
            if v:
                return v
    return ""


# ─────────────────────────────────────────────────────────────────────────
# Score / Date / Time Parsing
# ─────────────────────────────────────────────────────────────────────────

def parse_score(score_str: Any) -> Optional[Tuple[int, int]]:
    """
    Port of _robbers_parseScore_ / parseScore
    Parses "105-98" or "105:98" → (105, 98)
    """
    if not score_str:
        return None
    m = re.search(r"(\d+)\s*[-:]\s*(\d+)", str(score_str))
    if m:
        return (int(m.group(1)), int(m.group(2)))
    return None


def format_date(raw: Any) -> str:
    """Port of _formatDate — returns dd/mm/yyyy string."""
    if not raw:
        return ""
    s = str(raw).strip()
    # Already in dd/mm/yyyy?
    if re.match(r"^\d{1,2}/\d{1,2}/\d{4}$", s):
        return s
    # Try ISO format
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(3)}/{m.group(2)}/{m.group(1)}"
    return s


def format_time(raw: Any) -> str:
    """Port of _formatTime"""
    if not raw:
        return ""
    return str(raw).strip()


# ─────────────────────────────────────────────────────────────────────────
# Pick Parsing
# ─────────────────────────────────────────────────────────────────────────

def parse_pick_side(v: Any) -> int:
    """
    Port of _robbers_parsePick_
    Returns 1 (home), 2 (away), or 0 (unknown)
    """
    if v in (1, "1"):
        return 1
    if v in (2, "2"):
        return 2
    s = str(v or "").strip().lower()
    if s in ("home", "h", "1"):
        return 1
    if s in ("away", "a", "visitor", "2"):
        return 2
    return 0


def parse_pick_for_game(pred_raw: Any, home: str, away: str) -> int:
    """
    Port of _robbers_parsePickForGame_
    Also matches by team name substring.
    """
    pick = parse_pick_side(pred_raw)
    if pick in (1, 2):
        return pick

    pred = str(pred_raw or "").strip().lower()
    if not pred:
        return 0

    home_n = home.strip().lower()
    away_n = away.strip().lower()

    if pred == home_n:
        return 1
    if pred == away_n:
        return 2
    if home_n and (pred in home_n or home_n in pred):
        return 1
    if away_n and (pred in away_n or away_n in pred):
        return 2
    return 0


# ─────────────────────────────────────────────────────────────────────────
# O/U Signal Parsing
# ─────────────────────────────────────────────────────────────────────────

def parse_ou_signal(raw: Any) -> Optional[Dict[str, Any]]:
    """
    Port of _parseOUSignal from Contract_Enforcement.gs
    Returns {direction, line, conf, ev, edge, star} or None.
    """
    if not raw:
        return None
    s = str(raw).strip()
    if re.match(r"^EST\s", s, re.IGNORECASE):
        return None
    if s in ("N/A", ""):
        return None

    star = bool(re.search(r"[★⭐]", s))
    clean = re.sub(r"[★⭐●○]", "", s)
    clean = re.sub(r"\([\s\d.%]*\)", "", clean)
    clean = re.sub(r"\s+", " ", clean).strip().upper()

    # Pattern: "OVER 58.8 (55%)"
    m1 = re.match(r"^(OVER|UNDER)\s+([\d.]+)\s*\((\d+)\s*%?\)", clean, re.IGNORECASE)
    if m1:
        return {
            "direction": m1.group(1).upper(),
            "line": float(m1.group(2)),
            "conf": float(m1.group(3)),
            "ev": float("nan"),
            "edge": float("nan"),
            "star": star,
        }

    # Pattern: "OVER 58.8"
    m2 = re.match(r"^(OVER|UNDER)\s+([\d.]+)", clean, re.IGNORECASE)
    if m2:
        return {
            "direction": m2.group(1).upper(),
            "line": float(m2.group(2)),
            "conf": 50.0,
            "ev": float("nan"),
            "edge": float("nan"),
            "star": star,
        }

    return None


def norm_ou_pick_key(match_key: str, pick: str) -> str:
    """
    Port of _normOUPickKey from Contract_Enforcement.gs
    Normalized key for O/U duplicate detection.
    """
    s = re.sub(r"\s+", " ", str(pick or "").upper()).strip()
    m = re.match(r"(Q[1-4])\s*[:\-]?\s*(OVER|UNDER)\s+([\d.]+)", s, re.IGNORECASE)
    if not m:
        return f"{str(match_key or '').strip().lower()}|RAW|{s}"
    line_num = float(m.group(3))
    line = f"{round(line_num, 1):.1f}" if math.isfinite(line_num) else "NaN"
    return f"{str(match_key or '').strip().lower()}|{m.group(1)}|{m.group(2)}|{line}"


# ─────────────────────────────────────────────────────────────────────────
# Tier System (Port of Accumulator_Builder.gs getTierObject)
# ─────────────────────────────────────────────────────────────────────────

class TierResult:
    """Structured tier classification result."""
    __slots__ = ("tier", "symbol", "display", "color", "weight")

    def __init__(self, tier: str, symbol: str, display: str, color: str, weight: float):
        self.tier = tier
        self.symbol = symbol
        self.display = display
        self.color = color
        self.weight = weight

    def __repr__(self):
        return f"TierResult(tier={self.tier!r}, display={self.display!r})"


def get_tier_object(conf_pct: Any) -> TierResult:
    """
    Port of getTierObject from Accumulator_Builder.gs
    Maps confidence % to tier classification.
    """
    n = to_num(conf_pct, 0)
    n = int(round(n))
    n = max(0, min(100, n))

    if n >= 75:
        return TierResult("ELITE", "★★", f"★ ({n}%) ★", "#006400", 1.0)
    elif n >= 70:
        return TierResult("STRONG", "★●", f"★ ({n}%) ●", "#228B22", 0.85)
    elif n >= 58:
        return TierResult("MEDIUM", "●○", f"● ({n}%) ○", "#FFD700", 0.65)
    elif n >= 50:
        return TierResult("WEAK", "○", f"○ ({n}%)", "#FFA500", 0.45)
    else:
        return TierResult("SKIP", "", f"({n}%)", "#CCCCCC", 0.0)


def get_tier_display(conf_pct: Any) -> str:
    """Port of getOUTierDisplay"""
    return get_tier_object(conf_pct).display


def get_tier_name(conf_pct: Any) -> str:
    """Port of getOUTier"""
    return get_tier_object(conf_pct).tier


# ─────────────────────────────────────────────────────────────────────────
# Config Helpers
# ─────────────────────────────────────────────────────────────────────────

def to_bool(v: Any) -> bool:
    """Port of _toBool from Contract_Enforcement.gs"""
    if isinstance(v, bool):
        return v
    s = str(v if v is not None else "").strip().upper()
    return s in ("TRUE", "YES", "1")


# ─────────────────────────────────────────────────────────────────────────
# Config Stamp ID (Port of ConfigLedger_Satellite._deriveStampId)
# ─────────────────────────────────────────────────────────────────────────

def djb2_hash(s: str) -> str:
    """Port of _djb2Hash from Config_Ledger_Satellite.gs"""
    h = 5381
    for ch in s:
        h = ((h << 5) + h) ^ ord(ch)
        h = h & 0xFFFFFFFF
    return format(h, "08X")


def derive_stamp_id(cfg: dict) -> str:
    """Port of _deriveStampId"""
    import json
    keys = sorted(cfg.keys())
    canonical = json.dumps(cfg, sort_keys=True)
    return f"CFG_{djb2_hash(canonical)}"
