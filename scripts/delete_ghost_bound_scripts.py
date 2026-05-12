#!/usr/bin/env python3
"""
GHOST DELETE TOOL (Hardened)
Permanently deletes ghost script projects from a plan file.
Features: Resume capability, detailed status tracking, failure rate gate, and batch processing.
"""

import os
import sys
import json
import logging
import argparse
import time
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Set

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from auth.google_auth import get_credentials_from_file, SCOPES
from fetcher.script_api_client import ScriptApiClient

logging.basicConfig(
    level=logging.INFO, 
    format="%(asctime)s %(levelname)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

def load_credentials_pool(dir_path: Path, token_cache_dir: str) -> List[Dict[str, Any]]:
    pool = []
    for f in dir_path.glob("credentials_writer_*.json"):
        name = f.name.replace("credentials_writer_", "").replace(".json", "")
        pool.append({
            "name": name,
            "path": str(f),
            "client": None # Lazy load
        })
    return pool

def get_client_for_pool_item(item: Dict[str, Any], token_cache_dir: str) -> ScriptApiClient:
    if item["client"] is None:
        creds = get_credentials_from_file(item["path"], token_cache_dir, False, SCOPES)
        item["client"] = ScriptApiClient(credentials=creds)
    return item["client"]

def write_to_ledger(ledger_path: Path, record: Dict[str, Any]):
    with open(ledger_path, "a") as f:
        f.write(json.dumps(record) + "\n")
        f.flush()
        os.fsync(f.fileno())

def load_processed_ids(ledger_path: Path) -> Set[str]:
    processed = set()
    if ledger_path.exists():
        with open(ledger_path, "r") as f:
            for line in f:
                if not line.strip(): continue
                try:
                    obj = json.loads(line)
                    if "script_id" in obj:
                        processed.add(obj["script_id"])
                except: pass
    return processed

def main():
    parser = argparse.ArgumentParser(description="Permanently delete ghost bound scripts.")
    parser.add_argument("--plan", type=str, required=True, help="Path to ghost_sweeper_plan.json")
    parser.add_argument("--apply-delete", action="store_true", help="Actually execute deletion.")
    parser.add_argument("--canary", type=int, default=None, help="Limit to N candidates.")
    parser.add_argument("--credentials-dir", type=str, default=".", help="Dir containing writer credentials.")
    parser.add_argument("--token-cache-dir", type=str, default="artifacts/token-cache", help="Dir for token cache.")
    parser.add_argument("--backup-dir", type=str, default="artifacts/deleted_ghost_backups", help="Dir for backups.")
    parser.add_argument("--ledger", type=str, default="artifacts/ghost_delete_executed.jsonl", help="Ledger path.")
    parser.add_argument("--read-qps", type=float, default=2.0)
    parser.add_argument("--delete-qps", type=float, default=1.0)
    parser.add_argument("--failure-rate-gate", type=float, default=0.25)
    parser.add_argument("--batch-size", type=int, default=0, help="Process in batches of N. 0 for no batching.")
    parser.add_argument("--sleep-between-batches", type=int, default=20, help="Seconds to sleep between batches.")
    args = parser.parse_args()

    logger.info("=" * 60)
    logger.info("  GHOST DELETE TOOL (Hardened)")
    logger.info(f"  Mode: {'APPLY_DELETE' if args.apply_delete else 'DRY-RUN'}")
    if args.canary: logger.info(f"  Canary Limit: {args.canary}")
    logger.info("=" * 60)

    plan_path = Path(args.plan)
    if not plan_path.exists():
        logger.error(f"Plan file not found: {plan_path}")
        sys.exit(1)

    with open(plan_path) as f:
        plan = json.load(f)

    logger.info(f"Loaded {len(plan)} ghosts from plan.")

    ledger_path = Path(args.ledger)
    processed_ids = load_processed_ids(ledger_path)
    logger.info(f"Loaded {len(processed_ids)} already processed scripts from ledger.")

    backup_dir = Path(args.backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)

    pool = load_credentials_pool(Path(args.credentials_dir), args.token_cache_dir)
    logger.info(f"Loaded {len(pool)} writer credentials into pool.")

    if not args.apply_delete:
        logger.info("DRY-RUN mode enabled. No deletions will be performed.")

    success_deleted_count = 0
    fail_count = 0
    skip_count = 0
    attempts_this_run = 0
    
    canary_limit = args.canary if args.canary else len(plan)
    
    # Track which credential worked for which owner email
    owner_to_cred_idx = {}

    batch_processed = 0

    for ghost in plan:
        script_id = ghost["script_id"]
        
        # RESUME CHECK
        if script_id in processed_ids:
            continue

        if attempts_this_run >= canary_limit:
            logger.info(f"Canary limit reached ({canary_limit}). Stopping.")
            break

        sheet_id = ghost["sheet_id"]
        canonical_id = ghost.get("canonical_id")
        title = ghost.get("title", "Unknown")

        attempts_this_run += 1
        logger.info(f"[{attempts_this_run}/{canary_limit}] Processing {script_id} ('{title}')...")

        status = "UNKNOWN"
        error_msg = None
        used_cred = "NONE"
        backup_paths = []

        # 1) RE-VERIFY SAFETY BEFORE DELETE
        v_client = get_client_for_pool_item(pool[0], args.token_cache_dir)
        try:
            # Use Drive API to check mimeType and basic existence
            drive_meta = v_client.drive_service.files().get(
                fileId=script_id,
                fields="id,mimeType,capabilities(canDelete)",
                supportsAllDrives=True
            ).execute()
            
            if drive_meta.get("mimeType") != "application/vnd.google-apps.script":
                status = "SKIP_NOT_SCRIPT"
            elif script_id == canonical_id:
                status = "SKIP_CANONICAL"
            else:
                # 2) VERIFY PARENT BINDING
                try:
                    proj = v_client.script_service.projects().get(scriptId=script_id).execute()
                    real_parent_id = proj.get("parentId")
                    
                    if real_parent_id != sheet_id:
                        status = "SKIP_PARENT_MISMATCH"
                        error_msg = f"real_parent={real_parent_id}, plan_sheet={sheet_id}"
                    else:
                        # Proceed to backup
                        try:
                            # Metadata backup
                            meta_path = backup_dir / f"{script_id}.meta.json"
                            with open(meta_path, "w") as f:
                                json.dump(proj, f, indent=2)
                            backup_paths.append(str(meta_path))

                            # Content backup
                            content = v_client.script_service.projects().getContent(scriptId=script_id).execute()
                            content_path = backup_dir / f"{script_id}.json"
                            with open(content_path, "w") as f:
                                json.dump(content, f, indent=2)
                            backup_paths.append(str(content_path))
                            
                            logger.info(f"  ✓ Backup created.")
                            
                            if not args.apply_delete:
                                status = "DRY_RUN_BACKUP_OK"
                            else:
                                # 3) FIND DELETING CREDENTIAL
                                working_item = None
                                # Use the one we already have if it can delete
                                if drive_meta.get("capabilities", {}).get("canDelete"):
                                    working_item = pool[0]
                                else:
                                    # Search pool
                                    for i, item in enumerate(pool):
                                        if i == 0: continue # Already checked
                                        test_client = get_client_for_pool_item(item, args.token_cache_dir)
                                        try:
                                            meta = test_client.drive_service.files().get(
                                                fileId=script_id,
                                                fields="capabilities(canDelete)",
                                                supportsAllDrives=True
                                            ).execute()
                                            if meta.get("capabilities", {}).get("canDelete"):
                                                working_item = item
                                                break
                                        except:
                                            continue

                                if not working_item:
                                    status = "SKIP_NO_DELETE_PERMISSION"
                                else:
                                    used_cred = working_item["name"]
                                    # 4) DELETE
                                    d_client = get_client_for_pool_item(working_item, args.token_cache_dir)
                                    logger.info(f"  Attempting DELETE with {used_cred}...")
                                    try:
                                        if args.delete_qps > 0:
                                            time.sleep(1.0 / args.delete_qps)
                                        
                                        d_client.drive_service.files().delete(
                                            fileId=script_id,
                                            supportsAllDrives=True
                                        ).execute()
                                        logger.info(f"  ✓ DELETED: {script_id}")
                                        status = "DELETED"
                                        success_deleted_count += 1
                                    except Exception as delete_e:
                                        status = "FAIL_DELETE"
                                        error_msg = str(delete_e)

                        except Exception as backup_e:
                            status = "FAIL_BACKUP"
                            error_msg = str(backup_e)
                except Exception as proj_e:
                    status = "FAIL_VERIFY"
                    error_msg = f"Could not get project info: {proj_e}"

        except Exception as e:
            msg = str(e).lower()
            import googleapiclient.errors
            if isinstance(e, googleapiclient.errors.HttpError) and e.resp.status == 404:
                status = "SKIP_ALREADY_DELETED"
            elif "requested entity was not found" in msg or "404" in msg:
                status = "SKIP_ALREADY_DELETED"
            else:
                status = "FAIL_VERIFY"
                error_msg = str(e)

        # FINAL RECORDING
        logger.info(f"  Result: {status}")
        if error_msg: logger.error(f"  Error: {error_msg}")

        write_to_ledger(ledger_path, {
            "script_id": script_id,
            "sheet_id": sheet_id,
            "canonical_id": canonical_id,
            "status": status,
            "used_credential": used_cred,
            "error": error_msg,
            "backup_paths": backup_paths,
            "ts": datetime.now().isoformat()
        })

        if status.startswith("FAIL"):
            fail_count += 1
        elif status.startswith("SKIP") or status.startswith("DRY"):
            skip_count += 1

        # FAILURE RATE GATE
        total_attempts = success_deleted_count + fail_count
        if total_attempts > 0 and (fail_count / total_attempts) > args.failure_rate_gate:
            logger.error(f"Failure rate gate exceeded ({fail_count / total_attempts:.2%}). Stopping.")
            sys.exit(1)

        # BATCH PROCESSING
        if args.apply_delete and args.batch_size > 0:
            batch_processed += 1
            if batch_processed >= args.batch_size:
                logger.info(f"Batch limit ({args.batch_size}) reached. Sleeping {args.sleep_between_batches}s...")
                time.sleep(args.sleep_between_batches)
                batch_processed = 0

    # CANARY GATE
    if args.apply_delete and args.canary and success_deleted_count == 0:
        logger.error("!" * 60)
        logger.error("  CANARY FAILED: 0 DELETED successes. Stopping execution.")
        logger.error("!" * 60)
        sys.exit(1)

    logger.info("=" * 60)
    logger.info(f"  Processing Finished.")
    logger.info(f"  Deleted: {success_deleted_count}")
    logger.info(f"  Failed: {fail_count}")
    logger.info(f"  Skipped: {skip_count}")
    logger.info("=" * 60)

if __name__ == "__main__":
    main()
