"""
populate_registry_from_folder.py
─────────────────────────────────────────────────────────────────────────────
Builds registry/registry.json from the satellite Google Drive folder.

Credential resolution order (first found wins):
  1. GOOGLE_SERVICE_ACCOUNT_JSON  — raw JSON string in env var
  2. GOOGLE_SERVICE_ACCOUNT_JSON_B64 — base64-encoded JSON in env var
  3. service_account.json         — local file (dev fallback)

Folder ID resolution:
  - SATELLITES_FOLDER_ID env var (URL or raw ID accepted)
  - Default: 1fZYPWLG1OKTnML0Yil82y4cAI-ioli0K
─────────────────────────────────────────────────────────────────────────────
"""

import os
import json
import base64
import tempfile
from datetime import datetime, timezone

import gspread
from google.oauth2 import service_account

# ── Credential resolution ──────────────────────────────────────────────────

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

creds = None
cred_source = None

# 1. Raw JSON env var
raw_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
if raw_json:
    try:
        sa_info = json.loads(raw_json)
        creds = service_account.Credentials.from_service_account_info(sa_info, scopes=SCOPES)
        cred_source = "GOOGLE_SERVICE_ACCOUNT_JSON (env var)"
    except Exception as e:
        raise SystemExit(f"❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: {e}")

# 2. Base64-encoded JSON env var
if creds is None:
    b64_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON_B64", "").strip()
    if b64_json:
        try:
            decoded = base64.b64decode(b64_json).decode("utf-8")
            sa_info = json.loads(decoded)
            creds = service_account.Credentials.from_service_account_info(sa_info, scopes=SCOPES)
            cred_source = "GOOGLE_SERVICE_ACCOUNT_JSON_B64 (env var)"
        except Exception as e:
            raise SystemExit(f"❌ Failed to decode GOOGLE_SERVICE_ACCOUNT_JSON_B64: {e}")

# 3. Local service_account.json fallback
if creds is None:
    local_path = "service_account.json"
    if os.path.isfile(local_path):
        try:
            creds = service_account.Credentials.from_service_account_file(local_path, scopes=SCOPES)
            cred_source = f"local file: {local_path}"
        except Exception as e:
            raise SystemExit(f"❌ Failed to load {local_path}: {e}")

if creds is None:
    raise SystemExit(
        "❌ No credentials found. Set GOOGLE_SERVICE_ACCOUNT_JSON (or _B64) "
        "as a GitHub secret, or provide a local service_account.json."
    )

print(f"✅ Credentials loaded from: {cred_source}")

# ── Folder ID resolution ───────────────────────────────────────────────────

DEFAULT_FOLDER_ID = "1fZYPWLG1OKTnML0Yil82y4cAI-ioli0K"

folder_id = os.getenv("SATELLITES_FOLDER_ID", "").strip()

# Accept full Drive URL or raw ID
if "/folders/" in folder_id:
    folder_id = folder_id.split("/folders/", 1)[1]
if "?" in folder_id:
    folder_id = folder_id.split("?", 1)[0]

if not folder_id:
    folder_id = DEFAULT_FOLDER_ID
    print(f"ℹ️  SATELLITES_FOLDER_ID not set — using default: {folder_id}")
else:
    print(f"📁 Using folder ID from env: {folder_id}")

# ── List satellites from Drive ─────────────────────────────────────────────

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

# ── Validate uniqueness ────────────────────────────────────────────────────

ids = [s["id"] for s in satellites if s.get("id")]
if len(ids) != len(set(ids)):
    raise SystemExit("❌ Duplicate spreadsheet IDs found — aborting.")
print("✅ All spreadsheet IDs unique")

# ── Write registry.json ────────────────────────────────────────────────────

registry = {
    "last_updated": datetime.now(timezone.utc).isoformat(),
    "source": {
        "type": "google_drive_folder",
        "folder_id": folder_id,
        "count_found": len(satellites),
    },
    "satellites": satellites,
}

os.makedirs("registry", exist_ok=True)
out_path = "registry/registry.json"
with open(out_path, "w", encoding="utf-8") as fp:
    json.dump(registry, fp, indent=2, ensure_ascii=False)

print(f"✅ Wrote {out_path}")
print(f"   Satellites: {len(satellites)}")
