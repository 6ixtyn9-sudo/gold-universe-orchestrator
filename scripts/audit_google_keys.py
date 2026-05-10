import argparse
import json
import logging
import os
import sys
from pathlib import Path
from googleapiclient.discovery import build
import traceback

repo_root = Path(os.path.dirname(os.path.dirname(__file__)))
sys.path.insert(0, str(repo_root))

from auth.google_auth import get_credentials_from_file, SCOPES

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def discover_keys(keys_dir=None):
    if keys_dir:
        d = Path(keys_dir)
        if d.exists() and d.is_dir():
            return list(d.glob("*.json"))
        return []
    
    candidates = []
    # Search common dirs
    for d_name in ["keys", "secrets", "credentials", ".credentials", "creds", "."]:
        d = repo_root / d_name
        if d.exists() and d.is_dir():
            for f in d.glob("*.json"):
                # Avoid common non-credential files
                name = f.name.lower()
                if "registry" in name or "package" in name or "audit" in name or "straggler" in name:
                    continue
                candidates.append(f)
    return list(set(candidates))

def get_key_type(path):
    try:
        with open(path, "r") as f:
            info = json.load(f)
        if info.get("type") == "service_account":
            return "service_account", info.get("client_email", "unknown")
        if "installed" in info or "web" in info:
            return "oauth_client", "unknown (requires auth)"
    except Exception:
        pass
    return "unknown", "unknown"

def test_key(path, registry_samples, interactive_oauth, token_cache_dir):
    ktype, principal = get_key_type(path)
    if ktype == "unknown":
        return None

    result = {
        "filename": path.name,
        "path": str(path),
        "type": ktype,
        "principal": principal,
        "about_get": "FAIL",
        "sample_access_pass": 0,
        "sample_access_fail": 0,
        "bound_script_discovery": "FAIL",
        "overall_status": "BROKEN",
        "error_snippet": ""
    }

    try:
        creds = get_credentials_from_file(path, token_cache_dir, interactive_oauth, SCOPES)
    except Exception as e:
        result["error_snippet"] = str(e).splitlines()[0][:100]
        if "deleted_client" in str(e).lower():
            result["overall_status"] = "BROKEN_DELETED_CLIENT"
            logger.error(f"OAuth client deleted: {path.name} no longer exists in GCP; replace credentials and delete token cache.")
        return result

    try:
        drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
        
        # Test 1: about.get
        try:
            about = drive_service.about().get(fields="user(emailAddress),storageQuota").execute()
            if "user" in about and "emailAddress" in about["user"]:
                result["principal"] = about["user"]["emailAddress"]
            result["about_get"] = "PASS"
        except Exception as e:
            result["error_snippet"] = str(e).splitlines()[0][:100]
            if "deleted_client" in str(e).lower():
                result["overall_status"] = "BROKEN_DELETED_CLIENT"
                logger.error(f"OAuth client deleted: {path.name} no longer exists in GCP; replace credentials and delete token cache.")
                return result

        # Test 2: sample sheets
        bound_script_tested = False
        bound_script_pass = False

        for sheet_id in registry_samples:
            try:
                f = drive_service.files().get(fileId=sheet_id, fields="id,name,mimeType,owners,emailAddress,parents", supportsAllDrives=True).execute()
                result["sample_access_pass"] += 1
                
                # Test 3: bound script discovery
                if not bound_script_tested:
                    bound_script_tested = True
                    try:
                        query = f"'{sheet_id}' in parents and mimeType = 'application/vnd.google-apps.script'"
                        res = drive_service.files().list(q=query, fields="files(id, name)", supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
                        bound_script_pass = True
                        result["bound_script_discovery"] = "PASS"
                    except Exception as e:
                        if "deleted_client" in str(e).lower():
                            result["overall_status"] = "BROKEN_DELETED_CLIENT"
                            result["error_snippet"] = "deleted_client on list"
                            return result
            except Exception as e:
                result["sample_access_fail"] += 1
                if "deleted_client" in str(e).lower():
                    result["overall_status"] = "BROKEN_DELETED_CLIENT"
                    result["error_snippet"] = "deleted_client on get"
                    return result

        if result["about_get"] == "PASS" and result["sample_access_pass"] > 0 and result["bound_script_discovery"] == "PASS":
            # For now just READ_OK since we don't do a real write test
            result["overall_status"] = "READ_OK"
            
    except Exception as e:
        result["error_snippet"] = str(e).splitlines()[0][:100]

    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keys-dir", type=str, help="Directory containing credentials")
    parser.add_argument("--registry", type=str, default="registry/registry.json")
    parser.add_argument("--sample-size", type=int, default=5)
    parser.add_argument("--interactive-oauth", action="store_true")
    parser.add_argument("--report-out", type=str, default="artifacts/key-audit-report.json")
    parser.add_argument("--token-cache-dir", type=str, default="artifacts/token-cache")
    args = parser.parse_args()

    candidates = discover_keys(args.keys_dir)
    if not candidates:
        logger.error("No credential JSON files found.")
        sys.exit(1)
        
    logger.info(f"Found {len(candidates)} credential candidates.")

    registry_samples = []
    reg_path = repo_root / args.registry
    if reg_path.exists():
        with open(reg_path) as f:
            data = json.load(f)
            sats = data.get("satellites", [])
            for sat in sats[:args.sample_size]:
                registry_samples.append(sat.get("sheet_id") or sat.get("id"))
    
    if not registry_samples:
        logger.warning("No samples found in registry, continuing with empty samples.")

    reports = []
    for path in candidates:
        logger.info(f"Testing {path.name}...")
        res = test_key(path, registry_samples, args.interactive_oauth, args.token_cache_dir)
        if res:
            reports.append(res)
            
    # Print table
    print("\n--- Key Audit Summary ---")
    print(f"{'Filename':<25} | {'Type':<15} | {'Principal':<35} | {'About':<5} | {'Samples':<7} | {'BoundDisc':<9} | {'Status':<25} | {'Error'}")
    print("-" * 140)
    for r in reports:
        samples_str = f"{r['sample_access_pass']}/{r['sample_access_pass']+r['sample_access_fail']}"
        print(f"{r['filename']:<25} | {r['type']:<15} | {r['principal'][:35]:<35} | {r['about_get']:<5} | {samples_str:<7} | {r['bound_script_discovery']:<9} | {r['overall_status']:<25} | {r['error_snippet']}")

    out_path = Path(args.report_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(reports, f, indent=2)
    logger.info(f"\nSaved full report to {out_path}")

if __name__ == "__main__":
    main()
