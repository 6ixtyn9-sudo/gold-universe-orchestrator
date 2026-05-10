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

## Execution API Requirement Warning
If you choose NOT to delete duplicates and rely solely on trigger nuking (`--fix-triggers`), the tool MUST be able to execute `nukeAllTriggers` via the API. If the OAuth client lacks permission, is deleted, or lacks `scripts.run` capability, trigger cleanup will safely abort. If you see "Execution API unavailable; cannot nuke triggers", you should use the `--delete-duplicates` flag instead to ensure duplicates do not run unexpectedly.
