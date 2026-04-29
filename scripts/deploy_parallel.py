"""
scripts/deploy_parallel.py
══════════════════════════════════════════════════════════════════════════
Deploys .gs code to all 501 satellites in parallel using multiple
Google Cloud project credentials — bypassing the ~50/day per-project
quota by spreading the load across 10 projects.

SETUP (one-time, ~15 minutes):
  See scripts/PARALLEL_DEPLOY_SETUP.md for step-by-step instructions.

USAGE:
  # Dry run — shows assignment without deploying
  python3 scripts/deploy_parallel.py --dry-run

  # Deploy all
  python3 scripts/deploy_parallel.py

  # Deploy with specific credentials folder
  python3 scripts/deploy_parallel.py --creds-dir ~/Desktop/creds

HOW IT WORKS:
  - Loads all credential files from creds/ folder (token_0.json ... token_9.json)
  - Splits 501 satellites evenly across credentials (~50 each)
  - Runs each batch in a separate thread simultaneously
  - Each thread deploys its batch at 5s intervals (safe rate)
  - Total time: ~7 minutes for 501 satellites
  - Progress written to deploy_progress.json as it runs
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
from registry.satellite_registry import list_satellites, update_satellite

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)
logger = logging.getLogger("deploy_parallel")

DOCS_DIR       = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
CREDS_DIR      = REPO_ROOT / "creds"
PROGRESS_FILE  = REPO_ROOT / "deploy_progress.json"
DELAY_BETWEEN  = 5.0    # seconds between each satellite within a thread
MAX_WORKERS    = 10     # one thread per credential set


# ── File order matters for Apps Script ───────────────────────────────────────
GS_ORDER = [
    "Sheet_Setup", "Config_Ledger_Satellite", "Signal_Processor",
    "Data_Parser", "Margin_Analyzer", "Forecaster", "Game_Processor",
    "Inventory_Manager", "Accumulator_Builder", "Contract_Enforcer",
    "Contract_Enforcement",
]


def load_gs_files() -> list[dict]:
    files = [{
        "name": "appsscript", "type": "JSON",
        "source": json.dumps({
            "timeZone": "UTC",
            "exceptionLogging": "STACKDRIVER",
            "runtimeVersion": "V8",
            "oauthScopes": [
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive",
                "https://www.googleapis.com/auth/script.external_request"
            ]
        })
    }]
    missing = []
    for name in GS_ORDER:
        p = DOCS_DIR / f"{name}.gs"
        if p.exists():
            files.append({
                "name":   name,
                "type":   "SERVER_JS",
                "source": p.read_text(encoding="utf-8")
            })
        else:
            missing.append(name)
    if missing:
        logger.warning(f"Missing source files: {missing}")
    logger.info(f"Loaded {len(files)} source files ({len(files)-1} .gs + manifest)")
    return files


def load_credentials(creds_dir: Path) -> list[Credentials]:
    """Load all token_N.json files from the creds directory."""
    creds_list = []
    if not creds_dir.exists():
        return []
        
    for i in range(20):  # check up to 20 slots
        token_file = creds_dir / f"token_{i}.json"
        if not token_file.exists():
            continue
        try:
            creds = Credentials.from_authorized_user_file(str(token_file))
            # Refresh if expired
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())
            creds_list.append((i, creds, token_file))
            logger.info(f"  Loaded credentials slot {i}: {token_file.name}")
        except Exception as e:
            logger.warning(f"  Failed to load {token_file.name}: {e}")

    return creds_list


def build_services(creds: Credentials):
    script = build("script", "v1", credentials=creds, cache_discovery=False)
    drive  = build("drive",  "v3", credentials=creds, cache_discovery=False)
    return script, drive


def find_or_create_script(script_svc, drive_svc, sheet_id: str, sat_id: str) -> tuple[str, bool]:
    """Find existing bound script or create new one. Returns (script_id, was_created)."""
    # Try Drive search first
    try:
        q = f"'{sheet_id}' in parents and mimeType='application/vnd.google-apps.script'"
        r = drive_svc.files().list(q=q, fields="files(id,name)", pageSize=5).execute()
        files = r.get("files", [])
        if files:
            sid = files[0]["id"]
            # FIXED: Pass a dictionary to update_satellite
            update_satellite(sat_id, {"script_id": sid})
            return sid, False
    except Exception:
        pass

    # Create new
    proj = script_svc.projects().create(body={
        "title":    "Ma Golide Satellite Logic",
        "parentId": sheet_id
    }).execute()
    sid = proj["scriptId"]
    # FIXED: Pass a dictionary to update_satellite
    update_satellite(sat_id, {"script_id": sid})
    return sid, True


def deploy_satellite(script_svc, drive_svc, sat: dict, files: list[dict]) -> dict:
    """Deploy to one satellite. Returns result dict."""
    sheet_id  = sat.get("sheet_id") or sat.get("id", "")
    script_id = sat.get("script_id", "")
    label     = f"{sat.get('league','?')} {sat.get('date','?')}"

    result = {
        "label":     label,
        "sheet_id":  sheet_id,
        "ok":        False,
        "action":    "",
        "error":     None,
        "ts":        datetime.utcnow().isoformat()
    }

    if not sheet_id:
        result["error"] = "No sheet_id"
        return result

    created = False
    try:
        if not script_id:
            script_id, created = find_or_create_script(
                script_svc, drive_svc, sheet_id, sat["id"]
            )
    except Exception as e:
        err = str(e)
        if "429" in err or "exhausted" in err.lower():
            result["error"] = "QUOTA_HIT"
        else:
            result["error"] = f"create_failed: {err[:80]}"
        return result

    try:
        script_svc.projects().updateContent(
            scriptId=script_id,
            body={"files": files}
        ).execute()
        result["ok"]     = True
        result["action"] = "CREATED" if created else "UPDATED"
        return result
    except Exception as e:
        result["error"] = f"update_failed: {str(e)[:80]}"
        return result


# ── Progress tracking (thread-safe) ──────────────────────────────────────────
_progress_lock = threading.Lock()
_progress = {"success": 0, "failed": 0, "quota": 0, "results": []}

def _record(result: dict):
    with _progress_lock:
        if result["ok"]:
            _progress["success"] += 1
        elif result.get("error") == "QUOTA_HIT":
            _progress["quota"] += 1
        else:
            _progress["failed"] += 1
        _progress["results"].append(result)
        # Save progress to disk so you can monitor it
        PROGRESS_FILE.write_text(
            json.dumps(_progress, indent=2, default=str)
        )


def worker_batch(slot_idx: int, creds: Credentials, token_file: Path,
                 satellites: list[dict], files: list[dict],
                 delay: float, dry_run: bool) -> dict:
    """Worker function — runs in its own thread, deploys its batch of satellites."""
    thread_name = f"slot-{slot_idx}"
    threading.current_thread().name = thread_name

    logger.info(f"[{thread_name}] Starting — {len(satellites)} satellites to deploy")

    try:
        script_svc, drive_svc = build_services(creds)
    except Exception as e:
        logger.error(f"[{thread_name}] Cannot build services: {e}")
        return {"slot": slot_idx, "success": 0, "failed": len(satellites)}

    success, failed, quota_hits = 0, 0, 0

    for i, sat in enumerate(satellites):
        if dry_run:
            label = f"{sat.get('league','?')} {sat.get('date','?')}"
            logger.info(f"[{thread_name}] [{i+1}/{len(satellites)}] DRY RUN — {label}")
            success += 1
            continue

        result = deploy_satellite(script_svc, drive_svc, sat, files)
        _record(result)

        if result["ok"]:
            success += 1
            logger.info(
                f"[{thread_name}] [{i+1}/{len(satellites)}] ✅ {result['action']} — {result['label']}"
            )
        elif result.get("error") == "QUOTA_HIT":
            quota_hits += 1
            failed += 1
            logger.warning(
                f"[{thread_name}] [{i+1}/{len(satellites)}] ⏸ QUOTA HIT — stopping this slot"
            )
            # Quota hit — stop this thread, don't burn retries
            break
        else:
            failed += 1
            logger.warning(
                f"[{thread_name}] [{i+1}/{len(satellites)}] ❌ {result['label']}: {result['error']}"
            )

        # Refresh token if needed
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())
            except Exception:
                pass

        if i < len(satellites) - 1:
            time.sleep(delay)

    logger.info(f"[{thread_name}] Done — ✅{success} ❌{failed} ⏸{quota_hits}")
    return {"slot": slot_idx, "success": success, "failed": failed, "quota": quota_hits}


def split_satellites(satellites: list, n_slots: int) -> list[list]:
    """Split satellite list into n_slots roughly equal chunks."""
    if n_slots <= 0: return []
    size   = (len(satellites) + n_slots - 1) // n_slots
    chunks = []
    for i in range(0, len(satellites), size):
        chunks.append(satellites[i:i + size])
    return chunks


def main():
    parser = argparse.ArgumentParser(
        description="Deploy .gs code to all satellites in parallel"
    )
    parser.add_argument("--dry-run",   action="store_true",
                        help="Show plan without deploying")
    parser.add_argument("--creds-dir", type=Path, default=CREDS_DIR,
                        help=f"Folder with token_N.json files (default: {CREDS_DIR})")
    parser.add_argument("--delay",     type=float, default=DELAY_BETWEEN,
                        help=f"Seconds between satellites per thread (default: {DELAY_BETWEEN})")
    parser.add_argument("--workers",   type=int,   default=MAX_WORKERS,
                        help=f"Max parallel threads (default: {MAX_WORKERS})")
    args = parser.parse_args()

    print(f"\n{'═'*60}")
    print(f"  MA GOLIDE — PARALLEL SATELLITE DEPLOY")
    print(f"{'═'*60}")

    # ── Load source files ─────────────────────────────────────────────────
    files = load_gs_files()
    if len(files) < 5:
        print("ERROR: Too few source files found. Check DOCS_DIR path.")
        sys.exit(1)

    # ── Load credentials ──────────────────────────────────────────────────
    creds_list = load_credentials(args.creds_dir)
    if not creds_list:
        print(f\"\"\"
ERROR: No credential files found in {args.creds_dir}

Expected files: token_0.json, token_1.json, ... token_9.json
See scripts/PARALLEL_DEPLOY_SETUP.md for setup instructions.

Quick start (for 1 credential you already have):
  mkdir -p creds
  cp personal_token.json creds/token_0.json
  python3 scripts/deploy_parallel.py   # runs single-threaded
\"\"\")
        sys.exit(1)

    n_slots = min(len(creds_list), args.workers)

    # ── Load and split satellites ─────────────────────────────────────────
    all_sats  = list_satellites()
    pending   = [s for s in all_sats if not s.get("script_id")]
    done      = [s for s in all_sats if s.get("script_id")]
    chunks    = split_satellites(pending, n_slots)

    # Estimate time
    max_chunk    = max(len(c) for c in chunks) if chunks else 0
    est_minutes  = (max_chunk * args.delay) / 60

    print(f"  Source files:      {len(files)}")
    print(f"  Credential slots:  {n_slots}")
    print(f"  Total satellites:  {len(all_sats)}")
    print(f"  Already deployed:  {len(done)}")
    print(f"  Pending:           {len(pending)}")
    print(f"  Satellites/slot:   ~{max_chunk}")
    print(f"  Estimated time:    ~{est_minutes:.0f} minutes")
    if args.dry_run:
        print(f"  MODE:              DRY RUN")
    print(f"{'═'*60}\n")

    if not pending:
        print("✅ All satellites already deployed!")
        return

    # ── Show batch assignment ─────────────────────────────────────────────
    for i, (slot_idx, _, token_file) in enumerate(creds_list[:n_slots]):
        chunk = chunks[i] if i < len(chunks) else []
        print(f"  Slot {slot_idx} ({token_file.name}): {len(chunk)} satellites")
    print()

    if not args.dry_run:
        # Check if stdin is a terminal for input
        if sys.stdin.isatty():
            input("Press Enter to start deployment (Ctrl+C to cancel)...")
        else:
            print("Non-interactive mode, starting deployment...")
        print()

    start = datetime.now()

    # ── Run parallel threads ──────────────────────────────────────────────
    futures = []
    with ThreadPoolExecutor(max_workers=n_slots) as executor:
        for i, (slot_idx, creds, token_file) in enumerate(creds_list[:n_slots]):
            chunk = chunks[i] if i < len(chunks) else []
            if not chunk:
                continue
            future = executor.submit(
                worker_batch,
                slot_idx, creds, token_file, chunk, files,
                args.delay, args.dry_run
            )
            futures.append(future)
            time.sleep(0.5)  # stagger thread starts slightly

        # Wait for all threads
        total_success = 0
        total_failed  = 0
        for future in as_completed(futures):
            try:
                r = future.result()
                total_success += r.get("success", 0)
                total_failed  += r.get("failed", 0)
            except Exception as e:
                logger.error(f"Thread error: {e}")

    elapsed = (datetime.now() - start).total_seconds()

    # ── Also update already-deployed satellites (free — no create quota) ──
    if done and not args.dry_run:
        print(f"\nUpdating {len(done)} already-deployed satellites...")
        # Use first credential set for updates (no quota cost)
        _, creds, token_file = creds_list[0]
        script_svc, drive_svc = build_services(creds)
        for sat in done:
            result = deploy_satellite(script_svc, drive_svc, sat, files)
            if result["ok"]:
                total_success += 1
            time.sleep(1.0)

    # ── Final summary ─────────────────────────────────────────────────────
    print(f"\n{'═'*60}")
    print(f"  DEPLOY COMPLETE")
    print(f"{'═'*60}")
    print(f"  ✅ Success:  {total_success}")
    print(f"  ❌ Failed:   {total_failed}")
    print(f"  ⏱  Time:    {elapsed:.0f}s ({elapsed/60:.1f} min)")
    still_pending = len([s for s in list_satellites() if not s.get("script_id")])
    print(f"  📋 Still pending: {still_pending}")
    if still_pending > 0:
        print(f"  → Some slots hit quota. Run again tomorrow with fresh credentials.")
    else:
        print(f"  🎉 ALL SATELLITES DEPLOYED!")
    print(f"{'═'*60}")
    print(f"\nProgress saved to: {PROGRESS_FILE}")


if __name__ == "__main__":
    main()
