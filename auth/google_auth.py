import os
import json
import logging

logger = logging.getLogger(__name__)

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.projects",
]

_client_cache = None


def get_client():
    global _client_cache
    if _client_cache is not None:
        return _client_cache

    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        raise RuntimeError("gspread / google-auth not installed")

    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "service_account.json")
        if os.path.exists(path):
            with open(path, "r") as f:
                raw = f.read()
        else:
            raise RuntimeError(
                "GOOGLE_SERVICE_ACCOUNT_JSON secret is not set and service_account.json not found."
            )

    try:
        info = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Credentials data is not valid JSON: {e}")

    creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    client = gspread.authorize(creds)
    _client_cache = client
    logger.info("Google Sheets client authenticated successfully")
    return client


def reset_client():
    global _client_cache
    _client_cache = None
    logger.info("Google Sheets client cache cleared")


def is_configured():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if raw:
        try:
            json.loads(raw)
            return True
        except Exception:
            return False

    path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
    if path:
        try:
            from pathlib import Path
            return Path(path).exists()
        except Exception:
            return False

    return False


# --- New helper for Sheets API client (bundle fetcher) ---
def get_service_account_credentials(scopes):
    """Return google.oauth2.service_account.Credentials for given scopes.

    Prefers GOOGLE_SERVICE_ACCOUNT_JSON (prod). Falls back to GOOGLE_APPLICATION_CREDENTIALS (local dev).
    """
    import os, json
    from pathlib import Path
    from google.oauth2 import service_account

    raw = (os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
    if raw:
        info = json.loads(raw)
        return service_account.Credentials.from_service_account_info(info, scopes=scopes)

    path = (os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    if path and Path(path).exists():
        return service_account.Credentials.from_service_account_file(path, scopes=scopes)

    # Fallback to local service_account.json in repo root
    local_path = Path(os.path.dirname(os.path.dirname(__file__))) / "service_account.json"
    if local_path.exists():
        return service_account.Credentials.from_service_account_file(str(local_path), scopes=scopes)

    raise RuntimeError("Missing GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_APPLICATION_CREDENTIALS file)")
