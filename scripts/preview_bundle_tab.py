import argparse
import json
from pathlib import Path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bundle-dir", required=True)
    ap.add_argument("--file", help="Exact filename in bundle dir, e.g. core__ResultsClean.json")
    ap.add_argument("--match", help="Substring match if you don't know exact filename (first match used)")
    ap.add_argument("--rows", type=int, default=15)
    ap.add_argument("--cols", type=int, default=15)
    args = ap.parse_args()

    d = Path(args.bundle_dir)
    if not d.exists():
        raise SystemExit(f"Bundle dir not found: {d}")

    files = sorted([p.name for p in d.glob("*.json")])
    if not files:
        raise SystemExit("No .json files found in bundle dir")

    target = None
    if args.file:
        target = d / args.file
        if not target.exists():
            raise SystemExit(f"File not found: {target}")
    else:
        if not args.match:
            print("Available files (first 30):")
            for f in files[:30]:
                print(" ", f)
            raise SystemExit("Provide --file or --match")
        for f in files:
            if args.match in f:
                target = d / f
                break
        if target is None:
            raise SystemExit(f"No file matched substring: {args.match}")

    payload = json.loads(target.read_text(encoding="utf-8"))
    values = payload.get("values") or []

    key = payload.get("key", "")
    req = payload.get("requested_range") or payload.get("range") or ""
    ret = payload.get("returned_range") or ""

    print("✅ File:", target.name)
    print("key:", key)
    print("requested_range:", req)
    if ret and ret != req:
        print("returned_range:", ret)

    print("rows:", len(values))
    if values and isinstance(values[0], list):
        print("cols(first row):", len(values[0]))

    print("--- preview ---")
    for i, row in enumerate(values[: args.rows]):
        if isinstance(row, list):
            row2 = row[: args.cols]
        else:
            row2 = [row]
        print(f"{i+1:>3}:", row2)

if __name__ == "__main__":
    main()
