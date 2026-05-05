🛰️ Antigravity — Gold Universe Satellite Fleet Synchronization
"Let the satellites sing, so the mother may listen"

Overview
Antigravity is the deployment orchestration system for the Gold Universe. It ensures all satellite spreadsheets have the latest Google Apps Script (.gs) code, so the Assayer can test purity and the Mothership (the mother) can build accas with confidence.

🏗️ Architecture
text

┌─────────────────────────────────────────────────────────────────┐
│                    GOLD UNIVERSE ORCHESTRATOR                    │
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  🛰️ Satellites  │  │   🔬 Assayer    │  │  👑 Mothership  │  │
│  │  (Google Sheets)│──│  (Purity Engine)│──│  (Acca Builder) │  │
│  │                 │  │                 │  │                 │  │
│  │ • League data   │  │ • ASSAYER_EDGES │  │ • Reads purity  │  │
│  │ • Predictions   │  │ • ASSAYER_LEAGUE│  │ • Builds accas  │  │
│  │ • Results       │  │   _PURITY       │  │ • Portfolios    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│           ▲                                                    │
│           │ Antigravity deploys .gs code here                  │
└───────────┼────────────────────────────────────────────────────┘
            │
    ┌───────┴───────┐
    │  📦 .gs Files  │
    │  (Ma_Golide_   │
    │   Satellites/  │
    │   docs/)       │
    └────────────────┘
📁 Repository Structure
text

gold-universe-orchestrator/
├── antigravity_deploy.py          # Main deployment script
├── antigravity_deploy.log         # Deployment log
├── antigravity_summary.json       # Last deployment summary
├── ANTIGRAVITY_README.md          # This file
│
├── Ma_Golide_Satellites/          # Submodule: .gs source code
│   └── docs/
│       ├── Sheet_Setup.gs
│       ├── Data_Parser.gs
│       ├── Forecaster.gs
│       ├── Game_Processor.gs
│       ├── Signal_Processor.gs
│       ├── Margin_Analyzer.gs
│       ├── Config_Tuner.gs
│       ├── Config_Ledger_Satellite.gs
│       ├── Accumulator_Builder.gs
│       ├── Contract_Enforcement.gs
│       ├── Contract_Enforcer.gs
│       ├── Inventory_Manager.gs
│       └── fix_triggers.gs
│
├── Ma_Assayer/                    # Submodule: Purity engine
│   └── docs/
│       └── (Assayer .gs files)
│
├── Ma_Golide_Mothership/          # Submodule: The mother
│   └── doc/
│       └── (Mothership .gs files)
│
├── syncer/
│   └── script_syncer.py           # Core sync logic
│
├── scripts/
│   └── bootstrap_api_and_fire.py  # API bootstrap + safeLaunch
│
└── .github/workflows/
    └── antigravity.yml            # GitHub Actions CI/CD
🚀 Usage
Local Deployment
Bash

# Full deployment (sync code + bootstrap API + fire safeLaunch)
python antigravity_deploy.py --parallel

# Dry run (see what would happen)
python antigravity_deploy.py --dry-run

# Only sync .gs code (no bootstrap)
python antigravity_deploy.py --fleet-only

# Only bootstrap API and fire safeLaunch
python antigravity_deploy.py --bootstrap --parallel
GitHub Actions (Recommended)
Go to Actions → Antigravity → Run workflow:

Option	Description
dry_run	Preview changes without deploying
fleet_only	Only sync .gs code
bootstrap_only	Only bootstrap API and fire safeLaunch
Or trigger automatically on push to Ma_Golide_Satellites/docs/**

🔧 Prerequisites
1. Google OAuth Credentials
Store in creds/token_{0-19}.json (multiple for parallel deployment):

Bash

python scripts/complete_auth.py  # Generate tokens
Required OAuth scopes:

script.projects
script.deployments
drive
spreadsheets
2. Environment Variables
Create .env:

env

SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_supabase_key
GOOGLE_SERVICE_ACCOUNT_JSON={...}
3. GitHub Secrets (for CI/CD)
SUPABASE_URL
SUPABASE_SERVICE_KEY
GOOGLE_SERVICE_ACCOUNT_JSON
4. Submodule Setup
Bash

# Initialize submodules
git submodule update --init --recursive

# Update submodules to latest
git submodule update --remote
📡 Satellite Registry
Satellites are stored in Supabase (or registry/registry.json as fallback):

JSON

{
  "id": "sat_001",
  "sheet_id": "1ABC...",
  "script_id": "1DEF...",
  "league": "NBA",
  "date": "J10",
  "name": "United States (NBA) J10"
}
🔥 Deployment Flow
text

1. Load .gs sources from Ma_Golide_Satellites/docs/
         │
         ▼
2. For each satellite in registry:
   ├─ Find or create bound Apps Script project
   ├─ Push all .gs files via Script API
   └─ Register script_id in database
         │
         ▼
3. Bootstrap Phase (parallel):
   ├─ Create version + deployment (if needed)
   ├─ Make script API-executable
   └─ Fire safeLaunch function
         │
         ▼
4. Satellites are now running latest code!
📊 Monitoring
Deployment Log
Bash

tail -f antigravity_deploy.log
Summary Output
After each run, antigravity_summary.json contains:

JSON

{
  "timestamp": "2026-05-04T12:00:00Z",
  "satellites_total": 50,
  "deployed": 48,
  "failed": 2,
  "gs_files": 14,
  "dry_run": false
}
GitHub Actions Artifacts
Download deployment summaries from the Actions tab.

🎯 Next Steps After Deployment
Once antigravity has synchronized the fleet:

Assayer: Run purity analysis

Bash

python scripts/batch_smoke_assay.py
Mothership: Build accas from purity data

Access dashboard at /dashboard
Click "Build Accas" to generate betting portfolios
Monitor: Check satellite health

Bash

python scripts/audit_upcomingclean_schema.py
🐛 Troubleshooting
"No script_id in satellite metadata"
The satellite doesn't have a bound Apps Script project. Antigravity will create one automatically.

"PERMISSION_DENIED"
The service account needs access to the spreadsheet. Share each sheet with the service account email.

"TOKEN_SCOPE_MISSING"
Re-authenticate with the required scopes:

Bash

python scripts/auth_all_projects.py
Submodule out of date
Bash

git submodule update --remote --merge
git add Ma_Golide_Satellites Ma_Assayer Ma_Golide_Mothership
git commit -m "chore: update submodules to latest"
git push
📜 The .gs Files
File	Purpose
Sheet_Setup.gs	Initialize sheet structure
Data_Parser.gs	Parse incoming sports data
Forecaster.gs	Generate predictions
Game_Processor.gs	Process game results
Signal_Processor.gs	Extract betting signals
Margin_Analyzer.gs	Analyze betting margins
Config_Tuner.gs	Tune prediction parameters
Config_Ledger_Satellite.gs	Ledger management
Accumulator_Builder.gs	Build accumulators
Contract_Enforcement.gs	Enforce data contracts
Contract_Enforcer.gs	Contract validation
Inventory_Manager.gs	Manage prediction inventory
fix_triggers.gs	Trigger management utilities
🤝 Contributing
When updating satellite code:

Edit files in Ma_Golide_Satellites/docs/
Commit and push
Antigravity auto-deploys (or run manually)
Verify with batch_smoke_assay.py
📜 License
Made with ❤️ for the Gold Universe.

"Gold from charcoal, purity from chaos — through antigravity, the satellites ascend."
