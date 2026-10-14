# Free API Stack for 166 Leagues

**Question answered:** which free/RapidAPI keys can actually feed this fleet, and
in what order.
**Verified:** October 2026. Free tiers move — re-check before you commit a season to one.

---

## 0. The arithmetic that decides everything

Your fleet is **166 leagues** (now 113 after de-duplicating the registry — see §4).
The naive design — one request per league per day — needs **166 requests/day**.
No free tier offers that. So the naive design is dead on arrival.

But API-Sports' `/games` endpoint accepts a bare `date`:

```
GET /games?date=2026-10-14        ← every competition, one request
```

One call returns the whole day across all leagues, each game tagged with its
`league.id`/`name`/`country` **and** quarter splits for finished games. That
turns the budget problem inside out:

| Approach | Requests/day for the whole fleet | Fits 100/day free? |
|---|---|---|
| Per league: fixtures + results | 332 | ❌ by 3.3× |
| **Bulk: 1 date call (+1 lookback)** | **2** | ✅ with 98 to spare |

That is why `--provider api_sports` runs in bulk mode by default
(`ingest/providers/api_sports.py::bulk_day`, wired in `ingest/pipeline.py::_prefetch_bulk`).
Standings are the only remaining per-league cost, and those rotate across days.

**Guard-rails that come with it:** `ingest/quotas.py` counts every uncached
request against the provider's real limit and raises `QuotaExceeded` *before*
the call, rather than letting a vendor half-answer a run.
`python -m ingest.cli quota` shows the budget.

---

## 1. Fixtures / results / standings (the core feed)

| # | API | Platform | Free tier | Coverage | Quarters | Standings | Verdict |
|---|---|---|---|---|---|---|---|
| **1** | **API-Basketball** (API-Sports) | RapidAPI + direct | **100 req/day**, all endpoints, all competitions, resets 00:00 UTC, no card | 340+ leagues globally incl. NBB, LEL, KBL, ISW, LAA | ✅ `quarter_1..4`, `over_time`, `total` | ✅ | **Primary.** Widest coverage of exactly your long-tail leagues, and bulk `date=` makes 100/day ample |
| **2** | **Highlightly Basketball** | RapidAPI + direct | **100 req/day**, no rate limit, no card | 340+ leagues, 50+ countries | ✅ per-period scores | ✅ | **Best fallback.** Same quota shape, different upstream — a real second opinion when #1 is exhausted |
| **3** | **Broadage Sports – Basketball Data** | RapidAPI | **$0 BASIC** plan | 100+ tournaments, NBA/NCAA/EuroLeague emphasis | ✅ play-by-play + boxscore | ✅ | Strong #3; European-heavy, good for BNX/EBL/PLW |
| **4** | **BasketAPI** | RapidAPI | free tier present (limits vary by plan — verify) | 70+ leagues incl. FIBA, ABA, Baltic | ✅ "previous results by quarters, halftime or final" | ✅ | Good depth; check the current free cap before relying on it |
| **5** | **Sportbex Basketball API** | RapidAPI | free tier advertised | NBA, NCAA, EuroLeague, NBL, CBA, Liga ACB, FIBA, WNBA | ✅ live quarter data | ✅ | Vendor claims 99.9% SLA — useful as a latency fallback, younger provider |
| **6** | **API-NBA** (API-Sports) | RapidAPI + direct | **100 req/day** | **NBA only** (no NCAAB, no international) | ✅ period linescore | ✅ | Only if you want a second NBA source. Do not mistake it for the general basketball API |
| **7** | **Free NBA** (theapiguy) | RapidAPI | free | NBA historical | ⚠️ depends on the game payload | ✅ | Historical NBA backfill only |
| **8** | **TheRundown / Sportspage Feeds** | RapidAPI | free tiers listed, limits not published clearly | US-centric | ⚠️ | ✅ | Verify before use; listed for completeness |

## 2. Probabilities — the actual Forebet replacement

Forebet gave you two numbers per game. Nothing free gives those numbers directly,
so the pipeline derives them: **market odds with the margin removed**, then a
Poisson model as backfill. Odds free tiers are the tightest constraint in the
whole stack — plan for it.

| # | API | Platform | Free tier | Basketball coverage | Verdict |
|---|---|---|---|---|---|
| **1** | **The Odds API** (Starter) | RapidAPI ("Live Sports Odds") + direct | **500 credits/month**; 1 credit = 1 sport×region×market | NBA, EuroLeague, WNBA, NBL, NCAA | **Default.** Clean de-vig maths, h2h + totals markets. 500 credits ≈ 16/day, so price the majors and let the model cover the tail |
| **2** | **Odds-API.io** | direct | **100 req/hour** (~500/day), 2 bookmakers on free | pre-match + live | **Best free volume** if you need the long tail priced |
| **3** | **SharpAPI** | direct | **12 req/min** (~17,280/day), 2 sportsbooks | major US sports | Highest free throughput I found; thin bookmaker choice on free |
| **4** | **SportsGameOdds** | direct | free tier, 10 req/min, ~2,500 objects/mo | US-focused, 80+ books | Object-based billing — good shape, low volume |
| **5** | **OddsPapi** | direct | 250 req/month, includes historical | 350+ books | Historical odds on a free tier is rare — useful for backtesting the migration |

**Important:** odds providers price **major leagues only**. For the other ~100
leagues there is no free market feed at all, so `ingest/providers/model.py`
(Poisson attack/defence, fitted on results you already ingest) supplies the
`Prob %` and `Avg` columns. The pipeline is designed to run correctly with
**zero odds keys** — it just produces model probabilities instead of market ones.

## 3. Recommended stack (all free)

```
fixtures/results/standings   API-Basketball (API-Sports)      100 req/day  ─┐
                             Highlightly                      100 req/day  ─┤ failover chain
                             Broadage BASIC                   100 req/day  ─┘ (300/day effective)

probabilities (majors)       The Odds API 500 credits/mo  →  de-vigged market
probabilities (everything)   ingest/providers/model.py    →  Poisson from results

storage                      Supabase snapshots  or  local bundles
```

Wire the chain in one flag:

```bash
export API_SPORTS_KEY=...        # key #1
export HIGHLIGHTLY_KEY=...       # key #2, optional
export ODDS_API_KEY=...          # optional

python3 -m ingest.cli run \
  --provider api_sports,highlightly \
  --probability odds,model \
  --leagues all --date 2026-10-14 --sink supabase
```

`FailoverProvider` walks the chain per call: when API-Basketball hits its 100th
request, Highlightly answers the rest of the day automatically. It never merges
two vendors' results for the same league — a call is answered by exactly one
provider, because double-counting games would corrupt Assayer purity.

```bash
python3 -m ingest.cli quota     # what's left today
```

## 4. Free-tier reality checks

- **RapidAPI adds a hop and its own quota.** Same underlying vendor, often the
  same limits, plus RapidAPI's own per-second throttling. Direct keys are
  usually cheaper at scale; RapidAPI is the fastest way to *test*. The adapters
  here take a base URL, so switching is a config change, not a rewrite.
- **Free tiers gate the good stuff.** Highlightly's free plan excludes NBA odds.
  The Odds API's free plan excludes historical odds (10× credit cost). API-Sports
  gates nothing but the quota. Read the plan, not the marketing page.
- **100/day is 2 requests/day of real headroom in bulk mode** — until you add
  standings. Plan standings rotation: 90 leagues/day at one request each means a
  full refresh every ~1.25 days; that is fine, standings move slowly.
- **The registry was double-counting leagues.** Mining `registry.json` produced
  165 "leagues" because the same competition is spelled several ways
  ("South Korea (KBL) JW31" vs "South Korea (KBL) May 13"). Since one vendor
  league would feed several satellites, the Assayer would have graded the same
  games twice. `bootstrap-leagues` now merges those: **113 real leagues**, with
  the duplicate spellings kept as aliases. Women's competitions are never merged
  into men's, even when they share a code.
- **Everything is cached to disk** (`ingest/.cache/`, 15-minute TTL for games).
  Re-running a day costs nothing, which matters when you are debugging against a
  100-request budget.
- **What I did not do:** scrape Forebet. It has no API, its terms prohibit
  systematic extraction, and it is the thing you asked to move *away* from. The
  de-vigged market probability is the same signal from a source with an SLA.

## 5. Wiring the keys into GitHub Actions

The workflow is `.github/workflows/ingest.yml`. Add secrets at
**Settings → Secrets and variables → Actions → New repository secret**.
The names must match exactly — the workflow exports them as environment
variables and `ingest/` reads them by name (a typo means the code sees nothing
and the run fails its first key check rather than silently going unauthenticated).

| Secret name | Required? | What it unlocks | What happens without it |
|---|---|---|---|
| `API_SPORTS_KEY` | **yes** | the whole fixture/result/standings feed | the run stops immediately with one error line (no point spraying requests) |
| `ODDS_API_KEY` | no | de-vigged market probabilities for the major leagues | the Poisson model prices everything instead (`provider=… probability=odds_api+poisson_model` still runs) |
| `SUPABASE_URL` | only for `sink=supabase` | where snapshots are written | local bundles only |
| `SUPABASE_SERVICE_KEY` | only for `sink=supabase` | write auth to `satellite_tab_snapshots` | local bundles only |
| `HIGHLIGHTLY_KEY` | no | second 100/day fixture provider for the failover chain | if API-Basketball exhausts its budget, the rest of the day is skipped |

### Optional repository variables

Variables (**not** secrets — same settings page, second tab) control what the
*n scheduled* run does, so nobody has to be awake to dispatch it:

| Variable | Values | Default | Meaning |
|---|---|---|---|
| `INGEST_SINK` | `local`, `supabase`, `local,supabase` | `local` | where the 06:30 UTC run writes |
| `INGEST_LIVE_WRITES` | `true` / `false` | `false` | flip to `true` to let the nightly run apply Supabase writes. Until then every scheduled write is a dry run that only logs |

That pair is the reason nothing can reach production by accident: the sink must
be named, **and** live writes must be switched on by hand.

### First run

1. Add `API_SPORTS_KEY` (and `ODDS_API_KEY` if you have one).
2. Actions → **Ingest (APIs to snapshots)** → *Run workflow* → branch
   `arena/20b31a43-gold-universe-orchestrator`, `leagues=all`, `sink=local`,
   `upload_artifacts=true`.
3. Read the run summary: leagues with content, fixtures, priced %, bulk calls.
   Check `python -m ingest.cli quota` in the *Quota after* step — a full fleet
   day should cost **2–3 requests**, not 100.
4. Then dispatch again with `sink=supabase`, leaving `dry_run=true`, and read
   the log lines `[dry-run] would upsert N snapshot rows for …`.
5. Only then set the `INGEST_*` variables for the nightly job.

**Note on scheduled runs:** GitHub only fires `schedule` triggers from the
repository's **default branch** (`main`). Until this branch is merged, the
nightly job will not run — dispatching by hand works from any branch.

### How many satellites a night?

By default a league gets a satellite whether or not it has games — that is what
the 512-sheet fleet looked like, and downstream reads a present-but-empty
`UpcomingClean` as "nothing on tonight". The cost is real: **a full fleet day
writes ~113 snapshots, most of them empty.** Dispatch with
`only_with_games=true` (or pass `--only-with-games`) and the run writes only the
leagues that had fixtures, results or standings — on a typical night that is
10–25 instead of 113. Both are correct; pick one deliberately, because
downstream cannot tell a skipped satellite from a league you stopped covering.

### What the workflow refuses to do

- It will not write to Supabase unless the sink names it *and* a live write was
  explicitly authorised.
- It will not report success on an empty night: `tools/night_was_not_empty.py`
  fails the job when no fixtures were ingested anywhere, because a green check
  on a silent night is the failure mode most likely to go unnoticed for a week.
- It will not spend a request it cannot make: the key check runs before the
  quota spend.
- It cleans `ingest/out` first, so the summary can only ever count bundles from
  the current run.
- It verifies every bundle with the same parsers the Brain/Assayer use and fails
  if `brain/` and `fetcher/` disagree about the same rows.

### Checking the workflow without waiting for a run

```bash
python3 tools/simulate_workflow.py --provider fixture --leagues nba --date 2026-10-14
python3 tools/simulate_workflow.py --sink local,supabase    # exercises the dry-run path
python3 -m unittest tests.test_ci_workflow                  # flag/secret drift guards
```

`tools/simulate_workflow.py` executes the workflow's actual `run:` blocks in
order, so a broken shell step is caught locally instead of on a night when the
quota is already spent.

## 6. Status of each option in this codebase

| API | Adapter | State |
|---|---|---|
| API-Basketball (API-Sports) | `ingest/providers/api_sports.py` | ✅ implemented: fixtures, results, quarter splits, standings, H2H, team history, bulk date mode |
| The Odds API | `ingest/providers/odds.py` | ✅ implemented: h2h + totals, de-vig across books, consensus total line |
| Poisson model | `ingest/providers/model.py` | ✅ implemented: IPF attack/defence, quarter profiles |
| Highlightly | — | 🔜 one file: `DataProvider` with `bulk_day()` returning `group_games()`-shaped groups |
| Broadage / BasketAPI / Sportbex | — | 🔜 same shape, each ~150 lines |
| Odds-API.io / SharpAPI | — | 🔜 `ProbabilitySource` subclasses; the interface is one method, `annotate(fixtures)` |

Say which key(s) you actually hold and I'll write the matching adapter(s)
next — the failover chain and quota ledger already expect them.
