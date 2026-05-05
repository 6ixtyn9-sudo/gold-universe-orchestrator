import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")

try:
    supabase = create_client(url, key)
    res = supabase.table("bets").select("*", count="exact").execute()
    print(f"SUCCESS: Table 'bets' found. Count: {res.count}")
except Exception as e:
    print(f"FAILURE: {e}")
