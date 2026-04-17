import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from fetcher.parsers.results_clean import parse_results_clean
from assayer.results_index import build_result_index, summarize_index

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle-dir", required=True)
    ap.add_argument("--out", default="registry/result_map_sample.json")
    args = ap.parse_args()

    bundle = Path(args.bundle_dir)
    payload = json.loads((bundle / "core__ResultsClean.json").read_text(encoding="utf-8"))
    values = payload.get("values") or []

    rows = parse_results_clean(values)
    idx = build_result_index(rows)

    out = {
        "bundle_dir": str(bundle),
        "summary": summarize_index(idx),
        "by_game_id": idx.by_game_id,
        "duplicates": idx.duplicates,
    }

    Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")

    print("✅ wrote:", args.out)
    print("✅ summary:", out["summary"])
    if out["summary"]["duplicate_game_ids"]:
        # print first dupe key for visibility
        k = next(iter(idx.duplicates.keys()))
        print("⚠️ example duplicate game_id:", k, "rows:", len(idx.duplicates[k]))

if __name__ == "__main__":
    main()
