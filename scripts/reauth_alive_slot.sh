#!/usr/bin/env bash
# reauth_alive_slot.sh
# Re-authorize a slot that's still ALIVE (parent OAuth client exists in GCP)
# but whose token is missing scopes. No new credentials_*.json needed.
#
# Usage:
#   bash scripts/reauth_alive_slot.sh <slot_number>
#
# Example:
#   bash scripts/reauth_alive_slot.sh 1
set -euo pipefail

REPO="/Users/apple/Desktop/gold-universe-orchestrator"
cd "$REPO"

SLOT="${1:-}"
if [[ -z "$SLOT" ]]; then
  echo "Usage: bash scripts/reauth_alive_slot.sh <slot_number>"
  echo ""
  echo "Available alive slots (run audit first if unsure):"
  echo "  python3 scripts/audit_oauth_clients.py | grep -A 1 'ALIVE'"
  exit 2
fi

CRED_FILE=""
# Check root, then creds/, then backup
for candidate in \
    "credentials_${SLOT}.json" \
    "creds/credentials_${SLOT}.json" \
    "creds_backup_*/credentials_${SLOT}.json"
do
  # Handle glob expansion for backups
  for f in $candidate; do
    if [[ -f "$f" ]]; then
      CRED_FILE="$f"
      break 2
    fi
  done
done

if [[ -z "$CRED_FILE" ]]; then
  echo "❌ Cannot find credentials_${SLOT}.json anywhere in the repo."
  echo ""
  echo "Looked for:"
  echo "  - credentials_${SLOT}.json"
  echo "  - creds/credentials_${SLOT}.json"
  echo "  - creds_backup_*/credentials_${SLOT}.json"
  echo ""
  echo "If the file is in a backup folder, copy it to the repo root:"
  echo "  cp creds_backup_*/credentials_${SLOT}.json ./credentials_${SLOT}.json"
  exit 1
fi

echo "Found OAuth client definition: $CRED_FILE"

# Make sure it's where auth_single_slot.py looks
if [[ "$CRED_FILE" != "credentials_${SLOT}.json" ]]; then
  cp "$CRED_FILE" "credentials_${SLOT}.json"
  echo "Copied to: credentials_${SLOT}.json"
fi

# Remove the old too-narrow token so we get fresh consent
rm -f "creds/token_${SLOT}.json"
echo "Removed old creds/token_${SLOT}.json (will be recreated with full scopes)"
echo ""

python3 scripts/auth_single_slot.py "$SLOT"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " Verifying the new token..."
echo "═══════════════════════════════════════════════════════════════"
python3 scripts/audit_oauth_clients.py | grep -A 6 "token_${SLOT}.json" | head -20
