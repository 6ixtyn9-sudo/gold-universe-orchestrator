
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
import json

def test_token_update():
    SCRIPT_ID = "1Zh3Zux8xK4RQG02Y2u5yXS74C_ne8UizkcmJkrS7md-5qlbBqz9bTIUj"
    try:
        creds = Credentials.from_authorized_user_file('creds/token_1.json')
        service = build('script', 'v1', credentials=creds, cache_discovery=False)
        
        # Fetch current content
        content = service.projects().getContent(scriptId=SCRIPT_ID).execute()
        files = content.get('files', [])
        
        # Try to write it back exactly as is
        print(f'Attempting to update content for {SCRIPT_ID} using token_1...')
        service.projects().updateContent(scriptId=SCRIPT_ID, body={"files": files}).execute()
        print(f"✅ Successfully updated content!")
        return True
    except Exception as e:
        print(f"❌ Failed: {e}")
        return False

if __name__ == '__main__':
    test_token_update()
