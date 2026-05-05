import argparse
import gspread
from google.oauth2 import service_account

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet-id", required=True)
    args = ap.parse_args()

    creds = service_account.Credentials.from_service_account_file(
        "service_account.json",
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/drive.readonly",
        ],
    )
    gc = gspread.authorize(creds)

    sh = gc.open_by_key(args.sheet_id)
    print("✅ Spreadsheet title:", sh.title)
    
    try:
        ws = sh.worksheet("Bet_Slips")
        print("✅ Found Bet_Slips worksheet")
        
        # Check column count
        cols = ws.col_count
        print(f"✅ Column count: {cols}")
        
        # Get headers (Row 1 or first non-empty row)
        rows = ws.get("A1:Y5")
        print("\n--- Rows Preview ---")
        for i, row in enumerate(rows):
            print(f"Row {i+1} (Length {len(row)}): {row}")
            
    except gspread.exceptions.WorksheetNotFound:
        print("❌ Bet_Slips worksheet NOT found")

if __name__ == "__main__":
    main()
