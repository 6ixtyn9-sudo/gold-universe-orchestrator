import argparse
import gspread
from google.oauth2.credentials import Credentials

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet-id", required=True)
    args = ap.parse_args()

    # Use the valid token.json we copied from creds/token_1.json
    creds = Credentials.from_authorized_user_file("token.json")
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
        rows = ws.get("A1:Y10")
        print("\n--- Rows Preview ---")
        for i, row in enumerate(rows):
            print(f"Row {i+1} (Length {len(row)}): {row}")
            
    except gspread.exceptions.WorksheetNotFound:
        print("❌ Bet_Slips worksheet NOT found")

if __name__ == "__main__":
    main()
