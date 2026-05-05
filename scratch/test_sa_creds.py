
import json
from google.oauth2 import service_account
from googleapiclient.discovery import build

def test_sa(creds_path, folder_id):
    try:
        creds = service_account.Credentials.from_service_account_file(
            creds_path, 
            scopes=['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/spreadsheets']
        )
        service = build('drive', 'v3', credentials=creds)
        
        print(f"Testing {creds_path}...")
        results = service.files().list(
            q=f"'{folder_id}' in parents and mimeType='application/vnd.google-apps.spreadsheet'",
            pageSize=10, fields="nextPageToken, files(id, name)"
        ).execute()
        items = results.get('files', [])
        
        if not items:
            print('No files found.')
        else:
            print('Files found:')
            for item in items:
                print(f"{item['name']} ({item['id']})")
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False

if __name__ == '__main__':
    FOLDER_ID = '1fZYPWLG1OKTnML0Yil82y4cAI-ioli0K'
    for i in range(11, 15):
        test_sa(f'credentials_{i}.json', FOLDER_ID)
