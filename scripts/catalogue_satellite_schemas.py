import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import json
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

from fetcher.sheets_api_client import SheetsApiClient

REGISTRY_PATH = "registry/registry.json"
OUT_PATH = os.getenv("OUT_PATH", "registry/satellite_schema_catalogue_sample_v2.json")

CORE_TABS = [
    "Raw", "Clean",
    "UpcomingRaw", "UpcomingClean", "Upcoming_Clean", "Upcoming",
    "ResultsRaw", "ResultsClean", "Results_Clean", "Results",
    "Standings",
    "TeamQuarterStats_Tier2", "LeagueQuarterStats", "LeagueQuarterO_U_Stats",
    "Stats",
]

PATTERNS = {
    "RawH2H": re.compile(r"^RawH2H_(\d+)$", re.I),
    "CleanH2H": re.compile(r"^CleanH2H_(\d+)$", re.I),
    "RawRecentHome": re.compile(r"^RawRecentHome_(\d+)$", re.I),
    "CleanRecentHome": re.compile(r"^CleanRecentHome_(\d+)$", re.I),
    "RawRecentAway": re.compile(r"^RawRecentAway_(\d+)$", re.I),
    "CleanRecentAway": re.compile(r"^CleanRecentAway_(\d+)$", re.I),
}

def _norm(s: str) -> str:
    return str(s or "").strip()

def _norm_lower(s: str) -> str:
    return _norm(s).lower()

def _header_fingerprint(headers):
    hs = [_norm_lower(h) for h in headers if _norm(h)]
    return "|".join(hs)

def _escape_a1_tab(tab: str) -> str:
    return "'" + tab.replace("'", "''") + "'"

def _find_header_row(preview_rows):
    best_idx = None
    for i, row in enumerate(preview_rows or []):
        if not row:
            continue
        non_empty = [c for c in row if c not in ("", None)]
        if len(non_empty) >= 4:
            best_idx = i
            break
    if best_idx is None:
        best_idx = 0
    headers = (preview_rows[best_idx] if preview_rows else [])
    return best_idx + 1, headers

def main():
    sample_n = int(os.getenv("SAMPLE_N", "6"))
    seed = int(os.getenv("SEED", "7"))
    max_cols = int(os.getenv("MAX_COLS", "160"))
    preview_rows_n = int(os.getenv("PREVIEW_ROWS", "5"))
    pattern_header_fetch_limit = int(os.getenv("PATTERN_HEADER_FETCH_LIMIT", "2"))
    min_interval_s = float(os.getenv("MIN_INTERVAL_S", "1.2"))

    random.seed(seed)

    reg = json.load(open(REGISTRY_PATH, "r", encoding="utf-8"))
    sats = reg.get("satellites", [])
    if not sats:
        raise SystemExit("Registry has no satellites")

    sample = sats if len(sats) <= sample_n else random.sample(sats, sample_n)

    client = SheetsApiClient(min_interval_s=min_interval_s)

    overall = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sample_n": len(sample),
        "seed": seed,
        "max_cols": max_cols,
        "preview_rows": preview_rows_n,
        "min_interval_s": min_interval_s,
        "core_tabs": CORE_TABS,
        "patterns": list(PATTERNS.keys()),
        "presence_counts": Counter(),
        "pattern_counts": Counter(),
        "core_header_fingerprints": defaultdict(Counter),
        "per_satellite": [],
    }

    end_col = SheetsApiClient._col_to_a1(max_cols)  # noqa: SLF001
    end_row = preview_rows_n

    for idx, s in enumerate(sample, 1):
        sid = s.get("id")
        name = s.get("name")

        entry = {
            "id": sid,
            "name": name,
            "worksheets": [],
            "core": {},
            "patterns": {k: {"titles": [], "max_index": 0, "sampled": {}} for k in PATTERNS.keys()},
            "errors": [],
        }

        try:
            meta = client.spreadsheet_meta(sid)
            sheets = meta.get("sheets", []) or []
            titles = [sh.get("properties", {}).get("title") for sh in sheets]
            titles = [t for t in titles if t]
            entry["worksheets"] = titles

            title_lut = {t.lower(): t for t in titles}
            dims = {}
            for sh in sheets:
                p = sh.get("properties", {}) or {}
                t = p.get("title")
                gp = p.get("gridProperties", {}) or {}
                if t:
                    dims[t] = {"rows": gp.get("rowCount"), "cols": gp.get("columnCount")}

            for t in titles:
                for key, rx in PATTERNS.items():
                    m = rx.match(t)
                    if not m:
                        continue
                    n = int(m.group(1))
                    p = entry["patterns"][key]
                    p["titles"].append(t)
                    p["max_index"] = max(p["max_index"], n)

            ranges = []

            def add_range(tab_title: str):
                ranges.append(f"{_escape_a1_tab(tab_title)}!A1:{end_col}{end_row}")

            for tab in CORE_TABS:
                t = title_lut.get(tab.lower())
                if t:
                    add_range(t)

            for key in PATTERNS.keys():
                all_titles = sorted(
                    entry["patterns"][key]["titles"],
                    key=lambda x: int(re.search(r"(\d+)$", x).group(1)) if re.search(r"(\d+)$", x) else 0,
                )
                overall["pattern_counts"][key] += len(all_titles)
                for t in all_titles[:pattern_header_fetch_limit]:
                    add_range(t)

            vr_map = {}
            if ranges:
                resp = client.batch_get_values(sid, ranges)
                for vr in (resp.get("valueRanges") or []):
                    vr_map[vr.get("range")] = (vr.get("values") or [])

            for tab in CORE_TABS:
                t = title_lut.get(tab.lower())
                if not t:
                    continue
                overall["presence_counts"][tab] += 1
                rng = f"{_escape_a1_tab(t)}!A1:{end_col}{end_row}"
                preview = vr_map.get(rng, [])
                header_row_idx, headers = _find_header_row(preview)
                fp = _header_fingerprint(headers)
                entry["core"][tab] = {
                    "title": t,
                    "dims": dims.get(t, {}),
                    "preview": preview,
                    "header_row_index": header_row_idx,
                    "headers_raw": headers,
                    "header_fp": fp,
                }
                overall["core_header_fingerprints"][tab][fp] += 1

            for key in PATTERNS.keys():
                all_titles = sorted(
                    entry["patterns"][key]["titles"],
                    key=lambda x: int(re.search(r"(\d+)$", x).group(1)) if re.search(r"(\d+)$", x) else 0,
                )
                for t in all_titles[:pattern_header_fetch_limit]:
                    rng = f"{_escape_a1_tab(t)}!A1:{end_col}{end_row}"
                    preview = vr_map.get(rng, [])
                    header_row_idx, headers = _find_header_row(preview)
                    fp = _header_fingerprint(headers)
                    entry["patterns"][key]["sampled"][t] = {
                        "dims": dims.get(t, {}),
                        "preview": preview,
                        "header_row_index": header_row_idx,
                        "headers_raw": headers,
                        "header_fp": fp,
                    }

            overall["per_satellite"].append(entry)
            print(f"[{idx}/{len(sample)}] catalogued via Sheets API: {name} (tabs={len(titles)})")

        except Exception as e:
            entry["errors"].append(str(e))
            overall["per_satellite"].append(entry)
            print(f"[{idx}/{len(sample)}] ERROR: {name}: {e}")

    overall["presence_counts"] = dict(overall["presence_counts"])
    overall["pattern_counts"] = dict(overall["pattern_counts"])
    overall["core_header_fingerprints"] = {k: dict(v) for k, v in overall["core_header_fingerprints"].items()}

    json.dump(overall, open(OUT_PATH, "w", encoding="utf-8"), indent=2)
    print("✅ Wrote", OUT_PATH)
    print("Presence counts (core):", overall["presence_counts"])
    print("Pattertotal tabs found:", overall["pattern_counts"])

if __name__ == "__main__":
    main()
