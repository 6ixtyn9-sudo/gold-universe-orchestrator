
import os
import sys
import json
import time
import logging
import argparse
from pathlib import Path

# Add repo root to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fetcher.script_api_client import ScriptApiClient
from registry.satellite_registry import list_satellites

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("deploy_gs")

def load_local_gs_files(docs_dir: Path) -> list:
    """Load all .gs files from a directory into Script API format."""
    files = []
    # Always include appsscript.json if it exists, otherwise use a default
    manifest_path = docs_dir / "appsscript.json"
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

    for p in docs_dir.glob("*.gs"):
        files.append({
            "name": p.stem,
            "type": "SERVER_JS",
            "source": p.read_text(encoding="utf-8")
        })
    
    return files

def deploy_to_satellite(client: ScriptApiClient, spreadsheet_id: str, files: list, dry_run=False):
    logger.info(f"Processing spreadsheet: {spreadsheet_id}")
    
    script_id = client.find_bound_script(spreadsheet_id)
    
    if not script_id:
        if dry_run:
            logger.info(f"[DRY RUN] Would create new bound script for {spreadsheet_id}")
            return
        else:
            logger.info(f"No bound script found for {spreadsheet_id}. Creating one...")
            script_id = client.create_bound_script(spreadsheet_id, "Ma Golide Satellite Logic")
    
    if dry_run:
        logger.info(f"[DRY RUN] Would update script {script_id} with {len(files)} files")
    else:
        client.update_project_content(script_id, files)
        logger.info(f"Successfully updated script {script_id}")

def main():
    parser = argparse.ArgumentParser(description="Deploy latest .gs files to satellite sheets.")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually push changes.")
    parser.add_argument("--limit", type=int, default=None, help="Limit to N satellites.")
    parser.add_argument("--sheet-id", type=str, default=None, help="Deploy to a single specific sheet ID.")
    args = parser.parse_args()

    client = ScriptApiClient()
    
    docs_dir = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
    if not docs_dir.exists():
        logger.error(f"Docs directory not found: {docs_dir}")
        return

    files = load_local_gs_files(docs_dir)
    logger.info(f"Loaded {len(files)} files from {docs_dir}")

    if args.sheet_id:
        deploy_to_satellite(client, args.sheet_id, files, dry_run=args.dry_run)
    else:
        satellites = list_satellites()
        if args.limit:
            satellites = satellites[:args.limit]
        
        logger.info(f"Starting deployment to {len(satellites)} satellites...")
        for sat in satellites:
            try:
                deploy_to_satellite(client, sat["id"], files, dry_run=args.dry_run)
                # Sleep a bit to avoid hitting Script API rate limits
                if not args.dry_run:
                    time.sleep(2)
            except Exception as e:
                logger.error(f"Failed to deploy to {sat['id']}: {e}")

if __name__ == "__main__":
    main()
