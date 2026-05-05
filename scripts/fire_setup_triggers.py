import os
import sys
import time
import logging
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from registry.supabase_registry import list_satellites

# Load environment variables
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)
logger = logging.getLogger("fire_triggers")

CREDS_DIR = REPO_ROOT / "creds"
MAX_WORKERS = 10
DELAY = 1.0

SCOPES = [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
]

def load_credentials() -> list:
    creds_list = []
    for i in range(20):
        token_file = CREDS_DIR / f"token_{i}.json"
        if not token_file.exists(): continue
        try:
            creds = Credentials.from_authorized_user_file(str(token_file), scopes=SCOPES)
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())
            creds_list.append((i, creds))
        except Exception as e:
            logger.warning(f"Skipping token_{i}.json: {e}")
    return creds_list

def fire_one(script_svc, sat: dict) -> dict:
    label = sat.get("name") or sat.get("id", "?")
    script_id = sat.get("script_id")
    
    if not script_id:
        return {"ok": False, "reason": "NO_SCRIPT_ID"}
    
    try:
        # Call safeLaunch to clear old triggers and start a fresh one
        res = script_svc.scripts().run(
            scriptId=script_id,
            body={"function": "safeLaunch"}
        ).execute()
        
        if "error" in res:
            return {"ok": False, "reason": res["error"].get("message", "Unknown API error")}
        
        return {"ok": True, "label": label}
    except Exception as e:
        err = str(e)
        if "403" in err:
            return {"ok": False, "reason": "PERMISSION_DENIED"}
        return {"ok": False, "reason": err[:80]}


def worker(slot_idx, creds, satellites, delay):
    threading.current_thread().name = f"slot-{slot_idx}"
    svc = build("script", "v1", credentials=creds, cache_discovery=False)
    
    results = {"fired": 0, "failed": 0, "permission_denied": 0}
    for i, sat in enumerate(satellites):
        res = fire_one(svc, sat)
        if res["ok"]:
            results["fired"] += 1
            logger.info(f"🔥 FIRED  {res['label'][:55]}")
        else:
            reason = res["reason"]
            if reason == "PERMISSION_DENIED":
                results["permission_denied"] += 1
                logger.warning(f"🚫 DENIED {sat.get('name', 'Unknown')[:55]}")
            else:
                results["failed"] += 1
                logger.warning(f"❌ FAIL   {sat.get('name', 'Unknown')[:55]} — {reason}")
        
        if i < len(satellites) - 1:
            time.sleep(delay)
    return results

def main():
    print("\n🚀 MA GOLIDE — TRIGGER INITIALIZATION")
    print("════════════════════════════════════════════════")

    creds_list = load_credentials()
    if not creds_list:
        print("ERROR: No credentials found.")
        return

    all_sats = list_satellites()
    registered = [s for s in all_sats if s.get("script_id")]
    
    print(f"  Registered satellites: {len(registered)}")
    print(f"  Credential slots:      {len(creds_list)}")
    print("════════════════════════════════════════════════\n")

    if not registered:
        print("No registered satellites to trigger.")
        return

    n_slots = min(len(creds_list), MAX_WORKERS, len(registered))
    chunk_size = (len(registered) + n_slots - 1) // n_slots
    chunks = [registered[i:i+chunk_size] for i in range(0, len(registered), chunk_size)]

    totals = {"fired": 0, "failed": 0, "permission_denied": 0}
    with ThreadPoolExecutor(max_workers=n_slots) as executor:
        futures = [executor.submit(worker, idx, creds, chunks[i], DELAY) 
                   for i, (idx, creds) in enumerate(creds_list[:n_slots])]
        for f in as_completed(futures):
            r = f.result()
            for k in totals:
                totals[k] += r[k]

    print(f"\nFINAL COUNT: fired: {totals['fired']} | failed: {totals['failed']} | denied: {totals['permission_denied']}")

if __name__ == "__main__":
    main()
