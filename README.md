# Ma Golide Mothership — The Parent of the Gold Universe

**"The one who sees all satellites, consults the Assayer, and builds the Accas"**

This is the central brain of the entire Gold Universe.

## Architecture
- Reads **upcoming games** from all Satellites
- Pulls the **latest purity report** from the Assayer (`ASSAYER_EDGES` + `ASSAYER_LEAGUE_PURITY`)
- Builds **Accas**, **Risky Accas**, **Portfolios**, and **Bet Slips**

## How it works
1. Satellites feed clean data → Assayer
2. Assayer produces the official Gold/Platinum/Silver purity contract
3. Mothership reads the contract + satellite games → creates betting products

## Repository Contents
- `Mothership_AssayerBridge.gs` ← Multi-satellite bridge (updated)
- All your existing Mothership `.rtf` files (HiveMind, AccaEngine, etc.)
- Main menu for easy operation

Made with ❤️ for the Gold Universe.
