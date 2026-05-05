
import json, os
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from pathlib import Path

def check_tokens():
    repo_root = Path('.')
    creds_dir = repo_root / 'creds'
    working = []
    
    for i in range(11):
        token_path = creds_dir / f'token_{i}.json'
        if not token_path.exists(): continue
        
        try:
            creds = Credentials.from_authorized_user_file(str(token_path))
            script = build('script', 'v1', credentials=creds, cache_discovery=False)
            proj = script.projects().create(body={"title": f"Test {i}"}).execute()
            working.append(i)
            print(f"✅ Token {i} is WORKING")
        except Exception as e:
            err = str(e)
            if "429" in err:
                print(f"❌ Token {i} hit QUOTA (429)")
            elif "deleted_client" in err:
                print(f"❌ Token {i} DELETED")
            else:
                print(f"❌ Token {i} FAILED: {err[:50]}")
                
    print(f"\nWorking tokens: {working}")

if __name__ == '__main__':
    check_tokens()
