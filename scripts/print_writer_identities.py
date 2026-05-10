import os
import json
import logging
from pathlib import Path
from fetcher.script_api_client import ScriptApiClient
from auth.google_auth import get_credentials_from_file, SCOPES

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

def main():
    pool_file = Path("scripts/script_creds_pool.txt")
    if not pool_file.exists():
        logger.error(f"{pool_file} not found")
        return

    with open(pool_file, "r") as f:
        paths = [line.strip() for line in f if line.strip()]

    token_cache_dir = "artifacts/token-cache"

    for path in paths:
        if not Path(path).exists():
            logger.error(f"{path} NOT_FOUND")
            continue
            
        try:
            creds = get_credentials_from_file(path, token_cache_dir, False, SCOPES)
            client = ScriptApiClient(credentials=creds)
            try:
                about = client.drive_service.about().get(fields="user(emailAddress)").execute()
                email = about.get("user", {}).get("emailAddress", "unknown")
                logger.info(f"{path} - {email} - OK")
            except Exception as e:
                logger.info(f"{path} - unknown - ERROR: {e}")
        except Exception as e:
            if "interactive_oauth is false" in str(e).lower():
                logger.info(f"{path} - NOT_AUTHED")
            else:
                logger.info(f"{path} - ERROR: {e}")

if __name__ == "__main__":
    main()
