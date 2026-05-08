import os
import json
import glob
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

def map_tokens_to_sheets():
    print("--- MAPPING TOKENS TO SHEET IDS (1 API CALL PER TOKEN) ---")
    
    # We will build a mapping of sheet_id -> token_file
    sheet_to_token = {}
    
    token_files = glob.glob("creds/token_*.json")
    print(f"Found {len(token_files)} token files. This will only take {len(token_files)} API calls.")
    
    for token_file in token_files:
        try:
            # Load credentials
            creds = Credentials.from_authorized_user_file(token_file)
            drive_service = build('drive', 'v3', credentials=creds)
            
            # Query all spreadsheets owned by this token
            # We can paginate if they own more than 1000, but let's just get the first page for a quick probe
            results = drive_service.files().list(
                q="mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners",
                pageSize=1000,
                fields="files(id, name)"
            ).execute()
            
            files = results.get('files', [])
            print(f"{token_file}: Found {len(files)} owned spreadsheets.")
            
            for f in files:
                sheet_to_token[f['id']] = token_file
                
        except Exception as e:
            print(f"Error checking {token_file}: {e}")

    # Now let's see how many of our 451 stragglers we successfully mapped!
    try:
        with open("stragglers_list.json", "r") as f:
            stragglers = json.load(f)
            
        mapped_count = 0
        unmapped = []
        for s in stragglers:
            if s in sheet_to_token:
                mapped_count += 1
            else:
                unmapped.append(s)
                
        print(f"\n--- MAPPING RESULTS ---")
        print(f"Total Stragglers: {len(stragglers)}")
        print(f"Successfully Mapped to a Token: {mapped_count}")
        print(f"Unmapped: {len(unmapped)}")
        
        if mapped_count > 0:
            print("\nThis means we can perfectly route scripts.run using the exact correct token!")
            
    except Exception as e:
        print(f"Error checking stragglers_list.json: {e}")

if __name__ == "__main__":
    map_tokens_to_sheets()
