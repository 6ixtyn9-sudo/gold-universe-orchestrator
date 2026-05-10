
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from googleapiclient.discovery import build
from auth.google_auth import get_service_account_credentials

logger = logging.getLogger(__name__)

class ScriptApiClient:
    def __init__(self, credentials=None):
        scopes = [
            "https://www.googleapis.com/auth/script.projects",
            "https://www.googleapis.com/auth/script.deployments",
            "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/script.external_request"
        ]
        if credentials is None:
            credentials = get_service_account_credentials(scopes)
        
        self.script_service = build("script", "v1", credentials=credentials, cache_discovery=False)
        self.drive_service = build("drive", "v3", credentials=credentials, cache_discovery=False)

    def find_bound_script(self, spreadsheet_id: str) -> Optional[str]:
        """Try to find an existing script project bound to the spreadsheet."""
        # Method 1: Search Drive for files with the spreadsheet as parent
        query = f"'{spreadsheet_id}' in parents and mimeType = 'application/vnd.google-apps.script'"
        try:
            results = self.drive_service.files().list(
                q=query, 
                fields="files(id, name)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            files = results.get("files", [])
            if files:
                logger.info(f"Found bound script via Drive API: {files[0]['name']} ({files[0]['id']})")
                return files[0]["id"]
        except Exception as e:
            logger.warning(f"Drive search for bound script failed: {e}")

        # Method 2: Search Drive for files with the same name if we have a hint?
        # Not reliable.
        
        return None

    def find_all_bound_scripts(self, spreadsheet_id: str) -> List[Dict[str, str]]:
        """Find all script projects bound to the spreadsheet."""
        query = f"'{spreadsheet_id}' in parents and mimeType = 'application/vnd.google-apps.script'"
        all_files = []
        page_token = None
        try:
            while True:
                results = self.drive_service.files().list(
                    q=query, 
                    fields="nextPageToken, files(id, name, createdTime)",
                    pageToken=page_token,
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True
                ).execute()
                files = results.get("files", [])
                all_files.extend(files)
                page_token = results.get("nextPageToken")
                if not page_token:
                    break
            return all_files
        except Exception as e:
            logger.error(f"Drive search for bound scripts failed: {e}")
            raise

    def delete_project(self, script_id: str):
        """Delete a script project via Drive API."""
        try:
            self.drive_service.files().delete(fileId=script_id, supportsAllDrives=True).execute()
            logger.info(f"Deleted script project {script_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete script project {script_id}: {e}")
            return False

    def can_run_function(self, script_id: str) -> bool:
        """
        Check if we have the capability to execute Apps Script functions via API.
        Attempts a benign call (e.g. to a non-existent function) and checks if the error 
        is about permissions/disabled API vs just a missing function.
        """
        try:
            body = {"function": "benignCapabilityCheckDoNotRun", "parameters": []}
            self.script_service.scripts().run(scriptId=script_id, body=body).execute()
            return True
        except Exception as e:
            err_str = str(e).lower()
            if "api has not been used" in err_str or "oauth client was deleted" in err_str or "permission denied" in err_str:
                return False
            # If it just says function not found, execution is fundamentally enabled!
            return True

    def create_bound_script(self, spreadsheet_id: str, title: str) -> str:
        """Create a new script project bound to the spreadsheet."""
        body = {
            "title": title,
            "parentId": spreadsheet_id
        }
        try:
            project = self.script_service.projects().create(body=body).execute()
            logger.info(f"Created new bound script: {project['title']} ({project['scriptId']})")
            return project["scriptId"]
        except Exception as e:
            logger.error(f"Failed to create bound script for {spreadsheet_id}: {e}")
            raise

    def get_project_content(self, script_id: str) -> List[Dict[str, Any]]:
        """Get the current files in the script project."""
        try:
            content = self.script_service.projects().getContent(scriptId=script_id).execute()
            return content.get("files", [])
        except Exception as e:
            logger.error(f"Failed to get content for script {script_id}: {e}")
            raise

    def update_project_content(self, script_id: str, files: List[Dict[str, Any]]):
        """Update the script project with the provided files."""
        # We need a manifest (appsscript.json) if not provided
        has_manifest = any(f["name"] == "appsscript" for f in files)
        if not has_manifest:
            files.append({
                "name": "appsscript",
                "type": "JSON",
                "source": '{"timeZone":"UTC","exceptionLogging":"STACKDRIVER","runtimeVersion":"V8"}'
            })

        body = {"files": files}
        try:
            self.script_service.projects().updateContent(scriptId=script_id, body=body).execute()
            logger.info(f"Updated script project {script_id} with {len(files)} files")
        except Exception as e:
            logger.error(f"Failed to update script project {script_id}: {e}")
            raise

    def run_function(self, script_id: str, function_name: str, parameters: List[Any] = None):
        """
        Run a function in the script project.
        Note: The script must be deployed as an API Executable for this to work via the API.
        Alternatively, if using the same project as the caller, it might work.
        """
        body = {
            "function": function_name,
            "parameters": parameters or []
        }
        try:
            # We use projects().run for V1 API execution
            response = self.script_service.scripts().run(scriptId=script_id, body=body).execute()
            
            if "error" in response:
                error = response["error"]
                logger.error(f"Function {function_name} on {script_id} failed: {error}")
                return {"ok": False, "error": error}
            
            return {"ok": True, "response": response.get("response")}
        except Exception as e:
            logger.error(f"API call to run function {function_name} on {script_id} failed: {e}")
            return {"ok": False, "error": str(e)}
