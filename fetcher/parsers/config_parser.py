import re
from typing import Any, Dict, List, Optional

def parse_config_sheet(rows: List[List[Any]]) -> Dict[str, Any]:
    """Parse a config sheet (key in col 0, value in col 1)."""
    cfg = {}
    if not rows:
        return cfg
    
    for row in rows:
        if len(row) < 2:
            continue
        key = str(row[0] or "").strip().lower()
        if not key or key == "key": # skip header if any
            continue
        val = row[1]
        
        # Canonicalize keys: ou_min_conf -> ouMinConf
        norm_key = re.sub(r"_+", "", key)
        # Or just keep it as is if we know what we are looking for.
        # But Apps Script uses both snake_case and camelCase.
        
        cfg[key] = val
        cfg[norm_key] = val
        
    return cfg
