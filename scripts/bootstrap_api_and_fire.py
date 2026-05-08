import os
import sys
import time
import logging
import threading
import argparse
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from registry.satellite_registry import list_satellites

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)
logger = logging.getLogger("bootstrap_api_and_fire")

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


def load_credentials():
    creds_list = []

    for i in range(20):
        token_file = CREDS_DIR / f"token_{i}.json"
        if not token_file.exists():
            continue

        try:
            creds = Credentials.from_authorized_user_file(str(token_file))

            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())

            creds_list.append((i, creds))
        except Exception as e:
            logger.warning(f"Skipping token_{i}.json: {e}")

    return creds_list


def build_token_map(creds_list):
    """Ask Google Drive: for each token, which spreadsheets do I own?
    Returns sheet_id -> (slot_idx, creds). Used as a fast fallback."""
    sheet_to_idx = {}
    for idx, creds in creds_list:
        try:
            drive_svc = build('drive', 'v3', credentials=creds, cache_discovery=False)
            results = drive_svc.files().list(
                q="mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners",
                pageSize=1000,
                fields="files(id)"
            ).execute()
            files = results.get('files', [])
            for f in files:
                sheet_to_idx[f['id']] = (idx, creds)
        except Exception as e:
            logger.warning(f"Error mapping token {idx}: {e}")
    return sheet_to_idx


def load_script_token_map(creds_list):
    """Load the pre-built script_id -> token_file map from script_to_token_map.json.
    This is the ground-truth map: built by probing deployments.list per script,
    which reveals the *GCP project owner* (not just the Drive file owner)."""
    map_path = REPO_ROOT / "script_to_token_map.json"
    if not map_path.exists():
        logger.warning("script_to_token_map.json not found — falling back to Drive ownership map.")
        return None

    raw = json.loads(map_path.read_text())
    raw_map = raw.get("map", {})

    # Build a lookup: token_file path -> (idx, creds)
    token_file_to_creds = {}
    for idx, creds in creds_list:
        token_path = str(CREDS_DIR / f"token_{idx}.json")
        token_file_to_creds[token_path] = (idx, creds)

    script_to_slot = {}
    for script_id, token_file in raw_map.items():
        key = str(REPO_ROOT / token_file) if not token_file.startswith("/") else token_file
        # Normalise: strip leading repo path if stored as relative
        for candidate, slot in token_file_to_creds.items():
            if candidate.endswith(Path(token_file).name):
                script_to_slot[script_id] = slot
                break

    logger.info(f"Loaded script->token map: {len(script_to_slot)} entries")
    return script_to_slot

def label_for_sat(sat):
    return (
        sat.get("name")
        or sat.get("sheet_name")
        or sat.get("sheet_id")
        or sat.get("id")
        or "unknown"
    )


def create_api_deployment(script_svc, script_id):
    logger.info(f"Creating version for {script_id}")
    version = script_svc.projects().versions().create(
        scriptId=script_id,
        body={}
    ).execute()

    version_number = version["versionNumber"]

    logger.info(f"Creating deployment for {script_id} @ version {version_number}")
    deployment = script_svc.projects().deployments().create(
        scriptId=script_id,
        body={
            "versionNumber": version_number,
            "manifestFileName": "appsscript",
            "description": "Fleet Execution API bootstrap"
        }
    ).execute()

    return deployment["deploymentId"]


def run_safe_launch(script_svc, script_id):
    return script_svc.scripts().run(
        scriptId=script_id,
        body={
            "function": "safeLaunch",
            "devMode": True
        }
    ).execute()


def fire_one(script_svc, sat):
    label = label_for_sat(sat)
    script_id = sat.get("script_id")

    if not script_id:
        return {"ok": False, "label": label, "reason": "NO_SCRIPT_ID"}

    try:
        res = run_safe_launch(script_svc, script_id)

    except HttpError as e:
        status = getattr(e.resp, "status", None)
        msg = ""
        try:
            msg = e.content.decode("utf-8", errors="ignore")
        except Exception:
            msg = str(e)

        msg_l = msg.lower()

        # Missing deployment / not API executable yet
        if status == 404 or "requested entity was not found" in msg_l:
            try:
                deployment_id = create_api_deployment(script_svc, script_id)
                logger.info(f"Created deployment {deployment_id} for {label}, waiting 5s for propagation...")
                time.sleep(5)
                res = run_safe_launch(script_svc, script_id)
            except Exception as inner:
                return {
                    "ok": False,
                    "label": label,
                    "reason": f"DEPLOY_BOOTSTRAP_FAILED: {str(inner)[:160]}"
                }

        elif status == 403 and "access_token_scope_insufficient" in msg_l:
            return {"ok": False, "label": label, "reason": "TOKEN_SCOPE_MISSING"}

        elif status == 403:
            return {"ok": False, "label": label, "reason": "PERMISSION_DENIED"}

        else:
            return {
                "ok": False,
                "label": label,
                "reason": f"HTTP_{status}: {msg[:160]}"
            }

    except Exception as e:
        return {"ok": False, "label": label, "reason": str(e)[:160]}

    if "error" in res:
        err = res["error"]
        reason = err.get("message", "Unknown API error")
        details = err.get("details", [])
        if details and isinstance(details, list):
            reason = details[0].get("errorMessage", reason)
        return {"ok": False, "label": label, "reason": reason[:160]}

    return {"ok": True, "label": label}


def worker(slot_idx, creds, satellites, delay):
    threading.current_thread().name = f"slot-{slot_idx}"
    script_svc = build("script", "v1", credentials=creds, cache_discovery=False)

    results = {
        "fired": 0,
        "failed": 0,
        "permission_denied": 0,
        "scope_missing": 0,
        "no_script_id": 0,
    }

    for i, sat in enumerate(satellites):
        res = fire_one(script_svc, sat)

        if res["ok"]:
            results["fired"] += 1
            logger.info(f"🔥 FIRED {res['label'][:60]}")
        else:
            reason = res["reason"]

            if reason == "PERMISSION_DENIED":
                results["permission_denied"] += 1
                logger.warning(f"🚫 DENIED {res['label'][:60]}")
            elif reason == "TOKEN_SCOPE_MISSING":
                results["scope_missing"] += 1
                logger.warning(f"🔐 SCOPE MISSING {res['label'][:60]}")
            elif reason == "NO_SCRIPT_ID":
                results["no_script_id"] += 1
                logger.warning(f"🛰️ NO SCRIPT ID {res['label'][:60]}")
            else:
                results["failed"] += 1
                logger.warning(f"❌ FAIL {res['label'][:60]} — {reason}")

        if i < len(satellites) - 1:
            time.sleep(delay)

    return results


def main():
    parser = argparse.ArgumentParser(description="Bootstrap API Executable and run safeLaunch.")
    parser.add_argument("--targets", type=Path, default=None,
                        help="Path to JSON file with list of sheet_ids to target")
    args = parser.parse_args()

    print("\n🚀 MA GOLIDE — API BOOTSTRAP + FIRE")
    print("════════════════════════════════════════════════")

    creds_list = load_credentials()
    if not creds_list:
        print("ERROR: No usable credentials found.")
        return

    all_sats = list_satellites()
    
    if args.targets and args.targets.exists():
        targets_list = json.loads(args.targets.read_text())
        all_sats = [s for s in all_sats if (s.get("sheet_id") or s.get("id")) in targets_list]
        print(f"Filtered to {len(all_sats)} targets from {args.targets.name}")
        
    registered = [s for s in all_sats if s.get("script_id")]

    print(f" Registered satellites with script_id: {len(registered)}")
    print(f" Credential slots loaded: {len(creds_list)}")
    print("════════════════════════════════════════════════\n")

    print("Loading script->token map from script_to_token_map.json...")
    script_to_slot = load_script_token_map(creds_list)

    if script_to_slot is None:
        print("Falling back to Drive-ownership map (15 API calls)...")
        sheet_to_idx = build_token_map(creds_list)
        # Re-key by script_id using registered satellites
        script_to_slot = {}
        for sat in registered:
            sid = sat.get("sheet_id") or sat.get("id")
            if sid in sheet_to_idx:
                script_id = sat.get("script_id")
                if script_id:
                    script_to_slot[script_id] = sheet_to_idx[sid]

    print(f"Mapped {len(script_to_slot)} scripts to tokens.\n")

    if not registered:
        print("No registered satellites to process.")
        return

    slots_to_sats = {}
    unmapped = []

    for sat in registered:
        script_id = sat.get("script_id")
        if script_id and script_id in script_to_slot:
            idx, creds = script_to_slot[script_id]
            if idx not in slots_to_sats:
                slots_to_sats[idx] = {"creds": creds, "sats": []}
            slots_to_sats[idx]["sats"].append(sat)
        else:
            unmapped.append(sat)

    if unmapped:
        print(f"WARNING: {len(unmapped)} satellites could not be mapped to any token (no script_id or not in map).")

    totals = {
        "fired": 0,
        "failed": 0,
        "permission_denied": 0,
        "scope_missing": 0,
        "no_script_id": 0,
    }

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = []
        for idx, data in slots_to_sats.items():
            futures.append(executor.submit(worker, idx, data["creds"], data["sats"], DELAY))

        for f in as_completed(futures):
            r = f.result()
            for k in totals:
                totals[k] += r[k]

    print(
        "\nFINAL COUNT:"
        f" fired={totals['fired']}"
        f" | failed={totals['failed']}"
        f" | denied={totals['permission_denied']}"
        f" | scope_missing={totals['scope_missing']}"
        f" | no_script_id={totals['no_script_id']}"
    )


if __name__ == "__main__":
    main()
