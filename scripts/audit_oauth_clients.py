#!/usr/bin/env python3
"""
audit_oauth_clients.py
----------------------
Inspects every credentials_*.json and token_*.json under the repo and prints:

  - Which Google Cloud project each OAuth client belongs to
  - Which Google account each token was issued to (the "user" who clicked allow)
  - Whether the client appears alive (token can refresh) or DELETED
  - The scopes currently granted on each token

Read-only. Touches nothing. Safe to run anytime.

Usage:
  python3 scripts/audit_oauth_clients.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Optional

try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    import requests
except ImportError:
    print("Missing deps. Run: pip install google-auth google-auth-oauthlib requests")
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parent.parent
CREDS_DIR = REPO_ROOT / "creds"
BACKUP_DIR_GLOB = "creds_backup*"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_load_json(p: Path) -> Optional[dict]:
    try:
        with p.open("r") as f:
            return json.load(f)
    except Exception as e:
        print(f"   ⚠️  Cannot parse {p.name}: {e}")
        return None


def parse_credentials_file(p: Path) -> dict:
    """credentials_*.json = the OAuth client definition (downloaded from GCP)."""
    data = _safe_load_json(p) or {}
    blob = data.get("installed") or data.get("web") or {}
    return {
        "file": p.name,
        "client_id": blob.get("client_id", ""),
        "project_id": blob.get("project_id", ""),
        "auth_uri": blob.get("auth_uri", ""),
        "client_secret_present": bool(blob.get("client_secret")),
    }


def parse_token_file(p: Path) -> dict:
    """token_*.json = the user-granted authorization."""
    data = _safe_load_json(p) or {}
    return {
        "file": p.name,
        "client_id": data.get("client_id", ""),
        "refresh_token_present": bool(data.get("refresh_token")),
        "scopes": data.get("scopes", []),
        "token_uri": data.get("token_uri", ""),
        "raw": data,
    }


def probe_token(token_data: dict) -> dict:
    """
    Try to refresh the token. Returns liveness info + the Google account
    that originally authorized it (via tokeninfo / userinfo).
    """
    out = {"alive": False, "email": None, "error": None, "new_access_token": None}

    raw = token_data.get("raw") or {}
    if not raw.get("refresh_token"):
        out["error"] = "no_refresh_token"
        return out

    try:
        creds = Credentials.from_authorized_user_info(raw, scopes=raw.get("scopes"))
        creds.refresh(Request())
        out["alive"] = True
        out["new_access_token"] = creds.token
    except Exception as e:
        msg = str(e)
        out["error"] = msg
        # Common messages we want to surface clearly:
        if "deleted_client" in msg:
            out["error"] = "DELETED_CLIENT (OAuth client removed in GCP)"
        elif "invalid_grant" in msg:
            out["error"] = "INVALID_GRANT (user revoked or token expired)"
        elif "invalid_client" in msg:
            out["error"] = "INVALID_CLIENT (client_id/secret mismatch)"
        return out

    # If alive, ask Google who owns the token
    try:
        r = requests.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {out['new_access_token']}"},
            timeout=10,
        )
        if r.ok:
            out["email"] = r.json().get("email")
    except Exception:
        pass

    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def collect_credentials_files() -> list[Path]:
    files = []
    # Top-level credentials_*.json
    files.extend(sorted(REPO_ROOT.glob("credentials_*.json")))
    files.extend(sorted(REPO_ROOT.glob("credentials.json")))
    files.extend(sorted(REPO_ROOT.glob("client_secret*.json")))
    # Inside creds/
    if CREDS_DIR.exists():
        files.extend(sorted(CREDS_DIR.glob("credentials_*.json")))
        files.extend(sorted(CREDS_DIR.glob("client_secret*.json")))
    # De-dupe while preserving order
    seen = set()
    out = []
    for p in files:
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def collect_token_files() -> list[Path]:
    files = []
    # Top-level
    if (REPO_ROOT / "token.json").exists():
        files.append(REPO_ROOT / "token.json")
    # creds/
    if CREDS_DIR.exists():
        files.extend(sorted(CREDS_DIR.glob("token_*.json")))
        if (CREDS_DIR / "token.json").exists():
            files.append(CREDS_DIR / "token.json")
    # Backup folders (read-only inspection)
    for backup in sorted(REPO_ROOT.glob(BACKUP_DIR_GLOB)):
        if backup.is_dir():
            files.extend(sorted(backup.glob("token*.json")))
    seen = set()
    out = []
    for p in files:
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def main() -> int:
    print("═" * 72)
    print(" OAuth Audit — Gold Universe Orchestrator")
    print("═" * 72)
    print(f" Repo root: {REPO_ROOT}")
    print()

    # 1. Credentials files (the OAuth client definitions)
    cred_files = collect_credentials_files()
    print(f"📄 Found {len(cred_files)} credentials/client_secret file(s):")
    print()

    by_client_id: dict[str, dict] = {}
    if not cred_files:
        print("   (none — you have no OAuth client definitions checked in)")
    for p in cred_files:
        info = parse_credentials_file(p)
        cid = info["client_id"]
        print(f"   {p.relative_to(REPO_ROOT)}")
        print(f"      client_id   : {cid or '(missing)'}")
        print(f"      project_id  : {info['project_id'] or '(missing)'}")
        print(f"      has_secret  : {info['client_secret_present']}")
        print()
        if cid:
            by_client_id[cid] = info

    # 2. Token files (the user grants)
    token_files = collect_token_files()
    print("─" * 72)
    print(f"🔑 Found {len(token_files)} token file(s):")
    print()

    summary_rows = []

    for p in token_files:
        rel = str(p.relative_to(REPO_ROOT))
        is_backup = "creds_backup" in rel
        prefix = "🗄️  [backup] " if is_backup else "📌 [active]  "
        print(f"{prefix}{rel}")

        tok = parse_token_file(p)
        cid = tok["client_id"]
        cred_info = by_client_id.get(cid)

        if cred_info:
            print(f"      → matches {cred_info['file']} (project {cred_info['project_id']})")
        elif cid:
            print(f"      → client_id {cid[:25]}... NOT matched to any credentials_*.json")
        else:
            print("      → token has no client_id field")

        print(f"      scopes      : {len(tok['scopes'])} scope(s)")
        for s in tok["scopes"]:
            short = s.replace("https://www.googleapis.com/auth/", "")
            print(f"                    • {short}")

        # Probe liveness
        probe = probe_token(tok)
        if probe["alive"]:
            email = probe["email"] or "(unknown account)"
            print(f"      status      : ✅ ALIVE  — owned by {email}")
        else:
            err = probe["error"] or "unknown error"
            print(f"      status      : ❌ DEAD   — {err}")

        summary_rows.append({
            "file": rel,
            "client_id": cid,
            "project_id": (cred_info or {}).get("project_id", ""),
            "email": probe.get("email"),
            "alive": probe["alive"],
            "error": probe.get("error"),
            "scopes": tok["scopes"],
        })
        print()

    # 3. Summary table grouped by Google account
    print("═" * 72)
    print(" SUMMARY — grouped by Google account")
    print("═" * 72)

    by_email: dict[str, list[dict]] = {}
    dead_rows: list[dict] = []
    for row in summary_rows:
        if row["alive"] and row["email"]:
            by_email.setdefault(row["email"], []).append(row)
        else:
            dead_rows.append(row)

    if not by_email:
        print(" (no live tokens)")
    for email, rows in sorted(by_email.items()):
        print(f"\n👤 {email}")
        for r in rows:
            print(f"     {r['file']}")
            print(f"        client_id  : {r['client_id'][:30]}...")
            print(f"        project_id : {r['project_id'] or '(unknown)'}")

    if dead_rows:
        print(f"\n💀 Dead tokens ({len(dead_rows)}):")
        for r in dead_rows:
            print(f"     {r['file']}")
            print(f"        client_id  : {(r['client_id'] or '(none)')[:30]}...")
            print(f"        project_id : {r['project_id'] or '(unknown)'}")
            print(f"        reason     : {r['error']}")

    # 4. Required scopes reminder
    print()
    print("═" * 72)
    print(" REQUIRED SCOPES for bridge deployment")
    print("═" * 72)
    required = [
        "https://www.googleapis.com/auth/script.projects",
        "https://www.googleapis.com/auth/script.deployments",
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/script.external_request",
    ]
    for s in required:
        print(f"   • {s}")
    print()

    # 5. Per-token scope diff
    print(" SCOPE GAPS on live tokens:")
    any_gaps = False
    for row in summary_rows:
        if not row["alive"]:
            continue
        missing = [s for s in required if s not in row["scopes"]]
        if missing:
            any_gaps = True
            print(f"   {row['file']} ({row['email']}) is missing:")
            for m in missing:
                print(f"       - {m}")
    if not any_gaps:
        print("   ✅ all live tokens have the required scopes")

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
