# 🛠️ OAUTH RECOVERY PLAN

We've identified that many OAuth clients are dead or missing critical scopes. This plan outlines how to restore a single working slot to prove the bridge end-to-end.

## 1. Audit the Damage 🔍
- [x] Run `python3 scripts/audit_oauth_clients.py`.
- [ ] Identify which slots are `DEAD` or `MISSING_SCOPES`.
- [ ] Note: Slots 1-15 are mostly alive but missing `script.deployments` and `script.external_request`.

## 2. Prepare a Fresh Client 🆕
- [ ] Go to [Google Cloud Console](https://console.cloud.google.com/).
- [ ] Select a project that you own (e.g., `ma-golide-deploy-5` or create a new one).
- [ ] Go to **APIs & Services > Credentials**.
- [ ] Create an **OAuth 2.0 Client ID** (Desktop Application).
- [ ] Download the JSON and save it as `credentials_0.json` in the repo root.

## 3. Authorize the Slot 🔑
- [ ] Run the recovery script:
  ```bash
  python3 scripts/auth_single_slot.py 0
  ```
- [ ] Complete the browser flow. Ensure you see the "External Requests" scope.

## 4. Test the Bridge 🚀
- [ ] Run a limited deployment:
  ```bash
  python3 antigravity_deploy.py --bridge-only --limit 1
  ```
- [ ] Verify the bridge menu appears in the target sheet.

## 5. Fleet Restoration (Optional) 🌊
- [ ] Once slot 0 is proven, repeat for other slots or update `credentials_1.json` etc. with fresh clients.
