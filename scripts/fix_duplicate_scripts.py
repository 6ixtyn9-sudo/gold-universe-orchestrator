"""
scripts/fix_duplicate_scripts.py
══════════════════════════════════════════════════════════════════════════
Reads audit_report.json and fixes the problems it found:

  1. DUPLICATE_SCRIPTS  → Deletes orphan script projects, keeps canonical.
                          Pushes latest .gs code to canonical.
                          Updates registry with canonical script_id.

  2. UNREGISTERED       → Registers the existing script_id in registry.
                          Pushes latest .gs code to it.

  3. MISMATCH           → Updates registry to match what's actually on Drive.

  4. NO_SCRIPT          → Creates ONE new bound script. Registers it.
                          Pushes latest .gs code to it.

  After fixing, the registry is the single source of truth and every
  satellite has exactly ONE script project with the correct code.

USAGE:
  # Dry run first — see what would happen
  python3 scripts/fix_duplicate_scripts.py --dry-run

  # Fix only duplicates (safest first step)
  python3 scripts/fix_duplicate_scripts.py --only duplicates

  # Fix everything
  python3 scripts/fix_duplicate_scripts.py
"""

import sys, os, json, time, logging, argparse
from pathlib import Path
from datetime import datetime

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("fix_duplicates")

CREDS_DIR   = REPO_ROOT / "creds"
DOCS_DIR    = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
REGISTRY_PATH = REPO_ROOT / "registry" / "registry.json"
AUDIT_PATH  = REPO_ROOT / "audit_report.json"


# ── Credentials ──────────────────────────────────────────────────────────────

def load_first_credential():
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


# ── Registry helpers ──────────────────────────────────────────────────────────

def load_registry() -> dict:
    if not REGISTRY_PATH.exists():
        return {}
    return json.loads(REGISTRY_PATH.read_text())


def save_registry(registry: dict):
    registry["last_updated"] = datetime.utcnow().isoformat()
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2))
    logger.info("Registry saved.")


def update_registry_script_id(registry: dict, sheet_id: str, script_id: str):
    """Update the script_id for a satellite in the registry by sheet_id."""
    for sat in registry.get("satellites", []):
        if sat.get("id") == sheet_id or sat.get("sheet_id") == sheet_id:
            sat["script_id"] = script_id
            return True
    return False


# ── GS file loader ────────────────────────────────────────────────────────────

def load_gs_files() -> list:
    files = [{
        "name": "appsscript",
        "type": "JSON",
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
            "name": p.stem,
            "type": "SERVER_JS",
            "source": p.read_text(encoding="utf-8")
        })
    logger.info(f"Loaded {len(files)} source files from docs/")
    return files


# ── Core operations ───────────────────────────────────────────────────────────

def delete_script_project(drive_svc, script_id: str, dry_run: bool) -> bool:
    """Delete an orphan script project from Drive."""
    if dry_run:
        logger.info(f"  [DRY RUN] Would delete script project: {script_id}")
        return True
    try:
        drive_svc.files().delete(fileId=script_id).execute()
        logger.info(f"  Deleted orphan script: {script_id}")
        return True
    except HttpError as e:
        if e.resp.status == 404:
            logger.warning(f"  Script {script_id} already gone (404)")
            return True
        logger.error(f"  Failed to delete {script_id}: {e}")
        return False


def push_code(script_svc, script_id: str, files: list, dry_run: bool) -> bool:
    """Push .gs code to a script project."""
    if dry_run:
        logger.info(f"  [DRY RUN] Would push {len(files)} files to {script_id}")
        return True
    try:
        script_svc.projects().updateContent(
            scriptId=script_id,
            body={"files": files}
        ).execute()
        logger.info(f"  Pushed {len(files)} files to {script_id}")
        return True
    except Exception as e:
        logger.error(f"  Failed to push code to {script_id}: {e}")
        return False


def create_bound_script(script_svc, sheet_id: str, label: str, dry_run: bool) -> str | None:
    """Create a new bound script project."""
    if dry_run:
        logger.info(f"  [DRY RUN] Would create bound script for {sheet_id}")
        return "DRY_RUN_ID"
    try:
        project = script_svc.projects().create(body={
            "title": "Ma Golide Satellite Logic",
            "parentId": sheet_id
        }).execute()
        script_id = project["scriptId"]
        logger.info(f"  Created new script {script_id} for {label}")
        return script_id
    except Exception as e:
        logger.error(f"  Failed to create script for {sheet_id}: {e}")
        return None


# ── Main fix logic ────────────────────────────────────────────────────────────

def fix_entry(entry: dict, script_svc, drive_svc, files: list,
              registry: dict, dry_run: bool, only: str | None) -> str:
    status = entry.get("status")
    sheet_id = entry.get("sheet_id", "")
    label = entry.get("label", sheet_id)[:60]

    if only == "duplicates" and status != "DUPLICATE_SCRIPTS":
        return "SKIPPED"
    if status == "OK":
        return "OK_NO_ACTION"
    if status == "ERROR":
        return "SKIP_ERROR"

    # ── DUPLICATE_SCRIPTS ──────────────────────────────────────────────────────
    if status == "DUPLICATE_SCRIPTS":
        canonical = entry.get("canonical_script_id")
        orphans   = entry.get("orphan_script_ids", [])
        logger.info(f"\n[DUPLICATE] {label}")
        logger.info(f"  canonical={canonical}, orphans={orphans}")

        # Delete orphans
        all_deleted = True
        for oid in orphans:
            ok = delete_script_project(drive_svc, oid, dry_run)
            if not ok:
                all_deleted = False

        # Push code to canonical
        push_code(script_svc, canonical, files, dry_run)

        # Update registry
        if not dry_run:
            update_registry_script_id(registry, sheet_id, canonical)

        return "FIXED_DUPLICATE" if all_deleted else "PARTIAL_DUPLICATE_FIX"

    # ── UNREGISTERED ──────────────────────────────────────────────────────────
    elif status == "UNREGISTERED":
        script_id = entry["bound_scripts"][0]["script_id"]
        logger.info(f"\n[UNREGISTERED] {label} → registering {script_id}")
        push_code(script_svc, script_id, files, dry_run)
        if not dry_run:
            update_registry_script_id(registry, sheet_id, script_id)
        return "FIXED_UNREGISTERED"

    # ── MISMATCH ──────────────────────────────────────────────────────────────
    elif status == "MISMATCH":
        actual_id = entry["bound_scripts"][0]["script_id"]
        logger.info(f"\n[MISMATCH] {label} → updating registry to {actual_id}")
        push_code(script_svc, actual_id, files, dry_run)
        if not dry_run:
            update_registry_script_id(registry, sheet_id, actual_id)
        return "FIXED_MISMATCH"

    # ── NO_SCRIPT ──────────────────────────────────────────────────────────────
    elif status == "NO_SCRIPT":
        if only == "duplicates":
            return "SKIPPED"
        logger.info(f"\n[NO_SCRIPT] {label} → creating new script")
        new_id = create_bound_script(script_svc, sheet_id, label, dry_run)
        if new_id and new_id != "DRY_RUN_ID":
            push_code(script_svc, new_id, files, dry_run)
            update_registry_script_id(registry, sheet_id, new_id)
        return "FIXED_NO_SCRIPT" if new_id else "FAILED_NO_SCRIPT"

    return "UNKNOWN_STATUS"


def main():
    parser = argparse.ArgumentParser(description="Fix duplicate/missing script bindings")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would happen without making changes")
    parser.add_argument("--only", choices=["duplicates"], default=None,
                        help="Only fix a specific category (safest: duplicates)")
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()

    if not AUDIT_PATH.exists():
        print("ERROR: audit_report.json not found. Run audit_duplicate_scripts.py first.")
        return

    audit = json.loads(AUDIT_PATH.read_text())
    entries = audit.get("results", [])
    summary = audit.get("summary", {})

    print(f"\n🔧 MA GOLIDE — FIX DUPLICATE SCRIPTS")
    print(f"════════════════════════════════════════")
    print(f"  Audit entries:   {len(entries)}")
    print(f"  Duplicates:      {summary.get('DUPLICATE_SCRIPTS', 0)}")
    print(f"  Unregistered:    {summary.get('UNREGISTERED', 0)}")
    print(f"  Mismatch:        {summary.get('MISMATCH', 0)}")
    print(f"  No script:       {summary.get('NO_SCRIPT', 0)}")
    print(f"  Dry run:         {'YES' if args.dry_run else 'NO'}")
    print(f"  Only:            {args.only or 'all'}")
    print(f"════════════════════════════════════════\n")

    creds = load_first_credential()
    if not creds:
        print("ERROR: No credentials found.")
        return

    script_svc = build("script", "v1", credentials=creds, cache_discovery=False)
    drive_svc  = build("drive",  "v3", credentials=creds, cache_discovery=False)
    files      = load_gs_files()
    registry   = load_registry()

    outcome_counts = {}
    for i, entry in enumerate(entries):
        label = entry.get("label", "?")[:50]
        outcome = fix_entry(entry, script_svc, drive_svc, files, registry,
                            dry_run=args.dry_run, only=args.only)
        outcome_counts[outcome] = outcome_counts.get(outcome, 0) + 1
        if outcome not in ("OK_NO_ACTION", "SKIPPED"):
            print(f"  [{i+1}/{len(entries)}] {label:<50} → {outcome}")
        if i < len(entries) - 1:
            time.sleep(args.delay)

    # Save updated registry
    if not args.dry_run:
        save_registry(registry)
        print(f"\n  Registry updated and saved.")

    print(f"\n{'='*50}")
    print("OUTCOME SUMMARY:")
    for k, v in sorted(outcome_counts.items()):
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
