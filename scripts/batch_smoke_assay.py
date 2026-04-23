import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from assayer.smoke_assay import run_smoke_assay

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=5, help="Number of satellites to test")
    ap.add_argument("--registry", default="registry/registry.json")
    ap.add_argument("--cache-only", action="store_true", help="Only use cached bundles")
    ap.add_argument("--force-fetch", action="store_true", help="Force fetch from Google Sheets")
    args = ap.parse_args()

    reg_path = Path(args.registry)
    if not reg_path.exists():
        print(f"Error: Registry not found at {reg_path}")
        return

    reg = json.loads(reg_path.read_text(encoding="utf-8"))
    satellites = reg.get("satellites", [])
    
    # Filter for satellites that have cached bundles if --cache-only is set
    if args.cache_only:
        cache_dir = Path("cache/satellites")
        satellites = [s for s in satellites if (cache_dir / s["id"]).exists()]

    to_test = satellites[:args.limit]
    print(f"Testing {len(to_test)} satellites...")

    results = []
    for i, sat in enumerate(to_test):
        sid = sat["id"]
        name = sat["name"]
        print(f"[{i+1}/{len(to_test)}] Assaying {name} ({sid})...")
        
        try:
            report = run_smoke_assay(
                sid,
                use_cache=not args.force_fetch,
            )
            c = report["counts"]
            print(f"  ✅ Graded: {c['graded']}, Hits: {c['hits']} ({c['hit_rate']:.1%})")
            results.append({
                "id": sid,
                "name": name,
                "graded": c["graded"],
                "hits": c["hits"],
                "hit_rate": c["hit_rate"],
                "status": "success"
            })
        except Exception as e:
            print(f"  ❌ Error: {e}")
            results.append({
                "id": sid,
                "name": name,
                "status": "error",
                "error": str(e)
            })

    # Summary
    print("\n" + "="*30)
    print("BATCH SMOKE ASSAY SUMMARY")
    print("="*30)
    successes = [r for r in results if r["status"] == "success"]
    summary = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total_satellites": len(results),
        "errors": len(results) - len(successes),
        "results": results
    }
    
    if successes:
        avg_hr = sum(r["hit_rate"] for r in successes) / len(successes)
        total_graded = sum(r["graded"] for r in successes)
        summary["avg_hit_rate"] = avg_hr
        summary["total_graded"] = total_graded
        print(f"Average Hit Rate: {avg_hr:.1%}")
        print(f"Total Graded Samples: {total_graded}")
    
    print(f"Errors: {len(results) - len(successes)}")

    report_path = Path("batch_assay_report.json")
    report_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"\nDetailed report saved to {report_path}")

if __name__ == "__main__":
    main()
