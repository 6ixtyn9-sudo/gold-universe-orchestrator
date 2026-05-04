import os
import json
import argparse
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

def migrate(dry_run=False):
    repo_root = Path(__file__).resolve().parent.parent
    registry_path = repo_root / "registry" / "registry.json"
    
    if not registry_path.exists():
        print(f"Error: {registry_path} not found.")
        return

    with open(registry_path, "r") as f:
        data = json.load(f)

    satellites = data.get("satellites", [])
    print(f"Found {len(satellites)} satellites in registry.json")

    if dry_run:
        registered_count = sum(1 for s in satellites if s.get("script_id"))
        print(f"[DRY RUN] Would upsert {len(satellites)} satellites.")
        print(f"[DRY RUN] Registered: {registered_count}, Unregistered: {len(satellites) - registered_count}")
        return

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY or SUPABASE_URL.startswith("<"):
        print("Error: Supabase credentials not found in .env file.")
        return

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    inserted = 0
    updated = 0
    failed = 0

    for sat in satellites:
        sheet_id = sat.get("id")
        name = sat.get("name", "").strip()
        script_id = sat.get("script_id")
        
        # Parse league from name: " Brazil (NBB) F10" -> "NBB"
        league = None
        if "(" in name and ")" in name:
            league = name[name.find("(")+1:name.find(")")]
        
        status = 'registered' if script_id else 'unregistered'
        
        payload = {
            "sheet_id": sheet_id,
            "script_id": script_id,
            "name": name,
            "league": league,
            "status": status
        }
        
        try:
            # Upsert using sheet_id as conflict key
            # In Supabase/PostgREST, upsert is done via POST with on_conflict
            response = supabase.table("satellites").upsert(payload, on_conflict="sheet_id").execute()
            if response.data:
                inserted += 1
            else:
                failed += 1
        except Exception as e:
            print(f"Failed to upsert satellite {sheet_id}: {e}")
            failed += 1

    print(f"Migration complete.")
    print(f"Inserted/Updated: {inserted}")
    print(f"Failed: {failed}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate satellite registry to Supabase")
    parser.add_argument("--dry-run", action="store_true", help="Perform a dry run without writing to Supabase")
    args = parser.parse_args()
    
    migrate(dry_run=args.dry_run)
