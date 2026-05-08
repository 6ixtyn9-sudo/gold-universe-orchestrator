import os
import json
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

# Expected tabs for a fully-updated satellite based on actual .gs execution
EXPECTED_TABS = {
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
    "Accuracy_Report"
}

# Core tabs that MUST be present for the brain to function
CORE_TABS = {
    "UpcomingClean",
    "ResultsClean",
    "Standings",
    "Config_Tier1",
    "Config_Tier2",
    "Satellite_Identity",
    "Config_Accumulator"
}

print("Fetching all satellite snapshots...")
# Note: Pagination logic is required if rows > 1000, so I will add a fetch loop.
def fetch_all_rows():
    rows = []
    start = 0
    while True:
        resp = (
            sb.table("satellite_tab_snapshots")
            .select("sheet_id, tab_name, last_mirrored_at")
            .range(start, start + 1000 - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        start += 1000
    return rows

rows = fetch_all_rows()

satellite_tabs = defaultdict(set)
satellite_sync = {}

for row in rows:
    sid = row["sheet_id"]
    satellite_tabs[sid].add(row["tab_name"])
    satellite_sync[sid] = row.get("last_mirrored_at")

print(f"Total satellites in mirror: {len(satellite_tabs)}")
print()

# Categorize satellites
complete = []
missing_core = []
missing_some = []
legacy_candidates = []

for sid, tabs in satellite_tabs.items():
    missing = EXPECTED_TABS - tabs
    missing_core_tabs = CORE_TABS - tabs

    if not missing:
        complete.append(sid)
    elif missing_core_tabs:
        missing_core.append((sid, missing_core_tabs, missing))
    else:
        missing_some.append((sid, missing))
        
    # Legacy heuristic: missing brain-specific tabs but has old tabs
    has_old_bet_slips = "Bet_Slips" in tabs or "bet_slips" in tabs
    has_accuracy = "Accuracy_Report" in tabs or "Accuracy Report" in tabs
    has_upcoming = "Upcoming" in tabs
    has_upcoming_clean = "UpcomingClean" in tabs
    
    # If it has old-style tabs but missing new ones, flag as legacy
    if (has_old_bet_slips or has_accuracy) and not has_upcoming_clean:
        legacy_candidates.append((sid, tabs))

print("=" * 60)
print("SUMMARY")
print("=" * 60)
print(f"Complete satellites (all expected tabs): {len(complete)}")
print(f"Missing core tabs (brain can't run): {len(missing_core)}")
print(f"Missing some tabs (non-critical): {len(missing_some)}")
print(f"Legacy candidates (old format detected): {len(legacy_candidates)}")
print()

if missing_core:
    print("=" * 60)
    print("CRITICAL: Satellites missing CORE tabs")
    print("=" * 60)
    for sid, core_missing, all_missing in missing_core[:20]:
        print(f"\n{sid}")
        print(f"  Missing core: {', '.join(sorted(core_missing))}")
        print(f"  Has tabs:     {', '.join(sorted(satellite_tabs[sid]))}")
    if len(missing_core) > 20:
        print(f"\n... and {len(missing_core) - 20} more")
    print()

if legacy_candidates:
    print("=" * 60)
    print("LEGACY CANDIDATES (old .gs format, need updating)")
    print("=" * 60)
    for sid, tabs in legacy_candidates[:30]:
        print(f"\n{sid}")
        print(f"  Has:     {', '.join(sorted(tabs))}")
        missing = EXPECTED_TABS - tabs
        if missing:
            print(f"  Missing: {', '.join(sorted(missing))}")
    if len(legacy_candidates) > 30:
        print(f"\n... and {len(legacy_candidates) - 30} more")
    print()

if missing_some:
    print("=" * 60)
    print("Satellites missing non-critical tabs only")
    print("=" * 60)
    for sid, missing in missing_some[:20]:
        print(f"{sid}: missing {', '.join(sorted(missing))}")
    if len(missing_some) > 20:
        print(f"... and {len(missing_some) - 20} more")
    print()

# Save full report
report = {
    "total_satellites": len(satellite_tabs),
    "complete_count": len(complete),
    "missing_core_count": len(missing_core),
    "missing_some_count": len(missing_some),
    "legacy_candidate_count": len(legacy_candidates),
    "missing_core": [
        {"sheet_id": sid, "missing_core": sorted(m1), "missing_all": sorted(m2), "has": sorted(satellite_tabs[sid])}
        for sid, m1, m2 in missing_core
    ],
    "legacy_candidates": [
        {"sheet_id": sid, "has": sorted(tabs), "missing": sorted(EXPECTED_TABS - tabs)}
        for sid, tabs in legacy_candidates
    ],
    "missing_some": [
        {"sheet_id": sid, "missing": sorted(m), "has": sorted(satellite_tabs[sid])}
        for sid, m in missing_some
    ],
}

with open("fleet_completeness_audit.json", "w") as f:
    json.dump(report, f, indent=2)

print("Full report saved to: fleet_completeness_audit.json")

print("\nTABS IN DATABASE:")
tabs = sorted(set(r["tab_name"] for r in rows))
for t in tabs:
    print(f" - {t}")
