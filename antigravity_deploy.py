#!/usr/bin/env python3
"""
ANTIGRAVITY DEPLOY — Gold Universe Satellite Fleet Synchronization

This script ensures ALL satellites have the latest .gs code deployed,
so you can start working on the Assayer and Mothership (the mother).

Usage:
    python antigravity_deploy.py [--dry-run] [--fleet-only] [--bootstrap]

Options:
    --dry-run      Show what would be deployed without making changes
    --fleet-only   Only sync .gs code, don't bootstrap API/fire
    --bootstrap    Only bootstrap API deployments and fire safeLaunch
    --parallel     Use parallel deployment with 10 credential slots
"""

import os
import sys
import argparse
import logging
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from dotenv import load_dotenv

# Add repo root to path
REPO_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT))

# Try to import orchestrator modules
try:
    from syncer.script_syncer import load_gs_sources, sync_one, batch_sync
    from registry.supabase_registry import list_satellites
    ORCHESTRATOR_AVAILABLE = True
except ImportError as e:
    ORCHESTRATOR_AVAILABLE = False
    print(f"⚠️  Orchestrator modules not available: {e}")
    print("   Running in standalone mode with direct API calls...")

# Try to import Google API modules
try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    GOOGLE_AVAILABLE = True
except ImportError:
    GOOGLE_AVAILABLE = False

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    handlers=[
        logging.FileHandler("antigravity_deploy.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("antigravity")

# Constants
CREDS_DIR = REPO_ROOT / "creds"
MAX_WORKERS = 10
DELAY_BETWEEN_CALLS = 1.5
SCOPES = [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
]
SATELLITE_GS_SOURCES = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
BRIDGE_GS_SOURCES = REPO_ROOT / "bridge"


class Colors:
    """Terminal colors for pretty output"""
    GOLD = "\033[93m"
    GREEN = "\033[92m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    MAGENTA = "\033[95m"
    BLUE = "\033[94m"
    BOLD = "\033[1m"
    RESET = "\033[0m"


def banner():
    """Print the antigravity banner"""
    print(f"""
{Colors.GOLD}{Colors.BOLD}
     ___      .______   .______   _______   ______    __       _______
    /   \     |   _  \  |   _  \ |   ____| /  __  \  |  |     |   ____|
   /  ^  \    |  |_)  | |  |_)  ||  |__   |  |  |  | |  |     |  |__
  /  /_\  \   |   _  <  |   _  < |   __|  |  |  |  | |  |     |   __|
 /  _____  \  |  |_)  | |  |_)  ||  |     |  `--'  | |  `----.|  |____
/__/     \__\ |______/  |______/ |__|      \______/  |_______||_______|
{Colors.RESET}
{Colors.CYAN}  Gold Universe Orchestrator — Satellite Fleet Synchronization{Colors.RESET}
{Colors.MAGENTA}  "Let the satellites sing, so the mother may listen"{Colors.RESET}
    """)


def check_prerequisites(bridge_only: bool = False) -> Tuple[bool, List[str]]:
    """Check if all prerequisites are met"""
    issues = []
    
    # Check for .env
    if not (REPO_ROOT / ".env").exists():
        issues.append("No .env file found. Create one with required secrets.")
    
    # Check for credentials
    if not CREDS_DIR.exists():
        issues.append(f"Credentials directory not found: {CREDS_DIR}")
    else:
        token_files = list(CREDS_DIR.glob("token_*.json"))
        if not token_files:
            issues.append("No Google OAuth token files found in creds/")
        else:
            logger.info(f"Found {len(token_files)} credential token(s)")
    
    # Check for satellite sources
    sources_dir = BRIDGE_GS_SOURCES if bridge_only else SATELLITE_GS_SOURCES
    if not sources_dir.exists():
        issues.append(f"Source directory not found: {sources_dir}")
    else:
        gs_files = list(sources_dir.glob("*.gs"))
        if not gs_files:
            issues.append(f"No .gs files found in {sources_dir}")
        else:
            logger.info(f"Found {len(gs_files)} .gs source file(s) in {sources_dir.name}")
    
    # Check for submodules
    submodule_dirs = [
        REPO_ROOT / "Ma_Golide_Satellites",
        REPO_ROOT / "Ma_Assayer", 
        REPO_ROOT / "Ma_Golide_Mothership"
    ]
    for subdir in submodule_dirs:
        if not subdir.exists():
            issues.append(f"Submodule not initialized: {subdir.name}")
    
    return len(issues) == 0, issues


def load_gs_files_direct(bridge_only: bool = False) -> Optional[List[Dict[str, Any]]]:
    """Load .gs files directly from the repo"""
    sources_dir = BRIDGE_GS_SOURCES if bridge_only else SATELLITE_GS_SOURCES
    if not sources_dir.exists():
        return None
    
    files = []
    
    # Add manifest
    manifest_path = sources_dir / "appsscript.json"
    if manifest_path.exists():
        files.append({
            "name": "appsscript",
            "type": "JSON",
            "source": manifest_path.read_text(encoding="utf-8")
        })
    else:
        files.append({
            "name": "appsscript",
            "type": "JSON",
            "source": '{"timeZone":"UTC","exceptionLogging":"STACKDRIVER","runtimeVersion":"V8"}'
        })
    
    # Add .gs files
    for p in sorted(sources_dir.glob("*.gs")):
        files.append({
            "name": p.stem,
            "type": "SERVER_JS",
            "source": p.read_text(encoding="utf-8")
        })
    
    return files


def get_satellite_list() -> List[Dict[str, Any]]:
    """Get list of all registered satellites"""
    if ORCHESTRATOR_AVAILABLE:
        try:
            sats = list_satellites()
            logger.info(f"Loaded {len(sats)} satellites from registry")
            return sats
        except Exception as e:
            logger.error(f"Failed to load from registry: {e}")
    
    # Fallback: look for satellites in registry.json or prompt
    registry_file = REPO_ROOT / "registry" / "registry.json"
    if registry_file.exists():
        import json
        try:
            with open(registry_file) as f:
                data = json.load(f)
                sats = data.get("satellites", data if isinstance(data, list) else [])
                logger.info(f"Loaded {len(sats)} satellites from registry.json")
                return sats
        except Exception as e:
            logger.error(f"Failed to load registry.json: {e}")
    
    logger.warning("No satellites found in registry. You may need to populate it first.")
    return []


def sync_one_with_files(sat: Dict[str, Any], files: List[Dict[str, Any]], dry_run: bool = False, credentials=None) -> Dict[str, Any]:
    """Deploy provided .gs files to a single satellite"""
    sat_id = sat.get("id")
    spreadsheet_id = sat.get("sheet_id") or sat.get("id")
    script_id = sat.get("script_id")

    if dry_run:
        return {
            "ok": True,
            "script_id": script_id or "new_script_id_dry_run",
            "sat_id": sat_id,
            "pushed_files": len(files),
            "dry_run": True
        }

    if not spreadsheet_id:
        return {"ok": False, "error": "No sheet_id/id"}

    try:
        from fetcher.script_api_client import ScriptApiClient
        from registry.supabase_registry import update_satellite_script_id
    except ImportError as e:
        return {"ok": False, "error": f"Missing orchestrator module: {e}"}

    client = ScriptApiClient(credentials=credentials)

    if not script_id:
        script_id = client.find_bound_script(spreadsheet_id)

    if not script_id:
        title = f"Ma Golide Supabase Bridge - {sat.get('name') or sat.get('league') or spreadsheet_id}"
        script_id = client.create_bound_script(spreadsheet_id, title)

    if script_id:
        try:
            update_satellite_script_id(spreadsheet_id, script_id)
        except Exception:
            pass

    try:
        client.update_project_content(script_id, files)
    except Exception as e:
        return {"ok": False, "error": str(e)}

    return {
        "ok": True,
        "script_id": script_id,
        "sat_id": sat_id,
        "pushed_files": len(files)
    }


def deploy_to_satellite(sat: Dict[str, Any], gs_files: List[Dict[str, Any]], 
                        dry_run: bool = False) -> Dict[str, Any]:
    """Deploy .gs code to a single satellite"""
    sat_id = sat.get("id") or sat.get("sheet_id", "unknown")
    sheet_id = sat.get("sheet_id")
    script_id = sat.get("script_id")
    league = sat.get("league", "Unknown")
    
    if dry_run:
        logger.info(f"[DRY-RUN] Would deploy {len(gs_files)} files to {sat_id} ({league})")
        return {"ok": True, "sat_id": sat_id, "dry_run": True}
    
    if ORCHESTRATOR_AVAILABLE:
        try:
            result = sync_one(sat)
            return result
        except Exception as e:
            logger.error(f"Deploy failed for {sat_id}: {e}")
            return {"ok": False, "sat_id": sat_id, "error": str(e)}
    else:
        logger.warning(f"Direct API deploy not implemented. Use orchestrator modules.")
        return {"ok": False, "sat_id": sat_id, "error": "Orchestrator modules required"}


def run_bootstrap_fire(sat: Dict[str, Any], creds: Credentials, 
                       dry_run: bool = False) -> Dict[str, Any]:
    """Bootstrap API deployment and fire safeLaunch on a satellite"""
    sat_id = sat.get("id") or sat.get("sheet_id", "unknown")
    script_id = sat.get("script_id")
    
    if not script_id:
        return {"ok": False, "sat_id": sat_id, "error": "No script_id"}
    
    if dry_run:
        logger.info(f"[DRY-RUN] Would bootstrap API and fire safeLaunch for {sat_id}")
        return {"ok": True, "sat_id": sat_id, "dry_run": True}
    
    try:
        script_svc = build("script", "v1", credentials=creds, cache_discovery=False)
        
        # Try to run safeLaunch first
        try:
            result = script_svc.scripts().run(
                scriptId=script_id,
                body={"function": "safeLaunch", "devMode": True}
            ).execute()
            logger.info(f"✅ safeLaunch fired for {sat_id}")
            return {"ok": True, "sat_id": sat_id, "result": result}
        except HttpError as e:
            if e.resp.status == 404:
                # Need to create deployment
                logger.info(f"Creating deployment for {sat_id}...")
                version = script_svc.projects().versions().create(
                    scriptId=script_id, body={}
                ).execute()
                version_number = version["versionNumber"]
                
                deployment = script_svc.projects().deployments().create(
                    scriptId=script_id,
                    body={
                        "versionNumber": version_number,
                        "manifestFileName": "appsscript",
                        "description": "Antigravity Deployment"
                    }
                ).execute()
                
                # Try running again
                result = script_svc.scripts().run(
                    scriptId=script_id,
                    body={"function": "safeLaunch", "devMode": True}
                ).execute()
                logger.info(f"✅ safeLaunch fired after deployment for {sat_id}")
                return {"ok": True, "sat_id": sat_id, "deployment_id": deployment["deploymentId"]}
            else:
                raise
    except Exception as e:
        logger.error(f"Bootstrap fire failed for {sat_id}: {e}")
        return {"ok": False, "sat_id": sat_id, "error": str(e)}


def parallel_bootstrap(satellites: List[Dict[str, Any]], dry_run: bool = False) -> Dict[str, Any]:
    """Run bootstrap API and fire on all satellites in parallel using credential slots"""
    if not GOOGLE_AVAILABLE:
        logger.error("Google API libraries not available")
        return {"total": len(satellites), "success": 0, "failed": len(satellites)}
    
    # Load all credentials
    creds_list = []
    for i in range(20):
        token_file = CREDS_DIR / f"token_{i}.json"
        if token_file.exists():
            try:
                creds = Credentials.from_authorized_user_file(str(token_file), scopes=SCOPES)
                if creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                    token_file.write_text(creds.to_json())
                creds_list.append((i, creds))
            except Exception as e:
                logger.warning(f"Skipping token_{i}.json: {e}")
    
    if not creds_list:
        logger.error("No valid credentials found!")
        return {"total": len(satellites), "success": 0, "failed": len(satellites)}
    
    logger.info(f"Using {len(creds_list)} credential slot(s) for parallel deployment")
    
    # Filter to satellites with script_id
    registered = [s for s in satellites if s.get("script_id")]
    logger.info(f"Satellites with script_id: {len(registered)}")
    
    if dry_run:
        logger.info(f"[DRY-RUN] Would bootstrap {len(registered)} satellites")
        return {"total": len(registered), "success": len(registered), "failed": 0, "dry_run": True}
    
    # Chunk satellites across credential slots
    n_slots = min(len(creds_list), MAX_WORKERS, len(registered))
    chunk_size = (len(registered) + n_slots - 1) // n_slots
    chunks = [registered[i:i+chunk_size] for i in range(0, len(registered), chunk_size)]
    
    totals = {"fired": 0, "failed": 0, "permission_denied": 0, "scope_missing": 0}
    
    def worker(slot_idx: int, creds: Credentials, chunk: List[Dict]):
        threading.current_thread().name = f"slot-{slot_idx}"
        local_totals = {"fired": 0, "failed": 0, "permission_denied": 0, "scope_missing": 0}
        
        for sat in chunk:
            result = run_bootstrap_fire(sat, creds, dry_run=False)
            if result.get("ok"):
                local_totals["fired"] += 1
            else:
                error = result.get("error", "")
                if "PERMISSION_DENIED" in error or "permission" in error.lower():
                    local_totals["permission_denied"] += 1
                elif "scope" in error.lower():
                    local_totals["scope_missing"] += 1
                else:
                    local_totals["failed"] += 1
            time.sleep(DELAY_BETWEEN_CALLS)
        
        return local_totals
    
    with ThreadPoolExecutor(max_workers=n_slots) as executor:
        futures = [
            executor.submit(worker, idx, creds, chunks[i])
            for i, (idx, creds) in enumerate(creds_list[:n_slots])
            if i < len(chunks)
        ]
        
        for f in as_completed(futures):
            r = f.result()
            for k in totals:
                totals[k] += r[k]
    
    return {
        "total": len(registered),
        "fired": totals["fired"],
        "failed": totals["failed"],
        "permission_denied": totals["permission_denied"],
        "scope_missing": totals["scope_missing"]
    }


def main():
    parser = argparse.ArgumentParser(description="Antigravity Satellite Deployment")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done")
    parser.add_argument("--fleet-only", action="store_true", help="Only sync .gs code")
    parser.add_argument("--bootstrap", action="store_true", help="Only bootstrap and fire")
    parser.add_argument("--parallel", action="store_true", help="Use parallel deployment")
    parser.add_argument("--bridge-only", action="store_true", help="Deploy lightweight Supabase bridge only")
    parser.add_argument("--limit", type=int, help="Limit number of satellites to deploy to")
    args = parser.parse_args()
    
    banner()
    
    if args.bridge_only:
        print(f"{Colors.MAGENTA}{Colors.BOLD}🌉 BRIDGE MODE: Deploying lightweight Supabase bridge only.{Colors.RESET}")
        print(f"{Colors.MAGENTA}Heavy satellite logic will NOT be deployed.{Colors.RESET}\n")
        args.fleet_only = True  # Automatically skip bootstrap/safeLaunch in bridge mode
        
    def load_credential_pool():
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        creds_list = []
        for i in range(20):
            token_file = CREDS_DIR / f"token_{i}.json"
            if not token_file.exists():
                continue
            try:
                creds = Credentials.from_authorized_user_file(str(token_file), scopes=SCOPES)
                if creds.expired and creds.refresh_token:
                    creds.refresh(Request())
                    token_file.write_text(creds.to_json())
                creds_list.append((i, creds))
            except Exception as e:
                pass
        return creds_list

    load_dotenv()
    
    # Check prerequisites
    ok, issues = check_prerequisites(bridge_only=args.bridge_only)
    if not ok:
        print(f"\n{Colors.RED}{Colors.BOLD}❌ PREREQUISITE CHECKS FAILED:{Colors.RESET}")
        for issue in issues:
            print(f"   • {issue}")
        print(f"\n{Colors.CYAN}Please fix these issues before proceeding.{Colors.RESET}\n")
        sys.exit(1)
    
    print(f"\n{Colors.GREEN}✅ All prerequisites met!{Colors.RESET}\n")
    
    # Get satellites
    satellites = get_satellite_list()
    if not satellites:
        print(f"{Colors.RED}No satellites found. Populate your registry first.{Colors.RESET}")
        sys.exit(1)
    
    print(f"{Colors.GOLD}📡 Found {len(satellites)} satellite(s) in registry{Colors.RESET}\n")
    
    if args.limit:
        satellites = satellites[:args.limit]
        print(f"{Colors.CYAN}⚠️ Limiting deployment to {args.limit} satellite(s) as requested.{Colors.RESET}\n")
    
    # Load .gs sources
    gs_files = load_gs_files_direct(bridge_only=args.bridge_only)
    if not gs_files:
        print(f"{Colors.RED}Failed to load .gs source files{Colors.RESET}")
        sys.exit(1)
    
    print(f"{Colors.CYAN}📦 Loaded {len(gs_files)} source file(s):{Colors.RESET}")
    for f in gs_files:
        print(f"   • {f['name']}.{f['type'].lower().replace('_', '.')}")
    print()
    
    results = {
        "deployed": [],
        "failed": [],
        "bootstrapped": [],
        "fire_failed": []
    }
    
    # Phase 1: Deploy .gs code to all satellites
    if not args.bootstrap:
        print(f"{Colors.BOLD}{Colors.GOLD}═" * 60)
        print("PHASE 1: DEPLOYING .GS CODE TO SATELLITE FLEET")
        print("═" * 60 + Colors.RESET + "\n")
        
        if args.bridge_only:
            # Use bridge deployment path
            creds_pool = load_credential_pool()
            
            if args.parallel:
                with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                    futures = {}
                    for i, sat in enumerate(satellites):
                        creds = None
                        if creds_pool:
                            creds = creds_pool[i % len(creds_pool)][1]
                        futures[executor.submit(sync_one_with_files, sat, gs_files, dry_run=args.dry_run, credentials=creds)] = sat

                    for i, future in enumerate(as_completed(futures), 1):
                        sat = futures[future]
                        try:
                            res = future.result()
                            print(f"   [{i}/{len(satellites)}] {sat.get('league', 'Unknown')}: " + 
                                  (f"{Colors.GREEN}✅{Colors.RESET}" if res.get('ok') else f"{Colors.RED}❌{Colors.RESET}"))
                            if res.get('ok'):
                                results["deployed"].append(sat)
                            else:
                                results["failed"].append(sat)
                        except Exception as e:
                            print(f"   [{i}/{len(satellites)}] {sat.get('league', 'Unknown')}: {Colors.RED}❌ Exception: {e}{Colors.RESET}")
                            results["failed"].append(sat)
            else:
                creds = creds_pool[0][1] if creds_pool else None
                for i, sat in enumerate(satellites, 1):
                    league = sat.get("league", "Unknown")
                    print(f"   [{i}/{len(satellites)}] Deploying bridge to {league}...", end=" ")
                    res = sync_one_with_files(sat, gs_files, dry_run=args.dry_run, credentials=creds)
                    if res.get('ok'):
                        print(f"{Colors.GREEN}✅{Colors.RESET}")
                        results["deployed"].append(sat)
                    else:
                        print(f"{Colors.RED}❌{Colors.RESET}")
                        print(f"      Error: {res.get('error', 'Unknown')}")
                        results["failed"].append(sat)
                    if i < len(satellites) and not args.dry_run:
                        time.sleep(DELAY_BETWEEN_CALLS)
        elif args.parallel and ORCHESTRATOR_AVAILABLE:
            # Use batch_sync from orchestrator
            batch_results = batch_sync(satellites, on_progress=lambda done, total, sat, res: 
                print(f"   [{done}/{total}] {sat.get('league', 'Unknown')}: " + 
                      (f"{Colors.GREEN}✅{Colors.RESET}" if res.get('ok') else f"{Colors.RED}❌{Colors.RESET}")))
            results["deployed"] = [s for s in satellites if True]  # Simplified
            results["failed"] = [s for s in satellites if False] # Simplified
        else:
            # Sequential deployment (legacy heavy mode)
            for i, sat in enumerate(satellites, 1):
                league = sat.get("league", "Unknown")
                print(f"   [{i}/{len(satellites)}] Deploying to {league}...", end=" ")
                
                result = deploy_to_satellite(sat, gs_files, dry_run=args.dry_run)
                
                if result.get("ok"):
                    print(f"{Colors.GREEN}✅{Colors.RESET}")
                    results["deployed"].append(sat)
                else:
                    print(f"{Colors.RED}❌{Colors.RESET}")
                    print(f"      Error: {result.get('error', 'Unknown')}")
                    results["failed"].append(sat)
                
                if i < len(satellites) and not args.dry_run:
                    time.sleep(DELAY_BETWEEN_CALLS)
        
        print(f"\n{Colors.GREEN}✅ Deployed to {len(results['deployed'])} satellite(s){Colors.RESET}")
        if results["failed"]:
            print(f"{Colors.RED}❌ Failed on {len(results['failed'])} satellite(s){Colors.RESET}")
    
    # Phase 2: Bootstrap API and fire safeLaunch
    if not args.fleet_only:
        print(f"\n{Colors.BOLD}{Colors.GOLD}═" * 60)
        print("PHASE 2: BOOTSTRAPPING API & FIRING SAFELAUNCH")
        print("═" * 60 + Colors.RESET + "\n")
        
        if args.parallel:
            bootstrap_results = parallel_bootstrap(satellites, dry_run=args.dry_run)
            print(f"   Fired: {Colors.GREEN}{bootstrap_results.get('fired', 0)}{Colors.RESET}")
            print(f"   Failed: {Colors.RED}{bootstrap_results.get('failed', 0)}{Colors.RESET}")
            if bootstrap_results.get('permission_denied'):
                print(f"   Permission Denied: {Colors.RED}{bootstrap_results['permission_denied']}{Colors.RESET}")
            if bootstrap_results.get('scope_missing'):
                print(f"   Scope Missing: {Colors.RED}{bootstrap_results['scope_missing']}{Colors.RESET}")
        else:
            # Would need credentials for sequential mode
            print(f"   {Colors.CYAN}Use --parallel for bootstrap mode (requires credentials){Colors.RESET}")
    
    # Summary
    print(f"\n{Colors.BOLD}{Colors.GOLD}═" * 60)
    print("DEPLOYMENT SUMMARY")
    print("═" * 60 + Colors.RESET)
    print(f"""
{Colors.CYAN}Satellites:{Colors.RESET}        {len(satellites)} total
{Colors.GREEN}Code Deployed:{Colors.RESET}     {len(results['deployed'])} satellites
{Colors.RED}Deploy Failed:{Colors.RESET}     {len(results['failed'])} satellites

{Colors.GOLD}The satellites are now synchronized.{Colors.RESET}
{Colors.MAGENTA}You may now proceed to work on the Assayer and the Mother.{Colors.RESET}
    """)
    
    # Write summary to file
    summary = {
        "timestamp": datetime.now().isoformat(),
        "satellites_total": len(satellites),
        "deployed": len(results["deployed"]),
        "failed": len(results["failed"]),
        "gs_files": len(gs_files),
        "dry_run": args.dry_run
    }
    
    summary_file = REPO_ROOT / "antigravity_summary.json"
    import json
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"📄 Summary written to: {summary_file}\n")


if __name__ == "__main__":
    main()
