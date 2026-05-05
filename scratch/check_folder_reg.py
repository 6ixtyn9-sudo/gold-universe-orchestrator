
import json
from pathlib import Path
from auth.google_auth import get_credentials
from googleapiclient.discovery import build

def check_folder_registry(folder_id):
    creds = get_credentials(11)
    drive = build('drive', 'v3', credentials=creds, cache_discovery=False)
    
    # List sheets in folder
    results = drive.files().list(
        q=f"'{folder_id}' in parents and mimeType='application/vnd.google-apps.spreadsheet'",
        pageSize=1000, fields="files(id, name)"
    ).execute()
    folder_sheets = results.get('files', [])
    
    # Load registry
    reg_path = Path('registry/registry.json')
    reg = json.loads(reg_path.read_text(encoding='utf-8'))
    satellites = reg.get('satellites', [])
    id_map = {s['id']: s for s in satellites}
    
    # Compare
    count_in_reg = 0
    count_with_script = 0
    for s in folder_sheets:
        if s['id'] in id_map:
            count_in_reg += 1
            if id_map[s['id']].get('script_id'):
                count_with_script += 1
                
    print(f"Sheets in folder: {len(folder_sheets)}")
    print(f"Sheets in registry: {count_in_reg}")
    print(f"Sheets with script_id: {count_with_script}")

if __name__ == '__main__':
    FOLDER_ID = '1fZYPWLG1OKTnML0Yil82y4cAI-ioli0K'
    check_folder_registry(FOLDER_ID)
