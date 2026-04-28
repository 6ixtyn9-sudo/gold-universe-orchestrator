
import logging
from fetcher.script_api_client import ScriptApiClient

logging.basicConfig(level=logging.INFO)

def list_all_apps_scripts():
    client = ScriptApiClient()
    try:
        query = "mimeType = 'application/vnd.google-apps.script'"
        results = client.drive_service.files().list(q=query, fields="files(id, name, createdTime, modifiedTime, parents)", pageSize=100).execute()
        files = results.get("files", [])
        print(f"Found {len(files)} Apps Script files:")
        for f in files:
            print(f"- {f['name']} (ID: {f['id']}) | Created: {f['createdTime']} | Modified: {f['modifiedTime']} | Parents: {f.get('parents')}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_all_apps_scripts()
