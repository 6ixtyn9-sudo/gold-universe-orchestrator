
import logging
import os
import sys
from pathlib import Path

# Add repo root to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from fetcher.script_api_client import ScriptApiClient

logging.basicConfig(level=logging.INFO)

def find_all_scripts_for_sheet(spreadsheet_id):
    client = ScriptApiClient()
    # Search Drive for files with the spreadsheet as parent
    query = f"'{spreadsheet_id}' in parents and mimeType = 'application/vnd.google-apps.script'"
    try:
        results = client.drive_service.files().list(q=query, fields="files(id, name, createdTime, modifiedTime)").execute()
        files = results.get("files", [])
        print(f"Found {len(files)} scripts bound to sheet {spreadsheet_id}:")
        for f in files:
            print(f"- {f['name']} (ID: {f['id']}) | Created: {f['createdTime']} | Modified: {f['modifiedTime']}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # The sheet ID from the screenshot's tab (Finland Korisliiga (KLF) J14)
    SHEET_ID = "1lB9TR-o5-Dn_dX532OFaSTgN_9dI85gRcx6JfJGB8ks"
    find_all_scripts_for_sheet(SHEET_ID)
