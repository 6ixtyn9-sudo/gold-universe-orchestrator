
from auth.google_auth import get_credentials
from googleapiclient.discovery import build
import time

def test_create():
    try:
        creds = get_credentials(11)
        service = build('script', 'v1', credentials=creds, cache_discovery=False)
        print('API connected. Attempting project creation...')
        
        proj = service.projects().create(body={"title": "Antigravity Test"}).execute()
        print(f"✅ Created: {proj['scriptId']}")
        return True
    except Exception as e:
        print(f"❌ Failed: {e}")
        return False

if __name__ == '__main__':
    test_create()
