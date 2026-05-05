
import json
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

def test_token_quota(token_path):
    try:
        creds = Credentials.from_authorized_user_file(token_path)
        script = build('script', 'v1', credentials=creds, cache_discovery=False)
        
        print(f"Testing {token_path} project creation...")
        # Try to create a dummy project
        proj = script.projects().create(body={"title": "Quota Test"}).execute()
        print(f"✅ Success! Created {proj['scriptId']}")
        # Delete it to be clean
        # script.projects().delete(scriptId=proj['scriptId']).execute()
        return True
    except Exception as e:
        print(f"❌ Error for {token_path}: {e}")
        return False

if __name__ == '__main__':
    for i in range(11):
        test_token_quota(f'creds/token_{i}.json')
