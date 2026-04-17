import json
import os
import random
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

import gspread
from google.oauth2 import service_account

REGISTRY_PATH = "registry/registry.json"
OUT_PATH = "registry/satellite_schema_catalogue_sample.json"

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

def col_to_a1(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s

def norm(s: str) -> str:
    return str(s or "").strip()

def norm_lower(s: str) -> str:
    return norm(s).lower()

def header_fingerprint(headers):
    hs = [norm_lower(h) for h in headers if norm(h)]
    return "|".join(hs)

def safe_get_header(ws, header_range):
    vals = ws.get(header_range)
    return vals[0] if vals else []

def main():
    sample_n = int(os.getenv("SAMPLE_N", "6"))
    seed = int(os.getenv("SEED", "7"))
    max_cols = int(os.getenv("MAX_COLS", "160"))
    sleep_s = float(os.getenv("SLEEP_S", "0.12"))
    pattern_header_fetch_limit = int(os.getenv("PATTERN_HEADER_FETCH_LIMIT", "2"))

    random.seed(seed)

    reg = json.load(open(REGISTRY_PATH, "r", encoding="utf-8"))
    sats = reg.get("satellites", [])
    if not sats:
        raise SystemExit("Registry has no satellites")

    sample = sats if len(sats) <= sample_n else random.sample(sats, sample_n)

    creds = service_account.Credentials.from_service_account_file(
        "service_account.json",
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
        ],
    )
    gc = gspread.authorize(creds)

    end_col = col_to_a1(max_cols)
    header_range = f"A1:{end_col}1"

    overall = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sample_n": len(sample),
        "seed": seed,
        "header_range": header_range,
        "core_tabs": CORE_TABS,
        "patterns": list(PATTERNS.keys()),
        "presence_counts": Counter(),
        "pattern_counts": Counter(),
        "core_header_fingerprints": defaultdict(Counter),
        "per_satellite": [],
    }

    for idx, s in enumerate(sample, 1):
        sid = s.get("id")
        name = s.get("name")

        entry = {
            "id": sid,
            "name": name,
            "worksheets": [],
            "core": {},
            "patterns": {k: {"titles": [], "max_index": 0, "sampled_headers": {}} for k in PATTERNS.keys()},
            "errors": [],
        }

        try:
            sh = gc.open_by_key(sid)
            worksheets = sh.worksheets()
            titles = [ws.title for ws in worksheets]
            entry["worksheets"] = titles

            title_set_lower = {t.lower(): t for t in titles}

            # Core tabs: capture header if exists
            for tab in CORE_TABS:
                found_title = None
                if tab.lower() in title_set_lower:
                    found_title = title_set_lower[tab.lower()]

                if not found_title:
                    continue

                try:
                    ws = sh.worksheet(found_title)
                    headers = safe_get_header(ws, header_range)
                    fp = header_fingerprint(headers)

                    entry["core"][tab] = {
                        "title": found_title,
                        "headers_raw": headers,
                        "header_fp": fp,
                        "rows": ws.row_count,
                        "cols": ws.col_count,
                    }
                    overall["presence_counts"][tab] += 1
                    overall["core_header_fingerprints"][tab][fp] += 1
                except Exception as e:
                    entry["errors"].append(f"core_tab_error:{tab}:{e}")

                if sleep_s:
                    time.sleep(sleep_s)

            # Pattern tabs: discover all, then sample first N per pattern for header capture
            for ws_title in titles:
                for key, rx in PATTERNS.items():
                    m = rx.match(ws_title)
                    if not m:
                        continue
                    n = int(m.group(1))
                    p = entry["patterns"][key]
                    p["titles"].append(ws_title)
                    p["max_index"] = max(p["max_index"], n)

            for key in PATTERNS.keys():
                all_titles = sorted(entry["patterns"][key]["titles"], key=lambda t: int(re.search(r"(\d+)$", t).group(1)))
                overall["pattern_counts"][key] += len(all_titles)

                # capture only a couple headers per pattern (usually identical across _1..n)
                for t in all_titles[:pattern_header_fetch_limit]:
                    try:
                        ws = sh.worksheet(t)
                        headers = safe_get_header(ws, header_range)
                        fp = header_fingerprint(headers)
                        entry["patterns"][key]["sampled_headers"][t] = {
                            "headers_raw": headers,
                            "header_fp": fp,
                            "rows": ws.row_count,
                            "cols": ws.col_count,
                        }
                    except Exception as e:
                        entry["errors"].append(f"pattern_tab_error:{key}:{t}:{e}")

                    if sleep_s:
                        time.sleep(sleep_s)

            overall["per_satellite"].append(entry)
            print(f"[{idx}/{len(sample)}] catalogued: {name} (worksheets={len(titles)})")

        except Exception as e:
            entry["errors"].append(f"open_error:{e}")
            overall["per_satellite"].append(entry)
            print(f"[{idx}/{len(sample)}] ERROR opening: {name}: {e}")

    # Make counters JSON serializable
    overall["presence_counts"] = dict(overall["presence_counts"])
    overall["pattern_counts"] = dict(overall["pattern_counts"])
    overall["core_header_fingerprints"] = {k: dict(v) for k, v in overall["core_header_fingerprints"].items()}

    json.dump(overall, open(OUT_PATH, "w", encoding="utf-8"), indent=2)
    print("✅ Wrote", OUT_PATH)
    print("Presence counts (core):", overall["presence_counts"])
    print("Pattern total tabs found:", overall["pattern_counts"])

if __name__ == "__main__":
    main()
