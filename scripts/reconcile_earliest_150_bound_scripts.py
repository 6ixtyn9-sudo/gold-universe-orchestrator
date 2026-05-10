import argparse
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Add project root to sys.path to import local modules
repo_root = Path(os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, str(repo_root))

from registry.satellite_registry import list_satellites, update_satellite
from fetcher.script_api_client import ScriptApiClient
from syncer.script_syncer import load_gs_sources
from auth.google_auth import get_credentials_from_file, SCOPES

# For auto-pick
try:
    from scripts.audit_google_keys import discover_keys, test_key
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def evaluate_canonical(bound_scripts, registry_script_id, client, expected_names):
    if not bound_scripts:
        return None

    for s in bound_scripts:
        if s["id"] == registry_script_id:
            return s["id"]

    best_match_id = None
    best_match_score = -1
    
    for s in bound_scripts:
        try:
            content = client.get_project_content(s["id"])
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

def nuke_triggers(client, script_id, is_dry_run):
    if not client.can_run_function(script_id):
        logger.warning(f"Execution API unavailable; cannot nuke triggers on {script_id}. Use --delete-duplicates to eliminate risk.")
        return False

    if is_dry_run:
        logger.info(f"[Dry-run] Would safely nuke triggers on duplicate {script_id}")
        return True
        
    try:
        original_content = client.get_project_content(script_id)
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
        client.update_project_content(script_id, new_content)
        
        res = client.run_function(script_id, "nukeAllTriggers")
        success = res.get("ok", False)
        if success:
            logger.info(f"Successfully nuked triggers on {script_id}")
        else:
            logger.warning(f"Failed to run nukeAllTriggers on {script_id}: {res.get('error')}")
            
        logger.info(f"Restoring {script_id} to original state...")
        client.update_project_content(script_id, original_content)
        
        restored_content = client.get_project_content(script_id)
        restored_names = {f["name"] for f in restored_content}
        if restored_names != original_names:
            logger.error(f"CRITICAL: Restore verification failed on duplicate {script_id}! Mismatching files.")
        else:
            logger.info(f"Restore verified on {script_id}.")
            
        return success
    except Exception as e:
        logger.error(f"Exception nuking triggers on {script_id}: {e}")
        return False

def verify_canonical(client, canonical_id, expected_names):
    try:
        final_content = client.get_project_content(canonical_id)
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

def get_auth_credentials(args):
    if args.credentials:
        try:
            return get_credentials_from_file(args.credentials, args.token_cache_dir, args.interactive_oauth, SCOPES)
        except Exception as e:
            logger.error(f"Failed to load provided credentials: {e}")
            sys.exit(1)
            
    if args.auto_pick_key:
        candidates = discover_keys(args.keys_dir)
        if not candidates:
            logger.error("No credentials found for auto-pick.")
            sys.exit(1)
            
        logger.info(f"Auto-picking from {len(candidates)} candidates...")
        # Get one sample sheet just to test read
        reg_path = repo_root / "registry/registry.json"
        registry_samples = []
        if reg_path.exists():
            with open(reg_path) as f:
                data = json.load(f)
                sats = data.get("satellites", [])
                if sats: registry_samples.append(sats[0].get("sheet_id") or sats[0].get("id"))
                
        for path in candidates:
            res = test_key(path, registry_samples, args.interactive_oauth, args.token_cache_dir)
            if res and res["overall_status"] in ["READ_OK", "READ_WRITE_OK"]:
                logger.info(f"Auto-picked working credential: {path.name}")
                return get_credentials_from_file(path, args.token_cache_dir, args.interactive_oauth, SCOPES)
                
        logger.error("Auto-pick failed: No working credentials found.")
        sys.exit(1)
        
    logger.error("No credentials provided. Use --credentials <path> or --auto-pick-key.")
    sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Reconcile earliest bound scripts")
    parser.add_argument("--limit", type=int, default=150, help="Number of earliest satellites to process")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Dry run mode (default: True)")
    parser.add_argument("--force", action="store_true", help="Force writes (turns off dry-run)")
    parser.add_argument("--fix-triggers", action="store_true", default=True, help="Nuke triggers on non-canonical duplicates")
    parser.add_argument("--no-fix-triggers", dest="fix_triggers", action="store_false")
    parser.add_argument("--delete-duplicates", action="store_true", default=False, help="Delete duplicates if explicitly requested")
    parser.add_argument("--sort-by", choices=["added_at", "drive_created_time"], default="added_at", help="Sort order for 'earliest'")
    parser.add_argument("--credentials", type=str, help="Explicit path to JSON credentials")
    parser.add_argument("--keys-dir", type=str, help="Directory to auto-discover keys from")
    parser.add_argument("--auto-pick-key", action="store_true", help="Auto pick first working key")
    parser.add_argument("--token-cache-dir", type=str, default="artifacts/token-cache", help="Directory for token caches")
    parser.add_argument("--interactive-oauth", action="store_true", help="Allow interactive browser OAuth login")
    parser.add_argument("--create-if-missing", action="store_true", default=None, help="Create bound script if none exists (default: True with --force)")
    parser.add_argument("--no-create-if-missing", dest="create_if_missing", action="store_false")
    args = parser.parse_args()

    is_dry_run = args.dry_run and not args.force
    if args.create_if_missing is None:
        args.create_if_missing = args.force
    
    logger.info("=" * 60)
    logger.info(f"Reconciling earliest {args.limit} bound scripts")
    logger.info(f"Dry-run: {is_dry_run}")
    logger.info(f"Fix Triggers: {args.fix_triggers}")
    logger.info(f"Delete Duplicates: {args.delete_duplicates}")
    logger.info(f"Sort Mode: {args.sort_by}")
    logger.info("=" * 60)

    creds = get_auth_credentials(args)
    client = ScriptApiClient(credentials=creds)
    
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
    targets = sats_sorted[:args.limit]
    
    stats = {
        "processed": 0,
        "had_duplicates": 0,
        "duplicates_disabled": 0,
        "duplicates_deleted": 0,
        "canonical_fixed": 0,
        "verification_failures": 0
    }

    for sat in targets:
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
        
        # FAIL FAST on auth error
        try:
            bound_scripts = client.find_all_bound_scripts(sheet_id)
        except Exception as e:
            if "deleted_client" in str(e).lower() or "unauthorized" in str(e).lower() or "permission" in str(e).lower():
                logger.error(f"CRITICAL AUTH FAILURE: Unable to search Drive. Key is broken or lacks access. Error: {e}")
                sys.exit(1)
            else:
                logger.error(f"Failed to list bound scripts: {e}")
                continue

        if not bound_scripts:
            if args.create_if_missing:
                if is_dry_run:
                    logger.info(f"[Dry-run] Would create new bound script for {sat_id} because none exists.")
                    continue
                else:
                    logger.info(f"No bound scripts found. Creating new bound project for {sat_id}...")
                    title = f"Ma Golide Satellite Logic - {sat.get('league', 'Unknown')} {sat.get('date', 'Unknown')}"
                    try:
                        canonical_id = client.create_bound_script(sheet_id, title)
                        logger.info(f"Created new script: {canonical_id}")
                    except Exception as e:
                        logger.error(f"Failed to create script for {sat_id}: {e}")
                        continue
            else:
                logger.warning(f"No bound scripts found for {sat_id}. Skipping because create_if_missing is false.")
                continue
        else:
            logger.info(f"Found {len(bound_scripts)} bound script(s).")
            canonical_id = evaluate_canonical(bound_scripts, registry_script_id, client, expected_module_names)
            if not canonical_id:
                logger.error("Could not determine canonical script.")
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
                        content = client.get_project_content(d_id)
                        backup_dir = repo_root / "artifacts" / "dupe-script-backups" / sheet_id
                        backup_dir.mkdir(parents=True, exist_ok=True)
                        backup_path = backup_dir / f"{d_id}.json"
                        backup_path.write_text(json.dumps(content, indent=2))
                        logger.info(f"Backed up duplicate {d_id} to {backup_path}")
                    except Exception as e:
                        logger.error(f"Failed to backup {d_id}: {e}")
                
                if args.delete_duplicates:
                    if is_dry_run:
                        logger.info(f"[Dry-run] Would delete duplicate {d_id}")
                    else:
                        if client.delete_project(d_id):
                            stats["duplicates_deleted"] += 1
                else:
                    if args.fix_triggers:
                        if nuke_triggers(client, d_id, is_dry_run):
                            stats["duplicates_disabled"] += 1
                    else:
                        logger.warning(f"Duplicate {d_id} left untouched. It may still have triggers.")

        if not is_dry_run:
            logger.info(f"Syncing correct modules to canonical project {canonical_id}")
            try:
                client.update_project_content(canonical_id, gs_sources)
                stats["canonical_fixed"] += 1
                
                if not verify_canonical(client, canonical_id, expected_module_names):
                    stats["verification_failures"] += 1
            except Exception as e:
                logger.error(f"Failed to sync canonical project {canonical_id}: {e}")
                stats["verification_failures"] += 1
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
    logger.info("=" * 60)
    
    if stats["verification_failures"] > 0 and not is_dry_run:
        sys.exit(1)

if __name__ == "__main__":
    main()
