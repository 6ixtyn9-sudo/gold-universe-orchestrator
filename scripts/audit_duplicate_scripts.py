"""
scripts/audit_duplicate_scripts.py
══════════════════════════════════════════════════════════════════════════
Audits the entire fleet to find duplicate script projects bound to 
the same sheet. Writes results to audit_report.json and audit_report.txt.

Categorizes each sheet as:
  - OK: Exactly one bound script, matches registry.
  - DUPLICATE_SCRIPTS: Multiple bound scripts found.
  - UNREGISTERED: Bound script found but not in registry.
  - MISMATCH: Registry script_id doesn't match Drive reality.
  - NO_SCRIPT: No bound scripts found.
"""

import sys, os, time, json, logging, argparse
from pathlib import Path
from datetime import datetime

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from concurrent.futures import ThreadPoolExecutor
from registry.satellite_registry import list_satellites

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("audit")

CREDS_DIR   = REPO_ROOT / "creds"
REPORT_JSON = REPO_ROOT / "audit_report.json"
REPORT_TXT  = REPO_ROOT / "audit_report.txt"

def load_first_credential():
    """Load the first working credential slot."""
    for i in range(20):
        token_file = CREDS_DIR / f"token_{i}.json"
        if not token_file.exists():
            continue
        try:
            creds = Credentials.from_authorized_user_file(str(token_file))
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())
            return creds
        except Exception as e:
            logger.warning(f"Failed to load token_{i}.json: {e}")
    return None

def fetch_all_bound_scripts_multi_creds():
    """Fetch all Apps Script files and resolve their true parent (Spreadsheet ID) via the Apps Script API."""
    parent_to_scripts = {}
    script_ids_to_resolve = []
    
    # Step 1: Collect all script IDs from all credential slots
    for slot_idx in range(16):
        token_file = CREDS_DIR / f"token_{slot_idx}.json"
        if not token_file.exists(): continue
            
        logger.info(f"Collecting script IDs from slot {slot_idx}...")
        try:
            creds = Credentials.from_authorized_user_file(str(token_file))
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())
            
            drive_svc = build("drive", "v3", credentials=creds, cache_discovery=False)
            # Broad search for potential script names
            queries = [
                "mimeType='application/vnd.google-apps.script'",
                "name contains 'Ma Golide'",
                "name contains 'Vura'",
                "name contains 'Logic'"
            ]
            
            for query in queries:
                page_token = None
                while True:
                    params = {
                        "q": query, "fields": "nextPageToken, files(id, name)", "pageSize": 1000,
                        "supportsAllDrives": True, "includeItemsFromAllDrives": True
                    }
                    if page_token: params["pageToken"] = page_token
                    result = drive_svc.files().list(**params).execute()
                    for f in result.get("files", []):
                        script_ids_to_resolve.append((f["id"], f["name"], creds))
                    page_token = result.get("nextPageToken")
                    if not page_token: break
        except Exception as e:
            logger.warning(f"  Slot {slot_idx} collection failed: {e}")

    # Remove duplicates from our list of script IDs to resolve
    unique_scripts = {}
    for sid, name, creds in script_ids_to_resolve:
        if sid not in unique_scripts:
            unique_scripts[sid] = (name, creds)
    
    # Step 2: Resolve parentId for each script (Parallel & Distributed across all slots)
    logger.info(f"Resolving parentage for {len(unique_scripts)} unique scripts across all available slots...")
    
    all_creds = []
    for slot_idx in range(20):
        token_file = CREDS_DIR / f"token_{slot_idx}.json"
        if not token_file.exists(): continue
        try:
            c = Credentials.from_authorized_user_file(str(token_file))
            all_creds.append(c)
        except Exception: pass
    
    if not all_creds:
        logger.error("No working credentials for resolution.")
        return parent_to_scripts

    def resolve_one(sid_data, slot_idx):
        script_id, name = sid_data
        creds = all_creds[slot_idx % len(all_creds)]
        try:
            # Refresh if needed
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
            
            script_svc = build("script", "v1", credentials=creds, cache_discovery=False)
            project = script_svc.projects().get(scriptId=script_id).execute()
            parent_id = project.get("parentId")
            if parent_id:
                return parent_id, {"script_id": script_id, "name": name}
        except Exception as e:
            if "Quota exceeded" in str(e):
                logger.warning(f"  Quota hit on slot {slot_idx % len(all_creds)}")
            pass
        return None, None

    with ThreadPoolExecutor(max_workers=len(all_creds) * 2) as executor:
        items = list(unique_scripts.items())
        futures = [executor.submit(resolve_one, (sid, name), i) for i, (sid, (name, _)) in enumerate(items)]
        for f in futures:
            parent_id, script_info = f.result()
            if parent_id:
                if parent_id not in parent_to_scripts:
                    parent_to_scripts[parent_id] = []
                parent_to_scripts[parent_id].append(script_info)

    logger.info(f"Resolved parentage for {len(parent_to_scripts)} unique parent spreadsheets.")
    if parent_to_scripts:
        logger.info(f"  First 10 resolved Parent IDs: {list(parent_to_scripts.keys())[:10]}")
    return parent_to_scripts

def audit_satellite(sat, parent_to_scripts):
    sheet_id  = sat.get("sheet_id") or sat.get("id")
    reg_id    = sat.get("script_id")
    label     = sat.get("name") or f"{sat.get('league','?')} {sat.get('date','?')}"
    
    bound_scripts = parent_to_scripts.get(sheet_id, [])
    
    res = {
        "label": label,
        "sheet_id": sheet_id,
        "registry_script_id": reg_id,
        "bound_scripts": bound_scripts,
        "status": "UNKNOWN",
        "canonical_script_id": None,
        "orphan_script_ids": []
    }

    if not bound_scripts:
        res["status"] = "NO_SCRIPT"
    elif len(bound_scripts) > 1:
        res["status"] = "DUPLICATE_SCRIPTS"
        # Pick the one matching registry as canonical, or the most recently modified? 
        # For now, matching registry or first one.
        canonical = next((s["script_id"] for s in bound_scripts if s["script_id"] == reg_id), bound_scripts[0]["script_id"])
        res["canonical_script_id"] = canonical
        res["orphan_script_ids"] = [s["script_id"] for s in bound_scripts if s["script_id"] != canonical]
    elif not reg_id:
        res["status"] = "UNREGISTERED"
        res["canonical_script_id"] = bound_scripts[0]["script_id"]
    elif reg_id != bound_scripts[0]["script_id"]:
        res["status"] = "MISMATCH"
        res["canonical_script_id"] = bound_scripts[0]["script_id"]
        res["orphan_script_ids"] = [reg_id] if reg_id else []
    else:
        res["status"] = "OK"
        res["canonical_script_id"] = reg_id

    return res

def main():
    parser = argparse.ArgumentParser(description="Audit duplicate script bindings")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    # NEW: Fetch ALL scripts using ALL credentials
    parent_to_scripts = fetch_all_bound_scripts_multi_creds()
    
    sats = list_satellites()
    if args.limit:
        sats = sats[:args.limit]

    print(f"\n🔍 Auditing {len(sats)} satellites against multi-credential Drive metadata...")
    results = []
    summary = {"OK": 0, "DUPLICATE_SCRIPTS": 0, "UNREGISTERED": 0, "MISMATCH": 0, "NO_SCRIPT": 0}

    for i, sat in enumerate(sats):
        res = audit_satellite(sat, parent_to_scripts)
        results.append(res)
        summary[res["status"]] = summary.get(res["status"], 0) + 1
        
        indicator = "✅" if res["status"] == "OK" else "⚠️"
        if res["status"] == "NO_SCRIPT": indicator = "❌"
        if res["status"] == "DUPLICATE_SCRIPTS": indicator = "🔴"
        
        if res["status"] != "OK" or args.limit:
            print(f"  [{i+1}/{len(sats)}] {indicator} {res['status']:<18} | {res['label']}")

    # Save reports
    REPORT_JSON.write_text(json.dumps({"summary": summary, "results": results}, indent=2))
    
    with open(REPORT_TXT, "w") as f:
        f.write(f"MA GOLIDE SCRIPT AUDIT REPORT - {datetime.utcnow().isoformat()}\n")
        f.write(f"{'='*60}\n")
        for k, v in summary.items():
            f.write(f"{k:<20}: {v}\n")
        f.write(f"{'='*60}\n\n")
        for res in results:
            if res["status"] == "OK": continue
            f.write(f"[{res['status']}] {res['label']}\n")
            f.write(f"  Sheet ID:  {res['sheet_id']}\n")
            f.write(f"  Registry:  {res['registry_script_id']}\n")
            f.write(f"  Drive:     {', '.join([s['script_id'] for s in res['bound_scripts']])}\n\n")

    print(f"\nAudit complete. Summary: {summary}")
    print(f"Reports saved to: {REPORT_JSON.name}, {REPORT_TXT.name}")

if __name__ == "__main__":
    main()
