#!/usr/bin/env python3
"""
run_assayer_from_supabase.py
────────────────────────────
Phase 3: analytical compute decoupling.
Reads all 'Bet_Slips' snapshots from Supabase, parses them using the enhanced
Python parser, and runs the Assayer engine to generate the Fleet Purity Report.

Bypasses Google Sheets API entirely for analysis.
"""

import os
import json
import logging
from typing import List, Dict, Any
from dotenv import load_dotenv
from supabase import create_client, Client

# Project imports
from fetcher.parsers.bet_slips import parse_bet_slips
from assayer.assayer_engine import run_full_assay

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
log = logging.getLogger("assayer_fleet")

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

def fetch_all_bet_slips(sb: Client) -> List[Dict[str, Any]]:
    """Fetch every 'Bet_Slips' tab snapshot from the database."""
    log.info("📥 Fetching Bet_Slips snapshots from Supabase...")
    # We fetch in batches or all at once if the fleet isn't too massive yet.
    # For 501 satellites, this might be a few thousand rows.
    resp = sb.table("satellite_tab_snapshots") \
        .select("sheet_id, tab_name, values_json, satellite_id") \
        .filter("tab_name", "in", '("Bet_Slips", "BetSlips", "bet_slips", "betslips")') \
        .execute()
    return resp.data

def run_fleet_assay():
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.error("❌ SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")
        return

    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # 1. Get raw data
    snapshots = fetch_all_bet_slips(sb)
    log.info(f"📊 Found {len(snapshots)} Bet_Slips snapshots.")
    
    # 2. Parse into flat row list
    all_rows = []
    for snap in snapshots:
        raw_values = snap.get("values_json", [])
        if not raw_values: continue
        
        parsed = parse_bet_slips(raw_values)
        # Add metadata for provenance
        for p in parsed:
            p["sheet_id"] = snap["sheet_id"]
            p["satellite_id"] = snap["satellite_id"]
            
        all_rows.extend(parsed)
    
    log.info(f"🧪 Parsed {len(all_rows)} total bet slips across the fleet.")
    
    if not all_rows:
        log.warning("⚠️ No rows parsed. Is the mirror data populated?")
        return

    # 3. Run the Assayer Engine
    # The engine expects a payload with data keys
    payload = {
        "data": {
            "bet_slips": all_rows
        }
    }
    
    result = run_full_assay(payload)
    
    # 4. Output Summary
    summary = result["summary"]
    log.info("═══ FLEET PURITY REPORT ═══")
    log.info(f"  Total Edges:   {summary['total_edges']}")
    log.info(f"  Banker Count:  {summary['banker_count']}")
    log.info(f"  Robber Count:  {summary['robber_count']}")
    log.info(f"  Gold Count:    {summary['gold_count']} ({summary['gold_pct']*100:.1f}%)")
    log.info(f"  Fleet WinRate: {summary['overall_win_rate']*100:.1f}%" if summary['overall_win_rate'] else "  Fleet WinRate: N/A")
    log.info("═══════════════════════════")

    # Save detailed report
    report_path = "fleet_purity_report.json"
    with open(report_path, "w") as f:
        json.dump(result, f, indent=2)
    log.info(f"💾 Detailed report saved to {report_path}")

if __name__ == "__main__":
    run_fleet_assay()
