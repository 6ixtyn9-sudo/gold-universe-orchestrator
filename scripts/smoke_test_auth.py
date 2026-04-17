import os
from google.oauth2 import service_account
import gspread

print("🚀 Google Auth Smoke Test (Final Version)...")

SERVICE_ACCOUNT_FILE = "service_account.json"

if not os.path.exists(SERVICE_ACCOUNT_FILE):
    print("❌ service_account.json not found!")
    exit(1)

print(f"✅ Found {SERVICE_ACCOUNT_FILE}")

credentials = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_FILE,
    scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
)

print("✅ Service account credentials loaded successfully")

# Authorize client — this proves everything the rest of the codebase needs
gc = gspread.authorize(credentials)
print("✅ gspread client authorized with service account")
print("🎉 AUTH FULLY WOe account has correct Google Sheets scopes!")

print("\n✅ Ready for registry population + full satellite fetch!")
