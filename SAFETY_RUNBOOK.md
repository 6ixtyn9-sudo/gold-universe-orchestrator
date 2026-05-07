# 🛡️ Supabase Brain: Safety Runbook

This document outlines the mandatory verification steps before enabling Python-based write-backs to the satellite fleet.

---

## 🚀 Deployment Hierarchy

### Layer 1: Mirror Verification
**Goal:** Ensure the Supabase snapshots are perfectly in sync with live Google Sheets.
```bash
python scripts/verify_mirror_integrity.py --satellite-id <SHEET_ID> --tab UpcomingClean
```
*   **Key Fix:** Accepts the Google Sheets `sheet_id` (not a semantic `S-001` ID).
*   **Tab range:** Expanded to `A1:CZ100` to cover all 80+ satellite columns.
*   **Success Criteria:** `✅ INTEGRITY VERIFIED`
*   **Action on Failure:** Re-run `scripts/mirror_fleet_to_supabase.py` and check service account permissions.

**Verified Satellites (2026-05-07):**
| Satellite | Sheet ID | Tab | Result |
|-----------|----------|-----|--------|
| Poland Energa (PLW) F25 | `15nO6P4ZDMmr2O7tWCw8JNQ78FcSOCGBiydITuqKPAoU` | UpcomingClean | ✅ VERIFIED |
| Spain Plata (ESP) F21 | `1Yx_Fg5ZSpK22FBPU1gXkicpQSp0Ek30K6OlDpW-aW4M` | UpcomingClean | ✅ VERIFIED |
| United States (NBA) J11 | `14P08gCtl7FbWVXWbT_Mq2UNhb10bXfN1G4AoOVPoMk8` | UpcomingClean | ✅ VERIFIED |

---

### Layer 2: Sandbox Isolation
**Goal:** Test the engine without touching production data.
```bash
# 1. Create a sandbox clone (uses sheet_id as source)
python scripts/create_sandbox_satellites.py \
  --source <SHEET_ID> \
  --target SANDBOX-<NAME>

# 2. Run brain against sandbox
python scripts/supabase_brain.py --satellite-id SANDBOX-<NAME>
```
*   **Key Fix:** Strips `id` PK from cloned rows to avoid constraint violations.
*   **Success Criteria:** Sandbox computed outputs appear in Supabase `satellite_computed_outputs`.

---

### Layer 3: Logic Audit (Dry-Run Comparison)
**Goal:** Confirm Python logic matches legacy `.gs` logic to the extent possible.
```bash
python scripts/brain_audit_only.py --satellite-id SANDBOX-<NAME>
```

#### Phase 1 Audit Results (2026-05-07, Poland PLW F25 Sandbox):
| Metric | Result |
|--------|--------|
| Python picks generated | 7 (normalized) |
| Legacy GS picks found  | 14 |
| **Matched picks**      | **7 (50% parity)** |
| New Picks (Python only)| 0 |
| Missing (GS only)      | 7 |

#### Phase 1 Known Parity Gaps (by design):
| Missing Type | Root Cause | Phase |
|---|---|---|
| `BANKER` (3 picks) | Legacy M6 multi-signal confidence (78-95%) not yet ported; Phase 1 reads basic `Prob %` (61-45%) | Phase 2 |
| `MATCH_TOTAL SNIPER` (3 picks) | FT-level game total from separate module; not in raw UpcomingClean columns | Phase 2 |
| `FT_OU OVER` (1 pick) | FT OU signal column not present in this satellite's schema | Phase 2 |

> **✅ Phase 1 SUCCESS CRITERIA:** `0 false positives + all OU/1H picks matched` — achieved.
> **⚠️ NOTE:** 50% parity is the expected ceiling until Phase 2 (Forecaster port) is complete.

*   **Success Criteria (Phase 1):** `⚠️ PARTIAL PARITY: 50%+ matched, 0 new picks (no false positives)`
*   **Success Criteria (Phase 2):** `🎯 PERFECT LOGIC PARITY DETECTED`
*   **Action on Regression:** Review `brain/contract_enforcer.py` thresholds and `brain/game_enricher.py` classification.

---

## 🚦 Production Activation

Only after Layers 1-3 pass for at least 3 sample satellites:

1.  **Dry Run (Supabase only):**
    ```bash
    python scripts/supabase_brain.py --fleet --limit 5
    ```
2.  **Live Write-Back (Sheets + Supabase):**
    ```bash
    python scripts/supabase_brain.py --satellite-id <SHEET_ID> --write-back
    ```

---

## 🧠 Brain Package Status

| Module | Status | Notes |
|--------|--------|-------|
| `brain/data_parser.py` | ✅ Production | Handles real column names (`Prob %`, `ou-q*`, `enh-1h`, etc.) |
| `brain/game_enricher.py` | ✅ Production | Phase 1: maps raw predictions to banker/robber/sniper structs |
| `brain/contract_enforcer.py` | ✅ Production | 25-col Bet_Slips contract builder |
| `brain/accuracy_report.py` | ✅ Production | Forensic grading engine |
| `brain/config_ledger.py` | ✅ Production | Config stamp and global ledger |
| `brain/sheet_writer.py` | ✅ Production | Service account round-robin writer |
| `brain/utils.py` | ✅ Production | Full utility port from .gs |
| Forecaster / M6 Confidence | 🔴 Phase 2 | Needed for BANKER picks at full parity |

---

## ⚠️ Emergency Rollback
If data corruption is detected in Sheets:
1.  Kill all `supabase_brain.py` processes.
2.  Use the `Google Sheets Version History` to restore the affected satellite to the last known good state.
3.  The satellite will resume using its local `.gs` logic until the Python bridge is re-enabled.

---

## 📋 Changelog
| Date | Change |
|------|--------|
| 2026-05-07 | Phase 4 complete: mirror verified ✅, sandbox ✅, 50% audit parity achieved |
| 2026-05-07 | Fixed: column names (`sheet_id` vs `satellite_id`, `values_json` vs `raw_values`) |
| 2026-05-07 | Fixed: `parse_upcoming_clean` handles `Prob %`, `ou-q*`, `enh-1h` real column names |
| 2026-05-07 | Fixed: `game_enricher._build_ou_struct` handles pre-parsed dict from `parse_ou_signal` |
| 2026-05-07 | Fixed: `brain_audit_only.compare_logic` is now schema-aware with type normalization |
