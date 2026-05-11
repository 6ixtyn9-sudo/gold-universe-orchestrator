#!/usr/bin/env python3
"""
sanitize_checkpoint.py
Reads the live artifacts/reconcile_checkpoint.json and writes a sanitized
version safe to commit (no emails, no credential paths, no tokens).
"""
import json
import sys
from pathlib import Path

KEEP_FIELDS = {"sheet_id", "status", "canonical_script_id", "script_id",
               "timestamp", "deployed_fingerprint", "local_fingerprint",
               "error_reason"}

REMOVE_FIELDS = {"principal", "email", "token_path", "credential_path",
                 "traceback", "raw_message"}

repo_root = Path(__file__).resolve().parent.parent
src = repo_root / "artifacts" / "reconcile_checkpoint.json"
dst = repo_root / "artifacts" / "reconcile_checkpoint_FINAL.sanitized.json"

if not src.exists():
    print(f"ERROR: source not found: {src}", file=sys.stderr)
    sys.exit(1)

raw = json.loads(src.read_text())

sanitized = {}
for sat_id, entry in raw.items():
    clean = {k: v for k, v in entry.items() if k in KEEP_FIELDS}
    sanitized[sat_id] = clean

summary = {}
for entry in sanitized.values():
    s = entry.get("status", "unknown")
    summary[s] = summary.get(s, 0) + 1

output = {
    "_meta": {
        "total": len(sanitized),
        "summary": summary,
        "fingerprint": "6b220ec0c201c8d0fc04d02a71140804de04370dc209e8d18c77f6f675585c22",
        "note": "Sanitized checkpoint — principal emails and credential paths removed."
    },
    "satellites": sanitized
}

dst.write_text(json.dumps(output, indent=2))
print(f"Written {len(sanitized)} entries → {dst}")
for k, n in sorted(summary.items(), key=lambda x: -x[1]):
    print(f"  {k}: {n}")
