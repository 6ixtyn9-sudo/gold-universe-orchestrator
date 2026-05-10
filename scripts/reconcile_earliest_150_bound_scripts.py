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
        logger.warning(f"Execution API unavailable; cannot nuke triggers on {script_id}. Use --delete-duplicates to eliminate risk.")
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
            extra = final_names - expected_names - {"appsscript"}
            if extra:
                logger.warning(f"VERIFIED (with extra files: {extra})")
            else:
                logger.info("VERIFIED")
            return True
        else:
            missing = expected_names - final_names
            if "appsscript" not in final_names: missing.add("appsscript")
            logger.error(f"VERIFY_FAILED: Missing modules {missing}")
            return False
    except Exception as e:
        logger.error(f"VERIFY_FAILED: Error fetching content: {e}")
        return False

def check_script_preflight(client, cred_name, key_type, principal):
    preflight = client.can_script_create_project()
    if preflight["ok"]:
        return True
    
    reason = preflight["error_reason"]
    logger.error(f"\nCRITICAL AUTH FAILURE: Script API preflight failed for {cred_name}")
    logger.error(f"Key Type: {key_type} | Principal: {principal}")
    logger.error(f"Exact error: {preflight['raw_message']}")
    
    if key_type == "oauth_client":
        logger.error("Remediation: Login as esl4smartkids@gmail.com and enable Apps Script API at https://script.google.com/home/usersettings")
    elif key_type == "service_account":
        logger.error("Remediation: Service accounts may not create/manage Apps Script projects without Workspace domain-wide delegation. Use OAuth creds for script operations OR provide impersonation support.")
    else:
        logger.error("Remediation: Ensure API is enabled and scopes are correct.")
    
    return False

def get_drive_and_script_clients(args):
    drive_creds_path = args.drive_credentials or args.credentials
    script_creds_path = args.script_credentials or args.credentials

    drive_client = None
    script_client = None

    if drive_creds_path:
        drive_creds = get_credentials_from_file(drive_creds_path, args.token_cache_dir, args.interactive_oauth, SCOPES)
        drive_client = ScriptApiClient(credentials=drive_creds)
    elif args.auto_pick_drive_credentials or args.auto_pick_key:
        candidates = discover_keys(args.keys_dir)
        registry_samples = []
        reg_path = repo_root / "registry/registry.json"
        if reg_path.exists():
            with open(reg_path) as f:
                sats = json.load(f).get("satellites", [])
                if sats: registry_samples.append(sats[0].get("sheet_id") or sats[0].get("id"))
        ctx = {"max": 1, "count": 0, "allowlist": []}
        for path in candidates:
            res = test_key(path, registry_samples, args.interactive_oauth, args.token_cache_dir, ctx)
            if res and res["overall_status"] in ["DRIVE_OK_SCRIPT_OK", "DRIVE_OK_SCRIPT_NO"]:
                logger.info(f"Auto-picked Drive credential: {path.name}")
                drive_creds = get_credentials_from_file(path, args.token_cache_dir, args.interactive_oauth, SCOPES)
                drive_client = ScriptApiClient(credentials=drive_creds)
                break
        if not drive_client:
            logger.error("Auto-pick failed: No working Drive credentials found.")
            sys.exit(1)
    else:
        logger.error("No Drive credentials provided.")
        sys.exit(1)

    if script_creds_path:
        # Load and preflight
        s_creds = get_credentials_from_file(script_creds_path, args.token_cache_dir, args.interactive_oauth, SCOPES)
        script_client = ScriptApiClient(credentials=s_creds)
        # Assuming we can't easily parse type from creds, we will do best effort preflight
        if not check_script_preflight(script_client, script_creds_path, "unknown", "unknown"):
            logger.error("Script API preflight failed on explicitly provided credentials. Aborting.")
            sys.exit(1)
    elif args.auto_pick_script_credentials or args.auto_pick_key:
        candidates = discover_keys(args.keys_dir)
        registry_samples = []
        ctx = {"max": 1, "count": 0, "allowlist": []}
        for path in candidates:
            res = test_key(path, registry_samples, args.interactive_oauth, args.token_cache_dir, ctx)
            if res and res["overall_status"] == "DRIVE_OK_SCRIPT_OK":
                logger.info(f"Auto-picked Script credential: {path.name}")
                s_creds = get_credentials_from_file(path, args.token_cache_dir, args.interactive_oauth, SCOPES)
                script_client = ScriptApiClient(credentials=s_creds)
                break
        if not script_client:
            logger.error("Auto-pick failed: No working Script API credentials found that pass preflight.")
            sys.exit(1)
    else:
        logger.error("No Script credentials provided.")
        sys.exit(1)

    return drive_client, script_client

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
    parser.add_argument("--sort-by", choices=["added_at", "drive_created_time"], default="added_at", help="Sort order for 'earliest'")
    parser.add_argument("--credentials", type=str, help="Explicit path to JSON credentials")
    parser.add_argument("--drive-credentials", type=str, help="Explicit path to JSON credentials for Drive")
    parser.add_argument("--script-credentials", type=str, help="Explicit path to JSON credentials for Script API")
    parser.add_argument("--keys-dir", type=str, help="Directory to auto-discover keys from")
    parser.add_argument("--auto-pick-key", action="store_true", help="Auto pick first working key")
    parser.add_argument("--auto-pick-drive-credentials", action="store_true", help="Auto pick Drive key")
    parser.add_argument("--auto-pick-script-credentials", action="store_true", help="Auto pick Script key")
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
    logger.info(f"Reconciling earliest bound scripts (limit={limit_val}, start={args.start_index})")
    logger.info(f"Dry-run: {is_dry_run}")
    logger.info(f"Fix Triggers: {args.fix_triggers}")
    logger.info(f"Delete Duplicates: {args.delete_duplicates}")
    logger.info(f"Create if missing: {args.create_if_missing}")
    logger.info("=" * 60)

    drive_client, script_client = get_drive_and_script_clients(args)
    
    gs_sources, err = load_gs_sources()
    if err:
        logger.error(f"Failed to load local .gs sources: {err}")
        sys.exit(1)
        
    expected_module_names = {f["name"] for f in gs_sources if f["name"] != "appsscript"}
    
    sats = list_satellites()
    
    if args.sort_by == "added_at":
        def sort_key(s):
            val = s.get("added_at")
            return val if val else "9999-12-31T23:59:59"
    else:
        def sort_key(s):
            val = s.get("drive", {}).get("createdTime")
            return val if val else "9999-12-31T23:59:59"
            
    sats_sorted = sorted(sats, key=sort_key)
    targets = sats_sorted[args.start_index:]
    if limit_val > 0:
        targets = targets[:limit_val]
    
    stats = {
        "processed": 0,
        "had_duplicates": 0,
        "duplicates_disabled": 0,
        "duplicates_deleted": 0,
        "canonical_fixed": 0,
        "verification_failures": 0,
        "systemic_errors": 0
    }

    for sat in targets:
        if stats["systemic_errors"] >= args.max_errors:
            logger.error("Max systemic errors reached. Aborting.")
            break

        sat_id = sat.get("id")
        sheet_id = sat.get("sheet_id")
        
        if not sheet_id:
            logger.warning(f"Satellite {sat_id} missing sheet_id! Falling back to id.")
            sheet_id = sat_id
            if not is_dry_run:
                update_satellite(sat_id, sheet_id=sheet_id)
                logger.info(f"Normalized registry: saved sheet_id={sheet_id} for satellite {sat_id}")
                
        registry_script_id = sat.get("script_id")
        
        logger.info(f"\n--- Processing Satellite {sat_id} (Sheet: {sheet_id}) ---")
        stats["processed"] += 1
        
        try:
            bound_scripts = drive_client.find_all_bound_scripts(sheet_id)
        except Exception as e:
            msg = str(e).lower()
            if "deleted_client" in msg or "unauthorized" in msg or "permission" in msg:
                logger.error(f"CRITICAL AUTH FAILURE: Unable to search Drive. Key is broken or lacks access. Error: {e}")
                sys.exit(1)
            else:
                logger.error(f"Failed to list bound scripts: {e}")
                stats["systemic_errors"] += 1
                continue

        # Drive API might not return bound scripts. Manually add the one from registry if it exists and matches.
        if registry_script_id:
            try:
                proj = script_client.script_service.projects().get(scriptId=registry_script_id).execute()
                if proj.get("parentId") == sheet_id:
                    if not any(s["id"] == registry_script_id for s in bound_scripts):
                        bound_scripts.append({"id": registry_script_id, "name": proj.get("title")})
            except Exception as e:
                logger.warning(f"Could not verify registry_script_id {registry_script_id} via Script API: {e}")

        if not bound_scripts:
            if args.create_if_missing:
                if is_dry_run:
                    logger.info(f"[Dry-run] Would create new bound script for {sat_id} because none exists.")
                    continue
                else:
                    logger.info(f"No bound scripts found. Creating new bound project for {sat_id}...")
                    title = f"Ma Golide Satellite Logic - {sat.get('league', 'Unknown')} {sat.get('date', 'Unknown')}"
                    try:
                        canonical_id = script_client.create_bound_script(sheet_id, title)
                        logger.info(f"Created new script: {canonical_id}")
                    except Exception as e:
                        logger.error(f"Failed to create script for {sat_id}: {e}")
                        stats["systemic_errors"] += 1
                        continue
            else:
                logger.warning(f"No bound scripts found for {sat_id}. Skipping because create_if_missing is false.")
                continue
        else:
            logger.info(f"Found {len(bound_scripts)} bound script(s).")
            canonical_id = evaluate_canonical(bound_scripts, registry_script_id, script_client, expected_module_names)
            if not canonical_id:
                logger.error("Could not determine canonical script.")
                stats["systemic_errors"] += 1
                continue
            logger.info(f"Canonical script identified: {canonical_id}")
        
        if registry_script_id != canonical_id:
            if not is_dry_run:
                update_satellite(sat_id, script_id=canonical_id)
                logger.info("Updated registry with canonical script_id.")
            else:
                logger.info(f"[Dry-run] Would update registry script_id to {canonical_id}")
                
        duplicates = [s for s in bound_scripts if s["id"] != canonical_id]
        if duplicates:
            stats["had_duplicates"] += 1
            logger.info(f"Found {len(duplicates)} duplicate(s).")
            
            for d in duplicates:
                d_id = d["id"]
                
                if is_dry_run:
                    logger.info(f"[Dry-run] Would backup duplicate {d_id}")
                else:
                    try:
                        content = script_client.get_project_content(d_id)
                        backup_dir = repo_root / "artifacts" / "dupe-script-backups" / sheet_id
                        backup_dir.mkdir(parents=True, exist_ok=True)
                        backup_path = backup_dir / f"{d_id}.json"
                        backup_path.write_text(json.dumps(content, indent=2))
                        logger.info(f"Backed up duplicate {d_id} to {backup_path}")
                    except Exception as e:
                        logger.error(f"Failed to backup {d_id}: {e}")
                        stats["systemic_errors"] += 1
                
                if args.delete_duplicates:
                    if is_dry_run:
                        logger.info(f"[Dry-run] Would delete duplicate {d_id}")
                    else:
                        if drive_client.delete_project(d_id):
                            stats["duplicates_deleted"] += 1
                        else:
                            stats["systemic_errors"] += 1
                else:
                    if args.fix_triggers:
                        if nuke_triggers(script_client, d_id, is_dry_run):
                            stats["duplicates_disabled"] += 1
                        else:
                            stats["systemic_errors"] += 1
                    else:
                        logger.warning(f"Duplicate {d_id} left untouched. It may still have triggers.")

        already_verified = False
        try:
            already_verified = verify_canonical(script_client, canonical_id, expected_module_names)
        except Exception:
            pass

        if already_verified:
            logger.info(f"Canonical project {canonical_id} is already VERIFIED. Skipping sync.")
            # Still count it as fixed if we had to pick it or register it? Actually, skip counting as fixed since we did no write
        else:
            if not is_dry_run:
                logger.info(f"Syncing correct modules to canonical project {canonical_id}")
                try:
                    script_client.update_project_content(canonical_id, gs_sources)
                    stats["canonical_fixed"] += 1
                    
                    if not verify_canonical(script_client, canonical_id, expected_module_names):
                        stats["verification_failures"] += 1
                except Exception as e:
                    logger.error(f"Failed to sync canonical project {canonical_id}: {e}")
                    stats["verification_failures"] += 1
                    stats["systemic_errors"] += 1
            else:
                logger.info(f"[Dry-run] Would sync modules to {canonical_id} and verify.")
            
    logger.info("\n" + "=" * 60)
    logger.info("SUMMARY")
    logger.info(f"Satellites processed: {stats['processed']}")
    logger.info(f"Had duplicates: {stats['had_duplicates']}")
    logger.info(f"Duplicates disabled (triggers nuked): {stats['duplicates_disabled']}")
    logger.info(f"Duplicates deleted: {stats['duplicates_deleted']}")
    logger.info(f"Canonical projects fixed/synced: {stats['canonical_fixed']} (dry_run: {is_dry_run})")
    logger.info(f"Verification failures: {stats['verification_failures']}")
    logger.info(f"Systemic Errors: {stats['systemic_errors']}")
    logger.info("=" * 60)
    
    if stats["verification_failures"] > 0 and not is_dry_run:
        sys.exit(1)

if __name__ == "__main__":
    main()
