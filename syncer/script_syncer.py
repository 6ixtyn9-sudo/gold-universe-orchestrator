import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Callable

from fetcher.script_api_client import ScriptApiClient

logger = logging.getLogger(__name__)

def load_gs_sources() -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
    """
    Load local .gs source files from Ma_Golide_Satellites/docs.
    Returns (files, error_message).
    """
    try:
        # Get absolute path to the repo root
        repo_root = Path(os.path.dirname(os.path.dirname(__file__)))
        docs_dir = repo_root / "Ma_Golide_Satellites" / "docs"
        
        if not docs_dir.exists():
            return None, f"Source directory not found: {docs_dir}"

        files = []
        # appsscript.json
        manifest_path = docs_dir / "appsscript.json"
        if manifest_path.exists():
            files.append({
                "name": "appsscript",
                "type": "JSON",
                "source": manifest_path.read_text(encoding="utf-8")
            })
        else:
            # Default manifest if missing
            files.append({
                "name": "appsscript",
                "type": "JSON",
                "source": '{"timeZone":"UTC","exceptionLogging":"STACKDRIVER","runtimeVersion":"V8"}'
            })
        
        # .gs files
        for p in docs_dir.glob("*.gs"):
            files.append({
                "name": p.stem,
                "type": "SERVER_JS",
                "source": p.read_text(encoding="utf-8")
            })
        
        if not files:
            return None, "No .gs files found in source directory"
            
        return files, None
    except Exception as e:
        logger.exception("Failed to load GS sources")
        return None, str(e)

def sync_one(sat: Dict[str, Any]) -> Dict[str, Any]:
    """
    Push latest code to a single satellite.
    Returns result dict with 'ok', 'pushed_files', 'script_id', 'error'.
    """
    sat_id = sat.get("id")
    spreadsheet_id = sat.get("sheet_id")
    script_id = sat.get("script_id")

    if not spreadsheet_id:
        return {"ok": False, "error": "No sheet_id in satellite metadata"}

    files, err = load_gs_sources()
    if err:
        return {"ok": False, "error": f"Source load failed: {err}"}

    try:
        client = ScriptApiClient()
        
        # If we don't have a script_id, try to find one bound to the sheet
        if not script_id:
            script_id = client.find_bound_script(spreadsheet_id)
        
        # If still no script_id, create one
        if not script_id:
            script_id = client.create_bound_script(spreadsheet_id, f"Ma Golide Satellite Logic - {sat.get('league')} {sat.get('date')}")
        
        client.update_project_content(script_id, files)
        
        return {
            "ok": True,
            "pushed_files": len(files),
            "script_id": script_id,
            "sat_id": sat_id
        }
    except Exception as e:
        logger.error(f"Sync failed for satellite {sat_id}: {e}")
        return {"ok": False, "error": str(e), "sat_id": sat_id}

def batch_sync(sats: List[Dict[str, Any]], on_progress: Optional[Callable] = None) -> Dict[str, Any]:
    """
    Sync multiple satellites.
    on_progress(done, total, sat, result)
    """
    total = len(sats)
    success = 0
    failed = 0
    files_per_sat = 0

    # Load sources once for the batch
    files, err = load_gs_sources()
    if not err:
        files_per_sat = len(files)

    for i, sat in enumerate(sats):
        result = sync_one(sat)
        if result["ok"]:
            success += 1
        else:
            failed += 1
        
        if on_progress:
            on_progress(i + 1, total, sat, result)
        
        # Rate limiting to avoid Google API issues
        if i < total - 1:
            time.sleep(1.5)

    return {
        "total": total,
        "success": success,
        "failed": failed,
        "files_per_sat": files_per_sat
    }
