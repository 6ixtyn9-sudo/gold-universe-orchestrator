#!/usr/bin/env python3
"""
scripts/fire_via_webapp.py
──────────────────────────────────────────────────────────────────────
Bootstrap 451 straggler satellites via Web App URL instead of scripts.run.

This bypasses the GCP project boundary restriction that blocks scripts.run.
Each satellite's Bootstrap_Backdoor.gs doGet endpoint:
  1. Clears existing safeLaunch triggers
  2. Schedules safeLaunch to fire in 30s
  3. Returns {"status": "scheduled"} immediately

Pipeline:
  1. Load targets from targets_81.json (or --targets arg)
  2. Load satellite script_ids from Supabase
  3. For each script, create a version + web app deployment (gets the URL)
  4. Fire the URL with the secret key
  5. Report results

Usage:
  PYTHONPATH=. python3 scripts/fire_via_webapp.py --targets targets_81.json
  PYTHONPATH=. python3 scripts/fire_via_webapp.py --targets stragglers_list.json
"""

import os
import sys
import json
import time
import logging
import argparse
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

load_dotenv()

from registry.satellite_registry import list_satellites

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)
logger = logging.getLogger("fire_via_webapp")

CREDS_DIR = REPO_ROOT / "creds"
SECRET    = "GUO_BOOTSTRAP_2026_SECRET"
MAX_WORKERS = 10
DELAY = 1.0


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


def load_script_token_map(creds_list):
    """Load pre-built script_id -> (slot_idx, creds) map."""
    map_path = REPO_ROOT / "script_to_token_map.json"
    if not map_path.exists():
        logger.error("script_to_token_map.json not found — run scratch_probe6.py first")
        return {}

    raw = json.loads(map_path.read_text()).get("map", {})
    token_file_to_creds = {
        str(CREDS_DIR / f"token_{idx}.json"): (idx, creds)
        for idx, creds in creds_list
    }

    script_to_slot = {}
    for script_id, token_file in raw.items():
        for candidate, slot in token_file_to_creds.items():
            if candidate.endswith(Path(token_file).name):
                script_to_slot[script_id] = slot
                break

    logger.info(f"Loaded script->token map: {len(script_to_slot)} entries")
    return script_to_slot


def get_fresh_webapp_url(svc, script_id, label):
    """
    Always create a fresh version + web app deployment from the LATEST code.
    Old deployments may point to a version before Bootstrap_Backdoor.gs was added.
    Returns (url, True) on success or (None, False) on error.
    """
    try:
        ver = svc.projects().versions().create(
            scriptId=script_id,
            body={"description": "webapp bootstrap v2"}
        ).execute()
        vnum = ver["versionNumber"]

        dep = svc.projects().deployments().create(
            scriptId=script_id,
            body={
                "versionNumber": vnum,
                "manifestFileName": "appsscript",
                "description": "Bootstrap backdoor webapp"
            }
        ).execute()

        for ep in dep.get("entryPoints", []):
            if ep.get("entryPointType") == "WEB_APP":
                url = ep.get("webApp", {}).get("url")
                if url:
                    return url, True

        logger.warning(f"No WEB_APP entry point for {label} — manifest missing webapp block?")
        return None, False

    except HttpError as e:
        logger.error(f"Deployment failed for {label}: {e.content.decode()[:200]}")
        return None, False


def fire_url(url, label):
    """Hit the web app URL with the secret and return the result."""
    try:
        resp = requests.get(
            url,
            params={"secret": SECRET},
            timeout=30
        )
        if resp.status_code == 200:
            try:
                body = resp.json()
                if body.get("status") == "scheduled":
                    return {"ok": True, "label": label, "response": body}
                else:
                    return {"ok": False, "label": label, "reason": f"Unexpected response: {body}"}
            except Exception:
                return {"ok": False, "label": label, "reason": f"Non-JSON response: {resp.text[:100]}"}
        else:
            return {"ok": False, "label": label, "reason": f"HTTP {resp.status_code}: {resp.text[:100]}"}
    except Exception as e:
        return {"ok": False, "label": label, "reason": str(e)[:100]}


def process_sat(svc, sat, delay):
    """Get/create webapp URL, fire it, return result."""
    script_id = sat.get("script_id")
    label = sat.get("name") or sat.get("sheet_id", "?")

    if not script_id:
        return {"ok": False, "label": label, "reason": "NO_SCRIPT_ID"}

    url, created = get_fresh_webapp_url(svc, script_id, label)

    if not url:
        return {"ok": False, "label": label, "reason": "NO_WEBAPP_URL"}

    if created:
        logger.info(f"Created webapp deployment for {label[:50]}")
        time.sleep(3)  # brief propagation wait

    result = fire_url(url, label)
    return result


def worker(slot_idx, creds, satellites, delay):
    import threading
    threading.current_thread().name = f"slot-{slot_idx}"
    svc = build("script", "v1", credentials=creds, cache_discovery=False)

    results = {"scheduled": 0, "failed": 0, "no_url": 0}
    for i, sat in enumerate(satellites):
        res = process_sat(svc, sat, delay)
        if res["ok"]:
            results["scheduled"] += 1
            logger.info(f"🚀 SCHEDULED {res['label'][:60]}")
        else:
            reason = res.get("reason", "?")
            if "NO_WEBAPP_URL" in reason:
                results["no_url"] += 1
                logger.warning(f"🌐 NO URL   {res['label'][:60]}")
            else:
                results["failed"] += 1
                logger.warning(f"❌ FAIL     {res['label'][:60]} — {reason}")
        if i < len(satellites) - 1:
            time.sleep(delay)
    return results


def main():
    parser = argparse.ArgumentParser(description="Fire bootstrap via Web App URL")
    parser.add_argument("--targets", type=Path, required=True,
                        help="JSON file with list of sheet_ids to target")
    parser.add_argument("--dry-run", action="store_true",
                        help="Build URL map but don't fire")
    args = parser.parse_args()

    print("\n🌐 MA GOLIDE — WEB APP BOOTSTRAP FIRE")
    print("════════════════════════════════════════════════")

    creds_list = load_credentials()
    if not creds_list:
        print("ERROR: No credentials found.")
        return

    all_sats = list_satellites()
    targets_list = json.loads(args.targets.read_text())
    all_sats = [s for s in all_sats if (s.get("sheet_id") or s.get("id")) in targets_list]
    registered = [s for s in all_sats if s.get("script_id")]

    print(f" Targets file:        {args.targets.name}")
    print(f" Satellites in scope: {len(all_sats)}")
    print(f" With script_id:      {len(registered)}")
    print(f" Credential slots:    {len(creds_list)}")
    print("════════════════════════════════════════════════\n")

    if not registered:
        print("No registered satellites to process.")
        return

    # Route using script->token map
    script_to_slot = load_script_token_map(creds_list)
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
        print(f"WARNING: {len(unmapped)} satellites unmapped (no script_id in map)")

    if args.dry_run:
        print("DRY RUN — would fire these slots:")
        for idx, data in slots_to_sats.items():
            print(f"  slot-{idx}: {len(data['sats'])} satellites")
        return

    totals = {"scheduled": 0, "failed": 0, "no_url": 0}

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = []
        for idx, data in slots_to_sats.items():
            futures.append(executor.submit(worker, idx, data["creds"], data["sats"], DELAY))

        for f in as_completed(futures):
            r = f.result()
            for k in totals:
                totals[k] += r[k]

    print(f"\nFINAL COUNT: scheduled={totals['scheduled']} | failed={totals['failed']} | no_url={totals['no_url']}")
    if totals["scheduled"] > 0:
        print(f"\n⏳ Wait ~45 seconds, then run the mirror + audit to confirm tabs appeared.")


if __name__ == "__main__":
    main()
