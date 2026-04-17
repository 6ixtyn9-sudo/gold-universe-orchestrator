import argparse
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from fetcher.satellite_bundle_fetcher import fetch_satellite_bundle

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet-id", required=True)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--no-patterns", action="store_true")
    ap.add_argument("--min-interval", type=float, default=1.2)
    args = ap.parse_args()

    out_dir = args.out_dir or os.path.join("cache", "satellites", args.sheet_id)

    res = fetch_satellite_bundle(
        spreadsheet_id=args.sheet_id,
        out_dir=out_dir,
        include_patterns=not args.no_patterns,
        min_interval_s=args.min_interval,
    )

    print("✅ Bundle fetched")
    print("Title:", res.title)
    print("Out dir:", res.out_dir)
    print("Artifacts:", len(res.tabs_written) + 1, "(including manifest.json)")
    if res.errors:
        print("Errors:", res.errors)

if __name__ == "__main__":
    main()
