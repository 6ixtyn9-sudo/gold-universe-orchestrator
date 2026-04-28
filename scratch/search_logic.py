
import logging
from fetcher.script_api_client import ScriptApiClient

logging.basicConfig(level=logging.INFO)

def search_logic_projects():
    client = ScriptApiClient()
    try:
        query = "name contains 'Ma Golide Satellite Logic' and mimeType = 'application/vnd.google-apps.script'"
        results = client.drive_service.files().list(q=query, fields="files(id, name, createdTime, modifiedTime, parents)").execute()
        files = results.get("files", [])
        print(f"Found {len(files)} projects:")
        for f in files:
            print(f"- {f['name']} (ID: {f['id']}) | Created: {f['createdTime']} | Modified: {f['modifiedTime']} | Parents: {f.get('parents')}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    search_logic_projects()
