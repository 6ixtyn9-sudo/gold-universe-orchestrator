import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone

REGISTRY_PATH = Path("registry/registry.json")
FINGERPRINT_PATH = Path("registry/registry_fingerprint.json")

def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

if not REGISTRY_PATH.exists():
    raise SystemExit("Missing registry/registry.json (run populate step first)")

data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))

for k in ("last_updated", "source", "satellites"):
    if k not in data:
        raise SystemExit(f"Registry missing key: {k}")

src = data["source"]
if src.get("type") != "google_drive_folder":
    raise SystemExit(f"Unexpected source.type: {src.get('type')}")
folder_id = (src.get("folder_id") or "").strip()
if not folder_id:
    raise SystemExit("Missing source.folder_id")

sats = data["satellites"]
if not isinstance(sats, list):
    raise SystemExit("satellites must be a list")

ids = []
bad = 0
for s in sats:
    sid = (s.get("id") or "").strip()
    name = (s.get("name") or "").strip()
    if not sid or not name:
        bad += 1
    ids.append(sid)

if bad:
    raise SystemExit(f"{bad} satellites missing id and/or name")

if len(ids) != len(set(ids)):
    raise SystemExit("Duplicate spreadsheet IDs found")

count_found = src.get("count_found")
if isinstance(count_found, int) and count_found != len(sats):
    raise SystemExit(f"source.count_found ({count_found}) != len(satellites) ({len(sats)})")

canonical = "\n".join(sorted(f"{s['id']}|{s['name']}" for s in sats)).encode("utf-8")

fp = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "folder_id": folder_id,
    "satellite_count": len(sats),
    "sha256_id_name_pairs": sha256(canonical),
    "first_10_ids": sorted(ids)[:10],
}

FINGERPRINT_PATH.write_text(json.dumps(fp, indent=2), encoding="utf-8")

print("✅ Registry validation passed")
print("✅ Satellites:", len(sats))
print("✅ Fingerprint written:", str(FINGERPRINT_PATH))
print("✅ sha256:", fp["sha256_id_name_pairs"])
