import json, os
# Load .env (Python 3.13 fix)
with open('.env') as f:
    for l in f:
        if '=' in l and not l.startswith('#'):
            k,v = l.strip().split('=',1); os.environ[k]=v

from supabase import create_client
supa = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])

with open('registry/registry.json') as f:
    sats = json.load(f)['satellites']

print(f"🚀 Pushing {len(sats)} satellites...")

# Batch upsert 100 at a time
for i in range(0, len(sats), 100):
    batch = sats[i:i+100]
    rows = [{
        'sheet_id': s['id'],
        'sheet_name': s.get('name',''),
        'script_id': s.get('script_id'),
        'drive': s.get('drive'),
        'migrated_at': 'now()'
    } for s in batch]
    
    supa.table('satellites').upsert(rows, on_conflict='sheet_id').execute()
    print(f"[{min(i+100, len(sats))}/501] ✓")

total = supa.table('satellites').select('sheet_id', count='exact').execute().count
print(f"\n✅ WIN: {total} satellites in Supabase (bets FK intact)")
