import os
import json
import logging

logger = logging.getLogger(__name__)

SCOPES = [
    "https://spreadsheets.google.com/feeds",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
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
        raise RuntimeError(
            "GOOGLE_SERVICE_ACCOUNT_JSON secret is not set. "
            "Add it in Replit Secrets to enable Google Sheets access."
        )

    try:
        info = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: {e}")

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
    if not raw:
        return False
    try:
        json.loads(raw)
        return True
    except Exception:
        return False
