"""
upgrade_fleet_logic_fixed.py
────────────────────────────
Same as upgrade_fleet_logic.py but with the quota fix applied:
  max_workers=1  (serialized, not parallel)

Root cause of original quota failure:
  - Apps Script API projects.updateContent has ~30 req/min rate limit
  - 3 parallel workers all fired simultaneously → burst quota exhaustion
  - All 3 retries burned in 5 minutes, 0 satellites upgraded

Fix: max_workers=1 → sequential deployment across all users/tokens
  - 500 satellites × ~12s each (10s BASE_DELAY + API call) = ~100 minutes
  - Rate: ~5 calls/min → well under 30/min limit
  - Tokens are still round-robined across all 3 users for freshness

Usage:
    PYTHONPATH=. python3 scripts/upgrade_fleet_logic_fixed.py --limit 5   # smoke test
    PYTHONPATH=. python3 scripts/upgrade_fleet_logic_fixed.py --live       # full fleet
    PYTHONPATH=. python3 scripts/upgrade_fleet_logic_fixed.py --live 2>&1 | tee upgrade_$(date +%Y%m%d_%H%M%S).log
"""

import os
import json
import logging
import time
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-7s | %(message)s")
log = logging.getLogger("fleet_upgrade")

load_dotenv()

CREDS_DIR = Path("creds")
BASE_DELAY = 10.0  # seconds between calls — at max_workers=1 this is the global rate


def get_creds_pool():
    """Load and refresh all valid OAuth tokens, grouped by user email."""
    user_pools = {}
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
                    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
                    user = drive.about().get(fields="user(emailAddress)").execute()
                    email = user["user"]["emailAddress"]
                    if email not in user_pools:
                        user_pools[email] = []
                    user_pools[email].append((f.name, creds))
        except Exception as e:
            log.warning(f"Skipping {f.name}: {e}")
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
                log.info(f"  Created new script for {name}: {script_id}")

            script_api = build("script", "v1", credentials=creds, cache_discovery=False)
            script_api.projects().updateContent(
                scriptId=script_id,
                body={"files": files}
            ).execute()

            return {"ok": True, "sheet_id": sheet_id, "name": name, "script_id": script_id}

        except Exception as e:
            if "429" in str(e) and attempt < max_retries:
                wait = backoff * (2 ** attempt) + random.uniform(0, 10)
                log.warning(f"  Quota hit for {name} (attempt {attempt+1}). Waiting {wait:.1f}s...")
                time.sleep(wait)
                continue
            return {"ok": False, "sheet_id": sheet_id, "name": name, "error": str(e)}


def run_upgrade(dry_run=True, limit=None):
    files, err = load_gs_sources()
    if err:
        log.error(f"Failed to load sources: {err}")
        return

    sats = list_satellites()
    if limit:
        sats = sats[:limit]
    log.info(f"Found {len(sats)} satellites to upgrade. Mode: {'DRY RUN' if dry_run else 'LIVE'}")

    user_pools = get_creds_pool()
    if not user_pools:
        log.error("No valid OAuth tokens found.")
        return

    # Flatten all tokens into a single ordered list, round-robined across users
    emails = list(user_pools.keys())
    log.info(f"Using {len(emails)} unique user accounts: {', '.join(emails)}")

    # Build flat token list: token_1(user1), token_1(user2), token_1(user3), token_2(user1)...
    all_tokens = []
    max_tokens = max(len(v) for v in user_pools.values())
    for i in range(max_tokens):
        for email in emails:
            tokens = user_pools[email]
            if i < len(tokens):
                all_tokens.append((email, tokens[i][0], tokens[i][1]))

    results = {"ok": 0, "failed": 0}

    # ── THE FIX: max_workers=1 ── sequential, no burst ──────────────────────
    def deploy_task(args):
        idx, sat = args
        token_idx = idx % len(all_tokens)
        email, token_name, creds = all_tokens[token_idx]
        res = deploy_one(sat, files, creds, dry_run)
        return email, res

    with ThreadPoolExecutor(max_workers=1) as executor:  # <── SERIALIZED
        futures = {executor.submit(deploy_task, (i, sat)): sat for i, sat in enumerate(sats)}
        completed = 0
        for future in as_completed(futures):
            email, res = future.result()
            completed += 1
            if res["ok"]:
                results["ok"] += 1
                status = "(dry)" if res.get("dry_run") else "✅"
                log.info(f"[{completed}/{len(sats)}] [{email}] {res['name']}: {status}")
            else:
                results["failed"] += 1
                log.error(f"[{completed}/{len(sats)}] [{email}] {res['name']}: FAILED — {res['error']}")

            # Rate control between tasks (not needed for max_workers=1 since tasks
            # are sequential, but kept for explicitness)
            if completed < len(sats) and not res.get("dry_run"):
                time.sleep(BASE_DELAY + random.uniform(0, 3))

    log.info(f"Upgrade complete. Success: {results['ok']}, Failed: {results['failed']}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Run live deployment (default: dry run)")
    parser.add_argument("--limit", type=int, help="Limit number of satellites")
    args = parser.parse_args()
    run_upgrade(dry_run=not args.live, limit=args.limit)
