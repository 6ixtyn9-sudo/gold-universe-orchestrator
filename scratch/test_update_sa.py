
from auth.google_auth import get_credentials
from googleapiclient.discovery import build
import json

def test_update():
    SCRIPT_ID = "1Zh3Zux8xK4RQG02Y2u5yXS74C_ne8UizkcmJkrS7md-5qlbBqz9bTIUj"
    try:
        creds = get_credentials(11)
        service = build('script', 'v1', credentials=creds, cache_discovery=False)
        print(f'Attempting to fetch content for {SCRIPT_ID}...')
        
        content = service.projects().getContent(scriptId=SCRIPT_ID).execute()
        print(f"✅ Successfully fetched content! Found {len(content.get('files', []))} files.")
        return True
    except Exception as e:
        print(f"❌ Failed: {e}")
        return False

if __name__ == '__main__':
    test_update()
