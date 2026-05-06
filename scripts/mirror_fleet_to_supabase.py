#!/usr/bin/env python3
"""
mirror_fleet_to_supabase.py
───────────────────────────
Central mirror: reads EVERY tab of EVERY satellite directly via the Sheets API
(authenticated as one of 4 service accounts, round-robin) and upserts raw
values_json into public.satellite_tab_snapshots in Supabase.

NO Apps Script needed. Bypasses whatever .gs version is (or isn't) bound.
"""

import json
import os
import sys
import time
import hashlib
import argparse
import logging
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Config
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
REPO_ROOT = Path(__file__).parent.parent

# Service account credential paths
DEFAULT_SA_PATHS = [
    REPO_ROOT / "credentials_11.json",
    REPO_ROOT / "credentials_12.json",
    REPO_ROOT / "credentials_13.json",
    REPO_ROOT / "credentials_14.json",
]

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

CALL_DELAY = 0.2
BATCH_DELAY = 0.5
MAX_RANGES_PER_CALL = 80

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(message)s")
log = logging.getLogger("mirror")

def load_sa_services():
    services = []
    for path in DEFAULT_SA_PATHS:
        if not path.exists(): continue
        try:
            creds = service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)
            svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
            services.append((creds.service_account_email, svc))
            log.info(f"  ✅ SA loaded: {creds.service_account_email}")
        except Exception as e:
            log.warning(f"  ⚠️ Failed to load {path}: {e}")
    return services

def pick_sa(sheet_id: str, services: list) -> tuple:
    idx = int(hashlib.md5(sheet_id.encode()).hexdigest(), 16) % len(services)
    return services[idx]

def get_tab_names(service, sheet_id: str) -> list[str]:
    try:
        resp = service.spreadsheets().get(spreadsheetId=sheet_id, fields="sheets.properties.title").execute()
        return [s["properties"]["title"] for s in resp.get("sheets", [])]
    except Exception as e:
        log.warning(f"    get_tab_names failed: {e}")
        return []

def batch_get_all_tabs(service, sheet_id: str, tab_names: list[str]) -> dict:
    results = {}
    if not tab_names: return results
    for i in range(0, len(tab_names), MAX_RANGES_PER_CALL):
        chunk = tab_names[i:i + MAX_RANGES_PER_CALL]
        ranges = [f"'{name}'" for name in chunk]
        try:
            resp = service.spreadsheets().values().batchGet(
                spreadsheetId=sheet_id, ranges=ranges, valueRenderOption="FORMATTED_VALUE"
            ).execute()
            for vr in resp.get("valueRanges", []):
                tab_name = vr.get("range", "").split("!")[0].strip("'")
                results[tab_name] = vr.get("values", [])
            time.sleep(CALL_DELAY)
        except Exception as e:
            log.warning(f"    batchGet error: {e}")
    return results

def upsert_tab_snapshots(sb: Client, sheet_id: str, sat_id, tab_data: dict, dry_run: bool):
    if not tab_data: return 0
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for tab_name, values in tab_data.items():
        row_count = max(0, len(values) - 1) if values else 0
        col_count = max((len(r) for r in values), default=0)
        rows.append({
            "sheet_id": sheet_id,
            "satellite_id": sat_id,
            "tab_name": tab_name,
            "values_json": values,
            "row_count": row_count,
            "col_count": col_count,
            "bridge_version": "mirror-v1",
            "last_mirrored_at": now,
        })
    if dry_run: return len(rows)
    try:
        sb.table("satellite_tab_snapshots").upsert(rows, on_conflict="sheet_id,tab_name").execute()
        return len(rows)
    except Exception as e:
        log.error(f"    DB upsert error: {e}")
        return 0

def insert_sync_event(sb: Client, sheet_id: str, sat_id, label: str, tab_names: list, row_counts: dict, dry_run: bool):
    if dry_run: return
    row = {
        "sheet_id": sheet_id,
        "satellite_id": sat_id,
        "spreadsheet_name": label,
        "status": "ok",
        "tabs_received": tab_names,
        "row_counts": row_counts,
    }
    try:
        sb.table("satellite_sync_events").insert(row).execute()
    except Exception as e:
        log.warning(f"    sync_event insert failed: {e}")

def run_mirror(limit: int = None, dry_run: bool = False):
    log.info(f"🚀 Starting Fleet Mirror ({'DRY RUN' if dry_run else 'LIVE'})")
    services = load_sa_services()
    if not services:
        log.error("❌ No service accounts loaded.")
        return

    sb: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # Fetch satellites from Supabase
    resp = sb.table("satellites").select("id, sheet_id, name").execute()
    satellites = resp.data
    if limit: satellites = satellites[:limit]
    
    log.info(f"📋 Processing {len(satellites)} satellites.")
    
    for i, sat in enumerate(satellites, 1):
        sheet_id = sat["sheet_id"]
        label = sat["name"]
        sat_id = sat["id"]
        
        email, service = pick_sa(sheet_id, services)
        log.info(f"[{i}/{len(satellites)}] {label} ({sheet_id[:8]}...) via {email.split('@')[0]}")
        
        tab_names = get_tab_names(service, sheet_id)
        if not tab_names: continue
        
        tab_data = batch_get_all_tabs(service, sheet_id, tab_names)
        row_counts = {t: max(0, len(v)-1) for t, v in tab_data.items() if v}
        
        tabs_written = upsert_tab_snapshots(sb, sheet_id, sat_id, tab_data, dry_run)
        insert_sync_event(sb, sheet_id, sat_id, label, list(tab_data.keys()), row_counts, dry_run)
        
        log.info(f"    ✅ Mirrored {tabs_written} tabs.")
        time.sleep(BATCH_DELAY)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run_mirror(limit=args.limit, dry_run=args.dry_run)
