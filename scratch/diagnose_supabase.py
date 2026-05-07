import os
import sys
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")

if not url or not key:
    print("Error: Missing credentials")
    sys.exit(1)

sb = create_client(url, key)

print(f"Connecting to: {url}")

try:
    # 1. Check satellites table
    res_sats = sb.table("satellites").select("count", count="exact").execute()
    print(f"Satellites count: {res_sats.count}")
    
    # 2. Check snapshots table
    res_snaps = sb.table("satellite_tab_snapshots").select("count", count="exact").execute()
    print(f"Snapshots count: {res_snaps.count}")
    
    # 3. List some satellites if any
    if res_sats.count and res_sats.count > 0:
        sats = sb.table("satellites").select("*").limit(5).execute()
        print("Sample Satellites:")
        for s in sats.data:
            print(f" - {s.get('id')} | {s.get('sheet_id')} | {s.get('name')}")
    else:
        print("No satellites found.")

except Exception as e:
    print(f"Error: {e}")
