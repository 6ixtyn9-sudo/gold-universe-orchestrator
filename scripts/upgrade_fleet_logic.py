import os
import json
import logging
import time
import threading
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from dotenv import load_dotenv
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# Project imports
from syncer.script_syncer import load_gs_sources
from registry.supabase_registry import list_satellites

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-7s | %(message)s")
log = logging.getLogger("fleet_upgrade")

load_dotenv()

CREDS_DIR = Path("creds")
BASE_DELAY = 10.0 # 10 seconds between calls per user to stay safe

def get_creds_pool():
    """Load and refresh all valid OAuth tokens, grouped by user email."""
    user_pools = {} # email -> list of (token_name, creds)
    for f in sorted(CREDS_DIR.glob("token_*.json")):
        try:
            with open(f, "r") as tf:
                data = json.load(tf)
                creds = Credentials.from_authorized_user_info(data)
                if creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                    with open(f, "w") as tfw:
                        tfw.write(creds.to_json())
                
                if creds.valid:
                    # Identify user
                    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
                    user = drive.about().get(fields="user(emailAddress)").execute()
                    email = user["user"]["emailAddress"]
                    
                    if email not in user_pools:
                        user_pools[email] = []
                    user_pools[email].append((f.name, creds))
        except Exception as e:
            log.warning(f"⚠️ Skipping {f.name}: {e}")
    return user_pools

def deploy_one(sat, files, creds, dry_run=False):
    """Deploy files to a single satellite with exponential backoff for 429s."""
    sheet_id = sat.get("sheet_id") or sat.get("id")
    name = sat.get("name", "Unknown")
    
    if dry_run:
        return {"ok": True, "sheet_id": sheet_id, "name": name, "dry_run": True}

    max_retries = 3
    backoff = 30
    
    for attempt in range(max_retries + 1):
        try:
            # 1. Find bound script
            drive = build("drive", "v3", credentials=creds, cache_discovery=False)
            query = f"'{sheet_id}' in parents and mimeType = 'application/vnd.google-apps.script'"
            res = drive.files().list(q=query, fields="files(id, name)").execute()
            files_found = res.get("files", [])
            
            script_id = None
            if files_found:
                script_id = files_found[0]["id"]
            else:
                script_api = build("script", "v1", credentials=creds, cache_discovery=False)
                body = {"title": f"Ma Golide - {name}", "parentId": sheet_id}
                resp = script_api.projects().create(body=body).execute()
                script_id = resp["scriptId"]
                log.info(f"✨ Created new script for {name}: {script_id}")

            # 2. Update content
            script_api = build("script", "v1", credentials=creds, cache_discovery=False)
            script_api.projects().updateContent(
                scriptId=script_id,
                body={"files": files}
            ).execute()
            
            return {"ok": True, "sheet_id": sheet_id, "name": name, "script_id": script_id}
        except Exception as e:
            if "429" in str(e) and attempt < max_retries:
                wait = backoff * (2 ** attempt) + random.uniform(0, 10)
                log.warning(f"⚠️ Quota hit for {name} (attempt {attempt+1}). Waiting {wait:.1f}s...")
                time.sleep(wait)
                continue
            return {"ok": False, "sheet_id": sheet_id, "name": name, "error": str(e)}

def run_upgrade(dry_run=True, limit=None):
    files, err = load_gs_sources()
    if err: return log.error(f"❌ Failed to load sources: {err}")
    
    sats = list_satellites()
    if limit: sats = sats[:limit]
    log.info(f"📡 Found {len(sats)} satellites to upgrade.")

    user_pools = get_creds_pool()
    if not user_pools: return log.error("❌ No valid OAuth tokens found.")
    
    emails = list(user_pools.keys())
    log.info(f"🔑 Using {len(emails)} unique user accounts for deployment: {', '.join(emails)}")

    # Group satellites into buckets for each user
    buckets = {email: [] for email in emails}
    for i, sat in enumerate(sats):
        email = emails[i % len(emails)]
        buckets[email].append(sat)

    results = {"ok": 0, "failed": 0}

    def user_worker(email, sat_list):
        local_ok, local_failed = 0, 0
        tokens = user_pools[email]
        
        for i, sat in enumerate(sat_list):
            token_name, creds = tokens[i % len(tokens)]
            res = deploy_one(sat, files, creds, dry_run)
            
            if res["ok"]:
                local_ok += 1
                status = "✅" if not res.get("dry_run") else "📊 (dry)"
                log.info(f"[{email}] {res['name']}: {status}")
            else:
                local_failed += 1
                log.error(f"[{email}] {res['name']}: ❌ {res['error']}")
            
            if i < len(sat_list) - 1:
                time.sleep(BASE_DELAY + random.uniform(0, 5))
        
        return local_ok, local_failed

    with ThreadPoolExecutor(max_workers=len(emails)) as executor:
        futures = [executor.submit(user_worker, email, buckets[email]) for email in emails]
        for f in as_completed(futures):
            ok, failed = f.result()
            results["ok"] += ok
            results["failed"] += failed

    log.info(f"🏁 Upgrade Finished. Success: {results['ok']}, Failed: {results['failed']}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Run live deployment")
    parser.add_argument("--limit", type=int, help="Limit number of satellites")
    args = parser.parse_args()
    run_upgrade(dry_run=not args.live, limit=args.limit)
