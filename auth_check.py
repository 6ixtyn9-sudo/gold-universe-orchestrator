import sys
import logging
from auth.google_auth import get_service_account_credentials
import gspread

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    try:
        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive"
        ]
        creds = get_service_account_credentials(scopes=scopes)
        client = gspread.authorize(creds)
        
        sheet_id = '14xjFm3DU5M5J9uv08xHiIHPhKGpzta-w--zx6_cJ6X8'
        sh = client.open_by_key(sheet_id)
        logger.info(f"Successfully read spreadsheet: {sh.title}")
        
        # Identity
        if hasattr(creds, 'service_account_email'):
            logger.info(f"Principal identity: {creds.service_account_email}")
        elif hasattr(creds, 'client_id'):
            logger.info(f"Principal identity (client_id): {creds.client_id}")
        else:
            logger.info("Principal identity: OAuth Token or Default Creds")
            
    except Exception as e:
        logger.error(f"Auth check failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
