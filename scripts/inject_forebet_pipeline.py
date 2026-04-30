import os
import sys
import csv
import logging
from datetime import datetime
from pathlib import Path

# Add repo root to path
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from googleapiclient.discovery import build
from auth.google_auth import get_service_account_credentials
from fetcher.script_api_client import ScriptApiClient
from scripts.deploy_gs_to_satellites import load_local_gs_files, deploy_to_satellite

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("injector")

CSV_FILE = REPO_ROOT / "UpcomingClean_Friday.csv"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.projects"
]

def inject_pipeline():
    if not CSV_FILE.exists():
        logger.error(f"CSV file not found: {CSV_FILE}. Run forebet_scraper.py first!")
        return

    # 1. Read the scraped data
    logger.info("Reading Forebet predictions from CSV...")
    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        csv_data = list(reader)
    
    if not csv_data:
        logger.error("CSV is empty!")
        return

    # 2. Authenticate
    logger.info("Authenticating with Google Workspace...")
    creds = get_service_account_credentials(SCOPES)
    sheets_service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    
    # 3. Create the new Google Sheet (Satellite)
    today_str = datetime.now().strftime("%Y-%m-%d")
    sheet_title = f"Ma_Golide_Friday_Predictions_{today_str}"
    
    spreadsheet_body = {
        "properties": {"title": sheet_title},
        "sheets": [
            {"properties": {"title": "UpcomingClean"}}
        ]
    }
    
    logger.info(f"Creating new Satellite Google Sheet: {sheet_title}")
    spreadsheet = sheets_service.spreadsheets().create(
        body=spreadsheet_body, fields="spreadsheetId"
    ).execute()
    
    sheet_id = spreadsheet.get("spreadsheetId")
    logger.info(f"✅ Created successfully! Spreadsheet ID: {sheet_id}")

    # 4. Blast the Data into the `UpcomingClean` tab
    logger.info(f"Pushing {len(csv_data)} rows into UpcomingClean tab...")
    body = {"values": csv_data}
    sheets_service.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range="UpcomingClean!A1",
        valueInputOption="RAW",
        body=body
    ).execute()
    logger.info("✅ Data injected successfully!")

    # 5. Deploy the .gs logic to the new sheet
    logger.info("Preparing to inject .gs App Script Assayer Logic...")
    script_client = ScriptApiClient(credentials=creds)
    
    docs_dir = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
    if not docs_dir.exists():
        logger.warning(f"Could not find .gs payload at {docs_dir}. Skipping .gs deployment.")
    else:
        gs_files = load_local_gs_files(docs_dir)
        deploy_to_satellite(script_client, sheet_id, gs_files, dry_run=False)
        logger.info("✅ .gs Logic deployed natively to the Satellite!")

    # 6. Next Steps for Mothership
    print("\n" + "="*60)
    print("🚀 PIPELINE INJECTION COMPLETE 🚀")
    print("="*60)
    print(f"URL: https://docs.google.com/spreadsheets/d/{sheet_id}")
    print("\nThe Sheet has been created, data populated, and .gs logic deployed!")
    print(f"ADD THIS ID TO YOUR SATELLITE REGISTRY SO THE MOTHERSHIP CAN ASSAY IT:")
    print(f"{sheet_id}")
    print("="*60)

if __name__ == "__main__":
    inject_pipeline()
