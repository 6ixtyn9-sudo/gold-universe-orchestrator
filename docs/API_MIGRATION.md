# Moving the Gold Universe off Google Sheets

**Status:** Phase 1 (ingestion layer) implemented and verified offline.
Bulk (all-leagues) mode, the quota ledger and the free-key failover chain are
in place; the live cutover is waiting on the user's vendor key.
**Free-tier survey:** `docs/FREE_API_STACK.md`.
**Scope:** replace "copy/paste from Forebet into a satellite sheet" with API feeds,
without breaking the Assayer, the Brain or the Mothership.

---

## 1. Why this is smaller than it looks

The fleet is 512 sheets across 166 league *names*, but the sheets are only doing
three jobs — and only one of them is hard to replace.

> **Note on "166".** Mining `registry.json` yields 166 satellite labels, but
> several are the same competition spelled differently across sheets
> ("South Korea (KBL) JW31", "South Korea (KBL) May 13", "South Korea (KBL)").
> Feeding a vendor league once per satellite would hand the Assayer the same
> games multiple times and inflate every purity number. `ingest/leagues.py`
> therefore merges label variants that share a competition code:
> **166 labels → 113 distinct competitions**, with the absorbed spellings kept
> as aliases so `resolve()` still finds them. Women's competitions are never
> merged into men's, even when the code is shared (e.g. `ESW` vs `ESP`).

| Job | Happens today | Replaced by |
|---|---|---|
| **Data entry** | a human copies Forebet's `Pred` + `Prob %` for the day's games | `ingest/` — providers fetch fixtures, results, standings |
| **Compute** | each sheet's Apps Script (HiveMind/Forecaster/Signal_Processor) writes the `t1-*`, `t2-*`, `ou-*`, `enh-*` columns | the **Python ports that already exist** in `brain/` |
| **Storage / transport** | sheets are mirrored into Supabase `satellite_tab_snapshots` | written directly by `ingest/sinks.py` |

The seam is already in place. `brain/`, `assayer/` and the Mothership do not
read Google Sheets — they read **2-D arrays from a snapshot table**:

```
BEFORE
  forebet ──(human copy/paste)──► satellite sheet ──(Apps Script)──► tabs
                                     └──────────────(bridge/mirror)──► Supabase snapshots
                                                                          │
                                                                          ▼
                                                          brain/ · assayer/ · Mothership

AFTER
  sports APIs ──► ingest/ ──(same tab shapes)──► Supabase snapshots (or local bundles)
                                                        │
                                                        ▼
                                        brain/ · assayer/ · Mothership  (unchanged)
```

So the migration is **not** "rewrite the prediction system". It is:

> **make something other than a human produce the same tab rows.**

That claim is enforced by tests, not by a promise: `tests/test_ingest.py`
feeds API-generated rows to the repo's real, unmodified parsers
(`brain.data_parser`, `fetcher/parsers/*`) and asserts they come out the other
side intact.

```
python3 -m unittest discover -s tests -t .       # 20 tests, no network, no keys
python3 -m ingest.cli verify --bundle ingest/out/api_united-states-nba_2026-10-14
```

---

## 2. What replaces Forebet, specifically

Forebet supplied two hand-copied columns, and both are model *inputs*, not decoration:

| Column | Consumed by | Replacement |
|---|---|---|
| `Prob %` (`"61 - 39"`) | `brain/forecaster.calculate_forebet_difference` → `MaGolide` score, weight `forebetWeight` | market probabilities: bookmaker 1X2 odds with the margin removed (`ingest/providers/odds.py`) |
| `Avg` (expected total) | O/U sizing, `premium` tiers | Poisson attack/defence model fitted on ingested results (`ingest/providers/model.py`) |
| `Pred` (`1`/`2`) | side selection, banker/robber classification | argmax of the de-vigged probability, or the Poisson model |

Two sources, in priority order, because they answer different questions:

1. **`odds`** — *what the market thinks.* De-vigged (`p_i = (1/o_i) / Σ(1/o)`),
   averaged across bookmakers. This is strictly better than a scraped model
   output: auditable, timestamped, and it names its own uncertainty.
2. **`model`** — *what our own ratings say.* A bivariate Poisson attack/defence
   model (iterative proportional fitting, ratings shrunk toward the league mean
   by sample size). No key, no quota, no dependency — this is what keeps the
   pipeline alive when a vendor is down or a league isn't carried.

Whichever source prices a fixture first wins; the other backfills. A fixture
that neither can price is still ingested, flagged, and counted in the report —
it is never silently dropped.

**Nothing about the scoring maths changes.** `calculate_magolide_score`,
`t2ou_score_over_under_pick` and `calculate_forebet_difference` are called
exactly as before; only their inputs move from sheet cells to API payloads.
`forebetWeight` keeps its meaning — it now weights "market/model opinion vs
our own ratings", which is what it was always doing.

---

## 3. What was built

```
ingest/
├── cli.py             run · bootstrap-leagues · doctor · verify · export-config
├── models.py          canonical Fixture / GameResult / StandingRow / QuarterProfile
├── contracts.py       the tab contract — exact headers + row builders
├── leagues.py         league registry (165 leagues mined from registry.json)
├── teams.py           team-name reconciliation (alias table + fuzzy match)
├── predict.py         enrichment: brain/ ports driven by API input
├── configs.py         per-league Config_Tier1/Tier2 as versioned JSON
├── pipeline.py        orchestration → virtual satellites → sinks
├── sinks.py           local bundles (fetcher-compatible) + Supabase snapshots
└── providers/
    ├── base.py        DataProvider / ProbabilitySource interfaces
    ├── fixture.py     offline JSON provider (tests, dry runs, replays)
    ├── api_sports.py  API-Sports basketball adapter
    ├── odds.py        The Odds API adapter + de-vig maths
    └── model.py       Poisson ratings + quarter profiles
```

**Satellite identity.** A sheet satellite is keyed by a Drive file id. A virtual
satellite is keyed by `api:<league_key>:<date>` (e.g. `api:united-states-nba:2026-10-14`),
stored in the same `sheet_id` column the bridge uses. Same granularity as today
(one satellite per league per date), so Assayer purity and the accuracy ledger
keep their exact meaning.

**Contract compatibility fixes found while testing** (real bugs, not
migration artefacts; both directions now carry data):

- `brain/data_parser.parse_results_clean` could not see quarter splits from a
  `q1h/q1a` header, and `fetcher/parsers/results_clean.py` could not see them
  from a `q1` header. `ResultsClean` now carries **both dialects** (`q1h/q1a`
  *and* combined `q1..q4`, plus halves).
- `fetcher/parsers/upcoming_clean.py` reads `prob %` as a number only, while
  `brain/data_parser` accepts both. `prob %` is now written as a number and the
  historical `"61 - 39"` split is preserved in its own `prob pair` column — both
  consumers now agree, and the old sheets remain diffable.

---

## 4. Running it

```bash
# offline: no keys, no network, no quota
python3 -m ingest.cli run --provider fixture \
    --fixtures examples/provider_fixtures \
    --leagues nba euroleague --date 2026-10-14 --date-to 2026-10-15 \
    --sink local --out ingest/out --report ingest/out/last-report.json

# prove the output still satisfies every existing consumer
python3 -m ingest.cli verify --bundle ingest/out/api_united-states-nba_2026-10-14
#   UpcomingClean  brain=3 games  fetcher=3 games
#   Standings      brain=30 teams
#   ✅ CONTRACT OK

# live (needs a key; see §5)
export API_SPORTS_KEY=... ODDS_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
python3 -m ingest.cli run --provider api_sports --leagues nba euroleague \
    --date 2026-10-14 --sink local supabase
```

---

## 5. What only you can decide / supply

| # | Item | Why it matters | Default if you do nothing |
|---|---|---|---|
| 1 | **A sports data key** — API-Sports basketball (free tier ≈100 req/day) | it is the fixtures/results/standings source; without it `api_sports` cannot run | fixture provider keeps working offline |
| 2 | **An odds key** — The Odds API (free tier ≈500 req/month) | only this gives *market* probabilities, the strongest Forebet replacement | Poisson model supplies probabilities (no key needed) |
| 3 | **League ID resolution** — `bootstrap-leagues --probe` | maps each of the 165 fleet leagues to a vendor league id; a wrong id silently pulls the wrong competition, so ids are **never guessed** | every league stays unresolved and is skipped loudly |
| 4 | **Config export** — `export-config` per league | `Config_Tier1/Tier2` hold the tuned weights; without them a league regresses to repo defaults | repo defaults (`load_tier1_config`) |
| 5 | **Supabase write-back** — on or off | keeps production untouched until you say so | local bundles only; `satellite_tab_snapshots` is never written without `--sink supabase` |

Everything in §5 is a switch, not a rewrite. The pipeline runs, produces
verifiable satellites, and writes nothing anywhere you didn't name.

---

## 6. Phases

**Phase 1 — Ingestion core. ✅ done**
Contract layer, providers, probability sources, enrichment bridge, sinks, CLI,
offline fixture provider, 20 contract tests, verified end-to-end.

**Phase 2 — Connect a real feed. (needs key #1)**
```bash
export API_SPORTS_KEY=...
python3 -m ingest.cli bootstrap-leagues --probe      # league ids
python3 -m ingest.cli run --provider api_sports --capture \
    --leagues nba --date <today> --sink local        # capture raw JSON
python3 -m ingest.cli verify --bundle ingest/out/api_united-states-nba_<date>
```
Then diff one satellite against the live sheet it replaces — same games, same
probabilities within tolerance — **before** any write to Supabase.

**Phase 3 — Shadow mode.**
Run the pipeline nightly alongside the sheets, write only to local bundles,
and compare Assayer purity output day by day. This is the acceptance test: if
the API path produces the same purity reports as the sheet path, the sheets are
redundant.

**Phase 4 — Cut over per league.**
Enable `--sink supabase` league by league. Sheets become read-only history.

**Phase 4.5 — Bulk mode (all leagues at once).**
The user's cutover decision is *all 166 leagues in one night*, which a
per-league loop cannot do: 166 leagues × 2 requests = 332 calls/day against a
100/day free tier. API-Sports' `/games?date=` returns **every competition's
games for one day in a single response**, each game tagged with its league and
carrying quarter splits. So:

```
GET /games?date=2026-10-14        # every league, one request
```

`ingest/providers/api_sports.py::bulk_day()` fetches the day once;
`group_games()` buckets the raw games by `league.id` into the same
fixtures/results structures the per-league path produces, and
`ingest/pipeline.py::_prefetch_bulk()` distributes them to each fleet league.
Each fleet league then resolves its own vendor league id from that response —
which is why **no league ids are hard-coded**: a wrong id silently pulls the
wrong competition, so unmatched leagues are skipped loudly instead
(`… unresolved — run bootstrap-leagues`) rather than guessed.

Budget for the whole fleet: **1 request per day**, plus 1 per day of lookback
for results history (`results_lookback_days`). `--no-bulk` still exists for
single-league debugging. `ingest/quotas.py` enforces the vendor's real limit
before each uncached call and `python3 -m ingest.cli quota` prints the ledger.

Multiple free keys chain into one provider —
`--provider api_sports,highlightly` — via `ingest/providers/failover.py`:
when the first key's quota is exhausted mid-day, the next answers, and a call is
never split across vendors (splitting would double-count games). See
`docs/FREE_API_STACK.md` for the free-tier survey and the de-vigged-odds /
Poisson plan that replaces Forebet's `Prob %`.

**Phase 5 — Retire the sheets.**
`fetcher/*`, `syncer/*`, `antigravity_deploy.py`, the `.gs` bridges and the
512-sheet fleet become dead weight. Keep `fetcher/parsers/*` — they are the
contract tests' yardstick.

---

## 7. Honest open items

- **Roster/game-log sources.** Historical H2H and recent-form tabs
  (`CleanH2H_n`, `CleanRecentHome_n`, `CleanRecentAway_n`) are generated from
  results windows. If you want deeper per-team history per fixture, API-Sports
  `team=`/`h2h=` queries cover it but each one costs quota — the disk cache in
  `ingest/.cache` exists precisely for this.
- **Quarter O/U lines.** Quarter markets need a market line. Full-game lines
  come from the odds feed's `totals` market; quarter lines are a flat split of
  that line, which is the same approximation the sheets used. Where a
  bookmaker publishes real quarter totals, wiring them in is a ~20-line change
  in `providers/odds.py`.
- **Team name drift.** `ingest/teams.py` normalises, matches fuzzily, and
  *reports* what it cannot resolve. Seed `ingest/team_aliases.json` with any
  pairs it complains about; it never guesses silently.
- **Timezone.** Kickoffs are ingested in the vendor's published timezone
  (`LeagueSpec.timezone`, default UTC). The fleet's sheets are league-local —
  worth confirming per league before Phase 4, since it only affects the
  `date`/`time` columns, not the maths.
- **The `pred score` magnitude.** Scores are a logit-like signal
  (`confidence = clamp(1/(1+exp(-score/30)) * 100)`) per `Forecaster.gs`, so
  values in the tens-to-hundreds are expected under default weights. Leagues
  with tuned `Config_Tier1` weights will differ; export those configs before
  comparing numbers against a live sheet.
