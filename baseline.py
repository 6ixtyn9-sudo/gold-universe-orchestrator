import sys
import logging
import gspread
from auth.google_auth import get_credentials

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    try:
        creds = get_credentials(11)
        client = gspread.authorize(creds)
        sheet_id = '14xjFm3DU5M5J9uv08xHiIHPhKGpzta-w--zx6_cJ6X8'
        sh = client.open_by_key(sheet_id)
        
        # Count Bet_Slips rows
        worksheet = sh.worksheet("Bet_Slips")
        data = worksheet.get_all_values()
        
        count = sum(1 for row in data if any(row) and not str(row[0]).startswith("=== "))
        logger.info(f"Total rows in Bet_Slips: {len(data)}")
        logger.info(f"Non-empty rows in Bet_Slips (approx): {count}")
        
    except Exception as e:
        logger.error(f"Failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
