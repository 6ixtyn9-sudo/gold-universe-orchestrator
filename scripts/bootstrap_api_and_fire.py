import os
import sys
import time
import logging
import threading
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

from registry.supabase_registry import list_satellites

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
            creds = Credentials.from_authorized_user_file(str(token_file), scopes=SCOPES)

            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())

            creds_list.append((i, creds))
        except Exception as e:
            logger.warning(f"Skipping token_{i}.json: {e}")

    return creds_list


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
                logger.info(f"Created deployment {deployment_id} for {label}")
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
    print("\n🚀 MA GOLIDE — API BOOTSTRAP + FIRE")
    print("════════════════════════════════════════════════")

    creds_list = load_credentials()
    if not creds_list:
        print("ERROR: No usable credentials found.")
        return

    all_sats = list_satellites()
    registered = [s for s in all_sats if s.get("script_id")]

    print(f" Registered satellites with script_id: {len(registered)}")
    print(f" Credential slots loaded: {len(creds_list)}")
    print("════════════════════════════════════════════════\n")

    if not registered:
        print("No registered satellites to process.")
        return

    n_slots = min(len(creds_list), MAX_WORKERS, len(registered))
    chunk_size = (len(registered) + n_slots - 1) // n_slots
    chunks = [registered[i:i + chunk_size] for i in range(0, len(registered), chunk_size)]

    totals = {
        "fired": 0,
        "failed": 0,
        "permission_denied": 0,
        "scope_missing": 0,
        "no_script_id": 0,
    }

    with ThreadPoolExecutor(max_workers=n_slots) as executor:
        futures = [
            executor.submit(worker, idx, creds, chunks[i], DELAY)
            for i, (idx, creds) in enumerate(creds_list[:n_slots])
        ]

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
