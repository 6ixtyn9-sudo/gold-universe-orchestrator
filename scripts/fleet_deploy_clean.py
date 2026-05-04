"""
scripts/fleet_deploy_clean.py
══════════════════════════════════════════════════════════════════════════
Clean, reliable fleet deployment that works within real API constraints.

STRATEGY:
  - For satellites WITH a script_id in registry → push code directly.
    No Drive parent lookups. No new script creation. Just updateContent.
  - For satellites WITHOUT a script_id → skip for now (log them).
    They need a one-time manual fix or a separate creation pass.

This avoids the "create duplicate on every run" bug entirely.

WHAT IT PUSHES:
  - All .gs files from Ma_Golide_Satellites/docs/
  - Hardened setupOneTimeTrigger (no trigger pile-up)
  - nukeAllTriggers + safeLaunch utilities (fix_triggers.gs)

USAGE:
  python3 scripts/fleet_deploy_clean.py --limit 5    # test on 5
  python3 scripts/fleet_deploy_clean.py --limit 69   # only registered ones
  python3 scripts/fleet_deploy_clean.py              # full fleet
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
from registry.satellite_registry import list_satellites

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)
logger = logging.getLogger("fleet_deploy")

DOCS_DIR   = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
CREDS_DIR  = REPO_ROOT / "creds"
MAX_WORKERS = 10
DELAY       = 1.5   # seconds between deploys per thread


# ── Credential loader ─────────────────────────────────────────────────────────

def load_credentials() -> list:
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


# ── GS file loader ────────────────────────────────────────────────────────────

def load_gs_files() -> list:
    """Load all .gs files from docs/ into Script API format."""
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
    gs_files = list(DOCS_DIR.glob("*.gs"))
    for p in gs_files:
        files.append({
            "name": p.stem,
            "type": "SERVER_JS",
            "source": p.read_text(encoding="utf-8")
        })
    logger.info(f"Loaded {len(gs_files)} .gs files from {DOCS_DIR}")
    return files


# ── Single satellite deploy ────────────────────────────────────────────────────

def deploy_one(script_svc, sat: dict, files: list) -> dict:
    label     = sat.get("name", sat.get("id", "?"))
    script_id = sat.get("script_id", "")
    sheet_id  = sat.get("sheet_id") or sat.get("id", "")

    if not script_id:
        return {
            "label": label,
            "sheet_id": sheet_id,
            "ok": False,
            "skipped": True,
            "reason": "NO_SCRIPT_ID_IN_REGISTRY"
        }

    try:
        script_svc.projects().updateContent(
            scriptId=script_id,
            body={"files": files}
        ).execute()
        return {
            "label": label,
            "script_id": script_id,
            "ok": True,
            "skipped": False
        }
    except Exception as e:
        err = str(e)
        # Detect the specific "script not found" vs permission errors
        if "404" in err:
            reason = "SCRIPT_ID_STALE_OR_DELETED"
        elif "403" in err:
            reason = "PERMISSION_DENIED"
        else:
            reason = err[:80]
        return {
            "label": label,
            "script_id": script_id,
            "ok": False,
            "skipped": False,
            "reason": reason
        }


# ── Worker thread ─────────────────────────────────────────────────────────────

def worker(slot_idx: int, creds, satellites: list, files: list, delay: float) -> dict:
    threading.current_thread().name = f"slot-{slot_idx}"
    svc = build("script", "v1", credentials=creds, cache_discovery=False)

    results = {"ok": 0, "skipped": 0, "failed": 0, "stale": 0}
    for i, sat in enumerate(satellites):
        res = deploy_one(svc, sat, files)

        if res.get("skipped"):
            results["skipped"] += 1
            logger.info(f"⏭️  SKIP  {res['label'][:55]} — no script_id in registry")
        elif res["ok"]:
            results["ok"] += 1
            logger.info(f"✅  OK    {res['label'][:55]}")
        else:
            reason = res.get("reason", "")
            if "STALE" in reason or "404" in reason:
                results["stale"] += 1
                logger.warning(f"🟡  STALE {res['label'][:55]} — {reason}")
            else:
                results["failed"] += 1
                logger.warning(f"❌  FAIL  {res['label'][:55]} — {reason}")

        if i < len(satellites) - 1:
            time.sleep(delay)

    return results


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Fleet deploy — registry script_ids only")
    parser.add_argument("--limit",  type=int,   default=None,  help="Limit to N satellites")
    parser.add_argument("--delay",  type=float, default=DELAY, help="Seconds between deploys")
    parser.add_argument("--workers",type=int,   default=MAX_WORKERS)
    args = parser.parse_args()

    print("\n🚀 MA GOLIDE — FLEET DEPLOY (registry-based)")
    print("════════════════════════════════════════════════")

    # Load files
    if not DOCS_DIR.exists():
        print(f"ERROR: docs dir not found: {DOCS_DIR}")
        return
    files = load_gs_files()

    # Load credentials
    creds_list = load_credentials()
    if not creds_list:
        print("ERROR: No valid credentials in creds/")
        return

    # Load satellites
    all_sats = list_satellites()
    registered = [s for s in all_sats if s.get("script_id")]
    unregistered = [s for s in all_sats if not s.get("script_id")]

    if args.limit:
        registered = registered[:args.limit]

    print(f"  .gs files loaded:      {len(files)}")
    print(f"  Credential slots:      {len(creds_list)}")
    print(f"  Satellites total:      {len(all_sats)}")
    print(f"  ✅ Have script_id:     {len(registered)}")
    print(f"  ⏭️  No script_id:      {len(unregistered)}  (will be skipped)")
    print("════════════════════════════════════════════════\n")

    if not registered:
        print("Nothing to deploy (no satellites with script_id in registry).")
        print("Run the mass_deploy script first to create + register script IDs.")
        return

    # Distribute across credential slots
    n_slots = min(len(creds_list), args.workers, len(registered))
    chunk_size = max(1, (len(registered) + n_slots - 1) // n_slots)
    chunks = [registered[i:i+chunk_size] for i in range(0, len(registered), chunk_size)]

    start = datetime.now()
    totals = {"ok": 0, "skipped": 0, "failed": 0, "stale": 0}

    with ThreadPoolExecutor(max_workers=n_slots) as executor:
        futures = {}
        for i, (slot_idx, creds) in enumerate(creds_list[:n_slots]):
            chunk = chunks[i] if i < len(chunks) else []
            if not chunk:
                continue
            f = executor.submit(worker, slot_idx, creds, chunk, files, args.delay)
            futures[f] = slot_idx

        for f in as_completed(futures):
            try:
                r = f.result()
                for k in totals:
                    totals[k] += r.get(k, 0)
            except Exception as e:
                logger.error(f"Worker crashed: {e}")

    elapsed = (datetime.now() - start).total_seconds()

    print(f"\n{'='*50}")
    print(f"DONE in {elapsed:.0f}s")
    print(f"  ✅ Deployed:   {totals['ok']}")
    print(f"  🟡 Stale ID:   {totals['stale']}  (script was deleted, need re-registration)")
    print(f"  ❌ Failed:     {totals['failed']}")
    print(f"  ⏭️  Skipped:   {totals['skipped']}  (no script_id in registry)")

    if totals['stale'] > 0:
        print(f"\n⚠️  {totals['stale']} satellites have stale/deleted script IDs in the registry.")
        print("   These need their script_id cleared and re-created.")
        print("   Run: python3 scripts/mass_deploy_new.py --only-missing")

    if unregistered:
        print(f"\n⚠️  {len(unregistered)} satellites have NO script_id in the registry at all.")
        print("   These sheets have never had a script pushed to them via this system.")
        print("   Run: python3 scripts/mass_deploy_new.py --only-missing")


if __name__ == "__main__":
    main()
