import json

def extract_stragglers():
    try:
        with open("fleet_completeness_audit.json", "r") as f:
            report = json.load(f)
            
        stragglers = [item["sheet_id"] for item in report.get("missing_core", [])]
        
        with open("stragglers_list.json", "w") as out_f:
            json.dump(stragglers, out_f, indent=2)
            
        print(f"Successfully extracted {len(stragglers)} straggler sheet IDs to 'stragglers_list.json'.")
        if stragglers:
            print("First 5 stragglers:")
            for s in stragglers[:5]:
                print(f" - {s}")
                
    except FileNotFoundError:
        print("Error: fleet_completeness_audit.json not found. Please ensure the audit script ran successfully.")

if __name__ == "__main__":
    extract_stragglers()
