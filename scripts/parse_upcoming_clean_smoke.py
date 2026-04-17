import json
import os
import sys
from pathlib import Path

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from fetcher.parsers.upcoming_clean import parse_upcoming_clean

BUNDLE_DIR = "cache/satellites/1pG8O4Fh77FFM0wV4BJY-8WnW0R-umzdexzdDPnlCth8"
FILE = "core__UpcomingClean.json"

payload = json.loads((Path(BUNDLE_DIR) / FILE).read_text(encoding="utf-8"))
vals = payload.get("values") or []

rows = parse_upcoming_clean(vals)
print("UPCOMINGCLEAN_ROWS:", len(rows))
print("FIRST_5:", rows[:5])

out_path = Path("registry/upcoming_clean_parsed_sample.json")
out_path.write_text(json.dumps(rows[:50], indent=2), encoding="utf-8")
print("WROTE_SAMPLE:", str(out_path))
