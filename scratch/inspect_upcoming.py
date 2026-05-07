import sys
from pathlib import Path
REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

res = sb.table("satellite_tab_snapshots").select("*").eq("sheet_id", "SANDBOX-POLAND-F25").eq("tab_name", "UpcomingClean").execute()
if res.data:
    rows = res.data[0]["values_json"]
    print(f"UpcomingClean: {len(rows)} rows")
    for i, row in enumerate(rows[:5]):
        print(f"  Row {i}: {row}")
