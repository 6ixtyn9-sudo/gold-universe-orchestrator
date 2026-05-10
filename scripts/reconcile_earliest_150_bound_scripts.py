import argparse
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

repo_root = Path(os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, str(repo_root))

from registry.satellite_registry import list_satellites, update_satellite
from fetcher.script_api_client import ScriptApiClient
from syncer.script_syncer import load_gs_sources
from auth.google_auth import get_credentials_from_file, SCOPES
from syncer.fingerprint import compute_fingerprint

try:
    from scripts.audit_google_keys import discover_keys, test_key
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def evaluate_canonical(bound_scripts, registry_script_id, script_client, expected_names):
    if not bound_scripts:
        return None

    for s in bound_scripts:
        if s["id"] == registry_script_id:
            return s["id"]

    best_match_id = None
    best_match_score = -1
    
    for s in bound_scripts:
        try:
            content = script_client.get_project_content(s["id"])
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

def nuke_triggers(script_client, script_id, is_dry_run):
    if not script_client.can_run_function(script_id):
        logger.warning(f"Execution API unavailable; cannot nuke triggers on {script_id}.")
        return False

    if is_dry_run:
        logger.info(f"[Dry-run] Would safely nuke triggers on duplicate {script_id}")
        return True
        
    try:
        original_content = script_client.get_project_content(script_id)
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
        script_client.update_project_content(script_id, new_content)
        
        res = script_client.run_function(script_id, "nukeAllTriggers")
        success = res.get("ok", False)
        if success:
            logger.info(f"Successfully nuked triggers on {script_id}")
        else:
            logger.warning(f"Failed to run nukeAllTriggers on {script_id}: {res.get('error')}")
            
        logger.info(f"Restoring {script_id} to original state...")
        script_client.update_project_content(script_id, original_content)
        
        restored_content = script_client.get_project_content(script_id)
        restored_names = {f["name"] for f in restored_content}
        if restored_names != original_names:
            logger.error(f"CRITICAL: Restore verification failed on duplicate {script_id}! Mismatching files.")
        else:
            logger.info(f"Restore verified on {script_id}.")
            
        return success
    except Exception as e:
        logger.error(f"Exception nuking triggers on {script_id}: {e}")
        return False

def verify_canonical(script_client, canonical_id, expected_names):
    try:
        final_content = script_client.get_project_content(canonical_id)
        final_names = {f["name"] for f in final_content}
        
        if expected_names.issubset(final_names) and "appsscript" in final_names:
            return True
        else:
            return False
    except Exception:
        return False

def check_script_preflight(client, cred_name, key_type, principal):
    preflight = client.can_script_create_project()
    if preflight["ok"]:
        return True
    
    reason = preflight["error_reason"]
    logger.error(f"\nCRITICAL AUTH FAILURE: Script API preflight failed for {cred_name}")
    logger.error(f"Exact error: {preflight['raw_message']}")
    return False

def get_drive_and_script_clients(args):
    drive_creds_path = args.drive_credentials or args.credentials
    script_creds_path = args.script_credentials or args.credentials

    if not drive_creds_path or not script_creds_path:
        logger.error("Missing credentials")
        sys.exit(1)

    drive_creds = get_credentials_from_file(drive_creds_path, args.token_cache_dir, args.interactive_oauth, SCOPES)
    drive_client = ScriptApiClient(credentials=drive_creds, create_qps=args.create_qps, update_qps=args.update_qps, read_qps=args.read_qps)

    s_creds = get_credentials_from_file(script_creds_path, args.token_cache_dir, args.interactive_oauth, SCOPES)
    script_client = ScriptApiClient(credentials=s_creds, create_qps=args.create_qps, update_qps=args.update_qps, read_qps=args.read_qps)
    
    if not check_script_preflight(script_client, script_creds_path, "unknown", "unknown"):
        logger.error("Script API preflight failed on explicitly provided credentials. Aborting.")
        sys.exit(1)

    return drive_client, script_client

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

def main():
    parser = argparse.ArgumentParser(description="Reconcile earliest bound scripts")
    parser.add_argument("--limit", type=int, default=150, help="Number of earliest satellites to process (0 for all)")
    parser.add_argument("--all", action="store_true", help="Process all satellites")
    parser.add_argument("--start-index", type=int, default=0, help="Start index for processing")
    parser.add_argument("--max-errors", type=int, default=5, help="Abort after N systemic errors")
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
    parser.add_argument("--script-credentials", type=str, help="Explicit path to JSON credentials for Script API")
    parser.add_argument("--token-cache-dir", type=str, default="artifacts/token-cache", help="Directory for token caches")
    parser.add_argument("--interactive-oauth", action="store_true", help="Allow interactive browser OAuth login")
    parser.add_argument("--create-if-missing", action="store_true", default=None, help="Create bound script if none exists (default: True with --force)")
    parser.add_argument("--no-create-if-missing", dest="create_if_missing", action="store_false")
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

    drive_client, script_client = get_drive_and_script_clients(args)
    
    gs_sources, err = load_gs_sources()
    if err:
        logger.error(f"Failed to load local .gs sources: {err}")
        sys.exit(1)
        
    local_fingerprint = compute_fingerprint(gs_sources)
    logger.info(f"Local content fingerprint: {local_fingerprint}")
    
    expected_module_names = {f["name"] for f in gs_sources if f["name"] != "appsscript"}
    
    sats = list_satellites()
    
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

    for sat in targets:
        if stats["systemic_errors"] >= args.max_errors:
            logger.error("Max systemic errors reached. Aborting.")
            break

        sat_id = sat.get("id")
        sheet_id = sat.get("sheet_id") or sat_id
        registry_script_id = sat.get("script_id")
        
        logger.info(f"\n--- Processing Satellite {sat_id} (Sheet: {sheet_id}) ---")
        stats["processed"] += 1
        
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
                proj = script_client.script_service.projects().get(scriptId=registry_script_id).execute()
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
                        canonical_id = script_client.create_bound_script(sheet_id, title)
                        stats["created"] += 1
                        bound_scripts = [{"id": canonical_id, "name": title}]
                    except Exception as e:
                        logger.error(f"Failed to create script for {sat_id}: {e}")
                        stats["failed_create"] += 1
                        stats["systemic_errors"] += 1
                        continue
            else:
                logger.warning(f"No bound scripts found for {sat_id}. Skipping.")
                continue
        else:
            canonical_id = evaluate_canonical(bound_scripts, registry_script_id, script_client, expected_module_names)
            if not canonical_id:
                logger.error("Could not determine canonical script.")
                stats["systemic_errors"] += 1
                continue
            logger.info(f"Canonical script identified: {canonical_id}")
        
        if registry_script_id != canonical_id and not is_dry_run:
            update_satellite(sat_id, script_id=canonical_id)
            logger.info("Updated registry with canonical script_id.")
                
        duplicates = [s for s in bound_scripts if s["id"] != canonical_id]
        if duplicates:
            for d in duplicates:
                d_id = d["id"]
                if not is_dry_run:
                    if args.delete_duplicates:
                        drive_client.delete_project(d_id)
                    elif args.fix_triggers:
                        nuke_triggers(script_client, d_id, is_dry_run)

        # Check up-to-date
        needs_sync = True
        remote_fingerprint = None
        
        if args.skip_if_uptodate:
            reg_fp = sat.get("deployed_fingerprint")
            if args.trust_registry_fingerprint and reg_fp == local_fingerprint:
                logger.info(f"SKIPPED_UPTODATE: Registry fingerprint matches local {local_fingerprint}")
                stats["skipped_uptodate"] += 1
                stats["verified"] += 1
                continue
                
            try:
                content = script_client.get_project_content(canonical_id)
                remote_fingerprint = compute_fingerprint(content)
                if remote_fingerprint == local_fingerprint:
                    logger.info(f"SKIPPED_UPTODATE: Remote fingerprint matches local {local_fingerprint}")
                    needs_sync = False
                    stats["skipped_uptodate"] += 1
                    stats["verified"] += 1
                else:
                    logger.info(f"Fingerprint mismatch: local {local_fingerprint} != remote {remote_fingerprint}")
            except Exception as e:
                logger.warning(f"Could not compute remote fingerprint: {e}")

        if needs_sync:
            if not is_dry_run:
                try:
                    script_client.update_project_content(canonical_id, gs_sources)
                    stats["updated"] += 1
                    
                    # Verify
                    final_content = script_client.get_project_content(canonical_id)
                    final_fp = compute_fingerprint(final_content)
                    if final_fp == local_fingerprint:
                        stats["verified"] += 1
                        update_satellite(sat_id, deployed_fingerprint=local_fingerprint, deployed_at=datetime.utcnow().isoformat() + "Z")
                    else:
                        logger.error(f"VERIFY_FAILED: Remote fingerprint {final_fp} != expected {local_fingerprint}")
                        stats["failed_update"] += 1
                except Exception as e:
                    logger.error(f"Failed to sync canonical project {canonical_id}: {e}")
                    stats["failed_update"] += 1
                    stats["systemic_errors"] += 1
            else:
                logger.info(f"[Dry-run] Would sync modules to {canonical_id}.")
            
    logger.info("\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info(f"Sort mode: {args.sort_by} ({args.sort_order})")
    logger.info(f"Satellites processed: {stats['processed']}")
    logger.info(f"Created: {stats['created']}")
    logger.info(f"Updated: {stats['updated']}")
    logger.info(f"Skipped (up-to-date): {stats['skipped_uptodate']}")
    logger.info(f"Verified: {stats['verified']}")
    logger.info(f"Failed Create: {stats['failed_create']}")
    logger.info(f"Failed Update: {stats['failed_update']}")
    retries = script_client.rate_limited_retries + drive_client.rate_limited_retries
    logger.info(f"Rate Limited Retries: {retries}")
    logger.info("=" * 60)
    
if __name__ == "__main__":
    main()
