#!/usr/bin/env python3
"""
scripts/auth_single_slot.py
--------------------------
Authorizes ONE OAuth slot with the required scopes for the Supabase Bridge.
Usage: python3 scripts/auth_single_slot.py <slot_idx>
"""

import sys
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow

REPO_ROOT = Path(__file__).resolve().parent.parent
CREDS_DIR = REPO_ROOT / "creds"

SCOPES = [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.scriptapp"
]

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/auth_single_slot.py <slot_idx>")
        sys.exit(1)

    slot_idx = sys.argv[1]
    
    # Check for credentials file
    cred_file = REPO_ROOT / f"credentials_{slot_idx}.json"
    if not cred_file.exists():
        # Try generic credentials.json if slot is 0
        if slot_idx == "0":
            cred_file = REPO_ROOT / "credentials.json"
        
    if not cred_file.exists():
        print(f"❌ Credentials file not found: {cred_file.name}")
        sys.exit(1)

    token_file = CREDS_DIR / f"token_{slot_idx}.json"
    if slot_idx == "0":
        token_file = REPO_ROOT / "token.json"

    print(f"--- Authorizing Slot {slot_idx} ---")
    print(f"Using {cred_file.name}")
    
    flow = InstalledAppFlow.from_client_secrets_file(str(cred_file), SCOPES)
    creds = flow.run_local_server(port=0)
    
    CREDS_DIR.mkdir(exist_ok=True)
    with open(token_file, "w") as f:
        f.write(creds.to_json())
    
    print(f"✅ Saved: {token_file.name}")

if __name__ == "__main__":
    main()
