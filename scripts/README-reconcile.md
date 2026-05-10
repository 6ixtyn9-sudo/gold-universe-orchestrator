# Satellite Reconciler: Earliest Bound Scripts

This script safely deduplicates and reconciles Apps Script projects bound to the earliest satellite spreadsheets. It converges the fleet to **one canonical script project per sheet** while maintaining the multi-`.gs` module structure natively used by the satellites.

## Core Capabilities
- **Strict Sorting**: Sorts spreadsheets by `added_at` ascending. Falls back to Drive `createdTime` ONLY via an explicit `--sort-by drive_created_time` flag.
- **Dynamic Payload Verification**: Extracts the expected `.gs` module list directly from `Ma_Golide_Satellites/docs/` and verifies every canonical project matches it exactly.
- **Safe Duplicate Backups**: Automatically backs up all duplicate project source files to `artifacts/dupe-script-backups/<sheet_id>/` before doing anything to them.
- **Trigger Deletion**: Dynamically attempts to remove lingering triggers from non-canonical duplicate projects safely, testing the Apps Script Execution API for access first.
- **Duplicate Deletion**: Can permanently delete duplicate bound projects using the Drive API (supporting Shared Drives).

---

## How to Run

### 1. Dry Run (Safest, Default)
Executes logic without modifying registry or remote Apps Script projects.
```bash
python3 scripts/reconcile_earliest_150_bound_scripts.py --limit 150 --dry-run
```

### 2. Apply Canonical Sync + Safe Trigger Nuking
Updates the registry to point to the canonical script, pushes latest modules, backs up duplicate source files, and cleanly injects `fix_triggers.gs` to disable leftover duplicate triggers.
> **Note**: This requires Apps Script API `scripts.run` enabled, and execution scopes granted. If it fails, duplicate triggers may persist.
```bash
python3 scripts/reconcile_earliest_150_bound_scripts.py --limit 150 --force
```

### 3. Apply Canonical Sync + DELETE Duplicates (Recommended)
Updates canonical script, backs up duplicates to local disk, and permanently deletes the duplicate `.gs` bound projects via Drive API. 
> **Safest state**: Guarantees stray triggers can never fire again.
```bash
python3 scripts/reconcile_earliest_150_bound_scripts.py --limit 150 --force --delete-duplicates
```

---

## Execution API Requirement Warning
If you choose NOT to delete duplicates and rely solely on trigger nuking (`--fix-triggers` which is true by default), the tool MUST be able to execute `nukeAllTriggers` via the API. 
If the OAuth client lacks permission, is deleted, or lacks `scripts.run` capability, trigger cleanup will safely abort. If you see "cannot execute Apps Script functions; trigger cleanup skipped" in the logs, you should use the `--delete-duplicates` flag instead to ensure duplicates do not run unexpectedly.
