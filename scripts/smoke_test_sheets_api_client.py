from fetcher.sheets_api_client import SheetsApiClient

SHEET_ID = "1pG8O4Fh77FFM0wV4BJY-8WnW0R-umzdexzdDPnlCth8"

client = SheetsApiClient(min_interval_s=1.2)

titles = client.list_sheet_titles(SHEET_ID)
print("✅ Spreadsheet tabs:", len(titles))
print("First 15:", titles[:15])

for tab in ["UpcomingClean", "ResultsClean", "Standings", "Raw", "Clean"]:
    if tab in titles:
        hdr = client.get_header_row(SHEET_ID, tab, max_cols=80)
        print(f"✅ {tab} header_len=dr)} sample={hdr[:12]}")
    else:
        print(f"⚠️ {tab} not found on this satellite")
