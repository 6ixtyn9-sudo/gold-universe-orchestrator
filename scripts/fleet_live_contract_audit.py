import os
import re
import json
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

sb = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_KEY"),
)

PAGE_SIZE = 1000

STATIC_REQUIRED_TABS = {
    "SportConfig",
    "Raw",
    "Clean",
    "ResultsRaw",
    "ResultsClean",
    "Standings",
    "UpcomingRaw",
    "UpcomingClean",
    "Config_Accumulator",
    "Config_Tier1",
    "Config_Tier1_Proposals",
    "Config_Tier2",
    "Config_Tier2_Proposals",
    "Stats",
    "LeagueQuarterStats",
    "LeagueQuarterO_U_Stats",
    "Analysis_Tier1",
    "TeamQuarterStats_Tier2",
    "Stats_Tier2_Accuracy",
    "Stats_Tier2_Simulation",
    "Stats_Tier2_Optimization",
    "Satellite_Identity",
    "Bet_Slips",
    "Acca_Central",
    "Accuracy_Report",
}

OPTIONAL_RUNTIME_OUTPUTS = {
    "Tier1_Predictions",
    "OU_Log",
    "Tier2_Log",
}

DYNAMIC_PATTERNS = {
    "RawH2H": re.compile(r"^RawH2H_(\d+)$"),
    "CleanH2H": re.compile(r"^CleanH2H_(\d+)$"),
    "RawRecentHome": re.compile(r"^RawRecentHome_(\d+)$"),
    "CleanRecentHome": re.compile(r"^CleanRecentHome_(\d+)$"),
    "RawRecentAway": re.compile(r"^RawRecentAway_(\d+)$"),
    "CleanRecentAway": re.compile(r"^CleanRecentAway_(\d+)$"),
}

def fetch_all_rows():
    rows = []
    start = 0
    while True:
        resp = (
            sb.table("satellite_tab_snapshots")
            .select("sheet_id, tab_name, last_mirrored_at, row_count")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows

rows = fetch_all_rows()

# latest snapshot per (sheet_id, tab_name)
latest = {}
for row in rows:
    key = (row["sheet_id"], row["tab_name"])
    ts = row.get("last_mirrored_at") or ""
    if key not in latest or ts > (latest[key].get("last_mirrored_at") or ""):
        latest[key] = row

tabs_by_sheet = defaultdict(set)
meta_by_sheet = defaultdict(dict)

for (sheet_id, tab_name), row in latest.items():
    tabs_by_sheet[sheet_id].add(tab_name)
    meta_by_sheet[sheet_id][tab_name] = {
        "last_mirrored_at": row.get("last_mirrored_at"),
        "row_count": row.get("row_count") or 0,
        "is_empty": (row.get("row_count") or 0) == 0,
    }

report = {
    "summary": {},
    "sheets": [],
}

for sheet_id, tabs in sorted(tabs_by_sheet.items()):
    missing_static = sorted(STATIC_REQUIRED_TABS - tabs)
    missing_optional = sorted(OPTIONAL_RUNTIME_OUTPUTS - tabs)

    dynamic = {}
    for family, pattern in DYNAMIC_PATTERNS.items():
        found = []
        for t in tabs:
            m = pattern.match(t)
            if m:
                found.append(int(m.group(1)))
        dynamic[family] = sorted(found)

    report["sheets"].append({
        "sheet_id": sheet_id,
        "present_tabs": sorted(tabs),
        "missing_static": missing_static,
        "missing_optional": missing_optional,
        "dynamic_families": dynamic,
        "empty_tabs": sorted(
            t for t in tabs
            if meta_by_sheet[sheet_id][t]["is_empty"]
        ),
    })

report["summary"] = {
    "total_sheets": len(tabs_by_sheet),
    "missing_static_any": sum(1 for s in report["sheets"] if s["missing_static"]),
    "missing_optional_any": sum(1 for s in report["sheets"] if s["missing_optional"]),
}

with open("fleet_live_contract_audit.json", "w") as f:
    json.dump(report, f, indent=2)

print(json.dumps(report["summary"], indent=2))
print("Saved: fleet_live_contract_audit.json")
