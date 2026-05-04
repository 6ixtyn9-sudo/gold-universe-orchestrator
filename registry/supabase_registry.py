import os
from typing import List, Dict, Any
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

_client = None

def get_client() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY or SUPABASE_URL.startswith("<"):
            raise ValueError("Supabase credentials not configured in .env")
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client

def list_satellites() -> List[Dict[str, Any]]:
    """Returns all rows from satellites table as list of dicts."""
    client = get_client()
    response = client.table("satellites").select("*").execute()
    
    # Map sheet_id back to 'id' for compatibility with existing scripts
    sats = []
    for row in response.data:
        sat = row.copy()
        sat['id'] = row['sheet_id']
        sats.append(sat)
    return sats

def update_satellite_script_id(sheet_id: str, script_id: str) -> bool:
    """Updates script_id and sets status='registered' for matching sheet_id."""
    client = get_client()
    try:
        response = client.table("satellites").update({
            "script_id": script_id,
            "status": "registered"
        }).eq("sheet_id", sheet_id).execute()
        return len(response.data) > 0
    except Exception as e:
        print(f"Error updating satellite script_id: {e}")
        return False
