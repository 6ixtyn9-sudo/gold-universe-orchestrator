import json, os

# Load .env
with open('.env') as f:
    for line in f:
        if '=' in line and not line.startswith('#'):
            k,v = line.strip().split('=',1)
            os.environ[k] = v

from supabase import create_client
s = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_KEY'])

with open('registry/registry.json') as f:
    sats = json.load(f)['satellites']

print(f"Migrating {len(sats)} satellites...")

good = 0
for i, sat in enumerate(sats, 1):
    sheet_id = sat.get('id')
    if not sheet_id:
        continue
    
    payload = {
        'sheet_id': sheet_id,
        'sheet_name': sat.get('name', ''),
        'script_id': sat.get('script_id'),
    }
    payload = {k:v for k,v in payload.items() if v}
    
    try:
        s.table('satellites').upsert(payload, on_conflict='sheet_id').execute()
        good += 1
        if i % 50 == 0:
            print(f"[{i}/501]")
    except Exception as e:
        print(f"Error: {e}")

count = s.table('satellites').select('id', count='exact').execute().count
print(f"\nDONE: {count} satellites in Supabase")
