import os
import json
import csv
from collections import defaultdict
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

sb = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_SERVICE_KEY"),
)

PAGE_SIZE = 1000

# Adjust this list if your canonical modern sheet set changes.
EXPECTED_TABS = {
    "Upcoming",
    "UpcomingClean",
    "Results",
    "ResultsClean",
    "Standings",
    "Config_Tier1",
    "Config_Tier2",
    "Bet_Slips",
    "Accuracy_Report",
    "Side",
    "Totals",
    "Margin_Analyzer",
}

# These are the strongest "new-code" signals.
LEGACY_SIGNAL_TABS = {
    "UpcomingClean",
    "ResultsClean",
    "Side",
    "Totals",
    "Margin_Analyzer",
}

def fetch_all_snapshots():
    rows = []
    start = 0

    while True:
        resp = (
            sb.table("satellite_tab_snapshots")
            .select("sheet_id, tab_name")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )

        batch = resp.data or []
        rows.extend(batch)

        if len(batch) < PAGE_SIZE:
            break

        start += PAGE_SIZE

    return rows

rows = fetch_all_snapshots()

by_sheet = defaultdict(set)

for r in rows:
    sheet_id = r.get("sheet_id")
    tab_name = r.get("tab_name")
    if sheet_id and tab_name:
        by_sheet[sheet_id].add(tab_name)

total = len(by_sheet)
complete = []
missing_any = []
legacy_candidates = []

for sheet_id, tabs in by_sheet.items():
    missing = sorted(EXPECTED_TABS - tabs)

    if not missing:
        complete.append(sheet_id)
        continue

    record = {
        "sheet_id": sheet_id,
        "present_tabs": sorted(tabs),
        "missing_tabs": missing,
        "missing_count": len(missing),
        "legacy_missing_count": sum(1 for t in LEGACY_SIGNAL_TABS if t in missing),
    }
    missing_any.append(record)

    # Strong legacy/update candidate: missing one or more new-code tabs
    if record["legacy_missing_count"] > 0:
        legacy_candidates.append(record)

missing_any.sort(key=lambda x: (-x["missing_count"], x["sheet_id"]))
legacy_candidates.sort(
    key=lambda x: (-x["legacy_missing_count"], -x["missing_count"], x["sheet_id"])
)

print(f"Total satellites mirrored: {total}")
print(f"Complete satellites:       {len(complete)}")
print(f"Missing any tabs:          {len(missing_any)}")
print(f"Legacy candidates:         {len(legacy_candidates)}")
print()

print("Top legacy/update candidates:")
for row in legacy_candidates[:10]:
    print(f"- {row['sheet_id']}")
    print(f"  missing: {', '.join(row['missing_tabs'])}")
    print()

with open("fleet_missing_tabs.json", "w") as f:
    json.dump(
        {
            "total_satellites": total,
            "complete_count": len(complete),
            "missing_any_count": len(missing_any),
            "legacy_candidate_count": len(legacy_candidates),
            "legacy_candidates": legacy_candidates,
            "all_missing": missing_any,
        },
        f,
        indent=2,
    )

with open("fleet_missing_tabs.csv", "w", newline="") as f:
    writer = csv.DictWriter(
        f,
        fieldnames=[
            "sheet_id",
            "missing_count",
            "legacy_missing_count",
            "missing_tabs",
            "present_tabs",
        ],
    )
    writer.writeheader()
    for row in missing_any:
        writer.writerow(
            {
                "sheet_id": row["sheet_id"],
                "missing_count": row["missing_count"],
                "legacy_missing_count": row["legacy_missing_count"],
                "missing_tabs": ", ".join(row["missing_tabs"]),
                "present_tabs": ", ".join(row["present_tabs"]),
            }
        )

print("Saved:")
print("  - fleet_missing_tabs.json")
print("  - fleet_missing_tabs.csv")
