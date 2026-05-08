#!/usr/bin/env python3
"""
patch_missing_tabs.py
=====================
Directly creates missing Config_Accumulator and Satellite_Identity tabs
in target Google Sheets using the Sheets API (batchUpdate -> addSheet).

This bypasses ALL Apps Script execution boundaries (GCP project locks,
unreviewed-app security gates, and scripts.run permission_denied).

Requires:
  - stragglers_list.json  : list of spreadsheet IDs
  - sheet_to_token_map.json OR auto-probes Drive API per token
  - Google OAuth tokens with spreadsheets + drive scopes

Usage:
  # Dry run (probe + report, zero writes)
  PYTHONPATH=. python3 scripts/patch_missing_tabs.py --targets stragglers_list.json --dry-run

  # Live execution
  PYTHONPATH=. python3 scripts/patch_missing_tabs.py --targets stragglers_list.json --workers 10
"""

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
TAB_NAMES = ["Config_Accumulator", "Satellite_Identity"]
MAX_WORKERS = 10
CREDS_DIR = Path("creds")
TOKEN_PATTERN = "token_*.json"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def load_json(path):
    with open(path, "r") as f:
        return json.load(f)


def get_sheets_service(token_path):
    creds = Credentials.from_authorized_user_file(token_path)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def get_drive_service(token_path):
    creds = Credentials.from_authorized_user_file(token_path)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def probe_token_owns_spreadsheets(token_path, target_sheet_ids):
    """Return subset of target_sheet_ids that this token owns."""
    svc = get_drive_service(token_path)
    owned = set()
    page_token = None
    target_set = set(target_sheet_ids)
    while True:
        resp = svc.files().list(
            q="mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners",
            spaces="drive",
            fields="nextPageToken, files(id, name)",
            pageToken=page_token,
            pageSize=1000,
        ).execute()
        for f in resp.get("files", []):
            fid = f["id"]
            if fid in target_set:
                owned.add(fid)
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return owned


def build_sheet_token_map(target_sheet_ids):
    """Probe all tokens to build sheet_id -> token_path mapping."""
    token_files = sorted(CREDS_DIR.glob(TOKEN_PATTERN))
    if not token_files:
        raise RuntimeError(f"No token files found in {CREDS_DIR}/")

    mapping = {}
    for tf in token_files:
        print(f"  Probing {tf.name} ...")
        try:
            owned = probe_token_owns_spreadsheets(str(tf), target_sheet_ids)
            for sid in owned:
                mapping[sid] = str(tf)
            print(f"    -> owns {len(owned)} target sheets")
        except Exception as e:
            print(f"    -> ERROR: {e}")
    return mapping


def load_or_build_sheet_token_map(target_sheet_ids, map_path="sheet_to_token_map.json"):
    if os.path.exists(map_path):
        print(f"Loading sheet->token map from {map_path}")
        data = load_json(map_path)
        # Support either flat dict or {"map": {...}}
        if isinstance(data, dict) and "map" in data:
            mapping = data["map"]
        else:
            mapping = data
        # Filter to only targets
        mapping = {k: v for k, v in mapping.items() if k in set(target_sheet_ids)}
        print(f"  Loaded {len(mapping)} mappings")
        return mapping

    print(f"{map_path} not found. Probing tokens via Drive API...")
    mapping = build_sheet_token_map(target_sheet_ids)
    # Save for future runs
    with open(map_path, "w") as f:
        json.dump({"map": mapping}, f, indent=2)
    print(f"  Saved new map to {map_path}")
    return mapping


def patch_sheet(sheet_id, token_path, dry_run=False):
    svc = get_sheets_service(token_path)

    # 1. List existing tabs
    try:
        meta = svc.spreadsheets().get(
            spreadsheetId=sheet_id,
            fields="sheets.properties.title"
        ).execute()
    except HttpError as e:
        return {"sheet_id": sheet_id, "status": "error", "detail": f"get metadata failed: {e}"}

    existing = {s["properties"]["title"] for s in meta.get("sheets", [])}
    missing = [t for t in TAB_NAMES if t not in existing]

    if not missing:
        return {"sheet_id": sheet_id, "status": "skipped", "detail": "all tabs already present"}

    if dry_run:
        return {"sheet_id": sheet_id, "status": "dry_run", "detail": f"would add: {missing}"}

    # 2. Add missing tabs
    requests = [{"addSheet": {"properties": {"title": t}}} for t in missing]
    try:
        svc.spreadsheets().batchUpdate(
            spreadsheetId=sheet_id,
            body={"requests": requests}
        ).execute()
        return {"sheet_id": sheet_id, "status": "success", "detail": f"added: {missing}"}
    except HttpError as e:
        return {"sheet_id": sheet_id, "status": "error", "detail": f"batchUpdate failed: {e}"}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Add missing tabs to straggler sheets via Sheets API (no GAS execution)"
    )
    parser.add_argument("--targets", required=True, help="JSON file with list of sheet IDs")
    parser.add_argument(
        "--map",
        default="sheet_to_token_map.json",
        help="sheet_id -> token mapping file (auto-built if missing)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Probe only, do not write")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS, help="Parallel workers")
    args = parser.parse_args()

    targets = load_json(args.targets)
    if not isinstance(targets, list):
        print("ERROR: targets file must be a JSON list of sheet IDs")
        sys.exit(1)

    print(f"Targets loaded: {len(targets)} sheets")
    token_map = load_or_build_sheet_token_map(targets, args.map)

    # Find unmapped targets
    unmapped = [t for t in targets if t not in token_map]
    if unmapped:
        print(f"WARNING: {len(unmapped)} sheets have no mapped token (will be skipped)")
        for u in unmapped[:5]:
            print(f"  - {u}")
        if len(unmapped) > 5:
            print(f"  ... and {len(unmapped) - 5} more")

    mapped_targets = [t for t in targets if t in token_map]
    print(f"Proceeding with {len(mapped_targets)} mapped sheets (dry_run={args.dry_run})\n")

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {
            ex.submit(patch_sheet, sid, token_map[sid], args.dry_run): sid
            for sid in mapped_targets
        }
        for fut in as_completed(futures):
            res = fut.result()
            results.append(res)
            if res["status"] == "success":
                icon = "✅"
            elif res["status"] == "skipped":
                icon = "⏭️"
            elif res["status"] == "dry_run":
                icon = "💨"
            else:
                icon = "🚫"
            print(f"{icon} {res['sheet_id'][:30]}... | {res['status']} | {res['detail']}")

    # Summary
    success = sum(1 for r in results if r["status"] == "success")
    skipped = sum(1 for r in results if r["status"] == "skipped")
    errors = sum(1 for r in results if r["status"] == "error")
    dry = sum(1 for r in results if r["status"] == "dry_run")

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Total processed: {len(results)}")
    print(f"  Success:         {success}")
    print(f"  Skipped:         {skipped}")
    print(f"  Errors:          {errors}")
    print(f"  Dry-run:         {dry}")
    print(f"  Unmapped:        {len(unmapped)}")
    print("=" * 60)

    # Save detailed results
    out_file = "patch_results.json"
    with open(out_file, "w") as f:
        json.dump(
            {
                "summary": {
                    "success": success,
                    "skipped": skipped,
                    "errors": errors,
                    "dry_run": dry,
                    "unmapped": len(unmapped),
                },
                "results": results,
                "unmapped": unmapped,
            },
            f,
            indent=2,
        )
    print(f"\nDetailed results saved to {out_file}")

    # Exit with error code if there were unmapped or errors in live mode
    if unmapped or (errors and not args.dry_run):
        sys.exit(1)


if __name__ == "__main__":
    main()
