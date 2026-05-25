import os
import sys
from auth.google_auth import get_service_account_credentials
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    root = "/Users/apple/Desktop/gold-universe-orchestrator"
    paths = [
        "service_account.json",
        "token.json",
        "credentials.json",
        "creds/token_0.json",
        "creds/token_11.json"
    ]
    for p in paths:
        if os.path.exists(os.path.join(root, p)):
            logger.info(f"Found {p}")
            
if __name__ == "__main__":
    main()
