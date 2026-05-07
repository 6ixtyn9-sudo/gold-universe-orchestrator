import os, json
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SA_PATH = "credentials_11.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

def test_write_access():
    creds = service_account.Credentials.from_service_account_file(SA_PATH, scopes=SCOPES)
    service = build('sheets', 'v4', credentials=creds, cache_discovery=False)
    
    with open("registry/registry.json") as f:
        reg_data = json.load(f)
        satellites = reg_data.get("satellites", [])
        plw = next((s for s in satellites if "Poland Energa" in s.get("name", "")), None)
        if not plw:
            print("PLW not found in registry")
            return
        plw_id = plw["id"]

    print(f"Testing write access to {plw_id}...")
    try:
        # Check if sheet exists first
        res = service.spreadsheets().get(spreadsheetId=plw_id).execute()
        sheet_name = res["sheets"][0]["properties"]["title"]
        
        body = {'values': [['SA_WRITE_TEST', 'SUCCESS']]}
        service.spreadsheets().values().update(
            spreadsheetId=plw_id, range=f"'{sheet_name}'!A1:B1",
            valueInputOption="RAW", body=body).execute()
        print(f"✅ SUCCESS: Service Account can write to '{sheet_name}' on {plw_id}")
    except HttpError as e:
        msg = str(e)
        try:
            msg = json.loads(e.content).get("error", {}).get("message", str(e))
        except: pass
        print(f"❌ FAILURE: {msg}")

if __name__ == "__main__":
    test_write_access()
