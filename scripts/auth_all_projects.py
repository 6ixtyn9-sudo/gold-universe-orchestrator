"""
scripts/auth_all_projects.py
══════════════════════════════════════════════════════════════════════════
Automates the OAuth flow for multiple Google Cloud projects.
Expects credentials_1.json through credentials_9.json in the repo root.
Saves token_1.json through token_9.json in the creds/ folder.
"""

import os, sys
from pathlib import Path
from google_auth_oauthlib.flow import InstalledAppFlow

REPO_ROOT = Path(__file__).resolve().parent.parent
CREDS_DIR = REPO_ROOT / "creds"

SCOPES = [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets"
]

def auth_slot(slot_idx: int):
    client_secret = REPO_ROOT / f"credentials_{slot_idx}.json"
    token_file    = CREDS_DIR / f"token_{slot_idx}.json"

    if not client_secret.exists():
        print(f"Skipping slot {slot_idx}: {client_secret.name} not found.")
        return

    if token_file.exists():
        print(f"Skipping slot {slot_idx}: {token_file.name} already exists.")
        return

    print(f"\n--- Authorizing Slot {slot_idx} ---")
    print(f"Using {client_secret.name}")
    
    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret), SCOPES)
    creds = flow.run_local_server(port=0)
    
    CREDS_DIR.mkdir(exist_ok=True)
    with open(token_file, "w") as f:
        f.write(creds.to_json())
    
    print(f"✅ Saved: {token_file.name}")

def main():
    print("MA GOLIDE — MULTI-PROJECT AUTH")
    print("==============================")
    
    # We assume token_0 is already done (personal_token.json)
    # But we can re-run it if credentials.json exists
    for i in range(1, 11):
        auth_slot(i)
    
    print("\nAll slots processed. Check the 'creds/' folder.")

if __name__ == "__main__":
    main()
