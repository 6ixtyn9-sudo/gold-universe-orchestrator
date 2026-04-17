from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .common import build_header_map, norm, norm_lower, row_is_blank, to_float, to_int

def _looks_like_header(row: List[Any]) -> bool:
    if not row:
        return False
    cells = [norm_lower(c) for c in row if norm(c)]
    if len(cells) < 3:
        return False
    joined = " ".join(cells)
    has_team = ("team" in joined) or ("club" in joined) or ("squad" in joined)
    has_played = ("gp" in cells) or ("played" in joined) or ("matches" in joined) or ("pld" in cells)
    has_w = ("w" in cells) or ("wins" in joined) or ("won" in joined)
    has_l = ("l" in cells) or ("loss" in joined) or ("lost" in joined)
    has_pts = ("pts" in cells) or ("points" in joined) or ("pct" in cells) or ("%" in joined)
    return has_team and (has_played or has_w or has_pts or has_l)

def _single_label_row(row: List[Any]) -> Optional[str]:
    if not row:
        return None
    non_empty = [norm(c) for c in row if norm(c)]
    if len(non_empty) == 1 and len(non_empty[0]) <= 40:
        return non_empty[0]
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

def parse_standings(values: List[List[Any]]) -> List[Dict[str, Any]]:
    """
    Layout-agnostic standings parser.
    - Finds any header row that looks like standings (Team + GP/W/L/PTS/PCT)
    - Parses rows until blank row or next header/section label.
    - If there is a section label row (single cell like 'East', 'West', 'Group A'), it is stored in 'section'.
    Output fields are best-effort: position/team/gp/w/l/pf/pa/pct/pts, plus section.
    """
    out: List[Dict[str, Any]] = []
    section: Optional[str] = None
    i = 0

    while i < len(values):
        row = values[i] or []
        if row_is_blank(row):
            i += 1
            continue

        label = _single_label_row(row)
        # section labels are common ("East", "West", "Group A") but optional
        if label and (i + 1) < len(values) and _looks_like_header(values[i + 1] or []):
            section = label
            i += 1
            continue

        if not _looks_like_header(row):
            i += 1
            continue

        header = row
        hm = build_header_map(header)
        i += 1

        while i < len(values):
            r = values[i] or []
            if row_is_blank(r):
                break

            # stop if next block begins
            if _looks_like_header(r):
                i -= 1
                break
            if _single_label_row(r) and (i + 1) < len(values) and _looks_like_header(values[i + 1] or []):
                i -= 1
                break

            team = _get(hm, r, ["team name", "team", "club", "squad"], default="")
            if not norm(team):
                i += 1
                continue

            rec = {
                "section": section,
                "position": to_int(_get(hm, r, ["position", "pos", "#"], 0), 0),
                "team": norm(team),
                "gp": to_int(_get(hm, r, ["gp", "played", "pld", "matches"], 0), 0),
                "w": to_int(_get(hm, r, ["w", "wins", "won"], 0), 0),
                "l": to_int(_get(hm, r, ["l", "losses", "lost"], 0), 0),
                "pf": to_int(_get(hm, r, ["pf", "pts for", "points for", "for"], 0), 0),
                "pa": to_int(_get(hm, r, ["pa", "pts against", "points against", "against"], 0), 0),
                "pct": to_float(_get(hm, r, ["pct", "win%", "win %", "%"], 0.0), 0.0),
                "pts": to_int(_get(hm, r, ["pts", "points"], 0), 0),
            }
            out.append(rec)
            i += 1

        i += 1

    return out
