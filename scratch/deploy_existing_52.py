
import sys, os, time, json, logging, threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from auth.google_auth import get_credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("deploy_existing")

GS_ORDER = [
    "Sheet_Setup", "Config_Ledger_Satellite", "Signal_Processor",
    "Data_Parser", "Margin_Analyzer", "Forecaster", "Game_Processor",
    "Inventory_Manager", "Accumulator_Builder", "Contract_Enforcer",
    "Contract_Enforcement",
]

def load_gs_files():
    docs_dir = Path("Ma_Golide_Satellites/docs")
    files = [{"name": "appsscript", "type": "JSON", "source": '{"timeZone":"UTC","exceptionLogging":"STACKDRIVER","runtimeVersion":"V8"}'}]
    for name in GS_ORDER:
        p = docs_dir / f"{name}.gs"
        if p.exists():
            files.append({"name": name, "type": "SERVER_JS", "source": p.read_text(encoding="utf-8")})
    return files

def process_one(creds, sat, files):
    sid = sat["script_id"]
    name = sat.get("name", "Unknown")
    try:
        if creds.expired:
            creds.refresh(Request())
        service = build('script', 'v1', credentials=creds, cache_discovery=False)
        
        # Update content
        service.projects().updateContent(scriptId=sid, body={"files": files}).execute()
        
        # Run runTheWholeShebang
        try:
            service.scripts().run(scriptId=sid, body={"function": "runTheWholeShebang", "devMode": True}).execute()
            status = "✅ UPDATED + RAN"
        except Exception as e:
            status = f"✅ UPDATED (Run failed: {str(e)[:50]})"
        
        logger.info(f"{status} — {name}")
        return True
    except Exception as e:
        logger.error(f"❌ FAILED {name}: {e}")
        return False

def main():
    # 1. Load registered satellites
    reg_path = Path("registry/registry.json")
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    existing = [s for s in reg.get("satellites", []) if s.get("script_id")]
    
    logger.info(f"Found {len(existing)} existing satellites to update.")
    files = load_gs_files()
    
    # 2. Prepare tokens pool
    tokens = []
    for i in range(1, 11):
        try:
            tokens.append(get_credentials(i))
        except:
            pass
            
    if not tokens:
        logger.error("No valid tokens found in range 1-10!")
        return

    # 3. Process in parallel
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = []
        for i, sat in enumerate(existing):
            # Rotate tokens
            token = tokens[i % len(tokens)]
            futures.append(executor.submit(process_one, token, sat, files))
            time.sleep(0.5) # Slight stagger
            
        success = 0
        for f in as_completed(futures):
            if f.result():
                success += 1
        
    logger.info(f"Done! Updated {success}/{len(existing)} satellites.")

if __name__ == '__main__':
    main()
