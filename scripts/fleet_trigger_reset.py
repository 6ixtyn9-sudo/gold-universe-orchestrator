"""
scripts/fleet_trigger_reset.py
══════════════════════════════════════════════════════════════════════════
Automates the cleanup of duplicate triggers across the entire satellite fleet.

How it works:
1. Pushes the latest logic (including hardened trigger functions) to satellites.
2. Calls nukeAllTriggers() via the Apps Script API to clear the pile-up.
3. Calls safeLaunch() to start exactly ONE fresh 1-minute trigger.

USAGE:
  python3 scripts/fleet_trigger_reset.py --limit 5  # Test on 5 satellites
  python3 scripts/fleet_trigger_reset.py           # Run on ALL satellites
"""

import sys, os, time, json, logging, threading, argparse
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from registry.satellite_registry import list_satellites

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)
logger = logging.getLogger("trigger_reset")

DOCS_DIR       = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
CREDS_DIR      = REPO_ROOT / "creds"
MAX_WORKERS    = 10
DELAY_BETWEEN  = 3.0 # Slightly slower to avoid API spikes during execution

def load_gs_files() -> list[dict]:
    """Load all .gs files for deployment."""
    files = [{
        "name": "appsscript", "type": "JSON",
        "source": json.dumps({
            "timeZone": "UTC",
            "exceptionLogging": "STACKDRIVER",
            "runtimeVersion": "V8",
            "oauthScopes": [
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive",
                "https://www.googleapis.com/auth/script.projects",
                "https://www.googleapis.com/auth/script.external_request",
                "https://www.googleapis.com/auth/script.scriptapp"
            ]
        })
    }]
    for p in DOCS_DIR.glob("*.gs"):
        files.append({
            "name":   p.stem,
            "type":   "SERVER_JS",
            "source": p.read_text(encoding="utf-8")
        })
    return files

def load_credentials(creds_dir: Path):
    creds_list = []
    if not creds_dir.exists(): return []
    for i in range(20):
        token_file = creds_dir / f"token_{i}.json"
        if not token_file.exists(): continue
        try:
            creds = Credentials.from_authorized_user_file(str(token_file))
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())
            creds_list.append((i, creds, token_file))
        except Exception as e:
            logger.warning(f"  Failed to load {token_file.name}: {e}")
    return creds_list

def reset_satellite(script_svc, sat: dict, files: list[dict]) -> dict:
    sheet_id  = sat.get("sheet_id") or sat.get("id", "")
    script_id = sat.get("script_id", "")
    label     = f"{sat.get('league','?')} {sat.get('date','?')}"

    res = {"label": label, "ok": False, "steps": [], "error": None}

    if not script_id:
        res["error"] = "No script_id"
        return res

    try:
        # Step 1: Push fresh code (ensures fix_triggers.gs and hardened logic are present)
        script_svc.projects().updateContent(
            scriptId=script_id, body={"files": files}
        ).execute()
        res["steps"].append("PUSHED_CODE")

        # Step 1b: Create a deployment (required for scripts.run)
        try:
            deployment = script_svc.projects().deployments().create(
                scriptId=script_id, 
                body={"description": "Trigger Fix Deployment"}
            ).execute()
            res["steps"].append("DEPLOYED")
        except Exception as e:
            res["steps"].append(f"DEPLOY_FAILED: {str(e)[:50]}")

        # Step 2: Nuke Triggers
        try:
            script_svc.scripts().run(
                scriptId=script_id, 
                body={"function": "nukeAllTriggers"}
            ).execute()
            res["steps"].append("NUKED_TRIGGERS")
        except Exception as e:
            res["steps"].append(f"NUKE_FAILED: {str(e)[:50]}")

        # Step 3: Safe Launch
        try:
            script_svc.scripts().run(
                scriptId=script_id, 
                body={"function": "safeLaunch"}
            ).execute()
            res["steps"].append("LAUNCHED")
            res["ok"] = True
        except Exception as e:
            res["steps"].append(f"LAUNCH_FAILED: {str(e)[:50]}")

        if "LAUNCHED" in res["steps"]:
            res["ok"] = True
        else:
            # Even if nuke/launch failed, we pushed the code, which is a partial win
            res["ok"] = False
            res["error"] = "Execution failed (API Executable likely not configured)"

    except Exception as e:
        res["error"] = str(e)
    
    return res

def worker_batch(slot_idx, creds, satellites, files, delay):
    thread_name = f"slot-{slot_idx}"
    threading.current_thread().name = thread_name
    script_svc = build("script", "v1", credentials=creds, cache_discovery=False)
    
    success, failed = 0, 0
    for i, sat in enumerate(satellites):
        res = reset_satellite(script_svc, sat, files)
        if res["ok"]:
            success += 1
            logger.info(f"[{thread_name}] ✅ {res['label']} — {', '.join(res['steps'])}")
        else:
            failed += 1
            logger.warning(f"[{thread_name}] ❌ {res['label']} — {res['error']} ({', '.join(res['steps'])})")
        
        if i < len(satellites) - 1:
            time.sleep(delay)
    
    return {"success": success, "failed": failed}

def main():
    parser = argparse.ArgumentParser(description="Fleet Trigger Reset & Cleanup")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=DELAY_BETWEEN)
    args = parser.parse_args()

    print("\n🚀 MA GOLIDE — FLEET TRIGGER RESET")
    print("════════════════════════════════════════════════")

    files = load_gs_files()
    creds_list = load_credentials(CREDS_DIR)
    if not creds_list:
        print("ERROR: No credentials found in creds/ folder.")
        return

    all_sats = [s for s in list_satellites() if s.get("script_id")]
    if args.limit:
        all_sats = all_sats[:args.limit]
    
    n_slots = min(len(creds_list), MAX_WORKERS)
    chunks = []
    size = (len(all_sats) + n_slots - 1) // n_slots
    for i in range(0, len(all_sats), size):
        chunks.append(all_sats[i:i + size])

    print(f"  Credentials: {len(creds_list)}")
    print(f"  Satellites:  {len(all_sats)}")
    print("════════════════════════════════════════════════\n")

    start = datetime.now()
    futures = []
    with ThreadPoolExecutor(max_workers=n_slots) as executor:
        for i, (slot_idx, creds, _) in enumerate(creds_list[:n_slots]):
            chunk = chunks[i] if i < len(chunks) else []
            if not chunk: continue
            futures.append(executor.submit(worker_batch, slot_idx, creds, chunk, files, args.delay))
    
    total_success = 0
    total_failed = 0
    for f in as_completed(futures):
        r = f.result()
        total_success += r["success"]
        total_failed += r["failed"]

    elapsed = (datetime.now() - start).total_seconds()
    print(f"\nDONE: ✅ {total_success} success, ❌ {total_failed} failed. Time: {elapsed:.0f}s")

if __name__ == "__main__":
    main()
