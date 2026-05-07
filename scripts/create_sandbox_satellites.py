"""
scripts/create_sandbox_satellites.py
────────────────────────────────────
LAYER 2: Sandbox Isolation.

Duplicates production satellite snapshots in Supabase to a 'SANDBOX'
namespace, allowing the Brain engine to run test write-backs without
touching live production data or Sheets.

Usage:
  python scripts/create_sandbox_satellites.py --source S-001 --target SANDBOX-001
"""

import os
import logging
import argparse
from dotenv import load_dotenv
from supabase import create_client, Client

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("sandbox_creator")

load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, help="Production satellite ID")
    parser.add_argument("--target", required=True, help="Sandbox satellite ID")
    args = parser.parse_args()

    sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. Fetch source snapshots
    res = sb.table("satellite_tab_snapshots").select("*").eq("sheet_id", args.source).execute()
    if not res.data:
        log.error(f"Source {args.source} not found.")
        return

    # 2. Clone to target
    clones = []
    for row in res.data:
        clone = row.copy()
        clone["sheet_id"] = args.target
        # Remove primary key columns to let Supabase generate new ones
        if "id" in clone:
            del clone["id"]
        # The mirror script also has a satellite_id (UUID/int). For a sandbox, 
        # we might just leave it null or set it to a placeholder if it's not in the satellites table.
        clone["satellite_id"] = None 
        clones.append(clone)

    sb.table("satellite_tab_snapshots").upsert(clones, on_conflict="sheet_id,tab_name").execute()
    log.info(f"✅ Sandbox created: {args.target} (cloned from {args.source})")

if __name__ == "__main__":
    main()
