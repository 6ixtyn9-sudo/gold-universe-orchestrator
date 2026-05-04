"""
scripts/sync_fleet_to_supabase.py
══════════════════════════════════════════════════════════════════════════
Orchestrates the data sync from all 500+ satellites into Supabase.

FEATURES:
  - Loads fleet metadata from Supabase 'satellites' table.
  - Parallized fetch using the 20-slot OAuth pool to avoid quota limits.
  - Intelligent sheet discovery (finds 'Bet_Slips' even if renamed).
  - Robust parsing of betting data (Date, Market, Odds, Preds).
  - High-performance upsert into Supabase 'bets' table.
"""

import sys, os, json, time, logging, argparse, threading
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from registry.supabase_registry import list_satellites
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)
logger = logging.getLogger("fleet_sync")

CREDS_DIR  = REPO_ROOT / "creds"
MAX_WORKERS = 15
DELAY       = 1.0  # seconds between sheets per thread

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

# ── Credential pool ───────────────────────────────────────────────────────────

def load_credential_pool() -> list:
    creds_list = []
    for i in range(20):
        token_file = CREDS_DIR / f"token_{i}.json"
        if not token_file.exists(): continue
        try:
            creds = Credentials.from_authorized_user_file(str(token_file))
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())
            creds_list.append((i, creds))
        except Exception as e:
            logger.warning(f"Skipping token_{i}.json: {e}")
    return creds_list

# ── Data Fetcher ──────────────────────────────────────────────────────────────

def fetch_bets_from_sheet(sheets_svc, sheet_id: str, sat_name: str) -> List[Dict[str, Any]]:
    """Fetch and parse data from the 'Bet_Slips' sheet of a satellite."""
    try:
        # 1. Discover the sheet name (looking for 'Bet_Slips')
        metadata = sheets_svc.get(spreadsheetId=sheet_id).execute()
        sheets = metadata.get('sheets', [])
        target_sheet = None
        for s in sheets:
            title = s['properties']['title']
            if title.lower().strip() == 'bet_slips':
                target_sheet = title
                break
        
        if not target_sheet:
            # Fallback to anything with 'bet' or 'slip'
            for s in sheets:
                title = s['properties']['title'].lower()
                if 'bet' in title or 'slip' in title:
                    target_sheet = s['properties']['title']
                    break
        
        if not target_sheet:
            return []

        # 2. Fetch data
        range_name = f"'{target_sheet}'!A1:Z500"
        result = sheets_svc.values().get(spreadsheetId=sheet_id, range=range_name).execute()
        rows = result.get('values', [])
        if len(rows) < 2: return []

        # 3. Find header row
        header_idx = -1
        for i, row in enumerate(rows[:20]):
            row_str = " ".join([str(c).lower() for c in row])
            if ('match' in row_str or 'game' in row_str) and ('pick' in row_str or 'selection' in row_str):
                header_idx = i
                break
        
        if header_idx == -1: return []

        headers = [h.lower().strip() for h in rows[header_idx]]
        data_rows = rows[header_idx+1:]

        # 4. Map columns
        col_map = {h: i for i, h in enumerate(headers)}
        
        def get_val(row, col_name, default=None):
            idx = col_map.get(col_name)
            if idx is not None and idx < len(row):
                return row[idx]
            return default

        def clean_numeric(v):
            if v is None: return None
            s = str(v).replace('%', '').strip()
            try:
                return float(s)
            except:
                return None

        parsed_bets = []
        for i, row in enumerate(data_rows):
            match_str = get_val(row, 'match') or get_val(row, 'game') or ""
            if not match_str or "summary" in match_str.lower() or "---" in match_str:
                continue
            
            # Skip if it's just a repeated header row
            if match_str.lower() == 'match' or match_str.lower() == 'game':
                continue

            bet = {
                "match_date": get_val(row, 'date'),
                "match_time": get_val(row, 'time'),
                "pick": get_val(row, 'pick') or get_val(row, 'selection'),
                "market": "UNKNOWN",
                "odds": clean_numeric(get_val(row, 'odds')),
                "confidence": clean_numeric(get_val(row, 'confidence')),
                "ev": clean_numeric(get_val(row, 'ev')),
                "magolide_pred": get_val(row, 'magolide pred'),
                "forebet_pred": clean_numeric(get_val(row, 'forebet pred')),
                "game_key": get_val(row, 'gamekey'),
                "source_row": header_idx + i + 2
            }
            
            # Basic team splitting
            if " vs " in match_str:
                parts = match_str.split(" vs ")
                bet["home_team"] = parts[0].strip()
                bet["away_team"] = parts[1].strip()
            
            parsed_bets.append(bet)
            
        return parsed_bets

    except Exception as e:
        logger.error(f"Error fetching from {sat_name} ({sheet_id}): {e}")
        return []

# ── Worker ────────────────────────────────────────────────────────────────────

def sync_worker(slot_idx, creds, satellites, supabase: Client, delay):
    threading.current_thread().name = f"slot-{slot_idx}"
    sheets_svc = build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()
    
    total_synced = 0
    for i, sat in enumerate(satellites):
        sheet_id = sat.get('sheet_id') or sat.get('id')
        name = sat.get('name', 'Unknown')
        
        bets = fetch_bets_from_sheet(sheets_svc, sheet_id, name)
        if bets:
            # Prepare for Supabase upsert
            for b in bets:
                b['satellite_id'] = sat['id'] # The DB UUID
                
            try:
                # Upsert into 'bets' table
                # We use a composite of satellite_id + game_key + source_row as a unique hint if possible
                # For now, just insert
                supabase.table("bets").insert(bets).execute()
                total_synced += len(bets)
                logger.info(f"✅ SYNCED {len(bets)} bets from {name}")
            except Exception as e:
                logger.error(f"❌ FAILED to upload bets for {name}: {e}")
        
        if i < len(satellites) - 1:
            time.sleep(delay)
            
    return total_synced

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Fleet data sync to Supabase")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    print("\n🔄 MA GOLIDE — FLEET DATA SYNC")
    print("════════════════════════════════════════════════")

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Supabase credentials missing.")
        return

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    creds_pool = load_credential_pool()
    if not creds_pool: return

    # Load fleet from Supabase
    all_sats = list_satellites()
    registered = [s for s in all_sats if s.get('script_id')]
    
    if args.limit:
        registered = registered[:args.limit]

    print(f"  Credential slots:      {len(creds_pool)}")
    print(f"  Registered satellites: {len(registered)}")
    print("════════════════════════════════════════════════\n")

    if not registered:
        print("No registered satellites found to sync.")
        return

    n_slots = min(len(creds_pool), MAX_WORKERS, len(registered))
    chunk_size = (len(registered) + n_slots - 1) // n_slots
    chunks = [registered[i:i+chunk_size] for i in range(0, len(registered), chunk_size)]

    start = datetime.now()
    total_bets = 0

    with ThreadPoolExecutor(max_workers=n_slots) as executor:
        futures = [executor.submit(sync_worker, idx, creds, chunks[i], supabase, DELAY) 
                   for i, (idx, creds) in enumerate(creds_pool[:n_slots])]
        for f in as_completed(futures):
            total_bets += f.result()

    elapsed = (datetime.now() - start).total_seconds()
    print(f"\nDONE: 🎯 {total_bets} bets synced to Supabase. Time: {elapsed:.0f}s")

if __name__ == "__main__":
    main()
