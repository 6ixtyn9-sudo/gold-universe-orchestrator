"""
scripts/mass_deploy_new.py
══════════════════════════════════════════════════════════════════════════
Handles the first-time creation and registration of script projects for 
satellites that don't have a script_id yet.

FEATURES:
  - Creates exactly ONE bound script per spreadsheet.
  - Immediately persists the new script_id to registry.json.
  - Pushes the latest hardened .gs logic from docs/.
  - Parallelized across all credential slots for high throughput.

USAGE:
  python3 scripts/mass_deploy_new.py --limit 5    # test creation on 5
  python3 scripts/mass_deploy_new.py              # process all missing
"""

import sys, os, json, time, logging, argparse, threading
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from registry.supabase_registry import list_satellites, update_satellite_script_id

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)
logger = logging.getLogger("mass_deploy")

DOCS_DIR   = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
CREDS_DIR  = REPO_ROOT / "creds"
MAX_WORKERS = 10
DELAY       = 3.0 # Slightly higher for creation to avoid project creation quotas

# ── Credential loader ─────────────────────────────────────────────────────────

def load_credentials() -> list:
    creds_list = []
    for i in range(20):
        token_file = CREDS_DIR / f"token_{i}.json"
        if not token_file.exists(): continue
        try:
            creds = Credentials.from_authorized_user_file(str(token_file))
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())
            creds_list.append((i, creds))
        except Exception as e:
            logger.warning(f"Skipping token_{i}.json: {e}")
    return creds_list

# ── GS file loader ────────────────────────────────────────────────────────────

def load_gs_files() -> list:
    files = [{
        "name": "appsscript", "type": "JSON",
        "source": json.dumps({
            "timeZone": "UTC", "exceptionLogging": "STACKDRIVER", "runtimeVersion": "V8",
            "executionApi": {"access": "MYSELF"},
            "oauthScopes": [
                "https://www.googleapis.com/auth/script.projects",
                "https://www.googleapis.com/auth/script.deployments",
                "https://www.googleapis.com/auth/drive",
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/script.external_request"
            ]
        })
    }]
    for p in DOCS_DIR.glob("*.gs"):
        files.append({"name": p.stem, "type": "SERVER_JS", "source": p.read_text(encoding="utf-8")})
    return files

# ── Creation logic ────────────────────────────────────────────────────────────

def create_and_register(script_svc, sat: dict, files: list) -> dict:
    label    = sat.get("name") or sat.get("id", "?")
    sheet_id = sat.get("sheet_id") or sat.get("id", "")
    
    # Final safety check: don't create if already has script_id
    if sat.get("script_id"):
        return {"ok": True, "skipped": True}

    try:
        # 1. Create bound script
        project = script_svc.projects().create(body={
            "title": "Ma Golide Satellite Logic",
            "parentId": sheet_id
        }).execute()
        script_id = project["scriptId"]
        
        # 2. IMMEDIATELY update registry
        update_satellite_script_id(sheet_id, script_id)
        
        # 3. Push code
        script_svc.projects().updateContent(
            scriptId=script_id, body={"files": files}
        ).execute()
        
        return {"label": label, "script_id": script_id, "ok": True}
    except Exception as e:
        return {"label": label, "ok": False, "error": str(e)}

# ── Worker ────────────────────────────────────────────────────────────────────

def worker(slot_idx, creds, satellites, files, delay):
    threading.current_thread().name = f"slot-{slot_idx}"
    svc = build("script", "v1", credentials=creds, cache_discovery=False)
    
    results = {"created": 0, "failed": 0}
    for i, sat in enumerate(satellites):
        res = create_and_register(svc, sat, files)
        if res.get("skipped"): continue
        if res["ok"]:
            results["created"] += 1
            logger.info(f"✨ NEW   {res['label'][:55]} → {res['script_id']}")
        else:
            results["failed"] += 1
            logger.warning(f"❌ FAIL  {res['label'][:55]} — {res['error'][:80]}")
        
        if i < len(satellites) - 1:
            time.sleep(delay)
    return results

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Fleet creation & registration")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=DELAY)
    args = parser.parse_args()

    print("\n🏗️  MA GOLIDE — FLEET INITIALIZATION")
    print("════════════════════════════════════════════════")

    files = load_gs_files()
    creds_list = load_credentials()
    if not creds_list: return

    all_sats = list_satellites()
    missing = [s for s in all_sats if not s.get("script_id")]
    
    if args.limit:
        missing = missing[:args.limit]

    print(f"  Credential slots:      {len(creds_list)}")
    print(f"  Missing script_ids:    {len(missing)}")
    print("════════════════════════════════════════════════\n")

    if not missing:
        print("All satellites have script IDs. No new creations needed.")
        return

    n_slots = min(len(creds_list), MAX_WORKERS, len(missing))
    chunk_size = (len(missing) + n_slots - 1) // n_slots
    chunks = [missing[i:i+chunk_size] for i in range(0, len(missing), chunk_size)]

    start = datetime.now()
    totals = {"created": 0, "failed": 0}

    with ThreadPoolExecutor(max_workers=n_slots) as executor:
        futures = [executor.submit(worker, idx, creds, chunks[i], files, args.delay) 
                   for i, (idx, creds) in enumerate(creds_list[:n_slots])]
        for f in as_completed(futures):
            r = f.result()
            totals["created"] += r["created"]
            totals["failed"]  += r["failed"]

    elapsed = (datetime.now() - start).total_seconds()
    print(f"\nDONE: ✨ {totals['created']} created, ❌ {totals['failed']} failed. Time: {elapsed:.0f}s")

if __name__ == "__main__":
    main()
