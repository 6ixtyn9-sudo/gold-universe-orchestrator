import sys
from pathlib import Path
REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

import os
from dotenv import load_dotenv
from supabase import create_client, Client
from brain.data_parser import parse_upcoming_clean

load_dotenv()
sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

res = sb.table("satellite_tab_snapshots").select("*").eq("sheet_id", "SANDBOX-POLAND-F25").eq("tab_name", "UpcomingClean").execute()
if res.data:
    games = parse_upcoming_clean(res.data[0]["values_json"])
    for g in games:
        print(f"Game: {g['home']} vs {g['away']} | Pred: {g['prediction']} | Conf: {g['confidence']}")
else:
    print("No data found")
