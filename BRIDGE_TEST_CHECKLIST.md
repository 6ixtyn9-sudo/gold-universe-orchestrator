# 🌉 BRIDGE_TEST_CHECKLIST.md

Follow this checklist to ensure the Supabase Bridge is fully operational and secure.

## 0. Security Cleanup 🛑
- [ ] **Rotate SUPABASE_SERVICE_ROLE_KEY**: You pasted it in plain text. Go to Supabase Dashboard -> Project Settings -> API and rotate the secret.
- [ ] **Update local .env**: Replace the old key with the new one in your local `.env` file.

## 1. Secret Configuration 🔐
- [ ] **Generate BRIDGE_TOKEN**: 
  ```bash
  TOKEN=$(openssl rand -hex 32)
  echo $TOKEN
  ```
- [ ] **Set Supabase Secret**:
  ```bash
  supabase secrets set BRIDGE_TOKEN="<YOUR_TOKEN>"
  ```
- [ ] **Verify Secret**:
  ```bash
  supabase secrets list | grep BRIDGE_TOKEN
  ```

## 2. SQL Schema Verification 📊
- [ ] **Check Tables**: Run the following in the Supabase SQL Editor:
  ```sql
  select to_regclass('public.satellite_sync_events'), to_regclass('public.satellite_tab_snapshots');
  ```
- [ ] **Apply Migration (if missing)**: If tables are missing, run the contents of `supabase/bridge_schema.sql`.

## 3. Google Auth Refresh 🔑
- [ ] **Clear Old Tokens**:
  ```bash
  rm -f token.json creds/token_*.json
  ```
- [ ] **Re-authenticate**:
  ```bash
  python3 scripts/auth_all_projects.py
  ```

## 4. Bridge Deployment Test 🚀
- [ ] **Dry-run**:
  ```bash
  python3 antigravity_deploy.py --bridge-only --limit 1 --dry-run
  ```
- [ ] **Deploy to 1 Satellite**:
  ```bash
  python3 antigravity_deploy.py --bridge-only --limit 1
  ```

## 5. Apps Script Configuration 🛠️
- [ ] **Set SUPABASE_SYNC_URL**: In the Google Sheet Apps Script (Project Settings -> Script Properties):
  - Key: `SUPABASE_SYNC_URL`
  - Value: `https://<PROJECT_ID>.supabase.co/functions/v1/sync-satellite`
- [ ] **Set SUPABASE_BRIDGE_TOKEN**:
  - Key: `SUPABASE_BRIDGE_TOKEN`
  - Value: `<YOUR_TOKEN>`

## 6. Live UI Test 🧪
- [ ] **Reload Sheet**: Open the satellite sheet and reload.
- [ ] **Trigger Sync**: Select `Ma Golide` -> `Sync This Satellite → Supabase` from the menu.
- [ ] **Check Response**: Verify it returns `{"ok": true, ...}`.

## 7. Supabase Verification ✅
- [ ] **Check Events**: `select * from satellite_sync_events order by created_at desc limit 1;`
- [ ] **Check Snapshots**: `select * from satellite_tab_snapshots order by created_at desc limit 5;`

## 8. Troubleshooting Table 🛠️

| Symptom | Check | Fix |
| :--- | :--- | :--- |
| `BRIDGE_TOKEN is not configured` | Supabase Secrets | `supabase secrets set BRIDGE_TOKEN=...` |
| `Unauthorized` | Auth Header / Token | Match Apps Script token to Supabase secret |
| `PGRST116` / Satellite not found | Registry / DB | Ensure `sheet_id` in `satellites` table matches Google Sheet ID |
| `invalid_scope` | Google Auth | Re-run `auth_all_projects.py` with `external_request` scope |
| Menu not appearing | Deployment | Re-run `antigravity_deploy.py --bridge-only` |
