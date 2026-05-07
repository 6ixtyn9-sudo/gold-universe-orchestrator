import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")
sb = create_client(url, key)

try:
    res = sb.table("satellite_registry").select("count", count="exact").execute()
    print(f"satellite_registry count: {res.count}")
except Exception as e:
    print(f"Error checking satellite_registry: {e}")

try:
    res = sb.table("satellites").select("id, sheet_id, name").limit(5).execute()
    print("Sample Satellites from 'satellites' table:")
    for s in res.data:
        print(s)
except Exception as e:
    print(f"Error checking satellites: {e}")
