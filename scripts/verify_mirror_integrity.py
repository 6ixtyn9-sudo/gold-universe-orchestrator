"""
scripts/verify_mirror_integrity.py
──────────────────────────────────
LAYER 1: Mirror Verification.

Performs a cell-by-cell comparison between live Google Sheets and 
the Supabase `satellite_tab_snapshots` to ensure logic is running
on fresh, accurate data.

Usage:
  python scripts/verify_mirror_integrity.py --satellite-id S-001
"""

import os
import logging
import argparse
from dotenv import load_dotenv
from supabase import create_client, Client
from google.oauth2 import service_account
from googleapiclient.discovery import build

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("verify_integrity")

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--satellite-id", required=True)
    parser.add_argument("--tab", default="UpcomingClean")
    args = parser.parse_args()

    sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # 1. Fetch from Supabase
    res = sb.table("satellite_tab_snapshots")\
        .select("values_json, last_mirrored_at")\
        .eq("sheet_id", args.satellite_id)\
        .eq("tab_name", args.tab)\
        .execute()
    
    if not res.data:
        log.error(f"❌ No snapshot found for {args.satellite_id} [{args.tab}]")
        return

    sb_values = res.data[0]["values_json"]
    log.info(f"Supabase Snapshot Time: {res.data[0]['last_mirrored_at']}")

    # 2. Fetch from Registry
    reg = sb.table("satellites").select("sheet_id").eq("sheet_id", args.satellite_id).single().execute()
    ss_id = reg.data["sheet_id"]

    # 3. Fetch from Live Sheet
    # Note: Use the first available credentials file
    creds_file = "credentials_11.json"
    creds_path = os.path.join(os.getcwd(), creds_file)
    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=SCOPES)
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    sheet_api = service.spreadsheets()
    
    log.info(f"Fetching live data from: {ss_id} [{args.tab}]")
    live_res = sheet_api.values().get(spreadsheetId=ss_id, range=f"'{args.tab}'!A1:CZ100").execute()
    live_values = live_res.get("values", [])

    # 4. Compare
    compare_grids(sb_values, live_values)

def compare_grids(sb_grid, live_grid):
    log.info(f"Comparing grids: SB({len(sb_grid)} rows) vs Live({len(live_grid)} rows)")
    
    mismatches = 0
    max_rows = max(len(sb_grid), len(live_grid))
    
    for r in range(min(50, max_rows)):
        sb_row = sb_grid[r] if r < len(sb_grid) else []
        live_row = live_grid[r] if r < len(live_grid) else []
        
        max_cols = max(len(sb_row), len(live_row))
        for c in range(max_cols):
            v1 = str(sb_row[c] or "").strip() if c < len(sb_row) else ""
            v2 = str(live_row[c] or "").strip() if c < len(live_row) else ""
            
            if v1 != v2:
                log.warning(f"  Mismatch at R{r+1}C{c+1}: SB='{v1}' vs Live='{v2}'")
                mismatches += 1

    if mismatches == 0:
        log.info("✅ INTEGRITY VERIFIED: Mirror matches Live Sheet (first 50 rows).")
    else:
        log.error(f"❌ INTEGRITY FAILURE: Found {mismatches} mismatches.")

if __name__ == "__main__":
    main()
