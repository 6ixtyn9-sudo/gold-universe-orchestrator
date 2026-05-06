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
* **Apps Script Properties**: Uses `SUPABASE_SYNC_URL` and `SUPABASE_BRIDGE_TOKEN`.

## 📍 Exact Current Status (Where we paused)
1. Edge Function deployed successfully with correct `Record<string, number>` TypeScript fix.
2. Bridge database tables (`satellite_sync_events`, `satellite_tab_snapshots`) created with RLS enabled.
3. `satellites` table verified to have `id` (uuid) and `sheet_id` (text).
4. The PLW satellite (Poland Energa F25) has the bridge deployed.
5. **Pending User Action**: The user needs to set the Script Properties in the PLW sheet, reload, click **Ma Golide → Sync This Satellite → Supabase**, and verify the HTTP 200 alert.

## 🚀 Next Immediate Phases (Roadmap)
* **Phase 1**: Confirm the manual sync worked for PLW in Supabase.
* **Phase 2 (Tier 2)**: Shift Antigravity deployment from OAuth to **Service Accounts**. The user has 5 service accounts ready to use. We need to write a script to batch-share all 500 satellites to these service accounts via Drive API, then deploy the bridge fleet-wide without quota limits.
* **Phase 3**: Write `scripts/run_assayer_from_supabase.py` to decouple the Assayer from scraping sheets, reading directly from `satellite_tab_snapshots` instead.

*(Note to AI: Do not ask the user for secrets, and do not echo secrets in chat if generated.)*
