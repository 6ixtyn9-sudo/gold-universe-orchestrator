"""
scripts/deploy_batch.py
══════════════════════════════════════════════════════════════════════════
Deploys to satellites in safe daily batches, skipping ones already done.
Tracks progress in registry.json (script_id cached after first success).

Run once per day:
  python3 scripts/deploy_batch.py

It automatically:
  - Skips satellites that already have script_id (already deployed)
  - Deploys up to DAILY_LIMIT new ones
  - Prints progress so you know how many days remain

After 10 days all 501 are done.
Or run --limit 50 manually each day.
"""

import sys, time, logging
from pathlib import Path
from datetime import datetime

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from registry.satellite_registry import list_satellites, update_satellite

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("deploy_batch")

DOCS_DIR    = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
TOKEN_FILE  = REPO_ROOT / "personal_token.json"
DAILY_LIMIT = 45    # stay safely under the ~50/day quota
DELAY       = 8.0   # seconds between each — slow and steady


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
            files.append({"name": name, "type": "SERVER_JS",
                          "source": p.read_text(encoding="utf-8")})
    logger.info(f"Loaded {len(files)} source files")
    return files


def get_services():
    creds  = Credentials.from_authorized_user_file(str(TOKEN_FILE))
    script = build("script", "v1", credentials=creds, cache_discovery=False)
    drive  = build("drive",  "v3", credentials=creds, cache_discovery=False)
    return script, drive


def deploy_one(script_svc, drive_svc, sat, files):
    sheet_id  = sat.get("sheet_id") or sat.get("id", "")
    script_id = sat.get("script_id", "")
    label     = f"{sat.get('league','?')} {sat.get('date','?')}"

    # Already has script_id — just update content (no quota cost)
    if script_id:
        try:
            script_svc.projects().updateContent(
                scriptId=script_id, body={"files": files}
            ).execute()
            return "updated", None
        except Exception as e:
            return "error", str(e)[:100]

    # No script_id — need to create (costs quota)
    try:
        proj = script_svc.projects().create(body={
            "title":    "Ma Golide Satellite Logic",
            "parentId": sheet_id
        }).execute()
        script_id = proj["scriptId"]
        # FIXED: Pass a dictionary to update_satellite
        update_satellite(sat["id"], {"script_id": script_id})
    except Exception as e:
        err = str(e)
        if "429" in err or "exhausted" in err.lower():
            return "quota", "Daily quota hit — stop for today"
        return "error", err[:100]

    # Push content to newly created script
    try:
        script_svc.projects().updateContent(
            scriptId=script_id, body={"files": files}
        ).execute()
        return "created", None
    except Exception as e:
        return "error", str(e)[:100]


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=DAILY_LIMIT,
                        help=f"Max new scripts to create today (default: {DAILY_LIMIT})")
    parser.add_argument("--delay", type=float, default=DELAY)
    args = parser.parse_args()

    files = load_gs_files()
    script_svc, drive_svc = get_services()
    all_sats = list_satellites()

    # Split into already-done and pending
    done    = [s for s in all_sats if s.get("script_id")]
    pending = [s for s in all_sats if not s.get("script_id")]

    total_sats   = len(all_sats)
    already_done = len(done)
    remaining    = len(pending)
    today_limit  = min(args.limit, remaining)
    days_left    = max(0, (remaining - today_limit + args.limit - 1) // args.limit)

    print(f"\n{'='*55}")
    print(f"  SATELLITE DEPLOY — BATCH MODE")
    print(f"{'='*55}")
    print(f"  Total satellites:  {total_sats}")
    print(f"  Already deployed:  {already_done}")
    print(f"  Still pending:     {remaining}")
    print(f"  Deploying today:   {today_limit}")
    print(f"  Days remaining:    {days_left} after today")
    print(f"{'='*55}\n")

    if remaining == 0:
        print("✅ All satellites already deployed!")
        return

    created = 0
    updated = 0
    errors  = 0
    today_batch = pending[:today_limit]

    for i, sat in enumerate(today_batch):
        label = f"{sat.get('league','?')} {sat.get('date','?')}"
        status, err = deploy_one(script_svc, drive_svc, sat, files)

        if status == "quota":
            print(f"\n⏸  QUOTA HIT after {created} creates today.")
            print(f"   Run again tomorrow. Progress saved in registry.json.")
            break
        elif status == "created":
            created += 1
            logger.info(f"[{i+1}/{today_limit}] ✅ CREATED+DEPLOYED — {label}")
        elif status == "updated":
            updated += 1
            logger.info(f"[{i+1}/{today_limit}] ✅ UPDATED — {label}")
        elif status == "error":
            errors += 1
            logger.warning(f"[{i+1}/{today_limit}] ❌ ERROR — {label}: {err}")

        if i < today_limit - 1:
            time.sleep(args.delay)

    # Also update any already-deployed satellites (free — no create quota)
    if done:
        logger.info(f"\nUpdating {len(done)} already-deployed satellites...")
        for i, sat in enumerate(done):
            status, err = deploy_one(script_svc, drive_svc, sat, files)
            if status == "updated":
                updated += 1
            elif status == "error":
                logger.warning(f"Update error {sat.get('league','?')}: {err}")
            if i < len(done) - 1:
                time.sleep(1.5)   # faster delay for updates (no create)

    print(f"\n{'='*55}")
    print(f"  TODAY'S RESULTS")
    print(f"{'='*55}")
    print(f"  ✅ Created + deployed: {created}")
    print(f"  ✅ Updated (existing): {updated}")
    print(f"  ❌ Errors:             {errors}")
    remaining_after = remaining - created
    days_after = max(0, (remaining_after + args.limit - 1) // args.limit)
    print(f"  📅 Still pending:      {remaining_after}")
    if days_after > 0:
        print(f"  📅 Run again tomorrow — {days_after} day(s) to go")
    else:
        print(f"  🎉 ALL DONE!")
    print(f"{'='*55}")


if __name__ == "__main__":
    main()
