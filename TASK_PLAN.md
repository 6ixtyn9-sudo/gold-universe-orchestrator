# Task Plan (atomic cards + dependencies)

## Guardrails
- Worktrees only: guo-agent-auth / guo-agent-api / guo-agent-ui / guo-agent-ops
- Always: rm -f "$(git rev-parse --git-path index.lock)"
- python3 only
- git merge --no-edit (non-interactive)
- Auto-commit every card

## Critical path
0B -> 1C -> 2A -> 3A -> 3B -> 3C -> 3D

### 1C
- Inject creds into fetch_satellite_bundle (SheetsApiClient credentials flow)

### 2A
- assayer/smoke_assay.py: sheet_id -> ensure bundle cache -> parse ResultsClean + UpcomingClean -> FT winner grading -> report json

### 3A
- POST /api/assay-smoke

### 3B
- GET /api/leagues

### 3C
- POST /api/build-accas

### 3D
- UI /leagues page
