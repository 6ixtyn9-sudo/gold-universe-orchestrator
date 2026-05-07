import os, json
from supabase import create_client
from dotenv import load_dotenv
from scripts.run_assayer_from_supabase import fetch_all_bet_slips
from fetcher.parsers.bet_slips import parse_bet_slips

load_dotenv()
sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))
snaps = fetch_all_bet_slips(sb)
all_rows = []
for s in snaps: all_rows.extend(parse_bet_slips(s["values_json"]))
outcomes = [r["outcome"] for r in all_rows]
print(f"Wins: {outcomes.count('win')}")
print(f"Losses: {outcomes.count('loss')}")
print(f"None: {outcomes.count(None)}")
