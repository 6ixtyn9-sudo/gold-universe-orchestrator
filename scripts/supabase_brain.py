"""
scripts/supabase_brain.py
────────────────────────
The "Mothership" orchestrator for the centralized satellite logic.

Pipeline Flow:
1. Fetch latest snapshots from Supabase (UpcomingClean, ResultsClean, Config).
2. Process games using the Python 'Brain' engine.
3. Build canonical 25-column Bet_Slips array.
4. Grade bets against results for accuracy reporting.
5. Push results back to Supabase (satellite_computed_outputs).
6. (Optional) Write back to Google Sheets via service account rotation.
"""

import os
import logging
import argparse
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client, Client

from brain.data_parser import (
    parse_upcoming_clean, parse_results_clean,
    parse_config_tier2, load_accumulator_config, parse_standings
)
from brain.config_ledger import build_config_snapshot, upsert_config_to_supabase
from brain.contract_enforcer import build_bet_slips
from brain.game_processor import compute_magolide_predictions
from brain.game_enricher import enrich_games
from brain.accuracy_report import grade_bet_slips
from brain.sheet_writer import SheetWriter

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("supabase_brain")

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
CREDS_DIR = os.path.join(os.getcwd(), "credentials")


def main():
    parser = argparse.ArgumentParser(description="Supabase Brain Orchestrator")
    parser.add_argument("--satellite-id", help="Target satellite ID (e.g. S-001)")
    parser.add_argument("--fleet", action="store_true", help="Process entire fleet")
    parser.add_argument("--write-back", action="store_true", help="Push results to Sheets")
    parser.add_argument("--limit", type=int, default=5, help="Limit fleet processing for safety")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        log.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")
        return

    sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. Identify satellites to process
    if args.satellite_id:
        target_ids = [args.satellite_id]
    elif args.fleet:
        # Fetch list of active satellites from Supabase
        res = sb.table("satellite_tab_snapshots").select("sheet_id").execute()
        target_ids = list(set([r["sheet_id"] for r in res.data]))
        target_ids = sorted(target_ids)[:args.limit]
        log.info(f"🚀 Processing fleet: {len(target_ids)} satellites (limited to {args.limit})")
    else:
        log.error("Specify --satellite-id or --fleet")
        return

    writer = SheetWriter(CREDS_DIR) if args.write_back else None

    for sid in target_ids:
        try:
            process_satellite(sb, sid, writer)
        except Exception as e:
            log.error(f"❌ Failed processing {sid}: {e}", exc_info=True)


def process_satellite(sb: Client, satellite_id: str, writer: Optional[SheetWriter]):
    log.info(f"--- Processing Satellite: {satellite_id} ---")

    # 2. Fetch Snapshots
    res = sb.table("satellite_tab_snapshots")\
        .select("*")\
        .eq("sheet_id", satellite_id)\
        .execute()
    
    if not res.data:
        log.warning(f"No snapshots found for {satellite_id}")
        return

    tabs = {r["tab_name"]: r["values_json"] for r in res.data}
    
    # 3. Parse Data
    upcoming_raw = tabs.get("UpcomingClean", tabs.get("Upcoming_Clean", []))
    results_raw = tabs.get("ResultsClean", tabs.get("Results_Clean", []))
    config_raw = tabs.get("Config_Tier2", [])
    standings_raw = tabs.get("Standings", tabs.get("Clean", []))
    config_tier1_raw = tabs.get("Config_Tier1", [])

    games = parse_upcoming_clean(upcoming_raw)
    results = parse_results_clean(results_raw)
    config_kv = parse_config_tier2(config_raw)
    acc_config = load_accumulator_config(config_kv)
    
    standings = parse_standings(standings_raw)
    config_tier1 = parse_config_tier2(config_tier1_raw) # Key-value parser works for Tier1 too

    # 4. Config Stamping
    leagues = list(set([g.get("league") for g in games if g.get("league")]))
    cfg_snapshot = build_config_snapshot(config_kv, acc_config, active_leagues=leagues)
    stamp_id = upsert_config_to_supabase(sb, cfg_snapshot)

    # 5. Compute Predictions & Build Bet Slips (Phase 2: Active computation)
    computed_games = compute_magolide_predictions(games, standings, results, config_tier1)
    enriched_games = enrich_games(computed_games, acc_config)
    bet_slips_2d = build_bet_slips(enriched_games, acc_config, stamp_id)

    # 6. Grade Accuracy
    graded_slips = grade_bet_slips(bet_slips_2d, results)

    # 7. Write to Supabase (Computed Output)
    output_row = {
        "sheet_id": satellite_id,
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "stamp_id": stamp_id,
        "bet_slips_json": json.dumps(graded_slips),
        "summary_meta": json.dumps({
            "game_count": len(games),
            "bet_count": len(graded_slips) - 2, # skip header/banner
        })
    }
    sb.table("satellite_computed_outputs").upsert(
        output_row, on_conflict="sheet_id"
    ).execute()
    log.info(f"✅ Supabase computed output updated for {satellite_id}")

    # 8. (Optional) Write Back to Sheets
    if writer:
        # We need the spreadsheet_id for this satellite
        # This should be stored in a 'satellite_registry' table
        reg = sb.table("satellites").select("sheet_id").eq("sheet_id", satellite_id).single().execute()
        if reg.data:
            ss_id = reg.data["sheet_id"]
            writer.write_tab(ss_id, "Bet_Slips", graded_slips)
        else:
            log.warning(f"Spreadsheet ID not found for {satellite_id} in registry")


if __name__ == "__main__":
    main()
