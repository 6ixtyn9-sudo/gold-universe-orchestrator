"""
scripts/deploy_personal.py
Uses your personal OAuth token (personal_token.json) to deploy .gs files
to all satellites. Your personal account owns the sheets so it can see
all bound scripts — no quota issues, no 429 errors.
"""

import os, sys, time, logging, json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from registry.satellite_registry import list_satellites, update_satellite

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("deploy_personal")

DOCS_DIR   = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
TOKEN_FILE = REPO_ROOT / "personal_token.json"
DELAY      = 1.5   # seconds between satellites


def load_gs_files():
    ORDER = [
        "Sheet_Setup", "Config_Ledger_Satellite", "Signal_Processor",
        "Data_Parser", "Margin_Analyzer", "Forecaster", "Game_Processor",
        "Inventory_Manager", "Accumulator_Builder", "Contract_Enforcer",
        "Contract_Enforcement",
    ]
    files = [{
        "name": "appsscript", "type": "JSON",
        "source": '{"timeZone":"UTC","exceptionLogging":"STACKDRIVER","runtimeVersion":"V8"}'
    }]
    for name in ORDER:
        p = DOCS_DIR / f"{name}.gs"
        if p.exists():
            files.append({"name": name, "type": "SERVER_JS", "source": p.read_text(encoding="utf-8")})
        else:
            logger.warning(f"Missing: {p.name}")
    logger.info(f"Loaded {len(files)} files from docs/")
    return files


def get_services():
    creds = Credentials.from_authorized_user_file(str(TOKEN_FILE))
    script = build("script", "v1", credentials=creds, cache_discovery=False)
    drive  = build("drive",  "v3", credentials=creds, cache_discovery=False)
    return script, drive


def find_or_create_script(script_svc, drive_svc, sheet_id, sat_id):
    # Try Drive search first
    try:
        q = f"'{sheet_id}' in parents and mimeType='application/vnd.google-apps.script'"
        r = drive_svc.files().list(q=q, fields="files(id,name)").execute()
        files = r.get("files", [])
        if files:
            sid = files[0]["id"]
            update_satellite(sat_id, {"script_id": sid})
            return sid, False   # found, not created
    except Exception as e:
        logger.debug(f"Drive search failed: {e}")

    # Create new bound script
    try:
        proj = script_svc.projects().create(body={"title": "Ma Golide Satellite Logic", "parentId": sheet_id}).execute()
        sid  = proj["scriptId"]
        update_satellite(sat_id, {"script_id": sid})
        return sid, True    # created
    except Exception as e:
        raise RuntimeError(f"Cannot find or create script: {e}")


def deploy_one(script_svc, drive_svc, sat, files):
    sheet_id  = sat.get("sheet_id") or sat.get("id", "")
    script_id = sat.get("script_id", "")
    label     = f"{sat.get('league','?')} {sat.get('date','?')}"

    if not sheet_id:
        return False, "no sheet_id"

    created = False
    if not script_id:
        try:
            script_id, created = find_or_create_script(script_svc, drive_svc, sheet_id, sat["id"])
        except RuntimeError as e:
            return False, str(e)

    try:
        script_svc.projects().updateContent(
            scriptId=script_id, body={"files": files}
        ).execute()
        action = "CREATED+DEPLOYED" if created else "UPDATED"
        logger.info(f"✅ {action}: {label}")
        return True, action
    except Exception as e:
        return False, str(e)


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=DELAY)
    args = parser.parse_args()

    if not TOKEN_FILE.exists():
        logger.error("personal_token.json not found. Run the auth step first.")
        sys.exit(1)

    files        = load_gs_files()
    script_svc, drive_svc = get_services()
    satellites   = list_satellites()
    if args.limit:
        satellites = satellites[:args.limit]

    total, success, failed = len(satellites), 0, 0
    logger.info(f"Deploying to {total} satellites...")

    for i, sat in enumerate(satellites):
        ok, msg = deploy_one(script_svc, drive_svc, sat, files)
        if ok:
            success += 1
        else:
            failed += 1
            logger.warning(f"❌ [{i+1}/{total}] {sat.get('league','?')} {sat.get('date','?')}: {msg}")
        if i < total - 1:
            time.sleep(args.delay)

    print(f"\n{'='*50}")
    print(f"  ✅ Success: {success}  ❌ Failed: {failed}  Total: {total}")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
