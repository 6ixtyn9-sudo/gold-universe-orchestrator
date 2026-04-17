import os
import json
from datetime import datetime, timezone

import gspread
from google.oauth2 import service_account

folder_id = os.getenv("SATELLITES_FOLDER_ID", "").strip()
if "/folders/" in folder_id:
    folder_id = folder_id.split("/folders/", 1)[1]
if "?" in folder_id:
    folder_id = folder_id.split("?", 1)[0]
if not folder_id:
    raise SystemExit("Missing SATELLITES_FOLDER_ID")

creds = service_account.Credentials.from_service_account_file(
    "service_account.json",
    scopes=[
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
    ],
)
gc = gspread.authorize(creds)

print(f"🚀 Listing spreadsheets in folder: {folder_id}")
files = gc.list_spreadsheet_files(folder_id=folder_id)
files_sorted = sorted(files, key=lambda f: (f.get("name", ""), f.get("id", "")))

satellites = [
    {
        "id": f.get("id"),
        "name": f.get("name"),
        "drive": {k: v for k, v in f.items() if k not in {"id", "name"}},
    }
    for f in files_sorted
]

registry = {
    "last_updated": datetime.now(timezone.utc).isoformat(),
    "source": {"type": "google_drive_folder", "folder_id": folder_id, "count_found": len(satellites)},
    "satellites": satellites,
}

os.makedirs("registry", exist_ok=True)
with open("registry/registry.json", "w", encoding="utf-8") as fp:
    json.dump(registry, fp, indent=2, ensure_ascii=False)

print("✅ Wrote registry/registry.json")
print("   Satellites:", len(satellites))

ids = [s["id"] for s in satellites if s.get("id")]
if len(ids) != len(set(ids)):
    raise SystemExit("❌ Duplicate spreadsheet IDs found")
print("✅ All spreadsheet IDs unique")
