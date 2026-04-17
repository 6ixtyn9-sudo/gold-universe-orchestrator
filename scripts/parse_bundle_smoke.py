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

    standings_vals = load_values(d, "core__Standings.json")
    st = parse_standings(standings_vals)
    print("✅ standings parsed:", len(st))
    print("first 5:", st[:5])

    h2h_vals = load_values(d, "pattern__CleanH2H__CleanH2H_1.json")
    h2h = parse_game_log_table(h2h_vals)
    print("✅ cleanh2h_1 parsed:", len(h2h))
    print("first 2:", h2h[:2])

    rh_vals = load_values(d, "pattern__CleanRecentHome__CleanRecentHome_1.json")
    rh = parse_game_log_table(rh_vals)
    print("✅ cleanrecenthome_1 parsed:", len(rh))
    pfirst 2:", rh[:2])

    ra_vals = load_values(d, "pattern__CleanRecentAway__CleanRecentAway_1.json")
    ra = parse_game_log_table(ra_vals)
    print("✅ cleanrecentaway_1 parsed:", len(ra))
    print("first 2:", ra[:2])

if __name__ == "__main__":
    main()
