import sys
from pathlib import Path
REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

import os, json
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

res = sb.table("satellite_tab_snapshots").select("*").eq("sheet_id", "SANDBOX-POLAND-F25").eq("tab_name", "Bet_Slips").execute()
if res.data:
    rows = res.data[0]["values_json"]
    print(f"Bet_Slips tab: {len(rows)} rows")
    for i, row in enumerate(rows[:10]):
        print(f"  Row {i}: {row}")
else:
    print("No Bet_Slips tab found")
    
    # Also list all tabs
    res2 = sb.table("satellite_tab_snapshots").select("tab_name, row_count").eq("sheet_id", "SANDBOX-POLAND-F25").execute()
    print("Available tabs:", [r["tab_name"] for r in res2.data])
