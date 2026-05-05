import argparse
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script-id", required=True)
    args = ap.parse_args()

    creds = Credentials.from_authorized_user_file("token.json")
    service = build("script", "v1", credentials=creds, cache_discovery=False)

    try:
        content = service.projects().getContent(scriptId=args.script_id).execute()
        files = content.get("files", [])
        print(f"✅ Found {len(files)} files in script project")
        
        for f in files:
            name = f["name"]
            if name in ["Contract_Enforcement", "Config_Ledger_Satellite", "Margin_Analyzer"]:
                source = f["source"]
                print(f"\n--- Checking {name} ---")
                
                # Check for specific hardening markers
                if name == "Contract_Enforcement":
                    if "M6_SNIPER_OU" in source:
                        print("✅ Granular Source_Module (M6_SNIPER_OU) found")
                    if "selectionLine = 'ML'" in source:
                        print("✅ ML standardization found")
                
                if name == "Config_Ledger_Satellite":
                    if "return 24;" in source or "stampCol = 24;" in source:
                        print("✅ Column 24 forcing found")
                        
                if name == "Margin_Analyzer":
                    if "rowData.stamp =" in source or "rowData.lineSource =" in source:
                        print("✅ Forensic capture in loadBetSlipsComplete_ found")
                        
    except Exception as e:
        print(f"❌ Failed to get script content: {e}")

if __name__ == "__main__":
    main()
