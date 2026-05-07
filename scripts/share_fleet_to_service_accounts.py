import os
import json
import time
import argparse
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import supabase
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

SERVICE_ACCOUNT_EMAILS = [
    "ma-golide-orchestrator@gen-lang-client-0003846580.iam.gserviceaccount.com",
    "ma-golide-deploy@account-1-495208.iam.gserviceaccount.com",
    "ma-golide-deploy@account-2-495209.iam.gserviceaccount.com",
    "ma-golide-deploy@account-3-495209.iam.gserviceaccount.com",
    "ma-golide-deploy@account-4-495210.iam.gserviceaccount.com"
]

SCOPES = ['https://www.googleapis.com/auth/drive']

def get_owner_service():
    """Builds a Drive service authenticated as the owner (Slot 1)."""
    token_path = 'creds/token_1.json'
    if not os.path.exists(token_path):
        raise FileNotFoundError(f"Missing token for Slot 1: {token_path}")
    
    with open(token_path, 'r') as f:
        token_data = json.load(f)
    
    creds = Credentials.from_authorized_user_info(token_data, SCOPES)
    return build('drive', 'v3', credentials=creds)

def get_satellite_sheets():
    """Fetches all sheet IDs from Supabase."""
    client = supabase.create_client(SUPABASE_URL, SUPABASE_KEY)
    response = client.table("satellites").select("sheet_id, name").execute()
    return response.data

def share_sheet(service, file_id, email):
    """Shares a sheet with a service account email."""
    try:
        user_permission = {
            'type': 'user',
            'role': 'writer',
            'emailAddress': email
        }
        service.permissions().create(
            fileId=file_id,
            body=user_permission,
            fields='id',
            sendNotificationEmail=False
        ).execute()
        return True
    except HttpError as error:
        if error.resp.status == 403 and "rateLimitExceeded" in str(error):
            print(f"  ⚠️ Rate limit exceeded. Waiting 5s...")
            time.sleep(5)
            return share_sheet(service, file_id, email)
        print(f"  ❌ Error sharing {file_id} with {email}: {error}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Share fleet sheets with service accounts.")
    parser.add_argument("--limit", type=int, default=None, help="Limit the number of sheets to process.")
    parser.add_argument("--dry-run", action="store_true", help="Don't actually share, just print what would happen.")
    args = parser.parse_args()

    print(f"🚀 Starting Phase 2: Fleet Sharing to Service Accounts")
    if args.dry_run:
        print("🧪 DRY RUN MODE ENABLED")
    
    try:
        service = get_owner_service()
        sheets = get_satellite_sheets()
        
        if args.limit:
            sheets = sheets[:args.limit]
            
        print(f"📋 Processing {len(sheets)} satellites.")
        
        for i, sheet in enumerate(sheets):
            sheet_id = sheet['sheet_id']
            name = sheet.get('spreadsheet_name', 'Unknown')
            print(f"[{i+1}/{len(sheets)}] Target: '{name}' ({sheet_id})")
            
            for email in SERVICE_ACCOUNT_EMAILS:
                if args.dry_run:
                    print(f"  🧪 [DRY RUN] Would share with {email}")
                else:
                    success = share_sheet(service, sheet_id, email)
                    if success:
                        print(f"  ✅ Shared with {email}")
                    else:
                        print(f"  ❌ Failed for {email}")
            
            if not args.dry_run:
                time.sleep(0.5)

    except Exception as e:
        print(f"💥 Fatal error: {e}")

if __name__ == "__main__":
    main()
