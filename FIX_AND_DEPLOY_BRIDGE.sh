#!/usr/bin/env bash
# FIX_AND_DEPLOY_BRIDGE.sh
# One-shot: patch Edge Function, push, redeploy, verify.
# Run from repo root: bash FIX_AND_DEPLOY_BRIDGE.sh
set -euo pipefail

REPO="/Users/apple/Desktop/gold-universe-orchestrator"
FILE="supabase/functions/sync-satellite/index.ts"

cd "$REPO"

echo "════════════════════════════════════════════════════════════"
echo " STEP 1: Patch the broken Record type"
echo "════════════════════════════════════════════════════════════"

if grep -q "const row_counts: Record = {};" "$FILE"; then
  echo "Found broken line. Patching..."
  perl -i -pe 's/const row_counts: Record = \{\};/const row_counts: Record<string, number> = {};/g' "$FILE"
  echo "✅ Patched."
else
  echo "Broken line NOT found. Checking current state..."
  grep -n "row_counts" "$FILE" || echo "(no row_counts lines found)"
fi

echo ""
echo "Current row_counts lines:"
grep -n "row_counts" "$FILE" | head -5

echo ""
echo "════════════════════════════════════════════════════════════"
echo " STEP 2: Verify type is now correct"
echo "════════════════════════════════════════════════════════════"

if grep -q "const row_counts: Record<string, number> = {};" "$FILE"; then
  echo "✅ Type is correct: Record<string, number>"
else
  echo "❌ Type is NOT correct yet. Aborting."
  exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo " STEP 3: Commit and push"
echo "════════════════════════════════════════════════════════════"

git add "$FILE"
if git diff --cached --quiet; then
  echo "Nothing staged — file already at correct state on local."
else
  git commit -m "fix(edge): correct Record<string,number> type — final"
  git push origin main
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo " STEP 4: Verify origin/main has the fix"
echo "════════════════════════════════════════════════════════════"

git fetch origin main
echo "origin/main row_counts line:"
git show origin/main:"$FILE" | grep -n "row_counts" | head -3

echo ""
echo "════════════════════════════════════════════════════════════"
echo " STEP 5: Redeploy Edge Function"
echo "════════════════════════════════════════════════════════════"

supabase functions deploy sync-satellite

echo ""
echo "════════════════════════════════════════════════════════════"
echo " STEP 6: Verify BRIDGE_TOKEN secret is set"
echo "════════════════════════════════════════════════════════════"

supabase secrets list | grep -E "(BRIDGE_TOKEN|NAME)" || true

echo ""
echo "════════════════════════════════════════════════════════════"
echo " ✅ DONE"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "If BRIDGE_TOKEN is NOT in the secrets list above, run:"
echo "  TOKEN=\$(openssl rand -hex 32)"
echo "  echo \"Save this token (also paste into Apps Script SUPABASE_BRIDGE_TOKEN): \$TOKEN\""
echo "  supabase secrets set BRIDGE_TOKEN=\"\$TOKEN\""
echo ""
echo "Then test the bridge:"
echo "  python3 antigravity_deploy.py --bridge-only --limit 1 --dry-run"
echo "  python3 antigravity_deploy.py --bridge-only --limit 1"
