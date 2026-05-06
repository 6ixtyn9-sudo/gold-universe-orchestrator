# 🤖 AI Handover State: Gold Universe Orchestrator

## 🏗️ Architecture: Central Mirror (New)
The fleet has transitioned from a "Push" (Bridge) architecture to a "Pull" (Mirror) architecture.
- **Satellites**: 501 Google Sheets in `Ma_Golide_Satellites` folder.
- **Mirror Script**: `scripts/mirror_fleet_to_supabase.py` pulls data directly via Sheets API.
- **Auth**: 4 Service Accounts (`credentials_11.json` to `credentials_14.json`) have Viewer access to the entire fleet folder.
- **Supabase**: Raw 2D arrays are upserted into `satellite_tab_snapshots`.

## 🔑 Crucial Environment Context
- **Supabase Project**: `wbszxcotrsxsmlqamqac` (Ma Golide).
- **Service Accounts**: Round-robin usage via `mirror_fleet_to_supabase.py`.
- **Database Unique Constraint**: `uq_snapshot_sheet_tab` on `(sheet_id, tab_name)` enables idempotent upserts.

## 📍 Exact Current Status
- ✅ **Phase 1 (Validation)**: Completed via PLW bridge.
- ✅ **Phase 2 (Fleet Rollout)**: Transitioned to Mirror architecture.
- ✅ **Migration**: `supabase/migrations/20250601_mirror_schema.sql` applied.
- ✅ **Mirroring**: Full fleet (501 units) mirroring in progress.

## 🚀 Next Immediate Phases
1. **Phase 3: Assayer Decoupling**: Update Assayer to read from `satellite_tab_snapshots` instead of live sheets.
2. **Phase 4: Monitoring**: Build a dashboard to monitor `last_mirrored_at` and `error_message` in Supabase.

## ⚠️ Notes for the next AI agent
- Use `scripts/mirror_fleet_to_supabase.py` for all fleet-wide data ingestion.
- The `anon` key in `.env` (`SUPABASE_SERVICE_KEY`) currently has write access to the bridge tables.
- Do not attempt to deploy the Apps Script bridge to the remaining 500 sheets unless explicitly requested; the mirror architecture makes it unnecessary.
