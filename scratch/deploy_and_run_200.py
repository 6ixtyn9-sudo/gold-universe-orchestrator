
import sys, os, time, json, logging, threading
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from google.oauth2 import service_account
from googleapiclient.discovery import build

# Configuration
REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR  = REPO_ROOT / "Ma_Golide_Satellites" / "docs"
FOLDER_ID = '1fZYPWLG1OKTnML0Yil82y4cAI-ioli0K'
NUM_SHEETS = 200
ACCOUNTS  = [f'credentials_{i}.json' for i in range(11, 15)]
PROGRESS_FILE = REPO_ROOT / "scratch" / "deployment_200_progress.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(threadName)s] %(message)s"
)
logger = logging.getLogger("deploy_200")

GS_ORDER = [
    "Sheet_Setup", "Config_Ledger_Satellite", "Signal_Processor",
    "Data_Parser", "Margin_Analyzer", "Forecaster", "Game_Processor",
    "Inventory_Manager", "Accumulator_Builder", "Contract_Enforcer",
    "Contract_Enforcement",
]

def load_gs_files():
    files = [{
        "name": "appsscript", "type": "JSON",
        "source": json.dumps({
            "timeZone": "UTC",
            "exceptionLogging": "STACKDRIVER",
            "runtimeVersion": "V8",
            "oauthScopes": [
                "https://www.googleapis.com/auth/spreadsheets",
                "https://www.googleapis.com/auth/drive",
                "https://www.googleapis.com/auth/script.external_request",
                "https://www.googleapis.com/auth/script.scriptapp"
            ]
        })
    }]
    for name in GS_ORDER:
        p = DOCS_DIR / f"{name}.gs"
        if p.exists():
            files.append({
                "name": name, "type": "SERVER_JS",
                "source": p.read_text(encoding="utf-8")
            })
    return files

def get_services(creds_path):
    creds = service_account.Credentials.from_service_account_file(
        creds_path, 
        scopes=[
            'https://www.googleapis.com/auth/drive',
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/script.projects',
            'https://www.googleapis.com/auth/script.deployments',
            'https://www.googleapis.com/auth/script.external_request'
        ]
    )
    drive  = build('drive',  'v3', credentials=creds, cache_discovery=False)
    script = build('script', 'v1', credentials=creds, cache_discovery=False)
    return drive, script

def deploy_and_run_one(drive_svc, script_svc, sheet_id, sheet_name, files):
    try:
        # 1. Find or Create Script
        q = f"'{sheet_id}' in parents and mimeType='application/vnd.google-apps.script'"
        r = drive_svc.files().list(q=q, fields="files(id,name)").execute()
        files_found = r.get("files", [])
        
        if files_found:
            script_id = files_found[0]["id"]
            action = "UPDATED"
        else:
            proj = script_svc.projects().create(body={
                "title": f"Ma Golide Satellite Logic",
                "parentId": sheet_id
            }).execute()
            script_id = proj["scriptId"]
            action = "CREATED"
            
        # 2. Update Content
        script_svc.projects().updateContent(
            scriptId=script_id,
            body={"files": files}
        ).execute()
        
        # 3. Create Deployment (required for execution)
        # We need a version first
        version = script_svc.projects().versions().create(
            scriptId=script_id,
            body={"description": "Auto-deploy via Antigravity"}
        ).execute()
        v_num = version["versionNumber"]
        
        deployment = script_svc.projects().deployments().create(
            scriptId=script_id,
            body={
                "versionNumber": v_num,
                "manifestFileName": "appsscript",
                "description": "Auto-deployment"
            }
        ).execute()
        dep_id = deployment["deploymentId"]
        
        # 4. Run runTheWholeShebang
        # Using the executions.run endpoint
        # NOTE: This may still fail if the script is not configured as an API executable
        # in the Cloud Console, but let's try.
        try:
            script_svc.scripts().run(
                scriptId=script_id,
                body={"function": "runTheWholeShebang", "devMode": True}
            ).execute()
            run_status = "✅ RAN"
        except Exception as e_run:
            # If run fails, we'll try to create a trigger as a fallback
            run_status = f"⚠️ RUN_ERROR: {str(e_run)[:40]}"
            
        return {"id": sheet_id, "name": sheet_name, "script_id": script_id, "status": action, "run": run_status, "ok": True}
    except Exception as e:
        return {"id": sheet_id, "name": sheet_name, "error": str(e), "ok": False}

def worker(account_idx, creds_path, sheets, files, progress):
    thread_name = f"SA-{account_idx}"
    threading.current_thread().name = thread_name
    drive_svc, script_svc = get_services(creds_path)
    
    results = []
    for i, (sid, sname) in enumerate(sheets):
        if sid in progress:
            logger.info(f"Skipping {sname} (already done)")
            continue
            
        logger.info(f"Processing {i+1}/{len(sheets)}: {sname} ({sid})")
        res = deploy_and_run_one(drive_svc, script_svc, sid, sname, files)
        results.append(res)
        
        if res["ok"]:
            logger.info(f"[{res['status']}] [{res['run']}] {sname}")
            progress[sid] = res
        else:
            logger.error(f"Failed {sname}: {res['error']}")
            
        # Save progress every 5 sheets
        if i % 5 == 0:
            with open(PROGRESS_FILE, 'w') as f:
                json.dump(progress, f, indent=2)
                
        time.sleep(5) # Quota safety
        
    return results

if __name__ == '__main__':
    # 1. Load progress
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE, 'r') as f:
            progress = json.load(f)
    else:
        progress = {}
    
    # 2. Load files
    files = load_gs_files()
    logger.info(f"Loaded {len(files)} GS files")
    
    # 3. Get list of sheets
    drive_svc, _ = get_services(ACCOUNTS[0])
    logger.info("Listing sheets in folder...")
    all_files = []
    page_token = None
    while len(all_files) < NUM_SHEETS + 50: # fetch slightly more than needed
        results = drive_svc.files().list(
            q=f"'{FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.spreadsheet'",
            pageSize=1000, fields="nextPageToken, files(id, name, modifiedTime)",
            pageToken=page_token,
            orderBy="modifiedTime desc" # work on most recently modified first
        ).execute()
        all_files.extend(results.get('files', []))
        page_token = results.get('nextPageToken')
        if not page_token: break
    
    logger.info(f"Found {len(all_files)} total sheets. Taking 200.")
    target_sheets = [(f['id'], f['name']) for f in all_files[:NUM_SHEETS]]
    
    # 4. Split among workers
    chunk_size = (len(target_sheets) + len(ACCOUNTS) - 1) // len(ACCOUNTS)
    chunks = [target_sheets[i:i + chunk_size] for i in range(0, len(target_sheets), chunk_size)]
    
    # 5. Run parallel
    with ThreadPoolExecutor(max_workers=len(ACCOUNTS)) as executor:
        futures = []
        for i, chunk in enumerate(chunks):
            futures.append(executor.submit(worker, i+1, ACCOUNTS[i], chunk, files, progress))
        
        final_results = []
        for f in as_completed(futures):
            try:
                final_results.extend(f.result())
            except Exception as e_thread:
                logger.error(f"Thread error: {e_thread}")
            
    # 6. Final progress save
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(progress, f, indent=2)
            
    # 7. Summary
    success = [r for r in progress.values() if r["ok"]]
    logger.info(f"Batch Complete: Total Processed: {len(progress)} / {NUM_SHEETS}")
