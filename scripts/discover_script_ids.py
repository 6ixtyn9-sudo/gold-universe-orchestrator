import sys, time, logging
from pathlib import Path
from datetime import datetime

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fetcher.script_api_client import ScriptApiClient
from registry.satellite_registry import list_satellites, update_satellite

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("discover")

def fetch_all_script_files(drive_service):
    logger.info("Fetching all Apps Script files from Drive...")
    query  = "mimeType='application/vnd.google-apps.script'"
    fields = "nextPageToken, files(id, name, parents)"
    script_map, page_token, page_num, total = {}, None, 0, 0
    while True:
        page_num += 1
        params = {"q": query, "fields": fields, "pageSize": 1000}
        if page_token:
            params["pageToken"] = page_token
        result    = drive_service.files().list(**params).execute()
        files     = result.get("files", [])
        total    += len(files)
        logger.info(f"  Page {page_num}: {len(files)} scripts (total: {total})")
        for f in files:
            for parent_id in f.get("parents", []):
                script_map[parent_id] = f["id"]
        page_token = result.get("nextPageToken")
        if not page_token:
            break
        time.sleep(0.5)
    logger.info(f"Done: {total} scripts → {len(script_map)} unique parents")
    return script_map

def main():
    start  = datetime.now()
    client = ScriptApiClient()
    script_map = fetch_all_script_files(client.drive_service)
    sats = list_satellites()
    matched, already, not_found = 0, 0, 0
    for sat in sats:
        sheet_id  = sat.get("sheet_id", "")
        if sat.get("script_id"):
            already += 1
            continue
        if sheet_id in script_map:
            update_satellite(sat["id"], script_id=script_map[sheet_id])
            matched += 1
        else:
            not_found += 1
    elapsed = (datetime.now() - start).total_seconds()
    print(f"\n{'='*50}")
    print(f"  Newly matched:  {matched}")
    print(f"  Already cached: {already}")
    print(f"  Not found:      {not_found}")
    print(f"  Time:           {elapsed:.1f}s")
    print(f"{'='*50}")
    print("\nNow run: python3 scripts/deploy_gs_to_satellites.py")

if __name__ == "__main__":
    main()
