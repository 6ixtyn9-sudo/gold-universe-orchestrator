import os, json
from datetime import datetime, timezone
import gspread

folder_id = os.environ["SATELLITES_FOLDER_ID"].strip()
if "/folders/" in folder_id:
    folder_id = folder_id.split("/folders/", 1)[1]
if "?" in folder_id:
    folder_id = folder_id.split("?", 1)[0]

gc = gspread.oauth(
    scopes=[
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
    credentials_filename="credentials.json",
    authorized_user_filename="authorized_user.json",
)

files = gc.list_spreadsheet_files(folder_id=folder_id)
files = sorted(files, key=lambda f: (f.get("name",""), f.get("id","")))

out = {
    "last_updated": datetime.now(timezone.utc).isoformat(),
    "satellites": [{"id": f["id"], "name": f.get("name","")} for f in files if f.get("id")],
}

os.makedirs("registry", exist_ok=True)
with open("registry/registry.json", "w", encoding="utf-8") as fp:
    json.dump(out, fp, indent=2, ensure_ascii=False)

print("✅ Wrote registry/registry.json with", len(out["satellites"]), "satellites")
