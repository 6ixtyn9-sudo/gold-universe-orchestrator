
import sys, os, time, json, logging
from pathlib import Path
from auth.google_auth import get_credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("mass_deploy")

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
    
    # Add Remote_Trigger logic to runTheWholeShebang automatically
    trigger_code = """
function setupOneTimeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runTheWholeShebang') return;
  }
  ScriptApp.newTrigger('runTheWholeShebang')
    .timeBased()
    .after(60000) // 1 minute
    .create();
  Logger.log('One-time trigger created for runTheWholeShebang');
}
"""
    files.append({"name": "Remote_Trigger", "type": "SERVER_JS", "source": trigger_code})
    
    return files

def process_one(service, spreadsheet_id, name, files):
    try:
        # 1. Create project bound to sheet
        body = {"title": f"Ma Golide - {name}", "parentId": spreadsheet_id}
        project = service.projects().create(body=body).execute()
        script_id = project['scriptId']
        
        # 2. Update content
        service.projects().updateContent(scriptId=script_id, body={"files": files}).execute()
        
        # 3. Attempt to trigger (Will fail 404 most likely, but that's okay because we have the trigger code)
        try:
            # We also try to run setupOneTimeTrigger directly just in case it's an API executable
            service.scripts().run(scriptId=script_id, body={"function": "setupOneTimeTrigger", "devMode": True}).execute()
            status = "🚀 CREATED + TRIGGERED"
        except:
            status = "🚀 CREATED (Trigger pending on next manual open/timer)"
            
        logger.info(f"{status} — {name} ({script_id})")
        return script_id
    except Exception as e:
        if "quota" in str(e).lower() or "429" in str(e):
            logger.error(f"❌ QUOTA EXHAUSTED for this account!")
            return "QUOTA_ERROR"
        logger.error(f"❌ FAILED {name}: {e}")
        return None

def main():
    reg_path = Path("registry/registry.json")
    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    satellites = reg.get("satellites", [])
    
    pending = [s for s in satellites if not s.get("script_id")]
    logger.info(f"Total pending script creation: {len(pending)}")
    
    files = load_gs_files()
    
    # Using Tokens 11, 12, 13, 14, 15 (5 slots * 50 = 250 creations)
    slots = [11, 12, 13, 14, 15]
    processed_count = 0
    quota_hit_count = 0
    
    for slot in slots:
        if quota_hit_count >= len(slots): break
        
        logger.info(f"--- Switching to Token {slot} ---")
        try:
            creds = get_credentials(slot)
            if creds.expired: creds.refresh(Request())
            service = build('script', 'v1', credentials=creds, cache_discovery=False)
        except Exception as e:
            logger.error(f"Failed to load Token {slot}: {e}")
            quota_hit_count += 1
            continue

        for sat in pending:
            if sat.get("script_id"): continue 
            
            sid = process_one(service, sat["id"], sat["name"], files)
            
            if sid == "QUOTA_ERROR":
                quota_hit_count += 1
                break 
            
            if sid:
                sat["script_id"] = sid
                processed_count += 1
                # Save registry after each success
                reg_path.write_text(json.dumps(reg, indent=2), encoding="utf-8")
                
            time.sleep(1) 
            
    logger.info(f"Done! Created {processed_count} new scripts today.")

if __name__ == '__main__':
    main()
