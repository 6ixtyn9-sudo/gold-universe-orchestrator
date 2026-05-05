import os
import json
from pathlib import Path
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

CREDS_DIR = Path("creds")

def check_tokens():
    if not CREDS_DIR.exists():
        print("❌ creds directory not found")
        return

    tokens = sorted(CREDS_DIR.glob("token_*.json"))
    if not tokens:
        print("❌ No token files found in creds/")
        return

    for token_file in tokens:
        print(f"Checking {token_file.name}...", end=" ", flush=True)
        try:
            creds = Credentials.from_authorized_user_file(str(token_file))
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
            
            # Try a simple API call
            service = build("drive", "v3", credentials=creds, cache_discovery=False)
            service.about().get(fields="user").execute()
            print("✅ VALID")
        except Exception as e:
            err = str(e)
            if "deleted_client" in err:
                print("❌ DELETED CLIENT")
            elif "invalid_grant" in err:
                print("❌ INVALID GRANT")
            else:
                print(f"❌ ERROR: {err[:50]}")

if __name__ == "__main__":
    check_tokens()
