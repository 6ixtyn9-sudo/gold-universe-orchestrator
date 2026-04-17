import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from fetcher.parsers.standings import parse_standings
from fetcher.parsers.game_logs import parse_game_log_table

def load_values(bundle_dir: str, filename: str):
    p = Path(bundle_dir) / filename
    payload = json.loads(p.read_text(encoding="utf-8"))
    return payload.get("values") or []

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle-dir", required=True)
    args = ap.parse_args()

    d = args.bundle_dir
    print("Bundle:", d)

    st = parse_standings(load_values(d, "core__Standings.json"))
    print("✅ standings parsed:", len(st))
    print("firs3:", st[:3])

    h2h = parse_game_log_table(load_values(d, "pattern__CleanH2H__CleanH2H_1.json"))
    print("✅ cleanh2h_1 parsed:", len(h2h))
    print("first 2:", h2h[:2])

    rh = parse_game_log_table(load_values(d, "pattern__CleanRecentHome__CleanRecentHome_1.json"))
    print("✅ cleanrecenthome_1 parsed:", len(rh))
    print("first 2:", rh[:2])

    ra = parse_game_log_table(load_values(d, "pattern__CleanRecentAway__CleanRecentAway_1.json"))
    print("✅ cleanrecentaway_1 parsed:", len(ra))
 nt("first 2:", ra[:2])

if __name__ == "__main__":
    main()
