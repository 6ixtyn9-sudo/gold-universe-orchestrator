import argparse
import json
import sys

import gspread
from google.oauth2 import service_account

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet-id", required=True)
    ap.add_argument("--max-rows", type=int, default=10)
    ap.add_argument("--max-cols", type=int, default=12)
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
    wss = sh.worksheets()
    print("✅ Worksheets:", len(wss))
    for i, ws in enumerate(wss):
        print(f"  [{i}] {ws.title}  (rows={ws.row_count}, cols={ws.col_count})")

    if not wss:
        return 0

    ws0 = wss[0]
    r = args.max_rows
    c = args.max_cols

    print("\n--- Preview first worksheet ---")
    print("Worksheet:", ws0.title)
    rng = f"A1:{chr(ord('A') + min(c, 26) - 1)}{r}"
    vals = ws0.get(rng)
    print("Range:", rng)
    for row in vals:
        print(row)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
