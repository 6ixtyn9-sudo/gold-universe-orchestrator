import os, json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/script.projects", "https://www.googleapis.com/auth/drive"]

def test_all():
    for i in [11, 12, 13, 14]:
        f = f"credentials_{i}.json"
        if not os.path.exists(f): continue
        
        print(f"--- Testing {f} ---")
        try:
            creds = service_account.Credentials.from_service_account_file(f, scopes=SCOPES)
            service = build('script', 'v1', credentials=creds, cache_discovery=False)
            body = {'title': f'Test {f}'}
            service.projects().create(body=body).execute()
            print(f"✅ SUCCESS for {f}")
        except HttpError as e:
            try:
                msg = json.loads(e.content).get("error", {}).get("message", str(e))
                print(f"❌ FAILURE for {f}: {msg}")
            except:
                print(f"❌ FAILURE for {f}: {e}")
        except Exception as e:
            print(f"⚠️ ERROR for {f}: {e}")

if __name__ == "__main__":
    test_all()
