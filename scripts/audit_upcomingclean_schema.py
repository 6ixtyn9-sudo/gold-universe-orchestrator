import json
import os
import random
import time
from collections import Counter
from datetime import datetime, timezone

import gspread
from google.oauth2 import service_account

REGISTRY_PATH = "registry/registry.json"
OUT_PATH = "registry/upcomingclean_schema_audit.json"

UPCOMING_CANDIDATES = ["UpcomingClean", "Upcoming_Clean", "Upcoming"]

REQUIRED_COLS = [
    "date", "time", "league", "home", "away",
    "t1-q1", "t1-q1-conf", "t1-q2", "t1-q2-conf", "t1-q3", "t1-q3-conf", "t1-q4", "t1-q4-conf",
    "t2-q1-ou", "t2-q1-conf", "t2-q1-line", "t2-q2-ou", "t2-q2-conf", "t2-q2-line",
    "t2-q3-ou", "t2-q3-conf", "t2-q3-line", "t2-q4-ou", "t2-q4-conf", "t2-q4-line",
]

def col_to_a1(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s

def norm(h: str) -> str:
    return str(h or "").strip().lower().replace("\n", " ").replace("\t", " ")

def compact(h: str) -> str:
    return "".join(ch for ch in norm(h) if ch.isalnum() or ch in ["-", "_"]).replace("_", "").replace("-", "")

def main():
    sample_n = int(os.getenv("SAMPLE_N", "10"))
    seed = int(os.getenv("SEED", "7"))
    max_cols = int(os.getenv("MAX_COLS", "120"))
    sleep_s = float(os.getenv("SLEEP_S", "0.15"))

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

    header_fps = Counter()
    missing_sheet = 0
    results = []

    end_col = col_to_a1(max_cols)
    header_range = f"A1:{end_col}1"

    for idx, s in enumerate(sample, 1):
        sid = s.get("id")
        name = s.get("name")
        row = {"id": sid, "name": name, "found_sheet": None, "missing_required": [], "error": None}

        try:
            sh = gc.open_by_key(sid)

            ws = None
            for cand in UPCOMING_CANDIDATES:
                try:
                    ws = sh.worksheet(cand)
                    if ws:
                        row["found_sheet"] = cand
                        break
                except Exception:
                    ws = None

            if not ws:
                missing_sheet += 1
                results.append(row)
                continue

            vals = ws.get(header_range)
            headers = vals[0] if vals else []
            norm_headers = [norm(h) for h in headers if norm(h)]
            fp = "|".join(norm_headers)
            header_fps[fp] += 1

            present_norm = set(norm_headers)
            present_compact = set(compact(h) for h in headers if norm(h))

            missing = []
            for req in REQUIRED_COLS:
                if req in present_norm:
                    continue
                if req.replace("-", "").replace("_", "") in present_compact:
                    continue
                missing.append(req)

            row["missing_required"] = missing
            results.append(row)

        except Exception as e:
            row["error"] = str(e)
            results.append(row)

        if sleep_s:
            time.sleep(sleep_s)

        print(f"[{idx}/{len(sample)}] {name} -> sheet={row['found_sheet']} missing={len(row['missing_required'])} err={bool(row['error'])}")

    ok = sum(1 for r in results if r["found_sheet"] and not r["missing_required"] and not r["error"])

    audit = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sample_n": len(sample),
        "seed": seed,
        "max_cols_header_scan": max_cols,
        "header_range": header_range,
        "missing_upcoming_sheet_count": missing_sheet,
        "distinct_header_fingerprints_in_sample": len(header_fps),
        "top_header_fingerprints_counts": header_fps.most_common(3),
        "satellites_ok_all_required": ok,
        "required_cols": REQUIRED_COLS,
        "per_satellite": results,
    }

    json.dump(audit, open(OUT_PATH, "w", encoding="utf-8"), indent=2)
    print("✅ Wrote", OUT_PATH)
    print("✅ OK(all required):", ok, "/", len(sample))
    print("✅ Missing UpcomingClean:", missing_sheet)
    print("✅ Distinct header fingerprints:", len(header_fps))

if __name__ == "__main__":
    main()
