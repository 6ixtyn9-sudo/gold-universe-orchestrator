# Ghost Delete Verification Report

## Execution Summary
The hardened ghost delete tool has completed the processing of the `artifacts/ghost_sweeper_plan.json`.

**Total Processing Stats (from ledger):**
- **Total Attempts/Records:** 887
- **Successfully DELETED:** 381
- **SKIP_ALREADY_DELETED:** 377
- **SKIP_NO_DELETE_PERMISSION:** 127 (Stragglers)
- **FAIL_BACKUP:** 1 (Transient error during concurrent run)
- **FAIL_DELETE:** 0
- **SKIP_CANONICAL:** 0
- **SKIP_PARENT_MISMATCH:** 0

## Safety Verification
- **No Canonical Deletions:** All 381 deletions were non-canonical scripts. Sample verification confirms canonical scripts (e.g., `1UIQywY...`) remain active.
- **Backups Created:** All deleted scripts have metadata and content backups stored in `artifacts/deleted_ghost_backups/`.
- **Ledger Integrity:** Every action was recorded in `artifacts/ghost_delete_executed.jsonl` with fsync protection.

## Stragglers (Remaining Ghosts)
There are **127 scripts** that could not be deleted due to `SKIP_NO_DELETE_PERMISSION`. These scripts are likely owned by accounts not present in the current writer credential pool or have restrictive permissions.

**Sample Stragglers:**
| Script ID | Sheet ID | Reason |
|-----------|----------|--------|
| `1-Sahsmv...` | `1u5f9M...` | No delete permission with available pool |
| `1-btTMK-...` | `1Zy4Ne...` | No delete permission with available pool |
| `1-q0AI6q...` | `1opaGM...` | No delete permission with available pool |
| `1078qcMN...` | `10CxGS...` | No delete permission with available pool |

## Conclusion
The fleet is significantly cleaner. 381 ghosts were permanently removed, and 377 were confirmed as already gone. The remaining 127 stragglers require a wider credential pool or manual intervention if absolute parity is required.

**Graveyard Audit:**
A full Drive audit confirms `DUPLICATE_SCRIPTS: 0` for the first 500 satellites, meaning no Sheet currently has more than one bound script project visible to the automation pool.
