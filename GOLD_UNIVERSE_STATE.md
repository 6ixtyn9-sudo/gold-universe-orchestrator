# Gold Universe — State Snapshot
**Generated:** 2026-04-15  
**Status:** Active build — Orchestrator running. Google auth pending secret injection.

---

## 1. Repository & Directory Map

```
gold-universe-orchestrator/
├── app.py                          Flask web server — all API routes + background job threading
├── main.py                         Entry point (imports from app.py)
├── pyproject.toml                  Python dependencies
├── replit.md                       Project memory / architecture notes
├── GOLD_UNIVERSE_STATE.md          THIS FILE — state snapshot
├── orchestrator_backup.py          Single-file backup of all Orchestrator logic
│
├── auth/
│   └── google_auth.py              Google Service Account auth via gspread
│
├── registry/
│   ├── satellite_registry.py       Satellite CRUD + registry.json persistence
│   └── registry.json               (auto-created) flat JSON list of satellites
│
├── fetcher/
│   └── sheet_fetcher.py            Rate-limited batch fetcher (1.1s delay)
│
├── assayer/
│   └── assayer_engine.py           Ma Assayer Python port (Wilson CI, grades, tiers)
│
├── templates/
│   └── dashboard.html              Full dark-theme dashboard UI
│
├── doc/                            Ma Golide Mothership .gs files
├── attached_assets/                Repomix snapshots of all 3 repos
└── server.py                       (legacy static viewer — replaced by Flask app)
```

---

## 2. Architecture Summary

```
Satellite Google Sheets (hundreds)
        ↓  (gspread, rate-limited 1.1s)
  fetcher/sheet_fetcher.py
        ↓
  assayer/assayer_engine.py   ← Wilson CI + Banker/Robber classification
        ↓
  registry/satellite_registry.py  ← registry.json (flat file DB)
        ↓
  app.py (Flask)  →  templates/dashboard.html
```

---

## 3. Banker vs Robber Classification

```
BANKER  = lower_bound >= 0.60 AND win_rate >= 0.72  (Gold+ grade)
        OR lower_bound >= 0.55 AND win_rate >= 0.62  (Silver grade)
ROBBER  = n < 10 (too few samples)
        OR win_rate < 0.50 (below coinflip — use as fade)
NEUTRAL = everything else (positive but uncertain)

MIN_LIFT  = abs(win_rate - 0.50) >= 0.03 (minimum edge to qualify)
WILSON_Z  = 1.645 (80% one-sided CI)
Shrinkage = Bayesian Beta(2, 2) prior toward 50%
```

---

## 4. Grade Thresholds

| Grade    | Win Rate |
|----------|----------|
| PLATINUM | >= 80%   |
| GOLD     | >= 70%   |
| SILVER   | >= 60%   |
| BRONZE   | >= 55%   |
| CHARCOAL | >= 50%   |
| DUST     | < 50%    |

---

## 5. The One Thing Still Needed

**Google Service Account JSON** must be added to Replit Secrets:

1. Go to https://console.cloud.google.com
2. IAM & Admin → Service Accounts → Create a Service Account
3. Create a JSON key → download the .json file
4. In Replit: Secrets tab → Add secret:
   - Key:   `GOOGLE_SERVICE_ACCOUNT_JSON`
   - Value: paste the entire .json file contents
5. Share each satellite Google Sheet with the service account email
   (format: `something@project.iam.gserviceaccount.com`)

---

## 6. Key Design Rules (Phase 1 — DO NOT CHANGE)

- Manual control only — no automated triggers
- Rate limit: 1.1s between Google API calls
- Registry is a flat JSON file — no database
- No audit logs
- No automated rollback

---

## 7. Phase 2 Roadmap

1. **Google Auth** — Set the secret. Test with one satellite.
2. **Populate Registry** — Bulk-add all sheet IDs from Jan 10 onwards.
3. **First Batch Assay** — Fetch All → Run Full Assay on All.
4. **Acca Builder** — `/api/build-accas` endpoint using BANKER edges.
5. **League Purity Page** — `/leagues` showing all leagues sorted by win rate.
6. **Persistent Edge Storage** — Store edge results per satellite for cross-satellite queries.

---

## 8. Satellite Context

- Satellites start from **10 January 2026** (J10 = January 10)
- Naming: "United States (NBA) J10", "Europe (EuroLeague) J11"
- **Gold Universe format**: sheets named Side, Totals, MA_Vault, MA_Discovery
- **Legacy format**: sheets named Predictions, Results, BetSlips
- Known example: NBA J10 → 26 bets, 57.69% hit rate
- Strongest markets: BANKER / FT O/U / 1H 1X2
