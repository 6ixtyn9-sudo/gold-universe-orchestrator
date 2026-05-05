
import json
from pathlib import Path

def match_registry():
    reg_path = Path('registry/registry.json')
    if not reg_path.exists():
        print("Registry not found")
        return
    
    reg = json.loads(reg_path.read_text(encoding='utf-8'))
    satellites = reg.get('satellites', [])
    
    # Create a map for quick lookup
    id_map = {s['id']: s for s in satellites}
    
    print(f"Total in registry: {len(satellites)}")
    has_script = [s for s in satellites if s.get('script_id')]
    print(f"Already have script_id: {len(has_script)}")
    
if __name__ == '__main__':
    match_registry()
