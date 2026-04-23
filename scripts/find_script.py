
import os
import json
import sys
from googleapiclient.discovery import build
from google.oauth2 import service_account

# Add repo root to sys.path
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

def test_find_script():
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/script.projects"
    ]
    
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        path = os.path.join(REPO_ROOT, "service_account.json")
        if os.path.exists(path):
            with open(path, "r") as f:
                raw = f.read()
    
    if not raw:
        print("No credentials found")
        return

    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(info, scopes=scopes)
    
    drive = build("drive", "v3", credentials=creds)
    
    # Test with the first satellite in registry
    spreadsheet_id = "1DOw4qQDremLTFzD9wpztXTPeZYkF4iB1VaZV2u2XNjk"
    
    # Method 1: Search for bound script
    # Note: Bound scripts are often not returned in 'parents' query for service accounts 
    # unless they were created by the service account or shared explicitly.
    query = f"name contains 'Ma Golide' and mimeType = 'application/vnd.google-apps.script'"
    print(f"Searching for scripts with 'Ma Golide' in name...")
    results = drive.files().list(q=query, fields="files(id, name)").execute()
    files = results.get('files', [])
    
    if not files:
        print("No scripts found.")
    else:
        for f in files:
            print(f"Found script: {f['name']} ({f['id']})")

if __name__ == "__main__":
    test_find_script()
