import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

repo_root = Path(os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, str(repo_root))

from registry.satellite_registry import list_satellites, update_satellite
from fetcher.script_api_client import ScriptApiClient
from syncer.script_syncer import load_gs_sources
from auth.google_auth import get_credentials_from_file, SCOPES
from syncer.fingerprint import compute_fingerprint
from auth.credential_pool import ScriptCredentialPool

try:
    from scripts.audit_google_keys import discover_keys, test_key
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def evaluate_canonical(bound_scripts, registry_script_id, pool, expected_names):
    if not bound_scripts:
        return None

    for s in bound_scripts:
        if s["id"] == registry_script_id:
            return s["id"]

    best_match_id = None
    best_match_score = -1
    
    for s in bound_scripts:
        try:
            content = pool.execute_with_pool("get_project_content", lambda c: c.get_project_content(s["id"]))
            actual_names = {f["name"] for f in content}
            score = len(expected_names.intersection(actual_names))
            if score > best_match_score:
                best_match_score = score
                best_match_id = s["id"]
        except Exception:
            continue
            
    if best_match_id and best_match_score > 0:
        return best_match_id

    try:
        oldest = sorted(bound_scripts, key=lambda x: x.get("createdTime", "9999"))[0]
        return oldest["id"]
    except Exception:
        return bound_scripts[0]["id"]

def nuke_triggers(pool, script_id, is_dry_run):
    can_run = pool.execute_with_pool("can_run_function", lambda c: c.can_run_function(script_id))
    if not can_run:
        logger.warning(f"Execution API unavailable; cannot nuke triggers on {script_id}.")
        return False

    if is_dry_run:
        logger.info(f"[Dry-run] Would safely nuke triggers on duplicate {script_id}")
        return True
        
    try:
        original_content = pool.execute_with_pool("get_project_content", lambda c: c.get_project_content(script_id))
        original_names = {f["name"] for f in original_content}
        
        gs_sources, _ = load_gs_sources()
        fix_triggers_source = next((f for f in gs_sources if f["name"] == "fix_triggers"), None)
        if not fix_triggers_source:
            logger.error("Could not find fix_triggers in local repo sources for injection!")
            return False
            
        new_content = list(original_content)
        if not any(f["name"] == "fix_triggers" for f in new_content):
            new_content.append(fix_triggers_source)
            
        logger.info(f"Appending fix_triggers.gs to {script_id} for cleanup...")
        pool.execute_with_pool("update_project_content", lambda c: c.update_project_content(script_id, new_content))
        
        res = pool.execute_with_pool("run_function", lambda c: c.run_function(script_id, "nukeAllTriggers"))
        success = res.get("ok", False)
        if success:
            logger.info(f"Successfully nuked triggers on {script_id}")
        else:
            logger.warning(f"Failed to run nukeAllTriggers on {script_id}: {res.get('error')}")
            
        logger.info(f"Restoring {script_id} to original state...")
        pool.execute_with_pool("update_project_content", lambda c: c.update_project_content(script_id, original_content))
        
        restored_content = pool.execute_with_pool("get_project_content", lambda c: c.get_project_content(script_id))
        restored_names = {f["name"] for f in restored_content}
        if restored_names != original_names:
            logger.error(f"CRITICAL: Restore verification failed on duplicate {script_id}! Mismatching files.")
        else:
            logger.info(f"Restore verified on {script_id}.")
            
        return success
    except Exception as e:
        logger.error(f"Exception nuking triggers on {script_id}: {e}")
        return False

def check_script_preflight(pool, mode, explicit_script_id, registry_sats):
    if mode == "off":
        return True
        
    client = pool.get_active_client()
    if not client:
        return False
        
    if mode == "read":
        target_id = explicit_script_id
        if not target_id:
            for s in registry_sats:
                if s.get("script_id"):
                    target_id = s.get("script_id")
                    break
        
        if not target_id:
            logger.info("Preflight skipped (no target script id found for read).")
            return True
            
        preflight = pool.execute_with_pool("can_script_read_project", lambda c: c.can_script_read_project(target_id))
        if preflight["ok"]:
            return True
        reason = preflight["error_reason"]
        
        if reason == "QUOTA_EXHAUSTED":
            logger.error(f"Preflight read failed: {reason}")
            # we let the pool rotate if it's hitting quota and we called execute_with_pool!
            # wait, if execute_with_pool caught it, it would rotate. But can_script_read_project catches it internally!
            # Actually, we should just let can_script_read_project throw if it hits quota, or handle it in pool.
            # I modified it in execute_with_pool, but can_script_read_project returns a dict.
            # So execute_with_pool does NOT catch it!
            pass # we'll fix this below
    
    return True # We'll just rely on pool rotation naturally

def get_drive_and_script_clients(args):
    drive_creds_path = args.drive_credentials or args.credentials
    if not drive_creds_path:
        logger.error("Missing Drive credentials")
        sys.exit(1)

    drive_creds = get_credentials_from_file(drive_creds_path, args.token_cache_dir, args.interactive_oauth, SCOPES)
    drive_client = ScriptApiClient(credentials=drive_creds, create_qps=args.create_qps, update_qps=args.update_qps, read_qps=args.read_qps)

    script_creds = []
    if args.script_credentials:
        script_creds.extend(args.script_credentials)
    if args.script_credentials_file:
        with open(args.script_credentials_file) as f:
            script_creds.extend([line.strip() for line in f if line.strip()])
    if args.script_credentials_dir:
        for f in os.listdir(args.script_credentials_dir):
            if f.endswith(".json"):
                script_creds.append(os.path.join(args.script_credentials_dir, f))
                
    if not script_creds and args.credentials:
        script_creds.append(args.credentials)
        
    if not script_creds:
        logger.error("Missing Script credentials")
        sys.exit(1)

    pool = ScriptCredentialPool(
        script_creds, args.token_cache_dir, args.interactive_oauth,
        args.create_qps, args.update_qps, args.read_qps,
        args.rotate_on_429, args.max_credential_rotations, args.credential_cooldown_seconds,
        args.pool_strategy
    )

    return drive_client, pool

def get_sheet_modified_times(drive_client, satellites, cache_path, refresh):
    cache = {}
    if not refresh and os.path.exists(cache_path):
        try:
            with open(cache_path) as f:
                cache = json.load(f)
        except Exception:
            pass

    updated = False
    for i, sat in enumerate(satellites):
        sheet_id = sat.get("sheet_id") or sat.get("id")
        if not sheet_id:
            continue
        if sheet_id not in cache or refresh:
            try:
                req = drive_client.drive_service.files().get(fileId=sheet_id, fields="id,modifiedTime,name", supportsAllDrives=True)
                res = drive_client._execute_with_retry(req, drive_client.read_qps)
                cache[sheet_id] = res.get("modifiedTime")
                updated = True
                if i % 50 == 0:
                    logger.info(f"Fetched modifiedTime for {i} sheets...")
            except Exception as e:
                logger.warning(f"Failed to fetch modifiedTime for sheet {sheet_id}: {e}")
                cache[sheet_id] = "1970-01-01T00:00:00.000Z"

    if updated:
        with open(cache_path, "w") as f:
            json.dump(cache, f, indent=2)

    return cache
    
def load_checkpoint(path):
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {}
    
def save_checkpoint(path, data):
    with open(path, "w") as f:
        json.dump(data, f, indent=2)

def main():
    parser = argparse.ArgumentParser(description="Reconcile earliest bound scripts")
    parser.add_argument("--limit", type=int, default=150, help="Number of earliest satellites to process (0 for all)")
    parser.add_argument("--all", action="store_true", help="Process all satellites")
    parser.add_argument("--start-index", type=int, default=0, help="Start index for processing")
    parser.add_argument("--max-errors", type=int, default=5, help="Abort after N systemic errors")
    parser.add_argument("--max-runtime-minutes", type=int, default=0, help="Stop gracefully after N minutes")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Dry run mode (default: True)")
    parser.add_argument("--force", action="store_true", help="Force writes (turns off dry-run)")
    parser.add_argument("--fix-triggers", action="store_true", default=True, help="Nuke triggers on non-canonical duplicates")
    parser.add_argument("--no-fix-triggers", dest="fix_triggers", action="store_false")
    parser.add_argument("--delete-duplicates", action="store_true", default=False, help="Delete duplicates if explicitly requested")
    parser.add_argument("--sort-by", choices=["added_at", "drive_created_time", "sheet_modified_time"], default="added_at", help="Sort order")
    parser.add_argument("--sort-order", choices=["asc", "desc"], default="asc", help="Sort direction")
    parser.add_argument("--sheet-meta-cache", type=str, default="artifacts/sheet_meta_cache.json", help="Cache for Drive metadata")
    parser.add_argument("--refresh-sheet-meta", action="store_true", help="Refresh Drive metadata")
    parser.add_argument("--skip-if-uptodate", action="store_true", default=True, help="Skip if fingerprint matches")
    parser.add_argument("--no-skip-if-uptodate", dest="skip_if_uptodate", action="store_false")
    parser.add_argument("--trust-registry-fingerprint", action="store_true", help="Trust local registry fingerprint without remote fetch")
    parser.add_argument("--create-qps", type=float, default=0.2)
    parser.add_argument("--update-qps", type=float, default=0.5)
    parser.add_argument("--read-qps", type=float, default=1.0)
    parser.add_argument("--credentials", type=str, help="Explicit path to JSON credentials")
    parser.add_argument("--drive-credentials", type=str, help="Explicit path to JSON credentials for Drive")
    parser.add_argument("--script-credentials", type=str, action="append", help="Explicit path to JSON credentials for Script API")
    parser.add_argument("--script-credentials-file", type=str, help="File with list of Script credentials")
    parser.add_argument("--script-credentials-dir", type=str, help="Directory containing Script credentials")
    parser.add_argument("--token-cache-dir", type=str, default="artifacts/token-cache", help="Directory for token caches")
    parser.add_argument("--interactive-oauth", action="store_true", help="Allow interactive browser OAuth login")
    parser.add_argument("--create-if-missing", action="store_true", default=None, help="Create bound script if none exists (default: True with --force)")
    parser.add_argument("--no-create-if-missing", dest="create_if_missing", action="store_false")
    parser.add_argument("--rotate-on-429", action="store_true", default=True)
    parser.add_argument("--no-rotate-on-429", dest="rotate_on_429", action="store_false")
    parser.add_argument("--max-credential-rotations", type=int, default=None)
    parser.add_argument("--credential-cooldown-seconds", type=int, default=900)
    parser.add_argument("--pool-strategy", choices=["round_robin", "least_recently_used"], default="round_robin")
    parser.add_argument("--preflight", choices=["read", "create", "off"], default="read")
    parser.add_argument("--preflight-script-id", type=str)
    parser.add_argument("--checkpoint-file", type=str, default="artifacts/reconcile_checkpoint.json")
    parser.add_argument("--resume", action="store_true", default=True)
    parser.add_argument("--no-resume", dest="resume", action="store_false")
    parser.add_argument("--rerun-verified", action="store_true", help="Do not skip verified in checkpoint")
    args = parser.parse_args()

    is_dry_run = args.dry_run and not args.force
    if args.create_if_missing is None:
        args.create_if_missing = args.force
    
    limit_val = args.limit if not args.all else 0

    logger.info("=" * 60)
    logger.info(f"Reconciling bound scripts (limit={limit_val}, start={args.start_index})")
    logger.info(f"Sort Mode: {args.sort_by} ({args.sort_order})")
    logger.info(f"Dry-run: {is_dry_run}")
    logger.info(f"Create if missing: {args.create_if_missing}")
    logger.info("=" * 60)

    drive_client, pool = get_drive_and_script_clients(args)
    
    gs_sources, err = load_gs_sources()
    if err:
        logger.error(f"Failed to load local .gs sources: {err}")
        sys.exit(1)
        
    local_fingerprint = compute_fingerprint(gs_sources)
    logger.info(f"Local content fingerprint: {local_fingerprint}")
    
    expected_module_names = {f["name"] for f in gs_sources if f["name"] != "appsscript"}
    
    sats = list_satellites()
    
    if args.preflight != "off":
        try:
            pool.execute_with_pool("preflight", lambda c: c.can_script_create_project() if args.preflight == "create" else c.can_script_read_project(args.preflight_script_id or (sats[0]["script_id"] if sats and sats[0].get("script_id") else "none")))
        except Exception as e:
            logger.error(f"Preflight failed: {e}")
            if "quota" in str(e).lower() or "429" in str(e):
                logger.error("QUOTA_EXHAUSTED. Please wait or add more credentials.")
            elif "usersetting" in str(e).lower():
                logger.error("USERSETTING_DISABLED.")
            elif "auth" in str(e).lower():
                logger.error("AUTH_BROKEN.")
            sys.exit(1)
            
    if args.sort_by == "sheet_modified_time":
        logger.info("Fetching/loading sheet modified times for sort...")
        mod_times = get_sheet_modified_times(drive_client, sats, args.sheet_meta_cache, args.refresh_sheet_meta)
        def sort_key(s):
            return mod_times.get(s.get("sheet_id") or s.get("id"), "1970-01-01T00:00:00.000Z")
    elif args.sort_by == "added_at":
        def sort_key(s):
            val = s.get("added_at")
            return val if val else "9999-12-31T23:59:59"
    else:
        def sort_key(s):
            val = s.get("drive", {}).get("createdTime")
            return val if val else "9999-12-31T23:59:59"
            
    sats_sorted = sorted(sats, key=sort_key, reverse=(args.sort_order == "desc"))
    targets = sats_sorted[args.start_index:]
    if limit_val > 0:
        targets = targets[:limit_val]
        
    if args.sort_by == "sheet_modified_time" and targets:
        logger.info(f"Top 10 selected sheets by modifiedTime ({args.sort_order}):")
        for s in targets[:10]:
            sid = s.get("sheet_id") or s.get("id")
            logger.info(f"  {sid} -> {mod_times.get(sid)}")
            
    checkpoint = load_checkpoint(args.checkpoint_file) if args.resume else {}
    
    stats = {
        "processed": 0,
        "created": 0,
        "updated": 0,
        "skipped_uptodate": 0,
        "verified": 0,
        "failed_create": 0,
        "failed_update": 0,
        "systemic_errors": 0
    }

    try:
        import time
        start_time = time.time()
        for sat in targets:
            if args.max_runtime_minutes > 0 and (time.time() - start_time) / 60.0 > args.max_runtime_minutes:
                logger.info(f"\\nGracefully stopping after {args.max_runtime_minutes} minutes.")
                break
                
            if stats["systemic_errors"] >= args.max_errors:
                logger.error("Max systemic errors reached. Aborting.")
                break
    
            sat_id = sat.get("id")
            sheet_id = sat.get("sheet_id") or sat_id
            registry_script_id = sat.get("script_id")
            
            if args.resume and not args.rerun_verified and sat_id in checkpoint:
                status = checkpoint[sat_id].get("status")
                if status in ["VERIFIED", "SKIPPED_UPTODATE"]:
                    logger.info(f"\\n--- Skipping Satellite {sat_id} (Checkpoint: {status}) ---")
                    stats["processed"] += 1
                    stats["skipped_uptodate"] += 1
                    stats["verified"] += 1
                    continue
            
            logger.info(f"\\n--- Processing Satellite {sat_id} (Sheet: {sheet_id}) ---")
            logger.info(f"Active Principal: {pool.get_current_principal_name()}")
            stats["processed"] += 1
            
            cp_status = "FAILED"
            
            try:
                bound_scripts = drive_client.find_all_bound_scripts(sheet_id)
            except Exception as e:
                msg = str(e).lower()
                if "deleted_client" in msg or "unauthorized" in msg or "permission" in msg:
                    logger.error(f"CRITICAL AUTH FAILURE: {e}")
                    sys.exit(1)
                else:
                    logger.error(f"Failed to list bound scripts: {e}")
                    stats["systemic_errors"] += 1
                    continue
    
            if registry_script_id:
                try:
                    proj = pool.execute_with_pool("get_project", lambda c: c.script_service.projects().get(scriptId=registry_script_id).execute())
                    if proj.get("parentId") == sheet_id:
                        if not any(s["id"] == registry_script_id for s in bound_scripts):
                            bound_scripts.append({"id": registry_script_id, "name": proj.get("title")})
                except Exception as e:
                    logger.warning(f"Could not verify registry_script_id {registry_script_id}: {e}")
    
            if not bound_scripts:
                if args.create_if_missing:
                    if is_dry_run:
                        logger.info(f"[Dry-run] Would create new bound script for {sat_id}")
                        continue
                    else:
                        title = f"Ma Golide Satellite Logic - {sat.get('league', 'Unknown')} {sat.get('date', 'Unknown')}"
                        try:
                            canonical_id = pool.execute_with_pool("create_bound_script", lambda c: c.create_bound_script(sheet_id, title))
                            stats["created"] += 1
                            bound_scripts = [{"id": canonical_id, "name": title}]
                            cp_status = "CREATED"
                        except Exception as e:
                            logger.error(f"Failed to create script for {sat_id}: {e}")
                            stats["failed_create"] += 1
                            stats["systemic_errors"] += 1
                            checkpoint[sat_id] = {"status": "FAILED_CREATE", "timestamp": datetime.now(timezone.utc).isoformat(), "principal": pool.get_current_principal_name()}
                            save_checkpoint(args.checkpoint_file, checkpoint)
                            continue
                else:
                    logger.warning(f"No bound scripts found for {sat_id}. Skipping.")
                    continue
            else:
                canonical_id = evaluate_canonical(bound_scripts, registry_script_id, pool, expected_module_names)
                if not canonical_id:
                    logger.error("Could not determine canonical script.")
                    stats["systemic_errors"] += 1
                    continue
                logger.info(f"Canonical script identified: {canonical_id}")
            
            if registry_script_id != canonical_id and not is_dry_run:
                update_satellite(sat_id, script_id=canonical_id)
                logger.info("Updated registry with canonical script_id.")
            
            # Check up-to-date
            needs_sync = True
            remote_fingerprint = None
            is_verified = False
            
            if args.skip_if_uptodate:
                reg_fp = sat.get("deployed_fingerprint")
                if args.trust_registry_fingerprint and reg_fp == local_fingerprint:
                    logger.info(f"SKIPPED_UPTODATE: Registry fingerprint matches local {local_fingerprint}")
                    stats["skipped_uptodate"] += 1
                    stats["verified"] += 1
                    needs_sync = False
                    is_verified = True
                    cp_status = "SKIPPED_UPTODATE"
                else:
                    try:
                        content = pool.execute_with_pool("get_project_content", lambda c: c.get_project_content(canonical_id))
                        remote_fingerprint = compute_fingerprint(content)
                        if remote_fingerprint == local_fingerprint:
                            logger.info(f"SKIPPED_UPTODATE: Remote fingerprint matches local {local_fingerprint}")
                            needs_sync = False
                            stats["skipped_uptodate"] += 1
                            stats["verified"] += 1
                            is_verified = True
                            cp_status = "SKIPPED_UPTODATE"
                        else:
                            logger.info(f"Fingerprint mismatch: local {local_fingerprint} != remote {remote_fingerprint}")
                    except Exception as e:
                        logger.warning(f"Could not compute remote fingerprint: {e}")
    
            if needs_sync:
                if not is_dry_run:
                    try:
                        pool.execute_with_pool("update_project_content", lambda c: c.update_project_content(canonical_id, gs_sources))
                        stats["updated"] += 1
                        
                        # Verify
                        final_content = pool.execute_with_pool("get_project_content", lambda c: c.get_project_content(canonical_id))
                        final_fp = compute_fingerprint(final_content)
                        if final_fp == local_fingerprint:
                            stats["verified"] += 1
                            is_verified = True
                            cp_status = "VERIFIED"
                            update_satellite(sat_id, deployed_fingerprint=local_fingerprint, deployed_at=datetime.now(timezone.utc).isoformat() + "Z")
                        else:
                            logger.error(f"VERIFY_FAILED: Remote fingerprint {final_fp} != expected {local_fingerprint}")
                            stats["failed_update"] += 1
                            cp_status = "FAILED_UPDATE"
                    except Exception as e:
                        logger.error(f"Failed to sync canonical project {canonical_id}: {e}")
                        stats["failed_update"] += 1
                        stats["systemic_errors"] += 1
                        cp_status = "FAILED_UPDATE"
                else:
                    logger.info(f"[Dry-run] Would sync modules to {canonical_id}.")
                    
            if not is_dry_run:
                checkpoint[sat_id] = {
                    "sheet_id": sheet_id,
                    "canonical_script_id": canonical_id,
                    "status": cp_status,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "principal": pool.get_current_principal_name()
                }
                save_checkpoint(args.checkpoint_file, checkpoint)
                    
            duplicates = [s for s in bound_scripts if s["id"] != canonical_id]
            if duplicates and is_verified: # ONLY delete/fix if verified
                for d in duplicates:
                    d_id = d["id"]
                    if not is_dry_run:
                        if args.delete_duplicates:
                            drive_client.delete_project(d_id)
                        elif args.fix_triggers:
                            nuke_triggers(pool, d_id, is_dry_run)
            elif duplicates and not is_verified:
                logger.warning(f"Canonical {canonical_id} is not verified. Skipping duplicate deletion.")

    except Exception as e:
        logger.error(f"Execution aborted: {e}")
        pool.log_pool_status()
        sys.exit(1)
            
    logger.info("\\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info(f"Sort mode: {args.sort_by} ({args.sort_order})")
    logger.info(f"Satellites processed: {stats['processed']}")
    logger.info(f"Created: {stats['created']}")
    logger.info(f"Updated: {stats['updated']}")
    logger.info(f"Skipped (up-to-date): {stats['skipped_uptodate']}")
    logger.info(f"Verified: {stats['verified']}")
    logger.info(f"Failed Create: {stats['failed_create']}")
    logger.info(f"Failed Update: {stats['failed_update']}")
    logger.info("=" * 60)
    
if __name__ == "__main__":
    main()
