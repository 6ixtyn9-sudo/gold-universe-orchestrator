# Gold Universe Orchestrator

## What This Is
The Python orchestration layer for the Gold Universe sports betting ecosystem.
It connects to hundreds of Google Sheets "Satellite" spreadsheets, runs the
Ma Assayer purity engine on their betting data, and displays results in a live
dark-theme dashboard.

## Architecture

### Python Layer (runs in Replit)
| File | Purpose |
|------|---------|
| `app.py` | Flask web server — all API routes + background job threading |
| `auth/google_auth.py` | Google Service Account auth via gspread |
| `registry/satellite_registry.py` | Satellite CRUD + `registry/registry.json` persistence |
| `fetcher/sheet_fetcher.py` | Rate-limited batch fetcher (1.1s delay between API calls) |
| `assayer/assayer_engine.py` | Ma Assayer Python port — Wilson CI, grades, Banker/Robber tiers |
| `templates/dashboard.html` | Full dark-theme dashboard UI |

### Google Apps Script Layer (runs inside Google Sheets)
| Directory | Purpose |
|-----------|---------|
| `doc/` | Ma Golide Mothership scripts — Acca builder, HiveMind, etc. |
| `attached_assets/` | Repomix snapshots of Ma_Assayer and Ma_Golide_Satellites repos |

## Running Locally
- Workflow: `Start application` → `python3 app.py` on port 5000
- Host: `0.0.0.0` (required for Replit preview)

## The One Required Secret
Add `GOOGLE_SERVICE_ACCOUNT_JSON` to Replit Secrets with the full contents of
a Google Cloud service account JSON key file. Then share each satellite Google
Sheet with the service account email address.

## Banker vs Robber Classification
- **BANKER** = lower_bound >= 0.60 AND win_rate >= 0.72 (Gold+ grade)  
  OR lower_bound >= 0.55 AND win_rate >= 0.62 (Silver grade)
- **ROBBER** = n < 10 samples OR win_rate < 0.50 (use as fade)
- **NEUTRAL** = positive but uncertain

## Key Design Rules
- Manual control only — no automated triggers
- Rate limit: 1.1s between Google API calls
- Registry is a flat JSON file — no database
- Wilson z-score: 1.645 (80% one-sided CI)
- Shrinkage prior: Beta(2,2) toward 50%

## Satellite Format Detection
- **Gold Universe** sheets: Side, Totals, MA_Vault, MA_Discovery
- **Legacy** sheets: Predictions, Results, BetSlips

## Dependencies
flask, gspread, google-auth, google-auth-httplib2, google-auth-oauthlib
