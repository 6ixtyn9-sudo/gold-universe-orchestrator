# Satellite Reconciler & Auth Auditing

This toolkit safely deduplicates and reconciles Apps Script projects bound to the earliest satellite spreadsheets, ensuring we converge to **one canonical script project per sheet** while maintaining the multi-`.gs` module structure natively used by the satellites.

## Folder Ownership & Credentials (`esl4smartkids@gmail.com`)
The Google Drive folder containing all satellite spreadsheets is controlled by `esl4smartkids@gmail.com`. There are ~15 Google credential “keys” in use.
- **Recommendation:** Use OAuth logged into `esl4smartkids@gmail.com` OR ensure you share the target folder with the chosen service account as an Editor.
- Because there are multiple credentials, the tooling provides strict token cache isolation so that using one key doesn't clobber the token of another.

---

## 1. Auditing the 15 Keys

Before running the reconciler, you should figure out which of the credentials actually work.

### Run the Key Auditor
```bash
python3 scripts/audit_google_keys.py --keys-dir <DIR> --sample-size 5
```
This script tests each key file it finds, identifying whether it is a Service Account or OAuth client, and verifies if it has actual access to the registry's satellite spreadsheets and the ability to discover their bound scripts.

### Common Errors
- **`deleted_client`**: This means the OAuth client credential in the `.json` file was deleted from the Google Cloud Console. 
  - **Fix steps:** Replace the credentials JSON with a fresh one from GCP, delete the token cache file associated with the old client, re-authenticate, and ensure the Drive API + Apps Script API are enabled.

---

## 2. Running the Reconciler

Once you have a working key, you must provide it explicitly to the reconciler so it doesn't fail silently.

### A. Provide an explicit credential file
```bash
python3 scripts/reconcile_earliest_150_bound_scripts.py --credentials <FILE> --limit 150 --dry-run
```

### B. Auto-pick a working credential
The script can automatically run the audit logic and pick the first credential that successfully tests against the spreadsheets:
```bash
python3 scripts/reconcile_earliest_150_bound_scripts.py --keys-dir <DIR> --auto-pick-key --limit 150 --dry-run
```

### Modes of Execution

- **Dry Run (Safest, Default):**
  Executes logic without modifying registry or remote Apps Script projects.
  ```bash
  python3 scripts/reconcile_earliest_150_bound_scripts.py --auto-pick-key --limit 150 --dry-run
  ```

- **Apply Canonical Sync + Safe Trigger Nuking:**
  Updates the registry, pushes latest modules, backs up duplicate source files, and cleanly injects `fix_triggers.gs` to disable leftover duplicate triggers.
  > **Note**: This requires Apps Script API `scripts.run` enabled, and execution scopes granted. If it fails, duplicate triggers may persist.
  ```bash
  python3 scripts/reconcile_earliest_150_bound_scripts.py --auto-pick-key --limit 150 --force
  ```

- **Apply Canonical Sync + DELETE Duplicates (Recommended):**
  Updates canonical script, backs up duplicates to local disk, and permanently deletes the duplicate `.gs` bound projects via Drive API. 
  > **Safest state**: Guarantees stray triggers can never fire again.
  ```bash
  python3 scripts/reconcile_earliest_150_bound_scripts.py --auto-pick-key --limit 150 --force --delete-duplicates
  ```

## 3. Script Writer Pool (Quota Spreading)

When running on the entire fleet, creating or updating Apps Script projects will inevitably hit `429 Quota Exhausted` limits on `script.googleapis.com`. This quota is primarily tied to the **user principal** (the Google account authorizing the OAuth token), not just the client ID.

To "max out" processing across the fleet, the reconciler supports a **Script Credential Pool**:

```bash
python3 scripts/reconcile_earliest_150_bound_scripts.py \
  --drive-credentials credentials_drive.json \
  --script-credentials-file scripts/script_creds_pool.txt \
  --rotate-on-429 \
  --limit 0 --force
```

### What actually spreads quota
Multiple OAuth **client IDs** do not help if they all authenticate as the same user. Quota spreading requires multiple **user principals** (different Google accounts) that have permission to create/update scripts on the spreadsheets.

### How to set up a new writer user
To add a new Google account to the pool:
1. Share the Drive folder `Ma_Golide_Satellites` to that new Google account as **Editor**. *(Warning: "Anyone with link can edit" is very permissive; restrict if possible by inviting explicitly).*
2. Log in once via `--interactive-oauth` using that new account so the token gets cached:
   ```bash
   python3 scripts/reconcile_earliest_150_bound_scripts.py --script-credentials new_creds.json --interactive-oauth --limit 1 --dry-run
   ```
3. Visit and **enable Apps Script API** in user settings for that account: `https://script.google.com/home/usersettings`
4. Verify the credential passes preflight tests:
   ```bash
   python3 scripts/audit_google_keys.py --keys-dir <dir> --script-preflight create
   ```
   (You should see `DRIVE_OK_SCRIPT_OK`)

If a credential hits a 429, the pool will automatically place it in cooldown (default 900s) and rotate to the next ready credential.

---

## Execution API Requirement Warning
If you choose NOT to delete duplicates and rely solely on trigger nuking (`--fix-triggers`), the tool MUST be able to execute `nukeAllTriggers` via the API. If the OAuth client lacks permission, is deleted, or lacks `scripts.run` capability, trigger cleanup will safely abort. If you see "Execution API unavailable; cannot nuke triggers", you should use the `--delete-duplicates` flag instead to ensure duplicates do not run unexpectedly.
