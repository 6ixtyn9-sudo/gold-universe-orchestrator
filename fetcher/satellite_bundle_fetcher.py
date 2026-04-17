from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fetcher.sheets_api_client import SheetsApiClient

CORE_TABS = [
    "Raw", "Clean",
    "UpcomingRaw", "UpcomingClean", "Upcoming_Clean", "Upcoming",
    "ResultsRaw", "ResultsClean", "Results_Clean", "Results",
    "Standings",
    "TeamQuarterStats_Tier2", "LeagueQuarterStats", "LeagueQuarterO_U_Stats",
    "Stats",
]

PATTERNS: Dict[str, re.Pattern] = {
    "RawH2H": re.compile(r"^RawH2H_(\d+)$", re.I),
    "CleanH2H": re.compile(r"^CleanH2H_(\d+)$", re.I),
    "RawRecentHome": re.compile(r"^RawRecentHome_(\d+)$", re.I),
    "CleanRecentHome": re.compile(r"^CleanRecentHome_(\d+)$", re.I),
    "RawRecentAway": re.compile(r"^RawRecentAway_(\d+)$", re.I),
    "CleanRecentAway": re.compile(r"^CleanRecentAway_(\d+)$", re.I),
}

DEFAULT_MAX_ROWS: Dict[str, int] = {
    "Raw": 2500,
    "Clean": 2500,
    "UpcomingRaw": 2000,
    "UpcomingClean": 2000,
    "ResultsRaw": 2000,
    "ResultsClean": 2000,
    "Standings": 2000,
    "TeamQuarterStats_Tier2": 2000,
    "LeagueQuarterStats": 2000,
    "LeagueQuarterO_U_Stats": 2000,
    "Stats": 2000,
}

DEFAULT_MAX_COLS: Dict[str, int] = {
    "Raw": 60,
    "Clean": 80,
    "UpcomingRaw": 120,
    "UpcomingClean": 120,
    "ResultsRaw": 80,
    "ResultsClean": 80,
    "Standings": 60,
    "TeamQuarterStats_Tier2": 60,
    "LeagueQuarterStats": 60,
    "LeagueQuarterO_U_Stats": 60,
    "Stats": 80,
}

PATTERN_MAX_ROWS = 2000
PATTERN_MAX_COLS = 60

def _escape_a1_tab(tab: str) -> str:
    return "'" + tab.replace("'", "''") + "'"

def _col_to_a1(n: int) -> str:
    return SheetsApiClient._col_to_a1(n)  # noqa: SLF001

def _chunk(xs: List[str], n: int) -> List[List[str]]:
    return [xs[i : i + n] for i in range(0, len(xs), n)]

@dataclass
class BundleResult:
    spreadsheet_id: str
    title: str
    out_dir: str
    tabs_written: List[str]
    errors: List[str]

def discover_tabs(meta: Dict[str, Any]) -> Tuple[str, List[str], Dict[str, Dict[str, Any]]]:
    title = meta.get("properties", {}).get("title", "")
    sheets = meta.get("sheets", []) or []
    titles: List[str] = []
    dims: Dict[str, Dict[str, Any]] = {}
    for sh in sheets:
        p = sh.get("properties", {}) or {}
        t = p.get("title")
        if not t:
            continue
        titles.append(t)
        gp = p.get("gridProperties", {}) or {}
        dims[t] = {"rows": gp.get("rowCount"), "cols": gp.get("columnCount")}
    return title, titles, dims

def select_core_tabs(titles: List[str]) -> Dict[str, str]:
    lut = {t.lower(): t for t in titles}
    selected: Dict[str, str] = {}
    for wanted in CORE_TABS:
        found = lut.get(wanted.lower())
        if found:
            selected[wanted] = found
    return selected

def select_pattern_tabs(titles: List[str]) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {k: [] for k in PATTERNS.keys()}
    for t in titles:
        for key, rx in PATTERNS.items():
            m = rx.match(t)
            if m:
                out[key].append(t)
    for key in out.keys():
        out[key] = sorted(out[key], key=lambda x: int(re.search(r"(\d+)$", x).group(1)))
    return out

def build_range(tab_title: str, max_rows: int, max_cols: int) -> str:
    end_col = _col_to_a1(max_cols)
    return f"{_escape_a1_tab(tab_title)}!A1:{end_col}{max_rows}"

def fetch_satellite_bundle(
    spreadsheet_id: str,
    out_dir: str,
    include_patterns: bool = True,
    min_interval_s: float = 1.2,
    max_rows_override: Optional[Dict[str, int]] = None,
    max_cols_override: Optional[Dict[str, int]] = None,
    batch_chunk_size: int = 35,
) -> BundleResult:
    outp = Path(out_dir)
    outp.mkdir(parents=True, exist_ok=True)

    client = SheetsApiClient(min_interval_s=min_interval_s)

    errors: List[str] = []
    tabs_written: List[str] = []

    meta = client.spreadsheet_meta(spreadsheet_id)
    title, titles, dims = discover_tabs(meta)

    core = select_core_tabs(titles)
    patterns = select_pattern_tabs(titles) if include_patterns else {}

    max_rows = dict(DEFAULT_MAX_ROWS)
    max_cols = dict(DEFAULT_MAX_COLS)
    if max_rows_override:
        max_rows.update(max_rows_override)
    if max_cols_override:
        max_cols.update(max_cols_override)

    ranges: List[str] = []
    range_to_key: Dict[str, str] = {}

    for logical, actual in core.items():
        r = build_range(actual, max_rows.get(logical, 2000), max_cols.get(logical, 80))
        ranges.append(r)
        range_to_key[r] = f"core::{logical}"

    if include_patterns:
        for key, tab_titles in patterns.items():
            for t in tab_titles:
                r = build_range(t, PATTERN_MAX_ROWS, PATTERN_MAX_COLS)
                ranges.append(r)
                range_to_key[r] = f"pattern::{key}::{t}"

    all_values: Dict[str, Any] = {}
    for chunk in _chunk(ranges, batch_chunk_size):
        resp = client.batch_get_values(spreadsheet_id, chunk)
        for vr in resp.get("valueRanges", []) or []:
            rr = vr.get("range")
            all_values[rr] = vr.get("values") or []

    manifest = {
        "spreadsheet_id": spreadsheet_id,
        "title": title,
        "fetched_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "tabs_total": len(titles),
        "core_tabs_selected": core,
        "pattern_tabs_selected_counts": {k: len(v) for k, v in (patterns or {}).items()},
        "dims": dims,
        "ranges_count": len(ranges),
        "notes": "Values are raw 2D arrays. Canonical parsing happens in later cards.",
    }
    (outp / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    for r, values in all_values.items():
        key = range_to_key.get(r, "unknown")
        safe = (
            key.replace("::", "__")
            .replace("/", "_")
            .replace("'", "")
            .replace(" ", "_")
        )
        payload = {"range": r, "key": key, "values": values}
        (outp / f"{safe}.json").write_text(json.dumps(payload), encoding="utf-8")
        tabs_written.append(key)

    return BundleResult(
        spreadsheet_id=spreadsheet_id,
        title=title,
        out_dir=str(outp),
        tabs_written=tabs_written,
        errors=errors,
    )
