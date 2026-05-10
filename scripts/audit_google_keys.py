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
from fetcher.script_api_client import ScriptApiClient

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

def discover_keys(keys_dir=None):
    if keys_dir:
        d = Path(keys_dir)
        if d.exists() and d.is_dir():
            return list(d.glob("*.json"))
        return []
    
    candidates = []
    for d_name in ["keys", "secrets", "credentials", ".credentials", "creds", "."]:
        d = repo_root / d_name
        if d.exists() and d.is_dir():
            for f in d.glob("*.json"):
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

def test_key(path, registry_samples, script_ids, interactive_oauth, token_cache_dir, interactive_context, preflight_mode):
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
        "script_api_preflight": "FAIL",
        "overall_status": "BROKEN",
        "error_snippet": ""
    }

    try:
        interactive_allowed = interactive_oauth
        if interactive_allowed and ktype == "oauth_client":
            allowlist = interactive_context.get("allowlist", [])
            if allowlist and path.name not in allowlist:
                interactive_allowed = False
            elif interactive_context["count"] >= interactive_context["max"]:
                interactive_allowed = False

        try:
            creds = get_credentials_from_file(path, token_cache_dir, interactive_allowed, SCOPES)
            if interactive_allowed and ktype == "oauth_client":
                interactive_context["count"] += 1
        except Exception as e:
            msg = str(e)
            result["error_snippet"] = msg.splitlines()[0][:100]
            if "deleted_client" in msg.lower():
                result["overall_status"] = "BROKEN_DELETED_CLIENT"
                logger.error(f"OAuth client deleted: {path.name}")
            elif "interactive_oauth is false" in msg:
                result["overall_status"] = "NOT_TESTED_NO_TOKEN"
            return result

        client = ScriptApiClient(credentials=creds)
        drive_service = client.drive_service

        try:
            about = drive_service.about().get(fields="user(emailAddress),storageQuota").execute()
            if "user" in about and "emailAddress" in about["user"]:
                result["principal"] = about["user"]["emailAddress"]
            result["about_get"] = "PASS"
        except Exception as e:
            result["error_snippet"] = str(e).splitlines()[0][:100]
            if "deleted_client" in str(e).lower() or "invalid_grant" in str(e).lower():
                result["overall_status"] = "BROKEN_DELETED_CLIENT"
            return result

        bound_script_tested = False
        for sheet_id in registry_samples:
            try:
                f = drive_service.files().get(fileId=sheet_id, fields="id,name,mimeType,owners(emailAddress),parents", supportsAllDrives=True).execute()
                result["sample_access_pass"] += 1
                
                if not bound_script_tested:
                    bound_script_tested = True
                    try:
                        query = f"'{sheet_id}' in parents and mimeType = 'application/vnd.google-apps.script'"
                        res = drive_service.files().list(q=query, fields="files(id, name)", supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
                        result["bound_script_discovery"] = "PASS"
                    except Exception as e:
                        if "deleted_client" in str(e).lower():
                            result["overall_status"] = "BROKEN_DELETED_CLIENT"
                            result["error_snippet"] = "deleted_client on list"
                            return result
                        result["error_snippet"] = f"list failed: {str(e).splitlines()[0][:100]}"
            except Exception as e:
                result["sample_access_fail"] += 1
                if "deleted_client" in str(e).lower():
                    result["overall_status"] = "BROKEN_DELETED_CLIENT"
                    result["error_snippet"] = "deleted_client on get"
                    return result
                result["error_snippet"] = f"get failed: {str(e).splitlines()[0][:100]}"

        # Preflight test Script API
        if preflight_mode == "off":
            result["script_api_preflight"] = "PASS"
        elif preflight_mode == "read":
            target_id = None
            for sid in script_ids:
                if sid:
                    target_id = sid
                    break
            if target_id:
                preflight = client.can_script_read_project(target_id)
                if preflight["ok"]:
                    result["script_api_preflight"] = "PASS"
                else:
                    result["script_api_preflight"] = preflight["error_reason"]
                    result["error_snippet"] = f"Preflight read fail: {preflight['error_reason']}"
            else:
                result["script_api_preflight"] = "PASS"
        elif preflight_mode == "create":
            preflight = client.can_script_create_project()
            if preflight["ok"]:
                result["script_api_preflight"] = "PASS"
            else:
                result["script_api_preflight"] = preflight["error_reason"]
                result["error_snippet"] = f"Preflight create fail: {preflight['error_reason']}"

        drive_ok = result["about_get"] == "PASS" and result["sample_access_pass"] > 0 and result["bound_script_discovery"] == "PASS"
        script_pf = result["script_api_preflight"]

        if not drive_ok:
            result["overall_status"] = "DRIVE_NO"
        else:
            if script_pf == "PASS":
                result["overall_status"] = "DRIVE_OK_SCRIPT_OK"
            elif script_pf == "QUOTA_EXHAUSTED":
                result["overall_status"] = "QUOTA_EXHAUSTED"
            elif script_pf in ["USERSETTING_DISABLED", "INSUFFICIENT_PERMISSIONS_OR_DISABLED", "INSUFFICIENT_PERMISSIONS"]:
                result["overall_status"] = "DRIVE_OK_SCRIPT_NO"
            else:
                result["overall_status"] = "DRIVE_OK_SCRIPT_FAIL"

    except Exception as e:
        result["error_snippet"] = str(e).splitlines()[0][:100]

    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--keys-dir", type=str, help="Directory containing credentials")
    parser.add_argument("--registry", type=str, default="registry/registry.json")
    parser.add_argument("--sample-size", type=int, default=5)
    parser.add_argument("--interactive-oauth", action="store_true")
    parser.add_argument("--interactive-oauth-max", type=int, default=1)
    parser.add_argument("--interactive-allowlist", type=str, help="Comma separated filenames")
    parser.add_argument("--report-out", type=str, default="artifacts/key-audit-report.json")
    parser.add_argument("--token-cache-dir", type=str, default="artifacts/token-cache")
    parser.add_argument("--script-preflight", choices=["read", "create", "off"], default="read")
    args = parser.parse_args()

    candidates = discover_keys(args.keys_dir)
    if not candidates:
        logger.error("No credential JSON files found.")
        sys.exit(1)
        
    logger.info(f"Found {len(candidates)} credential candidates.")

    registry_samples = []
    script_ids = []
    reg_path = repo_root / args.registry
    if reg_path.exists():
        with open(reg_path) as f:
            data = json.load(f)
            sats = data.get("satellites", [])
            for sat in sats[:args.sample_size]:
                registry_samples.append(sat.get("sheet_id") or sat.get("id"))
                script_ids.append(sat.get("script_id"))
    
    if not registry_samples:
        logger.warning("No samples found in registry, continuing with empty samples.")

    interactive_context = {
        "max": args.interactive_oauth_max,
        "count": 0,
        "allowlist": [x.strip() for x in args.interactive_allowlist.split(",")] if args.interactive_allowlist else []
    }

    reports = []
    for path in candidates:
        logger.info(f"Testing {path.name}...")
        res = test_key(path, registry_samples, script_ids, args.interactive_oauth, args.token_cache_dir, interactive_context, args.script_preflight)
        if res:
            reports.append(res)
            
    print("\n--- Key Audit Summary ---")
    fmt = "{:<22} | {:<15} | {:<30} | {:<5} | {:<7} | {:<9} | {:<16} | {:<20} | {}"
    print(fmt.format("Filename", "Type", "Principal", "About", "Samples", "BoundDisc", "ScriptPre", "Status", "Error"))
    print("-" * 150)
    for r in reports:
        samples_str = f"{r['sample_access_pass']}/{r['sample_access_pass']+r['sample_access_fail']}"
        print(fmt.format(r['filename'][:22], r['type'], r['principal'][:30], r['about_get'], samples_str, r['bound_script_discovery'], r['script_api_preflight'][:16], r['overall_status'], r['error_snippet']))

    out_path = Path(args.report_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(reports, f, indent=2)
    logger.info(f"\nSaved full report to {out_path}")

if __name__ == "__main__":
    main()
