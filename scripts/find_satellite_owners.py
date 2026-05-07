#!/usr/bin/env python3
"""
find_satellite_owners.py
------------------------
For every satellite spreadsheet in registry/registry.json, ask Google Drive
who owns it. Groups results by owner email so you can see which Google
account owns the most satellites.

Uses any ALIVE token from creds/ — only needs Drive read scope, which all
your existing tokens already have.

Usage:
  python3 scripts/find_satellite_owners.py
  python3 scripts/find_satellite_owners.py --limit 50    # only check first 50
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
except ImportError:
    print("Missing deps. Run: pip install google-api-python-client google-auth")
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parent.parent
CREDS_DIR = REPO_ROOT / "creds"
REGISTRY = REPO_ROOT / "registry" / "registry.json"


def find_alive_creds() -> tuple[Credentials, Path] | tuple[None, None]:
    """Try every token_*.json in creds/ until one refreshes successfully."""
    # Check root token.json first
    token_files = [REPO_ROOT / "token.json"]
    if CREDS_DIR.exists():
        token_files.extend(sorted(CREDS_DIR.glob("token_*.json")))
    
    for token_file in token_files:
        if not token_file.exists():
            continue
        try:
            with token_file.open() as f:
                raw = json.load(f)
            creds = Credentials.from_authorized_user_info(raw, scopes=raw.get("scopes"))
            creds.refresh(Request())
            return creds, token_file
        except Exception:
            continue
    return None, None


def load_satellites() -> list[dict]:
    if not REGISTRY.exists():
        print(f"❌ {REGISTRY} not found")
        sys.exit(1)
    with REGISTRY.open() as f:
        data = json.load(f)
    sats = data.get("satellites", data if isinstance(data, list) else [])
    return sats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0,
                        help="Only check this many satellites (0 = all)")
    args = parser.parse_args()

    creds, token_file = find_alive_creds()
    if not creds:
        print("❌ No alive token found in creds/ or repo root")
        print("   Run: python3 scripts/audit_oauth_clients.py")
        return 1
    print(f"Using credentials from: {token_file.name}")

    sats = load_satellites()
    if args.limit:
        sats = sats[: args.limit]
    print(f"Checking ownership of {len(sats)} satellite(s)...")
    print()

    drive = build("drive", "v3", credentials=creds, cache_discovery=False)

    owner_counter: Counter[str] = Counter()
    owner_examples: dict[str, list[str]] = defaultdict(list)
    no_access: list[tuple[str, str]] = []
    missing_id: list[dict] = []

    for i, sat in enumerate(sats, 1):
        sheet_id = sat.get("sheet_id") or sat.get("id")
        name = sat.get("name") or sat.get("league") or "(unnamed)"
        if not sheet_id:
            missing_id.append(sat)
            continue

        try:
            meta = drive.files().get(
                fileId=sheet_id,
                fields="id,name,owners(emailAddress,displayName)",
                supportsAllDrives=True,
            ).execute()
        except HttpError as e:
            status = getattr(e.resp, "status", "?")
            no_access.append((name, f"HTTP {status}"))
            if i % 25 == 0:
                print(f"   ... checked {i}/{len(sats)}")
            continue
        except Exception as e:
            no_access.append((name, str(e)[:60]))
            continue

        owners = meta.get("owners", [])
        if not owners:
            no_access.append((name, "no owner field (likely shared drive)"))
            continue

        email = owners[0].get("emailAddress", "(unknown)")
        owner_counter[email] += 1
        if len(owner_examples[email]) < 3:
            owner_examples[email].append(name)

        if i % 25 == 0:
            print(f"   ... checked {i}/{len(sats)}")

    print()
    print("═" * 72)
    print(" SATELLITE OWNERSHIP — grouped by Google account")
    print("═" * 72)
    print()

    if not owner_counter:
        print(" ❌ Could not determine ownership of any satellite.")
        print("    Most likely: the token's account doesn't have read access")
        print("    to any of these sheets.")
    else:
        for email, count in owner_counter.most_common():
            print(f"  👤 {email}")
            print(f"      owns {count} satellite(s)")
            print(f"      examples:")
            for ex in owner_examples[email]:
                print(f"        • {ex}")
            print()

    if no_access:
        print(f"  ⚠️  {len(no_access)} satellite(s) the current token can't see")
        print(f"      (this token's owner doesn't have access to those sheets)")
        for name, reason in no_access[:5]:
            print(f"        • {name} — {reason}")
        if len(no_access) > 5:
            print(f"        ... and {len(no_access) - 5} more")
        print()

    if missing_id:
        print(f"  ⚠️  {len(missing_id)} satellite(s) have no sheet_id in registry")
        print()

    print("═" * 72)
    print(" RECOMMENDATION")
    print("═" * 72)
    if owner_counter:
        top_email, top_count = owner_counter.most_common(1)[0]
        print(f" Re-auth a slot whose owner is: {top_email}")
        print(f" That account owns {top_count} of the satellites you can see.")
        print()
        print(" Cross-reference with audit_oauth_clients.py output to find")
        print(" which slot number is owned by that email, then run:")
        print()
        print("   python3 scripts/auth_single_slot.py <slot_number>")
        print()
        print(" When the browser opens, sign in as:")
        print(f"   {top_email}")
    print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
