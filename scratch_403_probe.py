# Probe the exact 403 error body from scripts.run for one target script
import json, glob
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

with open("script_to_token_map.json") as f:
    stmap = json.load(f)

# Get one script_id from the map
script_id = list(stmap["map"].keys())[0]
token_file = list(stmap["map"].values())[0]
print(f"Testing script: {script_id}")
print(f"Using token:    {token_file}")

creds = Credentials.from_authorized_user_file(token_file)
if creds.expired and creds.refresh_token:
    creds.refresh(Request())
print(f"Token scopes:   {creds.scopes}")

svc = build("script", "v1", credentials=creds, cache_discovery=False)

# 1. Can we list deployments? (confirms ownership)
try:
    deps = svc.projects().deployments().list(scriptId=script_id).execute()
    print(f"\n✅ deployments.list OK — {len(deps.get('deployments', []))} deployments found")
    for d in deps.get("deployments", []):
        print(f"   deployment: {d.get('deploymentId','?')[:40]} | config: {d.get('deploymentConfig',{})}")
except HttpError as e:
    print(f"\n❌ deployments.list FAILED: {e.resp.status} {e.content.decode()[:300]}")

# 2. Try scripts.run and print FULL error body
print("\n--- Attempting scripts.run ---")
try:
    res = svc.scripts().run(
        scriptId=script_id,
        body={"function": "safeLaunch", "devMode": True}
    ).execute()
    print(f"✅ scripts.run OK: {res}")
except HttpError as e:
    print(f"❌ scripts.run FAILED: {e.resp.status}")
    print(f"Full error body:\n{e.content.decode('utf-8', errors='ignore')}")
except Exception as e:
    print(f"❌ scripts.run exception: {e}")

