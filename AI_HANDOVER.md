# 🤖 AI Handover State: Gold Universe Orchestrator

## 🏗️ Architecture (The "Golden Path")
* **Google Sheets** = Strictly UI/UX frontend.
* **Supabase** = Source of truth and backend database.
* **Apps Script** = A tiny, lightweight bridge (`SupabaseBridge.gs`) that only POSTs payload data to Supabase.
* **Python/Edge Functions** = The computation engine (Assayer, Config Tuning, Mothership).

## 🔑 Crucial Environment Context
* **Correct Supabase Project**: `wbszxcotrsxsmlqamqac` ("Git4smartkids's Project" / Ma Golide).
  * *Note: Ignore `dorihyvbgbhsxvdrtqqr` (PAWS).*
* **Google Cloud / OAuth**: `esl4smartkids@gmail.com` owns all satellite sheets. The active OAuth client is in project `ma-golide-deploy-1` (Slot 1).
* **Supabase Edge Function**: `sync-satellite` is deployed and uses the secret `BRIDGE_TOKEN` (NOT `SUPABASE_BRIDGE_TOKEN`).
  * **Must be deployed with `--no-verify-jwt`** — the function performs its own `Authorization: Bearer <BRIDGE_TOKEN>` check internally. Without this flag, Supabase's API gateway intercepts the header, tries to parse the hex token as a JWT, and returns 401 `UNAUTHORIZED_INVALID_JWT_FORMAT` before the function ever runs.
  * **Redeploy command**:
    ```bash
    supabase functions deploy sync-satellite --no-verify-jwt --project-ref wbszxcotrsxsmlqamqac
    ```
* **Apps Script Properties (per satellite sheet)**: Uses `SUPABASE_SYNC_URL` and `SUPABASE_BRIDGE_TOKEN`.
  * `SUPABASE_SYNC_URL` = `https://wbszxcotrsxsmlqamqac.supabase.co/functions/v1/sync-satellite`
  * `SUPABASE_BRIDGE_TOKEN` = the value of the Supabase `BRIDGE_TOKEN` secret.

## 🔐 BRIDGE_TOKEN Lifecycle (read before touching the token)
* **Never echo the token to chat or stdout.** `supabase secrets list` only shows SHA-256 digests, NOT plaintext — a hex string in that output is a digest, not a leak.
* **Provisioning vs rotation are different operations.** Provisioning is a one-shot generate + set + paste-into-PLW. Rotation requires fleet-wide propagation (Phase 2 tooling) or it causes an immediate ~500-sheet outage.
* **Atomic generate + set + copy** (use this any time you need a fresh value):
  ```bash
  openssl rand -hex 32 | tr -d '\n' | tee >(pbcopy) | xargs -I{} \
    supabase secrets set BRIDGE_TOKEN={} --project-ref wbszxcotrsxsmlqamqac >/dev/null
  ```
* **Verify clipboard ↔ Supabase match** before pasting into Apps Script:
  ```bash
  pbpaste | tr -d '\n' | shasum -a 256 | awk '{print $1}'
  supabase secrets list --project-ref wbszxcotrsxsmlqamqac | grep BRIDGE_TOKEN
  ```
  The two hex strings must be identical.

## 📍 Exact Current Status (Where we are)
* ✅ Edge Function `sync-satellite` deployed to `wbszxcotrsxsmlqamqac` with `--no-verify-jwt`.
* ✅ Bridge database tables (`satellite_sync_events`, `satellite_tab_snapshots`) created with RLS enabled.
* ✅ `satellites` table verified to have `id` (uuid) and `sheet_id` (text); PLW is registered as `e55a36a2-fb04-4532-a87a-c67d1162882a`.
* ✅ `BRIDGE_TOKEN` provisioned in Supabase project secrets.
* ✅ PLW Script Properties (`SUPABASE_SYNC_URL`, `SUPABASE_BRIDGE_TOKEN`) set.
* ✅ **PLW manual sync verified end-to-end**: HTTP 200, `satellite_id` linked, 5 tabs / 120 rows ingested into `satellite_tab_snapshots`.

## 🚀 Next Immediate Phases (Roadmap)
* **Phase 2 (Tier 2) — Service-account fleet rollout.** Shift Antigravity deployment from OAuth to Service Accounts (5 ready). Steps:
  1. Write `scripts/share_fleet_to_service_accounts.py` — batch-share all ~500 satellite sheets to the 5 service accounts via Drive API (round-robin or capacity-based).
  2. Extend `antigravity_deploy.py --bridge-only` to use service-account auth instead of OAuth tokens, eliminating the per-user quota ceiling.
  3. Push `SupabaseBridge.gs` + Script Properties (`SUPABASE_SYNC_URL`, `SUPABASE_BRIDGE_TOKEN`) to every satellite via Apps Script API.
  4. Verify fleet-wide success by counting distinct `sheet_ids` in `satellite_sync_events` over the next 24h.
* **Phase 3 — Decouple Assayer from sheets.** Write `scripts/run_assayer_from_supabase.py` to read directly from `satellite_tab_snapshots` instead of scraping sheets. Eliminates Sheets API quota pressure on the analysis side.
* **Phase 4 (do NOT start until Phase 2 ships) — Rotation tooling.** Implement overlap-rotation:
  1. Set `BRIDGE_TOKEN_NEW` alongside `BRIDGE_TOKEN`.
  2. Edge Function accepts either, for a grace window.
  3. Push new value to all satellites' Script Properties via the Phase 2 Apps Script API path.
  4. Verify all satellites are sending the new token.
  5. Promote: `BRIDGE_TOKEN` = `<new>`, drop `BRIDGE_TOKEN_NEW`, remove dual-accept code.
  6. Schedule rotations only after this exists. ~90-day cadence is reasonable.

## ⚠️ Notes for the next AI agent
* **Do not ask the user for secrets, and do not echo secrets in chat if generated.**
* `supabase secrets list` shows digests, not values. A 64-char hex string in that output is SHA-256, not the secret itself. Do not panic-rotate based on seeing it.
* `--no-verify-jwt` is load-bearing for `sync-satellite`. Any future redeploy must include it or the bridge breaks.
* When pasting multi-line shell snippets to the user, avoid bash comments containing apostrophes (e.g. `# what's…`) — they trigger the `quote>` continuation prompt.
