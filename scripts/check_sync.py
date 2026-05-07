import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

supabase = create_client(url, key)

try:
    response = supabase.table("satellite_sync_events").select("*").order("created_at", desc=True).limit(5).execute()
    print("--- RECENT SYNC EVENTS ---")
    for row in response.data:
        print(f"Time: {row['created_at']} | Sheet: {row['spreadsheet_name']} | Status: {row['status']}")
except Exception as e:
    print(f"Error: {e}")
