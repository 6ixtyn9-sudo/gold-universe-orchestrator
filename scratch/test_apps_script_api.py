import os, json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SA_PATH = "credentials_11.json"
# We need the script.projects scope to create/update scripts
SCOPES = ["https://www.googleapis.com/auth/script.projects", "https://www.googleapis.com/auth/drive"]

def test_apps_script_api():
    if not os.path.exists(SA_PATH):
        print(f"ERROR: {SA_PATH} not found")
        return
    
    try:
        creds = service_account.Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
        service = build('script', 'v1', credentials=creds, cache_discovery=False)
        
        print(f"Attempting to create a test Apps Script project using {SA_PATH}...")
        body = {
            'title': 'Antigravity Test Project',
        }
        request = service.projects().create(body=body)
        response = request.execute()
        
        print(f"✅ SUCCESS! Created project with ID: {response.get('scriptId')}")
        # Clean up
        drive_service = build('drive', 'v3', credentials=creds, cache_discovery=False)
        drive_service.files().delete(fileId=response.get('scriptId')).execute()
        print("✅ Cleaned up test project.")
        
    except HttpError as e:
        msg = str(e)
        try:
            error_data = json.loads(e.content).get("error", {})
            msg = error_data.get("message", str(e))
            status = error_data.get("status", "")
            print(f"❌ FAILURE: {status} - {msg}")
        except:
            print(f"❌ FAILURE: {e}")
    except Exception as e:
        print(f"⚠️ UNEXPECTED ERROR: {e}")

if __name__ == "__main__":
    test_apps_script_api()
