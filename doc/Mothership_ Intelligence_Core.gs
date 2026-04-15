
/* =========================
 * DEFAULT CONFIG (can be overridden at runtime)
 * ========================= */
if (typeof MIC_DEFAULTS === 'undefined') {
  const MIC_DEFAULTS = {
  SHEETS: {
    BETS_ARCHIVE: 'Historical_Bets_Archive',
    RESULTS_ARCHIVE: 'Historical_Results_Archive',
    PERFORMANCE_LOG: 'Historical_Performance_Log',
    SEGMENT_STATS: 'Segment_Stats',
    INSIGHTS_LOG: 'Historical_Insights',

    // Optional (small + valuable)
    POLICY_OVERRIDES: 'Policy_Overrides',

    // Upgrade: backtest + tuning logs
    SHADOW_BACKTEST_LOG: 'Shadow_Backtest_Log',
    TUNING_LOG: 'MIC_Tuning_Log'
  },

  // Archives scale
  SHARD_THRESHOLD_CELLS: 500000,

  // Caching
  CACHE_SECONDS: 300,

  // Learning + drift
  MIN_SAMPLE_SIZE: 10,
  PRIOR_ALPHA: 2,
  PRIOR_BETA: 2,
  RECENCY_DECAY_HALFLIFE_DAYS: 30,

  // Decision thresholds
  ALERT_WIN_RATE_THRESHOLD: 0.50, // below => BLOCK (when mature)
  CAUTION_MEAN_THRESHOLD: 0.55,   // between ALERT and CAUTION => CAUTION (when mature)

  // Early activation via lower bound
  LOWER_BOUND_ONE_SIDED_CONFIDENCE: 0.80, // z ≈ -0.8416
  EARLY_BET_LOWER_BOUND: 0.55,
  EARLY_BLOCK_LOWER_BOUND: 0.45,

  // Insights thresholds
  HIGH_PERFORMER_THRESHOLD: 0.70,

  // Shadow backtest defaults
  BACKTEST: {
    MAX_EVENTS: 5000,         // last N graded bets
    MIN_COVERAGE: 0.25,       // tuner constraint
    STRICT_LEARNING: false,    // no updating model on bets that policy would have blocked
    TREAT_CAUTION_AS_BET: true
  },

  // Inside MIC_DEFAULTS.TUNING:
   CANDIDATE_MIN_SAMPLE_SIZE:  [10, 20],
   CANDIDATE_ALERT_THRESHOLD:  [0.48, 0.50],
   CANDIDATE_EARLY_BLOCK_LB:   [0.25, 0.30, 0.35, 0.40, 0.42, 0.45],

  // Auto-tuner grid (kept small to avoid timeouts)
  TUNING: {
    ENABLED: true,
    CANDIDATE_EARLY_BET_LB: [0.53,0.54,0.55,0.56,0.57,0.58],
    CANDIDATE_HALFLIFE_DAYS: [14,30,60],
    CANDIDATE_CAUTION_MEAN: [0.54,0.55,0.56]
  }
};
}





/* ===========================================================
 * SCHEMA — Single source of truth for all sheet structures
 * Column names: PascalCase  |  Keys: UPPER_SNAKE_CASE
 * =========================================================== */

if (typeof SCHEMA === 'undefined') {
  const SCHEMA = {

  BETS_ARCHIVE: [
  // ── Core identity
  'BetID','SyncTimestamp','League','Match','HomeTeam','AwayTeam',

  // ── Bet details
  'Pick','Type','SubType','Quarter','Odds','Confidence','ConfidenceBucket',

  // ── Evaluation
  'EV','HomeAwayFlag','RiskTier','ForebetAction',

  // ── Context
  'Sport','MatchDate','SegmentKey',

  // ── Assayer: Confidence
  'AssayerConfidenceBucket',

  // ── Assayer: Edge
  'AssayerEdgeMatched','AssayerEdgeBestID','AssayerEdgeBestGrade',
  'AssayerEdgeBestSymbol','AssayerEdgeBestLift','AssayerEdgeBestWinRate',
  'AssayerEdgeBestN','AssayerEdgeBestPattern','AssayerEdgeBestReliable',
  'AssayerEdgeMatchCount',

  // ── Assayer: Purity
  'AssayerPurityGrade','AssayerPurityStatus','AssayerPurityAction',
  'AssayerPurityWinRate','AssayerPurityN','AssayerPurityUpdatedAt'
],

  RESULTS_ARCHIVE: [
    'ResultID','SyncTimestamp','League','Match','HomeTeam','AwayTeam',
    'FTScore','HTScore','Q1Score','Q2Score','Q3Score','Q4Score','MatchDate','Sport'
  ],

  PERFORMANCE_LOG: [
    'LogID','BetID','ResultID','GradedTimestamp','League','Match','Pick','Type',
    'SubType','Quarter','Odds','Confidence','ConfidenceBucket','HomeAwayFlag',
    'RiskTier','ForebetAction','SegmentKey','Result','WinLossFlag','ActualScore',
    'ROI_Contribution','EdgeRealized','Sport'
  ],

  SEGMENT_STATS: [
    'SegmentKey','Sport','League','BetType','SubType','Side','ConfidenceBucket',
    'Quarter','RiskTier','TotalBets','Wins','Losses','Pushes',
    'WinRate_Lifetime','WinRate_L30','WinRate_L10',
    'AvgOdds','AvgConfidence','TotalROI',
    'Alpha_WITH','Beta_WITH','Alpha_AGAINST','Beta_AGAINST','Alpha_SKIP','Beta_SKIP',
    'RecommendedAction','RecommendedForebetMode','ConfidenceLowerBound',
    'LastUpdated','TrendDirection','IsActive'
  ],

  INSIGHTS_LOG: [
    'InsightID','Timestamp','InsightType','Segment','Message',
    'Metrics','ActionTaken','Priority'
  ],

  POLICY_OVERRIDES: [
    'SegmentKey','OverrideAction','OverrideMode','Reason',
    'SetBy','SetDate','ExpiryDate','IsActive'
  ],

  SHADOW_BACKTEST_LOG: [
    'RunID','Timestamp','EventsUsed','Placed_BET','Placed_CAUTION','Blocked',
    'Coverage','ROI_IfBetAll','ROI_IfFollowPolicy','AvgROI_IfFollowPolicy',
    'ConfigUsed'
  ],

  TUNING_LOG: [
    'TuningID','Timestamp','EventsUsed',
    'Baseline_AvgROI','Baseline_Coverage',
    'Best_AvgROI','Best_Coverage',
    'RecommendedOverridesJSON','Applied'
  ],

  SYNC_TEMP: [
    'League','Time','Match','Pick','Type','Odds','Confidence','EV'
  ]
};
}




/**
 * Returns physical header row as-is (blanks preserved at their positions).
 * Never filters blanks — that would shift column alignment on writes.
 *
 * @param  {Sheet}    sh
 * @return {string[]}
 */
function getPhysicalHeaders_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(v) { return v == null ? '' : String(v).trim(); });
}



/**
 * Builds { headerName: 0-based-column-index } from physical row 1.
 * Blank headers are skipped (they have no name to map).
 *
 * @param  {Sheet}                   sh
 * @return {Object.<string, number>}
 */
function buildHeaderMap_(sh) {
  var headers = getPhysicalHeaders_(sh);
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) map[headers[i]] = i;
  }
  return map;
}


/**
 * Ensures the sheet has at least `needed` columns.
 * Inserts extras at the end if necessary.
 */
function _ensureColumnCapacity_(sh, needed) {
  var maxCols = sh.getMaxColumns();
  if (maxCols < needed) {
    sh.insertColumnsAfter(maxCols, needed - maxCols);
  }
}




/**
 * Applies consistent header styling to a range of columns in row 1.
 */
function _formatHeaderRange_(sh, startCol, count) {
  sh.getRange(1, startCol, 1, count)
    .setFontWeight('bold')
    .setBackground('#1a1a2e')
    .setFontColor('#ffffff');
}



/**
 * Ensures every column in schemaHeaders exists in the sheet's header row.
 *
 * Behavior:
 *  - Empty sheet        → write canonical headers (ordered).
 *  - Headers, no data   → safe to rewrite row 1 in canonical order.
 *  - Headers + data     → append missing columns to the RIGHT only.
 *  - Already up-to-date → no-op.
 *
 * NEVER reorders existing columns when data is present.
 * NEVER overwrites row 1 wholesale when data is present.
 *
 * @param  {Sheet}    sh
 * @param  {string[]} schemaHeaders
 * @return {{ added: string[] }}
 */
function ensureSchemaColumns_(sh, schemaHeaders) {
  var physical = getPhysicalHeaders_(sh);
  var nonEmpty = physical.filter(Boolean);
  var hasData  = sh.getLastRow() > 1;

  // Case 1: No headers at all → stamp canonical
  if (nonEmpty.length === 0) {
    _stampCanonicalHeaders_(sh, schemaHeaders);
    return { added: schemaHeaders.slice() };
  }

  // Case 2: Headers exist but no data rows → safe to rewrite canonical
  if (!hasData) {
    _stampCanonicalHeaders_(sh, schemaHeaders);
    return {
      added: schemaHeaders.filter(function(h) {
        return nonEmpty.indexOf(h) === -1;
      })
    };
  }

  // Case 3: Headers + data → only append missing columns to the right
  var existingSet = {};
  nonEmpty.forEach(function(h) { existingSet[h] = true; });

  var missing = schemaHeaders.filter(function(h) { return !existingSet[h]; });
  if (missing.length === 0) return { added: [] };

  // Find last occupied column position
  var lastOccupied = physical.length;
  while (lastOccupied > 0 && !physical[lastOccupied - 1]) lastOccupied--;

  var startCol    = lastOccupied + 1;
  var totalNeeded = lastOccupied + missing.length;

  _ensureColumnCapacity_(sh, totalNeeded);
  sh.getRange(1, startCol, 1, missing.length).setValues([missing]);
  _formatHeaderRange_(sh, startCol, missing.length);

  log_('🧩 Schema upgrade on "' + sh.getName() + '": appended [' + missing.join(', ') + ']');
  return { added: missing };
}




/**
 * Writes canonical headers to row 1 of an empty/headerless sheet.
 * ONLY called when there are NO data rows to corrupt.
 */
function _stampCanonicalHeaders_(sh, schemaHeaders) {
  sh.clear();
  _ensureColumnCapacity_(sh, schemaHeaders.length);
  sh.getRange(1, 1, 1, schemaHeaders.length).setValues([schemaHeaders]);
  _formatHeaderRange_(sh, 1, schemaHeaders.length);
  sh.setFrozenRows(1);
}


function _marketFromRow_(b) {
  // In PERFORMANCE_LOG, your "Type" column stores the market (MAIN/OU/Q_SPREAD/etc)
  return String(b.Type || b.type || '').toUpperCase().trim();
}

function _sideFromRow_(b) {
  // In PERFORMANCE_LOG, you have HomeAwayFlag (HOME/AWAY/NEUTRAL)
  return String(b.HomeAwayFlag || b.homeAwayFlag || '').toUpperCase().trim();
}

function _isTotalsMarket_(market) {
  const m = String(market || '').toUpperCase().trim();
  return (m === 'OU' || m === 'TOTALS');
}


// ═══════════════════════════════════════════════════════════════════════════════
// ForebetAction Sanitization & Defaulting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize junk ForebetAction values to 'NA'.
 *
 * Catches:
 *   - Empty / whitespace-only strings
 *   - Explicit tokens: 'N/A', 'NA', 'null', 'undefined', 'NaN'
 *   - Garbage characters: '---', '???', '—', '/', etc.
 *   - Numeric-ish strings: '0', '1', '0.5'
 *
 * Mutates `b` in place. Call at ingest / normalization time,
 * NOT inside predicates.
 *
 * @param  {Object} b  A bet / row object
 * @return {Object}    The same object (for chaining)
 */
function _sanitizeForebetAction_(b) {
  b = b || {};

  const raw = String(b.ForebetAction || b.forebetAction || '').trim();

  const JUNK_LITERALS = /^(?:N\/A|NA|null|undefined|nan)$/i;
  const JUNK_CHARS    = /^[\s\-—–?!\/]*$/;
  const looksNumeric  = raw !== '' && !isNaN(Number(raw));

  if (!raw || JUNK_LITERALS.test(raw) || JUNK_CHARS.test(raw) || looksNumeric) {
    b.ForebetAction = 'NA';
    b.forebetAction = 'NA';
  }

  return b;
}


/**
 * Should we default an NA ForebetAction → WITH during week-test?
 *
 * Returns `true` only when:
 *   1. The market is NOT a totals market (Over/Under, etc.)
 *   2. The side is a "comparable" pick — HOME or AWAY
 *
 * Pure predicate — no mutation of `b`.
 *
 * @param  {Object}  b  A bet / row object
 * @return {boolean}
 */
function _shouldDefaultNAForebetToWith_(b) {
  b = b || {};

  const market = _marketFromRow_(b);
  if (_isTotalsMarket_(market)) return false;

  const side = String(_sideFromRow_(b) || '').toUpperCase().trim();
  return side === 'HOME' || side === 'AWAY';
}


// ═══════════════════════════════════════════════════════════════════════════════
// Usage — call during your ingest / normalization pass
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalize all bets and apply the NA → WITH default where appropriate.
 *
 * @param {Object[]} bets  Array of bet / row objects
 */
function _normalizeForebetActions_(bets) {
  if (!Array.isArray(bets)) return;

  bets.forEach(function (b) {

    /* ── Step 0 — capture raw prediction from any key ──────── */
    var predRaw = _firstMeaningful_(
      b.ForebetPred,       b.forebetPred,
      b.Pred,              b.pred,
      b['Forebet Pred'],   b['Pred']
    );

    // If "Forebet Action" column held 1/2, treat as prediction
    var actionRaw = _firstMeaningful_(
      b.ForebetAction,     b.forebetAction,
      b.forebet_action,    b['Forebet Action'],
      b['FOREBET ACTION']
    );
    if (!predRaw && (actionRaw === '1' || actionRaw === '2')) {
      predRaw = actionRaw;
    }

    // Store canonical prediction direction
    var predDir = _normalizeForebetPred_(predRaw);
    b.ForebetPred  = predDir;
    b.forebetPred  = predDir;

    /* ── Step 1 — derive WITH / AGAINST ────────────────────── */
    //   _deriveForebetAction_ reads ForebetPred + HomeAwayFlag
    var derived = _deriveForebetAction_(b);

    /* ── Step 2 — fallback: default to WITH for eligible bets ─ */
    if (!derived &&
        typeof _shouldDefaultNAForebetToWith_ === 'function' &&
        _shouldDefaultNAForebetToWith_(b)) {
      derived = 'WITH';
    }

    /* ── Step 3 — write canonical keys ─────────────────────── */
    b.ForebetAction = derived;
    b.forebetAction = derived;

    // Clean up any spaced-key ghosts
    if ('Forebet Action' in b)  b['Forebet Action']  = derived;
    if ('FOREBET ACTION' in b)  b['FOREBET ACTION']  = derived;
    if ('forebet_action' in b)  b['forebet_action']  = derived;
  });
}


// ═══════════════════════════════════════════════════════════════════════════════
// Helper stubs — replace with your actual implementations
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract the market string from a bet row.
 * e.g. '1X2', 'Over/Under 2.5', 'Asian Handicap', etc.
 *
 * @param  {Object} b
 * @return {string}
 */
function _marketFromRow_(b) {
  // ── YOUR IMPLEMENTATION ──
  return String(b.Market || b.market || '').trim();
}

/**
 * Is this market a totals (Over/Under) market?
 *
 * @param  {string} market
 * @return {boolean}
 */
function _isTotalsMarket_(market) {
  // ── YOUR IMPLEMENTATION ──
  return /over|under|total/i.test(String(market));
}

/**
 * Extract the side / pick direction from a bet row.
 * Expected values: 'HOME', 'AWAY', 'DRAW', 'OVER', 'UNDER', etc.
 *
 * @param  {Object} b
 * @return {string}
 */
function _sideFromRow_(b) {
  // ── YOUR IMPLEMENTATION ──
  return String(b.Side || b.side || '').trim();
}

function _matchString_(obj) {
  return matchString(obj);
}

function _evidenceCount_(alpha, beta, cfg) {
  // How much data beyond the prior (can be fractional because you decay)
  const a = safeNum_(alpha, 0);
  const b = safeNum_(beta, 0);
  const priorSum = safeNum_(cfg.PRIOR_ALPHA, 0) + safeNum_(cfg.PRIOR_BETA, 0);
  return Math.max(0, (a + b) - priorSum);
}

/* =========================
 * RUNTIME OVERRIDES (ScriptProperties)
 * ========================= */

function _getRuntimeOverrides_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('MIC_RUNTIME_OVERRIDES');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function setMICRuntimeOverrides(overridesObj) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('MIC_RUNTIME_OVERRIDES', JSON.stringify(overridesObj || {}));
  Logger.log('✅ Set MIC_RUNTIME_OVERRIDES');
}

function clearMICRuntimeOverrides() {
  PropertiesService.getScriptProperties().deleteProperty('MIC_RUNTIME_OVERRIDES');
  Logger.log('✅ Cleared MIC_RUNTIME_OVERRIDES');
}

function getMICRuntimeOverrides() {
  return _getRuntimeOverrides_();
}

function _deepMerge_(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  Object.keys(over).forEach(k => {
    const bv = base ? base[k] : undefined;
    const ov = over[k];
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = _deepMerge_(bv, ov);
    } else {
      out[k] = ov;
    }
  });
  return out;
}

function _cfg_() {
  return _deepMerge_(MIC_DEFAULTS, _getRuntimeOverrides_());
}

/* =========================
 * BET_SLIPS MAPPING HELPERS
 * ========================= */

// Markets your MIC "Type" should represent
if (typeof _KNOWN_MARKETS_ === 'undefined') {
  const _KNOWN_MARKETS_ = new Set(['MAIN','OU','Q_SPREAD','SPREAD','ML','TOTALS']);
}

function _micBetType_(bet) {
  // Your feed: Market = MAIN / OU / Q_SPREAD
  const m = String(bet.market || bet.Market || '').toUpperCase().trim();
  if (m) return m;

  // Fallback: if Type is actually a market (other feeds)
  const t = String(bet.type || bet.Type || '').toUpperCase().trim();
  if (_KNOWN_MARKETS_.has(t)) return t;

  return '';
}

function _pickClass_(bet) {
  // Your feed: Type = SNIPER 🎯 / BANKER 🔒 / etc (label)
  // If Type accidentally equals a known market, don’t treat it as label.
  const t = String(bet.type || bet.Type || '').trim();
  if (!t) return '';
  if (_KNOWN_MARKETS_.has(t.toUpperCase().trim())) return '';
  return t;
}



function _sanitizePickForID_(pick) {
  var s = String(pick || '');

  try { s = s.normalize('NFKC'); } catch (e) {}

  // Remove emoji surrogate pairs + joiners/variation selectors
  s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');
  s = s.replace(/[\u200D\uFE0F]/g, '');

  // Remove decorative glyphs
  s = s.replace(/[★☆●○✅⚠️⬡♦◆■□•·🔒🎯🔥📊🔴🟡🟢]/g, ' ');

  // Strip embedded/standalone percentages
  s = s.replace(/\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)/g, ' ');
  s = s.replace(/\b\d{1,3}(?:\.\d+)?\s*%\b/g, ' ');

  // Standardize quarter prefix variants: "Q1:", "Q 1 -" -> "Q1 "
  s = s.replace(/\bQ\s*([1-4])\s*[:.\-–—]?\s*/gi, 'Q$1 ');

  // Standardize O/U -> OVER/UNDER (only when followed by number)
  s = s.replace(/\bO(?:VER)?\s*([0-9]+(?:\.[0-9]+)?)\b/gi, 'OVER $1');
  s = s.replace(/\bU(?:NDER)?\s*([0-9]+(?:\.[0-9]+)?)\b/gi, 'UNDER $1');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function _normalizeDirectionToken_(x) {
  const s = String(x || '').toUpperCase().trim();
  if (!s) return '';
  if (s === 'H' || s === 'HOME') return 'HOME';
  if (s === 'A' || s === 'AWAY') return 'AWAY';
  if (s === 'OVER') return 'OVER';
  if (s === 'UNDER') return 'UNDER';
  return s;
}

function _pickSideToken_(bet) {
  // Use Direction column when present (it’s already clean in your feed)
  const dir = _normalizeDirectionToken_(bet.direction || bet.Direction || '');
  if (dir === 'HOME' || dir === 'AWAY') return dir;
  if (dir === 'OVER' || dir === 'UNDER') return dir;

  // Otherwise infer from pick/match (your existing logic)
  const pick = bet.pick || bet.Pick || '';
  const match = _matchString_(bet);
  const ha = parseHomeAwayFlag_(pick, match);
  if (ha === 'HOME' || ha === 'AWAY') return ha;

  const pu = String(pick || '').toUpperCase();
  if (/OVER/.test(pu)) return 'OVER';
  if (/UNDER/.test(pu)) return 'UNDER';

  return 'NEUTRAL';
}

function _forebetPredToken_(bet) {
  // Your feed: "Forebet Pred" appears as "1" or "2" often
  const raw =
    bet.forebetPred || bet['Forebet Pred'] || bet.ForebetPred || bet.Forebet_Pred || '';

  const s = String(raw || '').toUpperCase().trim();
  if (!s) return '';

  // Common forebet codes: 1 (home), X (draw), 2 (away)
  if (s === '1') return 'HOME';
  if (s === '2') return 'AWAY';
  if (s === 'X' || s === 'DRAW') return 'NEUTRAL';

  if (s === 'HOME' || s === 'H') return 'HOME';
  if (s === 'AWAY' || s === 'A') return 'AWAY';
  if (s.indexOf('OVER') !== -1) return 'OVER';
  if (s.indexOf('UNDER') !== -1) return 'UNDER';

  // If pred is a team name, map to HOME/AWAY via Match teams
  const teams = extractTeams_(_matchString_(bet));
  const home = String(teams.home || '').toUpperCase().trim();
  const away = String(teams.away || '').toUpperCase().trim();
  if (home && home !== 'NA' && s === home) return 'HOME';
  if (away && away !== 'NA' && s === away) return 'AWAY';

  return s; // unknown format; keep for debugging
}


/**
 * Converts Forebet prediction code to a direction.
 *   1 → HOME,  2 → AWAY,  X/0 → DRAW
 */
function _normalizeForebetPred_(val) {
  if (val === null || val === undefined || val === '') return '';
  var v = String(val).trim();

  if (v === '1') return 'HOME';
  if (v === '2') return 'AWAY';
  if (v === '0' || v.toUpperCase() === 'X') return 'DRAW';

  var u = v.toUpperCase();
  if (u === 'HOME' || u === 'H') return 'HOME';
  if (u === 'AWAY' || u === 'A') return 'AWAY';
  if (u === 'DRAW' || u === 'D') return 'DRAW';

  return '';
}



/* =========================
 * LOG HELPERS
 * ========================= */



function log_(msg) { try { Logger.log(String(msg)); } catch (e) {} }
function warn_(msg) { try { Logger.log('⚠️ ' + String(msg)); } catch (e) {} }
function err_(msg) { try { Logger.log('❌ ' + String(msg)); } catch (e) {} }

function isoNow_() { return new Date().toISOString(); }

function safeNum_(x, fallback) {
  const n = parseFloat(x);
  return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}

function normalizeConfidence_(value) {
  const n = safeNum_(value, NaN);
  if (isNaN(n)) return NaN;
  if (n > 0 && n <= 1) return n * 100;
  return n;
}

function normalizeString_(str) {
  if (str === null || str === undefined || str === '') return 'NA';

  return String(str)
    .normalize('NFD')                    // split accents
    .replace(/[\u0300-\u036f]/g, '')     // remove accents
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // remove zero-width chars
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'NA';
}

function _loadLeagueKeyMapFromConfig_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'MIC_LeagueKeyMap_CodeCanonical_v1';

  const cached = cache.get(cacheKey);
  if (cached) {
    try { return new Map(JSON.parse(cached)); } catch (e) {}
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Config');
  const map = new Map();

  if (!sh || sh.getLastRow() < 2) return map;

  const data = sh.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim().toLowerCase());

  // Try robust header discovery
  const idxCode = headers.findIndex(h => h.includes('league') && h.includes('code'));
  const idxName = headers.findIndex(h => h.includes('league') && h.includes('name'));

  if (idxCode === -1 || idxName === -1) {
    warn_('Config is missing "League Code" and/or "League Name" columns (cannot canonicalize leagues).');
    return map;
  }

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const codeRaw = String(row[idxCode] || '').trim();
    const nameRaw = String(row[idxName] || '').trim();
    if (!codeRaw) continue;

    const codeKey = normalizeString_(codeRaw); // canonical key = CODE
    if (!codeKey || codeKey === 'NA') continue;

    // CODE -> CODE
    map.set(codeKey, codeKey);

    // NAME -> CODE
    const nameKey = normalizeString_(nameRaw);
    if (nameKey && nameKey !== 'NA') map.set(nameKey, codeKey);
  }

  try {
    cache.put(cacheKey, JSON.stringify(Array.from(map.entries())), 6 * 60 * 60); // 6h
  } catch (e) {}

  return map;
}

/**
 * normalizeLeagueKey_  (Mothership_Intelligence_Core.gs)
 *
 * Resolves fused league strings like "UNITED_STATESNBA" or "GERMANY_PRO_ADE2"
 * back to their canonical Config code ("NBA", "DE2").
 *
 * Recovery chain:
 *   1) Exact alias match via Config map
 *   2) Raw string IS a canonical code already
 *   3) Last underscore-delimited token IS a canonical code
 *   4) Suffix match (longest-first to prevent partial sub-matches)
 *   5) Compact suffix match (underscores stripped)
 *   6) Bounded contains ("_CODE_" within "_RAW_", underscore-delimited only)
 *   7) Deterministic fallback (return normalized raw)
 *
 * Intentionally avoids:
 *   - Prefix/startsWith matching (false-positive risk per critique)
 *   - Raw .includes() matching (collision risk)
 */
function normalizeLeagueKey_(leagueRaw) {
  var raw = normalizeString_(leagueRaw);
  if (!raw || raw === 'NA') return 'NA';

  var map = _loadLeagueKeyMapFromConfig_();

  // Guard: if map is not usable, return raw deterministically
  if (!map || typeof map.has !== 'function') return raw;

  // ── 1) Exact alias match (happy path) ──
  if (map.has(raw)) {
    var v = map.get(raw);
    return v ? normalizeString_(v) : raw;
  }

  // ── Build canonical code list (normalized, unique, longest-first) ──
  var validCodes;
  try {
    var seen = {};
    var allVals = [];
    map.forEach(function(val) {
      var n = normalizeString_(val);
      if (n && n !== 'NA' && !seen[n]) {
        seen[n] = true;
        allVals.push(n);
      }
    });
    validCodes = allVals.sort(function(a, b) { return b.length - a.length; });
  } catch (e) {
    return raw;
  }

  if (!validCodes.length) return raw;

  // ── 2) Raw IS already a canonical code ──
  for (var c = 0; c < validCodes.length; c++) {
    if (raw === validCodes[c]) return raw;
  }

  // ── 3) Last-token recovery: "SPAIN_LIGA_FEMENINA_ESW" → "ESW" ──
  var tokens = raw.split('_').filter(function(t) { return t.length > 0; });
  if (tokens.length > 1) {
    var lastToken = tokens[tokens.length - 1];
    for (var lt = 0; lt < validCodes.length; lt++) {
      if (lastToken === validCodes[lt]) return validCodes[lt];
    }
  }

  // ── 4) Suffix recovery (the core fused-string fix) ──
  //    "UNITED_STATESNBA" endsWith "NBA"  ✓
  //    "GERMANY_PRO_A_DE2" endsWith "_DE2"  ✓
  for (var s = 0; s < validCodes.length; s++) {
    var code = validCodes[s];
    if (raw.endsWith(code) || raw.endsWith('_' + code)) return code;
  }

  // ── 5) Compact suffix (underscores stripped on both sides) ──
  //    Handles feeds that inconsistently strip/add underscores
  var rawCompact = raw.replace(/_/g, '');
  for (var cs = 0; cs < validCodes.length; cs++) {
    var codeCompact = validCodes[cs].replace(/_/g, '');
    if (codeCompact && rawCompact.endsWith(codeCompact)) return validCodes[cs];
  }

  // ── 6) Bounded contains: "_CODE_" within "_RAW_" ──
  //    Handles "UNITED_STATES_NBA_PLAYOFFS" → finds "_NBA_"
  //    Underscore-delimited only (no raw substring matching)
  var bounded = '_' + raw + '_';
  for (var bc = 0; bc < validCodes.length; bc++) {
    var needle = '_' + validCodes[bc] + '_';
    if (bounded.indexOf(needle) !== -1) return validCodes[bc];
  }

  // ── 7) Deterministic fallback ──
  return raw;
}


function normalizeOdds_(x) {
  if (x === null || x === undefined) return NaN;

  const s0 = String(x).trim();
  if (!s0 || s0 === '-' || s0.toUpperCase() === 'NA') return NaN;

  // If odds sometimes come as "1,85" (comma decimal), normalize to "1.85"
  const s = (s0.indexOf(',') >= 0 && s0.indexOf('.') < 0) ? s0.replace(',', '.') : s0;

  const o = parseFloat(s);
  if (!isFinite(o) || o <= 1) return NaN;
  return o;
}

function getConfidenceBucket_(confidence, scheme) {
  const mode = String(scheme || 'MIC').toUpperCase();
  const conf = normalizeConfidence_(confidence);
  if (isNaN(conf)) return 'NA';

  // Preserve MIC legacy buckets (do NOT change these)
  if (mode === 'MIC') {
    if (conf >= 90) return '90-100';
    if (conf >= 80) return '80-89';
    if (conf >= 70) return '70-79';
    if (conf >= 60) return '60-69';
    if (conf >= 50) return '50-59';
    return 'BELOW_50';
  }

  // ASSAYER contract buckets: MUST match Phase 1 computeConfidenceBucket_ exactly (including gaps)
  if (typeof computeConfidenceBucket_ !== 'function') return 'NA';

  let c01 = conf;
  if (c01 > 1) c01 = c01 / 100;

  const bucket = computeConfidenceBucket_(c01); // returns string or null
  return bucket || 'NA';
}

function _getMatchDateYYYYMMDDFromBet_(bet, betID) {
  // Prefer explicit fields from Sync_Temp ("Date") or any upstream ("MatchDate")
  const raw = bet.matchDate || bet.MatchDate || bet.date || bet.Date || '';

  let ymd = formatDateForID_(raw);
  if (ymd && ymd !== 'NA') return ymd;

  // Fallback: BetID already contains yyyymmdd as part[1]
  if (betID) {
    const parts = String(betID).split('|');
    if (parts.length >= 2 && /^\d{8}$/.test(parts[1])) return parts[1];
  }

  return 'NA';
}

/* =========================
 * PARSERS
 * ========================= */

function parseQuarter_(pick) {
  if (!pick) return 'FT';
  const s = String(pick).toUpperCase();
  if (/OT|OVERTIME/.test(s)) return 'OT';
  if (/Q1|1ST\s*QTR|FIRST\s*QUARTER/.test(s)) return 'Q1';
  if (/Q2|2ND\s*QTR|SECOND\s*QUARTER/.test(s)) return 'Q2';
  if (/Q3|3RD\s*QTR|THIRD\s*QUARTER/.test(s)) return 'Q3';
  if (/Q4|4TH\s*QTR|FOURTH\s*QUARTER/.test(s)) return 'Q4';
  if (/HT|HALF\s*TIME|1ST\s*HALF|FIRST\s*HALF/.test(s)) return 'HT';
  if (/2ND\s*HALF|SECOND\s*HALF/.test(s)) return '2H';
  return 'FT';
}

function parseSubType_(pick) {
  if (!pick) return 'NA';
  const s = String(pick).toUpperCase();

  const q = [
    { k:'Q1', re:/Q1|1ST\s*QTR|FIRST\s*QUARTER/i },
    { k:'Q2', re:/Q2|2ND\s*QTR|SECOND\s*QUARTER/i },
    { k:'Q3', re:/Q3|3RD\s*QTR|THIRD\s*QUARTER/i },
    { k:'Q4', re:/Q4|4TH\s*QTR|FOURTH\s*QUARTER/i },
    { k:'HT', re:/HT|HALF\s*TIME|1ST\s*HALF|FIRST\s*HALF/i },
    { k:'OT', re:/OT|OVERTIME/i }
  ];
  for (let i=0;i<q.length;i++) {
    if (q[i].re.test(s)) {
      if (/OVER|UNDER/.test(s)) return q[i].k + '_OU';
      if (/SPREAD|MARGIN|\+|\-\d/.test(s)) return q[i].k + '_SPREAD';
      return q[i].k + '_ML';
    }
  }

  if (/OVER/.test(s)) return 'OVER';
  if (/UNDER/.test(s)) return 'UNDER';
  if (/SPREAD|\+\d+\.?\d*|\-\d+\.?\d*/.test(s)) return 'SPREAD';
  if (/MARGIN/.test(s)) return 'MARGIN';
  if (/ML|MONEY\s*LINE|WIN|WINNER/.test(s)) return 'ML';
  if (/BTTS|BOTH\s*TEAMS?\s*TO\s*SCORE/.test(s)) return 'BTTS';
  if (/DRAW|TIE/.test(s)) return 'DRAW';
  return 'OTHER';
}



function parseHomeAwayFlag_(pick, match) {
  if (!pick || !match) return 'NEUTRAL';

  const pickUpper = String(pick).toUpperCase().trim();

  // ✅ Handle your shorthand first (these do not include team names)
  // Examples: "Q1: H +9.5", "Q4: A +3.0"
  if (/\bQ[1-4]\s*:\s*H\b/.test(pickUpper)) return 'HOME';
  if (/\bQ[1-4]\s*:\s*A\b/.test(pickUpper)) return 'AWAY';

  // (Optional safety) handle "H +x" / "A +x" without quarter if you ever use it
  if (/(^|\s)H\s*[+-]\s*\d/.test(pickUpper)) return 'HOME';
  if (/(^|\s)A\s*[+-]\s*\d/.test(pickUpper)) return 'AWAY';

  const teams = extractTeams_(match);

  const homeTeam = String(teams.home || '').toUpperCase().trim();
  const awayTeam = String(teams.away || '').toUpperCase().trim();
  if (!homeTeam || !awayTeam || homeTeam === 'NA' || awayTeam === 'NA') return 'NEUTRAL';

  function esc_(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  const homeRe = new RegExp(esc_(homeTeam), 'i');
  const awayRe = new RegExp(esc_(awayTeam), 'i');

  if (homeRe.test(pickUpper)) return 'HOME';
  if (awayRe.test(pickUpper)) return 'AWAY';

  if (/HOME\s*(WIN|WINNER|ML|MONEY\s*LINE)/i.test(pickUpper)) return 'HOME';
  if (/AWAY\s*(WIN|WINNER|ML|MONEY\s*LINE)/i.test(pickUpper)) return 'AWAY';

  // Totals/draw markets are neutral by design
  if (/OVER|UNDER|O\/U|TOTAL|BTTS|DRAW/i.test(pickUpper)) return 'NEUTRAL';

  return 'NEUTRAL';
}

function detectSport_(obj) {
  const leagueRaw = String(obj.league || obj.League || '').toUpperCase().trim();
  const pick = String(obj.pick || obj.Pick || '').toUpperCase();

  // ✅ First: Config-driven detection (fast via cache)
  const map = _loadLeagueSportMapFromConfig_();
  if (leagueRaw && map.has(leagueRaw)) return map.get(leagueRaw);

  // ✅ Second: heuristic fallback (keeps system robust if Config missing)
  const bballHints = ['Q1','Q2','Q3','Q4','QUARTER','POINTS','PTS'];
  for (let i = 0; i < bballHints.length; i++) {
    if (pick.indexOf(bballHints[i]) !== -1) return 'BASKETBALL';
  }

  const soccerHints = ['BTTS','CORNERS','CLEAN SHEET'];
  for (let i = 0; i < soccerHints.length; i++) {
    if (pick.indexOf(soccerHints[i]) !== -1) return 'FOOTBALL';
  }

  return 'UNKNOWN';
}

/* =========================
 * IDS (Deterministic)
 * ========================= */

function generateBetID_(bet) {
  const league = normalizeLeagueKey_(bet.league || bet.League || '');

  const matchRaw = _matchString_(bet);
  const match  = normalizeString_(matchRaw);

  const pickRaw = bet.pick || bet.Pick || '';
  const pick = normalizeString_(_sanitizePickForID_(pickRaw));

  const type  = normalizeString_(_micBetType_(bet)); // Market → Type
  const date  = formatDateForID_(bet.matchDate || bet.MatchDate || bet.date || bet.Date || 'NA');

  return [league, date, match, type, pick].join('|');
}

function generateResultKeyNoScore_(result) {
  const league = normalizeLeagueKey_(result.league || result.League || '');
  const matchRaw = matchString(result);
  const match = normalizeString_(matchRaw);
  const date = formatDateForID_(result.matchDate || result.MatchDate || result.date || result.Date || 'NA');

  if (!league || league === 'NA' || !date || date === 'NA' || !match || match === 'NA') return 'NA|NA|NA';
  return [league, date, match].join('|');
}

// Deterministic LogID: BET + SCORELESS RESULT KEY
function generateLogID_(betID, resultKeyNoScore) {
  return 'LOG|' + betID + '|' + resultKeyNoScore;
}


function _loadBetsFromArchive_(shardId, options) {
  var cfg = _cfg_();
  var opt = options || {};

  var sheetName      = cfg.SHEETS.BETS_ARCHIVE;
  var fallbackSchema = SCHEMA.BETS_ARCHIVE;

  var sheet = getShardSheetById_(sheetName, shardId);
  if (!sheet) return [];

  var rawHeaders = _getPhysicalHeaders_(sheet, fallbackSchema);
  var lastRow    = sheet.getLastRow();
  if (lastRow <= 1) return [];

  /* ── Canonicalize headers once ────────────────────── */
  var headers = rawHeaders.map(function (h) {
    return _canonicalHeaderKey_(h);
  });

  var width = headers.length;
  var data  = sheet.getRange(2, 1, lastRow - 1, width).getValues();

  var out = [];

  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var bet = {};

    for (var c = 0; c < headers.length; c++) {
      var h = headers[c];
      if (!h) continue;
      bet[h] = row[c];
    }

    /* ── Numeric coercions ──────────────────────────── */
    if ('EV' in bet)         bet.EV         = _toFiniteNum_(bet.EV, 0);
    if ('Odds' in bet)       bet.Odds       = _toFiniteNum_(bet.Odds, 0);
    if ('Confidence' in bet) bet.Confidence = _toFiniteNum_(bet.Confidence, 0);

    /* ── Type fallback ──────────────────────────────── */
    if ('Type' in bet) {
      var t = (bet.Type === null || bet.Type === undefined)
        ? '' : String(bet.Type).trim();
      bet.Type = t || 'UNKNOWN';
    }

    /* ── MatchDate ──────────────────────────────────── */
    if ('MatchDate' in bet) {
      bet.MatchDate = _normalizeDateForKey(bet.MatchDate);
    }

    /* ── League: canonical ──────────────────────────── */
    if ('League' in bet) {
      bet.League = normalizeLeagueKey_(bet.League);
    }

    /* ── ForebetPred: normalize 1/2 → HOME/AWAY ────── */
    if ('ForebetPred' in bet) {
      bet.ForebetPred = _normalizeForebetPred_(bet.ForebetPred);
    }

    /* ── ForebetAction: if it holds 1/2, move to Pred ─ */
    if ('ForebetAction' in bet) {
      var faVal = String(bet.ForebetAction ?? '').trim();
      if (faVal === '1' || faVal === '2') {
        // Column was mislabeled; value is actually a prediction
        if (!bet.ForebetPred) {
          bet.ForebetPred = _normalizeForebetPred_(faVal);
        }
        bet.ForebetAction = '';
      } else {
        bet.ForebetAction = _blankIfNA_(faVal);
      }
    }

    /* ── RiskTier: sanitize ─────────────────────────── */
    if ('RiskTier' in bet) {
      bet.RiskTier = _blankIfNA_(bet.RiskTier);
    }

    if (opt.filterFn && !opt.filterFn(bet)) continue;
    out.push(bet);
  }

  return out;
}


function _toFiniteNum_(value, fallback) {
  const fb = (fallback === undefined) ? 0 : fallback;
  const n = (typeof value === 'number') ? value : parseFloat(value);
  return (isFinite(n) ? n : fb);
}



/**
 * generateSegmentKey_  (Mothership_Intelligence_Core.gs)
 *
 * Builds a pipe-delimited segment key for bucketing bet performance.
 * Format: sport|league|betType|subType|side|confBucket|quarter|riskTier
 *
 * PATCHES APPLIED:
 *   Gap 3.1 — Strip RISKY_ prefix from betType
 *   Gap 3.2 — Strip pipe corruption from league (pre + post canonicalization)
 *   Gap 3.3 — Normalize single-letter side tokens (H→HOME, A→AWAY)
 *   Gap 3.4 — Prefer upstream RiskTier (consistent with Gap 2 archive behavior)
 *   Gap 4   — _riskTier_ helper reads new field with correct precedence
 */
/**
 * Builds an 8-part pipe-delimited segment key:
 * sport|league|betType|subType|side|confBucket|quarter|riskTier
 *
 * ForebetAction is NOT part of the key (it's a field, not a dimension).
 */
function generateSegmentKey_(bet) {
  bet = bet || {};

  var sport = normalizeString_(bet.sport || bet.Sport || detectSport_(bet) || 'NA');

  // ── League: canonical code via normalizeLeagueKey_ ──
  var rawLeague = bet.league || bet.League || bet.leagueCode || bet.LeagueCode || '';

  // GAP 3.2a: strip pipe corruption BEFORE canonicalization
  if (rawLeague.indexOf('|') !== -1) rawLeague = rawLeague.split('|')[0].trim() || 'NA';

  var league = normalizeLeagueKey_(rawLeague);

  // GAP 3.2b: strip pipe corruption AFTER canonicalization
  if (league.indexOf('|') !== -1) league = league.split('|')[0].trim() || 'NA';

  // ── BetType ──
  var market = _micBetType_(bet);
  var betType = normalizeString_(market || 'NA');

  // GAP 3.1: strip RISKY_ prefix so RISKY_1X2 → 1X2
  if (betType.toUpperCase().indexOf('RISKY_') === 0) {
    betType = normalizeString_(betType.replace(/^RISKY_/i, '').trim() || 'NA');
  }

  var pick  = bet.pick || bet.Pick || '';
  var match = _matchString_(bet);
  var subType = normalizeString_(
    bet.subType || bet.SubType || parseSubType_(pick) || 'NA'
  );

  // ── Side logic ──
  var side = 'NA';
  if (_isTotalsMarket_(market)) {
    var dir = _normalizeDirectionToken_(bet.direction || bet.Direction || '');
    if (dir === 'OVER' || dir === 'UNDER') {
      side = normalizeString_(dir);
    } else {
      side = normalizeString_(_pickSideToken_(bet)) || 'NA';
    }
  } else {
    var haw = normalizeString_(bet.homeAwayFlag || bet.HomeAwayFlag || '');
    if (haw && haw !== 'NA') {
      side = haw;
    } else {
      var d = _normalizeDirectionToken_(bet.direction || bet.Direction || '');
      if (d === 'HOME' || d === 'AWAY') {
        side = normalizeString_(d);
      } else {
        side = normalizeString_(parseHomeAwayFlag_(pick, match)) || 'NA';
      }
    }
  }

  // GAP 3.3: normalize single-letter side tokens
  if (side === 'H') side = 'HOME';
  if (side === 'A') side = 'AWAY';

  var confBucket = normalizeString_(
    bet.confidenceBucket || bet.ConfidenceBucket ||
    getConfidenceBucket_(bet.confidence || bet.Confidence || 0) || 'NA'
  );

  var quarter = normalizeString_(
    bet.quarter || bet.Quarter || parseQuarter_(pick) || 'NA'
  );

  // GAP 3.4: prefer upstream RiskTier
  var riskTierUpstream = _firstNonEmpty_(bet.RiskTier, bet.riskTier, bet.risk_tier);
  var riskTierComputed = _riskTier_(bet) || '';
  var riskTier = normalizeString_(riskTierUpstream || riskTierComputed || 'NA');

  return [sport, league, betType, subType, side, confBucket, quarter, riskTier].join('|');
}


/**
 * Builds an 8-part segment key from a sheet row object.
 * Returns the SAME 8-part format as generateSegmentKey_:
 * sport|league|betType|subType|side|confBucket|quarter|riskTier
 *
 * ForebetAction is NOT included in the key.
 */
function _segmentKeyFromRow_(row) {
  var _warn = (typeof warn_ === 'function') ? warn_ : function(msg) { Logger.log('[WARN] ' + String(msg)); };
  row = row || {};

  var str = function(v, fb) {
    var s = String(v === null || v === undefined ? (fb || '') : v).trim();
    return s || (fb || '');
  };
  var up = function(v, fb) { return str(v, fb).toUpperCase(); };

  var sport      = up(row.Sport      || row.sport,      'NA');
  var league     = up(row.League     || row.league,      'NA');
  var betType    = up(row.Type       || row.type || row.BetType || row.betType, 'NA');
  var subType    = up(row.SubType    || row.subType,     'NA');
  var side       = up(row.Side       || row.side || row.HomeAwayFlag || row.homeAwayFlag, 'NA');
  var confBucket = up(row.ConfidenceBucket || row.confidenceBucket, 'NA');
  var quarter    = up(row.Quarter    || row.quarter,     'NA');
  var riskTier   = up(row.RiskTier   || row.riskTier,    'NA');

  // ── GUARD 1: strip RISKY_ prefix from betType ───────────────────────────
  if (betType.indexOf('RISKY_') === 0) {
    betType = betType.replace(/^RISKY_/g, '').trim() || 'NA';
    _warn('_segmentKeyFromRow_: stripped RISKY_ prefix from betType; now "' + betType + '"');
  }
  if (!betType || betType === 'UNKNOWN') betType = 'NA';

  // ── GUARD 2: league pipe corruption ─────────────────────────────────────
  if (league.indexOf('|') !== -1) {
    league = league.split('|')[0].trim() || 'NA';
    _warn('_segmentKeyFromRow_: pipe in league field — truncated to "' + league + '"');
  }

  // ── GUARD 3: side normalization ─────────────────────────────────────────
  if (side === 'H') side = 'HOME';
  if (side === 'A') side = 'AWAY';
  var VALID_SIDES = ['HOME', 'AWAY', 'OVER', 'UNDER', 'NA'];
  if (VALID_SIDES.indexOf(side) < 0) side = 'NA';

  // ── GUARD 4: quarter normalization ──────────────────────────────────────
  var VALID_QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4', 'FT', 'H1', 'H2', 'OT', 'NA'];
  if (VALID_QUARTERS.indexOf(quarter) < 0) {
    var qm = quarter.match(/Q([1-4])/);
    quarter = qm ? ('Q' + qm[1]) : 'NA';
  }

  // 8 parts — same schema as generateSegmentKey_
  return [
    sport, league, betType, subType,
    side, confBucket, quarter, riskTier
  ].join('|');
}


/**
 * _riskTier_  (Mothership_Intelligence_Core.gs)
 *
 * Returns the risk-tier label for a bet object.
 *
 * PATCHES APPLIED:
 *   Gap 4 — Reads new upstream RiskTier field FIRST with correct precedence
 *           (RiskTier > riskTier > risk_tier), then falls back to legacy
 *           tier / Tier / Tier1 Config fields. Preserves uppercasing and
 *           Tier1 Config whitelist guard from original implementation.
 *
 * @param  {Object} bet  A bet row object (column-header-keyed).
 * @return {string}      Uppercased tier label, e.g. "ELITE", "STRONG", "MEDIUM", "WEAK", or "NA".
 */
function _riskTier_(bet) {
  bet = bet || {};

  // ── GAP 4 FIX: new upstream field, correct precedence ──
  var rt = String(bet.RiskTier || bet.riskTier || bet.risk_tier || '').toUpperCase().trim();
  if (rt) return rt;

  // ── Legacy fallbacks (safe to keep for older feed formats) ──
  var tier = String(bet.tier || bet.Tier || '').toUpperCase().trim();
  if (tier) return tier;

  var t1 = String(bet.tier1Config || bet['Tier1 Config'] || '').toUpperCase().trim();
  if (t1 === 'ELITE' || t1 === 'STRONG' || t1 === 'MEDIUM' || t1 === 'WEAK') return t1;

  return 'NA';
}

function getParentSegmentKey_(segmentKey) {
  // Force 8-part so we never treat a 9th token as part of the hierarchy
  var parts = normalizeSegmentKey_(segmentKey).split('|');
  if (parts.length <= 3) return null;
  for (var i = parts.length - 1; i >= 3; i--) {
    if (parts[i] && parts[i] !== 'NA') {
      var p = parts.slice();
      p[i] = 'NA';
      return p.join('|');
    }
  }
  return null;
}

/* =========================
 * SHEETS + SHARDS
 * ========================= */
/**
 * Creates a sheet with canonical headers if it doesn't exist.
 * If it DOES exist, ensures all schema columns are present (append-right).
 *
 * @param  {string}   sheetName
 * @param  {string[]} schemaHeaders
 * @return {Sheet}
 */
function createSheetIfMissing_(sheetName, schemaHeaders) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(sheetName);

  if (!sh) {
    sh = ss.insertSheet(sheetName);
    _stampCanonicalHeaders_(sh, schemaHeaders);
    return sh;
  }

  // Sheet exists — upgrade headers if needed
  ensureSchemaColumns_(sh, schemaHeaders);
  return sh;
}



/**
 * Appends an array of objects to a sheet by matching property names
 * to physical header names.
 *
 * - Position-independent (works regardless of column order)
 * - Blank headers → blank cells (preserves alignment)
 * - Unknown object keys → ignored
 *
 * @param  {Sheet}    sh
 * @param  {Object[]} objects
 * @return {number}   Rows appended
 */
function appendByHeaders_(sh, objects) {
  if (!objects || !objects.length) return 0;

  var headers = getPhysicalHeaders_(sh);
  if (!headers.length || headers.every(function(h) { return !h; })) {
    throw new Error('appendByHeaders_: "' + sh.getName() + '" has no headers');
  }

  var rows = objects.map(function(obj) {
    return headers.map(function(h) {
      if (!h) return '';                      // blank header → blank cell
      var v = obj[h];
      return (v === undefined || v === null) ? '' : v;
    });
  });

  var startRow = sh.getLastRow() + 1;
  sh.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  return rows.length;
}



/**
 * Reads all data rows as an array of objects keyed by header name.
 * Safe regardless of column order. Blank headers skipped.
 *
 * @param  {Sheet}     sh
 * @return {Object[]}
 */
function readSheetAsObjects_(sh) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  var headers = getPhysicalHeaders_(sh);
  var data    = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();

  return data.map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) {
      if (h) obj[h] = row[i];
    });
    return obj;
  });
}




function getAllShardSheets_(baseSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const out = [];
  for (let i=0;i<sheets.length;i++) {
    const n = sheets[i].getName();
    if (n === baseSheetName || n.indexOf(baseSheetName + '_') === 0) out.push(sheets[i]);
  }
  out.sort((a,b)=>a.getName().localeCompare(b.getName(), undefined, {numeric:true}));
  return out;
}

function getNextShardNumber_(baseSheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  let max = 0;
  for (let i=0;i<sheets.length;i++) {
    const n = sheets[i].getName();
    if (n.indexOf(baseSheetName + '_') === 0) {
      const num = parseInt(n.replace(baseSheetName + '_',''), 10);
      if (!isNaN(num) && num > max) max = num;
    }
  }
  return max + 1;
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * getArchiveSheet_ — CONSOLIDATED PATCH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Returns the current shard sheet for appending data, creating a new
 * shard if the current one exceeds SHARD_THRESHOLD_CELLS.
 *
 * Fixes applied:
 *  1. Safe log_ fallback — no crash if log_ is undefined
 *  2. Schema consistency — new shards inherit headers from base sheet
 *     (not from caller's headers, which may have drifted)
 *  3. Empty shards guard — falls back to base sheet if
 *     getAllShardSheets_ returns [] or non-array
 *  4. Deterministic shard ordering — base sheet first, then by
 *     trailing _N number (not insertion order / tab order)
 *  5. Non-shard sheet filtering — "_backup", "_old" etc. excluded
 *     from shard discovery
 *  6. Null-safe _getPhysicalHeaders_ — falls back through
 *     basePhysicalHeaders → headers → empty array
 *  7. cellCount uses Math.max(1, ...) on both dimensions to
 *     prevent 0 × N = 0 (which would never trigger sharding)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
function getArchiveSheet_(baseSheetName, headers) {
  var cfg = _cfg_();
  var _log = (typeof log_ === 'function')
    ? log_
    : function(msg) { Logger.log(String(msg)); };

  // ═══════════════════════════════════════════════════════════════
  // 1) ENSURE BASE SHEET EXISTS
  //
  //    createSheetIfMissing_ returns the sheet object.
  //    We keep this as our guaranteed fallback.
  // ═══════════════════════════════════════════════════════════════
  var baseSheet = createSheetIfMissing_(baseSheetName, headers);


  // ═══════════════════════════════════════════════════════════════
  // 2) DISCOVER SHARDS (defensive)
  //
  //    FIX #3: getAllShardSheets_ might return:
  //      - undefined / null   (function missing or error)
  //      - []                 (naming mismatch, permissions)
  //      - unsorted array     (tab order, not shard order)
  //
  //    We guard against all of these.
  // ═══════════════════════════════════════════════════════════════
  var rawShards = null;
  if (typeof getAllShardSheets_ === 'function') {
    try {
      rawShards = getAllShardSheets_(baseSheetName);
    } catch (e) {
      _log('⚠️ getAllShardSheets_ threw: ' + (e && e.message ? e.message : e));
      rawShards = null;
    }
  }

  // Ensure we have a usable array with at least the base sheet
  var shards;
  if (Array.isArray(rawShards) && rawShards.length > 0) {
    // Filter out nulls and non-sheet objects
    shards = rawShards.filter(function(s) {
      return s && typeof s.getName === 'function';
    });
  }

  if (!shards || shards.length === 0) {
    shards = [baseSheet];
  }


  // ═══════════════════════════════════════════════════════════════
  // 3) SORT SHARDS DETERMINISTICALLY
  //
  //    FIX #4: Don't rely on tab order or insertion order.
  //    Base sheet (exact name match) comes first.
  //    Numbered shards (BaseName_1, BaseName_2, ...) sort by number.
  //
  //    FIX #5: Filter out non-shard sheets that happen to
  //    start with baseSheetName (e.g., "Results_backup",
  //    "Results_old"). Only accept exact base name or
  //    base name + _digits.
  // ═══════════════════════════════════════════════════════════════
  var shardNumberPattern = new RegExp(
    '^' + baseSheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '_(\\d+)$'
  );

  shards = shards.filter(function(s) {
    var name = s.getName();
    // Keep: exact base name OR base_N pattern
    return name === baseSheetName || shardNumberPattern.test(name);
  });

  // Re-check after filtering
  if (shards.length === 0) {
    shards = [baseSheet];
  }

  shards.sort(function(a, b) {
    var aName = a.getName();
    var bName = b.getName();

    // Base sheet always first
    if (aName === baseSheetName) return -1;
    if (bName === baseSheetName) return 1;

    // Extract shard numbers and sort numerically
    var aMatch = aName.match(shardNumberPattern);
    var bMatch = bName.match(shardNumberPattern);
    var aNum = aMatch ? parseInt(aMatch[1], 10) : 0;
    var bNum = bMatch ? parseInt(bMatch[1], 10) : 0;

    return aNum - bNum;
  });


  // ═══════════════════════════════════════════════════════════════
  // 4) ESTABLISH CANONICAL HEADERS FROM BASE SHEET
  //
  //    FIX #2: New shards inherit the base sheet's physical
  //    headers, not the caller's headers (which may have evolved).
  //    This keeps all shards schema-aligned.
  //
  //    FIX #6: Guard against _getPhysicalHeaders_ returning
  //    null/undefined/empty. Fall through:
  //      _getPhysicalHeaders_(base) → headers arg → []
  // ═══════════════════════════════════════════════════════════════
  var base = shards[0];  // guaranteed to exist after guards above

  var basePhysicalHeaders;
  if (typeof _getPhysicalHeaders_ === 'function') {
    try {
      basePhysicalHeaders = _getPhysicalHeaders_(base, headers);
    } catch (e) {
      _log('⚠️ _getPhysicalHeaders_ threw on base: ' +
        (e && e.message ? e.message : e));
      basePhysicalHeaders = null;
    }
  }

  // Fallback chain: physical → caller headers → empty
  if (!Array.isArray(basePhysicalHeaders) ||
      basePhysicalHeaders.length === 0) {
    basePhysicalHeaders = Array.isArray(headers) && headers.length > 0
      ? headers
      : [];
  }


  // ═══════════════════════════════════════════════════════════════
  // 5) GET CURRENT SHARD + ITS PHYSICAL HEADERS
  //
  //    "Current" = last shard in sorted order = the one we
  //    append data to (or decide to shard from).
  // ═══════════════════════════════════════════════════════════════
  var current = shards[shards.length - 1];

  var currentPhysicalHeaders;
  if (typeof _getPhysicalHeaders_ === 'function') {
    try {
      currentPhysicalHeaders = _getPhysicalHeaders_(
        current, basePhysicalHeaders
      );
    } catch (e) {
      _log('⚠️ _getPhysicalHeaders_ threw on current shard: ' +
        (e && e.message ? e.message : e));
      currentPhysicalHeaders = null;
    }
  }

  if (!Array.isArray(currentPhysicalHeaders) ||
      currentPhysicalHeaders.length === 0) {
    currentPhysicalHeaders = basePhysicalHeaders;
  }


  // ═══════════════════════════════════════════════════════════════
  // 6) CALCULATE CELL COUNT + SHARD IF NEEDED
  //
  //    FIX #7: Math.max(1, ...) on BOTH dimensions.
  //    Without this, an empty sheet (lastRow=0) or empty
  //    headers (length=0) produces cellCount=0, which
  //    never exceeds the threshold → shard never triggers.
  //
  //    NOTE: getLastRow() includes the header row, so we
  //    shard slightly earlier than "data-only" size implies.
  //    This is intentional — it's the safer direction.
  // ═══════════════════════════════════════════════════════════════
  var lastRow   = current.getLastRow();
  var rows      = Math.max(1, lastRow);
  var cols      = Math.max(1, currentPhysicalHeaders.length);
  var cellCount = rows * cols;

  if (cellCount > cfg.SHARD_THRESHOLD_CELLS) {
    var nextNum   = getNextShardNumber_(baseSheetName);
    var shardName = baseSheetName + '_' + nextNum;

    _log('📦 Creating shard: ' + shardName +
      ' (current cells: ' + cellCount +
      ', threshold: ' + cfg.SHARD_THRESHOLD_CELLS + ')');

    // New shard gets base sheet's headers → schema stays aligned
    return createSheetIfMissing_(shardName, basePhysicalHeaders);
  }

  return current;
}

/* =========================
   FIXED: Sheet to Objects - Handle spaced headers properly
   ========================= */
function sheetToObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  const headers = data[0].map(h => String(h).trim());
  const out = [];
  
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const obj = {};
    
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      const val = row[c];
      
      if (!key) continue;
      
      // Store original header
      obj[key] = val;
      
      // Create multiple access keys for flexibility
      // "FT Score" -> ftScore, ftscore, FTScore
      const camel = key
        .toLowerCase()
        .replace(/[^a-z0-9]+(.)/g, (m, chr) => chr.toUpperCase())
        .replace(/^./, c => c.toLowerCase());
      
      const noSpace = key.replace(/\s+/g, '');
      const lower = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      if (camel) obj[camel] = val;
      if (noSpace) obj[noSpace] = val;
      if (lower) obj[lower] = val;
    }
    
    out.push(obj);
  }
  
  return out;
}


/* =========================
   NEW: Grade bets against results
   ========================= */
function parseScorePair_(scoreStr) {
  // "27 - 17" or "27-17" or "98-88" -> {home: 27, away: 17}
  const cleaned = String(scoreStr || '').replace(/\s+/g, '');
  const parts = cleaned.split('-');
  if (parts.length !== 2) return null;
  
  const home = parseFloat(parts[0]);
  const away = parseFloat(parts[1]);
  
  if (isNaN(home) || isNaN(away)) return null;
  return { home: home, away: away };
}

function gradeSpreadPick_(pick, homeScore, awayScore) {
  // Parse "Q1: H +9.5" or "Q4: A +3.0" or "Home +5.5"
  const pickUpper = String(pick || '').toUpperCase();
  
  // Match patterns like "H +9.5", "A -3.0", "HOME +5.5", "AWAY -2.5"
  const spreadMatch = pickUpper.match(/\b(H(?:OME)?|A(?:WAY)?)\s*([+-])\s*([\d.]+)/);
  if (!spreadMatch) return null;
  
  const sideRaw = spreadMatch[1];
  const isHome = (sideRaw === 'H' || sideRaw === 'HOME');
  const sign = spreadMatch[2];
  const spreadValue = parseFloat(spreadMatch[3]);
  
  const spread = (sign === '+') ? spreadValue : -spreadValue;
  
  // Calculate adjusted score
  const pickScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;
  const adjustedDiff = (pickScore + spread) - oppScore;
  
  if (adjustedDiff > 0) return 'WON';
  if (adjustedDiff < 0) return 'LOST';
  return 'PUSH';
}

function gradeMoneylinePick_(pick, homeScore, awayScore) {
  const pickUpper = String(pick || '').toUpperCase();
  
  // Determine if picking home or away
  let isHome = null;
  if (/\bH(?:OME)?\b/.test(pickUpper) && !/\bA(?:WAY)?\b/.test(pickUpper)) {
    isHome = true;
  } else if (/\bA(?:WAY)?\b/.test(pickUpper) && !/\bH(?:OME)?\b/.test(pickUpper)) {
    isHome = false;
  }
  
  if (isHome === null) return null;
  
  const pickScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;
  
  if (pickScore > oppScore) return 'WON';
  if (pickScore < oppScore) return 'LOST';
  return 'PUSH';
}

function gradeTotalsPick_(pick, homeScore, awayScore) {
  const pickUpper = String(pick || '').toUpperCase();
  const total = homeScore + awayScore;
  
  // Match "O 185.5" or "OVER 185.5" or "U 180" or "UNDER 180"
  const overMatch = pickUpper.match(/\bO(?:VER)?\s*([\d.]+)/);
  const underMatch = pickUpper.match(/\bU(?:NDER)?\s*([\d.]+)/);
  
  if (overMatch) {
    const line = parseFloat(overMatch[1]);
    if (total > line) return 'WON';
    if (total < line) return 'LOST';
    return 'PUSH';
  }
  
  if (underMatch) {
    const line = parseFloat(underMatch[1]);
    if (total < line) return 'WON';
    if (total > line) return 'LOST';
    return 'PUSH';
  }
  
  return null;
}

function gradeBetAgainstScore_(pick, scoreStr) {
  const score = parseScorePair_(scoreStr);
  if (!score) return { result: 'PENDING', reason: 'Invalid score format' };
  
  // Try spread first (most common in your data)
  const spreadResult = gradeSpreadPick_(pick, score.home, score.away);
  if (spreadResult) return { result: spreadResult, reason: 'Spread pick' };
  
  // Try totals
  const totalsResult = gradeTotalsPick_(pick, score.home, score.away);
  if (totalsResult) return { result: totalsResult, reason: 'Totals pick' };
  
  // Try moneyline
  const mlResult = gradeMoneylinePick_(pick, score.home, score.away);
  if (mlResult) return { result: mlResult, reason: 'Moneyline pick' };
  
  return { result: 'PENDING', reason: 'Could not parse pick type' };
}

function getQuarterScore_(result, quarter) {
  // quarter = 'Q1', 'Q2', 'Q3', 'Q4', 'HT', 'FT'
  const q = String(quarter || 'FT').toUpperCase();
  
  if (q === 'FT' || q === 'FULL' || q === 'FULLTIME') {
    return getScoreValue_(result, 'ft') || result['FT Score'] || '';
  }
  if (q === 'HT' || q === '1H' || q === 'FIRSTHALF') {
    return getScoreValue_(result, 'ht') || result['HT Score'] || '';
  }
  if (q === 'Q1') return getScoreValue_(result, 'q1') || result.Q1 || '';
  if (q === 'Q2') return getScoreValue_(result, 'q2') || result.Q2 || '';
  if (q === 'Q3') return getScoreValue_(result, 'q3') || result.Q3 || '';
  if (q === 'Q4') return getScoreValue_(result, 'q4') || result.Q4 || '';
  
  return '';
}

/* =========================
   NEW: Build results lookup map
   ========================= */
function buildResultsLookup_(results) {
  const map = new Map();

  for (let i = 0; i < results.length; i++) {
    const r = results[i] || {};

    const league = normalizeLeagueKey_(r.league || r.League || '');
    const matchRaw = matchString(r);
    const match = normalizeString_(matchRaw);
    const date = formatDateForID_(r.date || r.Date || r.matchDate || r.MatchDate || '');

    if (league === 'NA' || match === 'NA' || date === 'NA') continue;

    // Primary (what BetID[0..2] expects)
    const primary = [league, date, match].join('|');
    if (!map.has(primary)) map.set(primary, r);

    // Fallback #1: Date|Match (handles any remaining league weirdness safely)
    const dateMatch = [date, match].join('|');
    if (!map.has(dateMatch)) map.set(dateMatch, r);

    // Fallback #2: Date|Home|Away (+ reversed)
    const teams = extractTeams_(matchRaw);
    const h = normalizeString_(teams.home);
    const a = normalizeString_(teams.away);
    if (h !== 'NA' && a !== 'NA') {
      const dateTeams = [date, h, a].join('|');
      const dateTeamsRev = [date, a, h].join('|');
      if (!map.has(dateTeams)) map.set(dateTeams, r);
      if (!map.has(dateTeamsRev)) map.set(dateTeamsRev, r);
    }
  }

  return map;
}

function gradeAndPopulatePerformanceLog() {
  const cfg = _cfg_();
  log_('📊 Starting bet grading...');

  // Ensure Config league map is warm (optional but helps debug)
  _loadLeagueKeyMapFromConfig_();

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Load bets
  const betsShards = getAllShardSheets_(cfg.SHEETS.BETS_ARCHIVE);
  if (!betsShards.length) {
    warn_('No bets archive found');
    return { graded: 0, pending: 0, alreadyLogged: 0, errors: 0, logged: 0 };
  }

  const allBets = [];
  for (let s = 0; s < betsShards.length; s++) allBets.push(...sheetToObjects_(betsShards[s]));
  log_('📌 Loaded ' + allBets.length + ' bets from archive');

  // Load results (temp)
  const resultsSheet = ss.getSheetByName('Results_Temp');
  if (!resultsSheet || resultsSheet.getLastRow() < 2) {
    warn_('No results in Results_Temp');
    return { graded: 0, pending: allBets.length, alreadyLogged: 0, errors: 0, logged: 0 };
  }

  const results = sheetToObjects_(resultsSheet);
  log_('📌 Loaded ' + results.length + ' results');

  const resultsMap = buildResultsLookup_(results);
  log_('📌 Results lookup has ' + resultsMap.size + ' keys');

  const existingLogIDs = getExistingIDs_(cfg.SHEETS.PERFORMANCE_LOG, 'LogID');
  log_('📌 Existing performance log has ' + existingLogIDs.size + ' LogIDs');

  const gradedBets = [];
  let graded = 0, pending = 0, alreadyLogged = 0, errors = 0;

  let debugMissCount = 0;
  const debugMissLimit = 10;

  for (let i = 0; i < allBets.length; i++) {
    try {
      const bet = allBets[i];
      const betID = bet.BetID || bet.betID || generateBetID_(bet);

      const parts = String(betID).split('|');
      if (parts.length < 3) { pending++; continue; }

      const league = parts[0];
      const date = parts[1];
      const match = parts[2];

      // Primary scoreless result key MUST be league|date|match for stability
      const resultKeyNoScore = [league, date, match].join('|');
      const logID = generateLogID_(betID, resultKeyNoScore);

      if (existingLogIDs.has(logID)) { alreadyLogged++; continue; }

      // Try matching result using multiple keys
      let result = resultsMap.get(resultKeyNoScore);

      if (!result) {
        const dateMatch = [date, match].join('|');
        result = resultsMap.get(dateMatch);
      }

      if (!result) {
        const matchRaw = bet.Match || bet.match || _matchString_(bet);
        const teams = extractTeams_(matchRaw);
        const h = normalizeString_(teams.home);
        const a = normalizeString_(teams.away);
        if (h !== 'NA' && a !== 'NA') {
          result = resultsMap.get([date, h, a].join('|')) || resultsMap.get([date, a, h].join('|'));
        }
      }

      if (!result) {
        pending++;
        if (debugMissCount < debugMissLimit) {
          log_('⚠️ SKIP #' + (debugMissCount + 1) + ': No result match for key: ' + resultKeyNoScore);
          debugMissCount++;
        }
        continue;
      }

      // Grade
      const pick = bet.Pick || bet.pick || '';
      const quarter = parseQuarter_(pick);
      const scoreStr = getQuarterScore_(result, quarter);
      if (!scoreStr) { pending++; continue; }

      const grade = gradeBetAgainstScore_(pick, scoreStr);
      if (grade.result === 'PENDING') { pending++; continue; }

      const gradedBet = Object.assign({}, bet, {
        BetID: betID,
        ResultID: resultKeyNoScore,
        Result: grade.result,
        ActualScore: scoreStr,
        GradedTimestamp: isoNow_()
      });

      gradedBets.push(gradedBet);
      graded++;

    } catch (e) {
      errors++;
      if (errors <= 3) err_('Grading error: ' + e.message);
    }
  }

  log_('📊 Grading complete: ' + graded + ' graded, ' + pending + ' pending, ' + alreadyLogged + ' already logged');
  // ── NEW: Grade dropped bets from Bet_Audit (anti-portfolio) ──
  try {
    var droppedResult = _gradeDroppedBetsFromAudit(ss, resultsMap);
    if (droppedResult && droppedResult.count > 0) {
      log_('[Dropped_Performance] Graded ' + droppedResult.count + 
           ' dropped bets | WinRate=' + droppedResult.winRate);
    }
  } catch (e) {
    log_('[Dropped_Performance] Skipped: ' + (e.message || e));
  }
  if (gradedBets.length > 0) {
    const logRes = appendToPerformanceLog(gradedBets);
    return { graded, pending, alreadyLogged, errors, logged: logRes.appended };
  }

  return { graded: 0, pending, alreadyLogged, errors, logged: 0 };
}



/**
 * Grade dropped bets from Bet_Audit → Dropped_Performance sheet.
 * Extracted from _gradeAllBetsWithLogging so it can be called
 * from any pipeline path (MIC, Performance Analyzer, standalone).
 *
 * @param {Spreadsheet} ss - Active spreadsheet
 * @param {Object|Map} resultsMap - Results lookup (key → result object)
 * @returns {{ count: number, winRate: string }}
 */
function _gradeDroppedBetsFromAudit(ss, resultsMap) {

  // ═══════════════════════════════════════════════════
  // LOCAL HELPERS (self-contained, no new module)
  // ═══════════════════════════════════════════════════
  var RUN_ID = 'RUN_' + Date.now();

   

  var normHead = function(h) {
    return String(h || '').toLowerCase().trim()
      .replace(/[\s\-]+/g, '_').replace(/[^\w]/g, '');
  };

  var getOrCreateSheet_ = function(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    return sh;
  };

  var getFromResults_ = function(k) {
    if (!k || !resultsMap) return null;
    if (typeof resultsMap.get === 'function') return resultsMap.get(k) || null;
    return resultsMap[k] || null;
  };

  var safeDateOnly_ = function(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    var x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    return x;
  };

  var tryParseDate_ = function(v) {
    try { return safeDateOnly_(_parseDateString(v)); }
    catch (e) { return safeDateOnly_(v instanceof Date ? v : null); }
  };

  var parseMatch_ = function(s) {
    try {
      if (typeof _parseMatchStringForPerf === 'function') return _parseMatchStringForPerf(s);
    } catch (e) {}
    return _parseMatchString(s);
  };

  var DROP_SIGNALS = ['DROPP', 'BLOCK', 'REJECT', 'FILTER', 'SKIP', 'EXPIRED'];
  var isDroppedStatus_ = function(status) {
    var s = String(status || '').toUpperCase().trim();
    for (var i = 0; i < DROP_SIGNALS.length; i++) {
      if (s.indexOf(DROP_SIGNALS[i]) >= 0) return true;
    }
    return false;
  };

  var reasonKeyFromNote_ = function(note) {
    var s = String(note || '').trim();
    if (!s) return 'UNKNOWN';
    var m = s.match(/^([A-Z][A-Z0-9_]+)/);
    if (m && m[1]) return m[1];
    return s.slice(0, 40).replace(/\s+/g, '_').toUpperCase();
  };

  var extractReasonCodesFromProofLog_ = function(proofLog) {
    var s = String(proofLog || '');
    var m = s.match(/REASONS\[(.*?)\]/i);
    if (!m) return [];
    return String(m[1] || '').split(',')
      .map(function(x) { return String(x || '').trim(); })
      .filter(function(x) { return x && x !== '∅'; });
  };

  var normalizeTeamForFuzzy_ = function(s) {
    s = String(s || '');
    try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    s = s.toLowerCase();
    s = s.replace(/\b(w|womens|women|women's|ladies|femenino|fem)\b/gi, ' ');
    s = s.replace(/\b(fc|sc|ac|cf|cd|bk|bc|kc|sv|fk|sk)\b/gi, ' ');
    s = s.replace(/\b(club|de|del|la|el|the)\b/gi, ' ');
    s = s.replace(/[^\w\s]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  };

  var tokenSet_ = function(s) {
    var tokens = String(s || '').split(' ').filter(function(w) { return w.length > 2; });
    var set = {};
    for (var i = 0; i < tokens.length; i++) set[tokens[i]] = true;
    return set;
  };
  var tokenSetSize_ = function(set) {
    var n = 0; for (var k in set) if (set.hasOwnProperty(k)) n++; return n;
  };
  var jaccard_ = function(A, B) {
    var sA = tokenSetSize_(A), sB = tokenSetSize_(B);
    if (!sA || !sB) return 0;
    var inter = 0;
    for (var k in A) if (A.hasOwnProperty(k) && B[k]) inter++;
    var union = sA + sB - inter;
    return union ? inter / union : 0;
  };

  var resultKeys_ = (function() {
    if (!resultsMap) return [];
    if (typeof resultsMap.keys === 'function') {
      try { return Array.from(resultsMap.keys()); } catch (e) { return []; }
    }
    return Object.keys(resultsMap);
  })();

  var lookupResultByTeams_ = function(home, away, dateRaw) {
        // Strategy 0: date|home|away keys (matches buildResultsLookup_ shapes exactly)
    try {
      var dateKey = formatDateForID_(dateRaw);
      if (dateKey && dateKey !== 'NA') {
        var hKey = normalizeString_(home);
        var aKey = normalizeString_(away);
        var r0 = getFromResults_([dateKey, hKey, aKey].join('|')) ||
                 getFromResults_([dateKey, aKey, hKey].join('|'));
        if (r0) return r0;
        var matchKey = normalizeString_(home + ' vs ' + away);
        var r0b = getFromResults_([dateKey, matchKey].join('|'));
        if (r0b) return r0b;
      }
    } catch (e) {}
    // 1) canonical key
    try {
      var k1 = _normalizeTeamKey(home, away);
      var k2 = _normalizeTeamKey(away, home);
      var r = getFromResults_(k1) || getFromResults_(k2);
      if (r) return r;
    } catch (e) {}

    // 2) match-key variants
    try {
      var keys = (_generateAllMatchKeys(home, away) || [])
        .concat(_generateAllMatchKeys(away, home) || []);
      for (var ki = 0; ki < keys.length; ki++) {
        var r2 = getFromResults_(keys[ki]);
        if (r2) return r2;
      }
    } catch (e) {}

    // 3) existing partial matcher
    try {
      if (typeof _findPartialMatch === 'function') {
        var r3 = _findPartialMatch(home, away, resultsMap);
        if (r3) return r3;
      }
    } catch (e) {}

    // 4) fuzzy scan (guarded)
    var betDate = tryParseDate_(dateRaw);
    var hN = normalizeTeamForFuzzy_(home);
    var aN = normalizeTeamForFuzzy_(away);
    var hT = tokenSet_(hN);
    var aT = tokenSet_(aN);

    var best = null;
    var bestScore = 0;

    var limit = Math.min(resultKeys_.length, 8000);
    for (var fi = 0; fi < limit; fi++) {
      var fk = resultKeys_[fi];
      if (String(fk).indexOf('|') < 0) continue;
      var parts = String(fk).split('|');
            if (parts.length === 3) {
        parts = [parts[1], parts[2]];
      } else if (parts.length !== 2) {
        continue;
      }

      var rHome = String(parts[0] || '').toLowerCase();
      var rAway = String(parts[1] || '').toLowerCase();

      var homeDirectJ = jaccard_(hT, tokenSet_(rHome));
      var awayDirectJ = jaccard_(aT, tokenSet_(rAway));
      var homeSwapJ   = jaccard_(hT, tokenSet_(rAway));
      var awaySwapJ   = jaccard_(aT, tokenSet_(rHome));

      var scoreDirect = (homeDirectJ + awayDirectJ) / 2;
      var scoreSwap   = (homeSwapJ + awaySwapJ) / 2;

      var score, valid;
      if (scoreDirect >= scoreSwap) {
        score = scoreDirect;
        valid = (homeDirectJ >= 0.5 && awayDirectJ >= 0.5);
      } else {
        score = scoreSwap;
        valid = (homeSwapJ >= 0.5 && awaySwapJ >= 0.5);
      }

      if (!valid || score <= bestScore) continue;

      var candidate = getFromResults_(fk);
      if (!candidate) continue;

      if (betDate && candidate.date) {
        var rd = tryParseDate_(candidate.date);
        if (rd && rd.getTime() !== betDate.getTime()) continue;
      }

      bestScore = score;
      best = candidate;
    }

    return bestScore >= 0.80 ? best : null;
  };

  var calcRoiContribution_ = function(odds, grade) {
    var o = parseFloat(odds);
    if (!isFinite(o) || o <= 1) return 0;
    if (grade === 'WON') return (o - 1);
    if (grade === 'LOST') return -1;
    return 0;
  };

  var writeDroppedPerformance_ = function(rows, summaryByReason) {
    var sh = getOrCreateSheet_('Dropped_Performance');
    sh.clearContents();

    var header = [
      'RunID','GradedTimestamp','Origin','BetID','League','Date','Time',
      'Match','Home','Away','Pick','PickClean','Type','Odds','Confidence',
      'DropReasonNote','ReasonKey',
      'Grade','GradeReason','FTScore','QuarterScores','ROI_Contribution'
    ];
    sh.getRange(1, 1, 1, header.length).setValues([header]);

    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      out.push([
        RUN_ID,
        r.gradedTs || '',
        r.origin || 'BET_AUDIT',
        r.betId || '',
        r.league || '',
        r.date || '',
        r.time || '',
        r.match || '',
        r.home || '',
        r.away || '',
        r.pick || '',
        r.pickClean || '',
        r.betType || '',
        r.odds || '',
        r.confidence || '',
        r.dropNote || '',
        r.reasonKey || '',
        r.grade || '',
        r.reason || '',
        r.actualScore || '',
        r.quarterScores ? JSON.stringify(r.quarterScores) : '',
        (r.roi != null ? r.roi : '')
      ]);
    }

    if (out.length) sh.getRange(2, 1, out.length, header.length).setValues(out);

    var startRow = 2 + out.length + 2;
    var sumHeader = [
      'ReasonKey','Total','WON','LOST','PUSH','PENDING','UPCOMING',
      'NO_RESULT','ERROR','WinRate(W/L)','ROI_Sum','ROI_AvgPerBet'
    ];
    sh.getRange(startRow, 1, 1, sumHeader.length).setValues([sumHeader]);

    var skeys = Object.keys(summaryByReason).sort(function(a, b) { return a.localeCompare(b); });
    var sumOut = [];
    for (var si = 0; si < skeys.length; si++) {
      var sk = skeys[si];
      var d = summaryByReason[sk];
      var wl = d.won + d.lost;
      var wr = wl ? (d.won / wl) : 0;
      var roiAvg = d.total ? (d.roiSum / d.total) : 0;
      sumOut.push([
        sk, d.total, d.won, d.lost, d.push, d.pending, d.upcoming,
        d.noResult, d.error,
        (wr * 100).toFixed(2) + '%',
        d.roiSum.toFixed(4),
        roiAvg.toFixed(4)
      ]);
    }
    if (sumOut.length) {
      sh.getRange(startRow + 1, 1, sumOut.length, sumHeader.length).setValues(sumOut);
    }
  };

  // ═══════════════════════════════════════════════════
  // MAIN: Scan Bet_Audit for dropped bets
  // ═══════════════════════════════════════════════════
  var audit = ss.getSheetByName('Bet_Audit');
  if (!audit || audit.getLastRow() <= 1) {
    Logger.log('[Dropped_Performance] No Bet_Audit sheet or empty');
    return { count: 0, winRate: 'N/A' };
  }

  var ad = audit.getDataRange().getValues();

  // Scan first 30 rows for header (Bet_Audit has title blocks)
  var headerRow = -1;
  for (var scanR = 0; scanR < Math.min(30, ad.length); scanR++) {
    var scanRowNorm = (ad[scanR] || []).map(function(c) { return normHead(c); });
    var hasStatus = scanRowNorm.indexOf('status') >= 0;
    var hasMatch  = scanRowNorm.indexOf('match') >= 0 ||
                    scanRowNorm.indexOf('event') >= 0 ||
                    scanRowNorm.indexOf('fixture') >= 0;
    var hasBetId  = scanRowNorm.indexOf('betid') >= 0 ||
                    scanRowNorm.indexOf('bet_id') >= 0;
    if (hasStatus && (hasMatch || hasBetId)) {
      headerRow = scanR;
      break;
    }
  }

  if (headerRow < 0) {
    Logger.log('[Dropped_Performance] Could not find Bet_Audit header row');
    return { count: 0, winRate: 'N/A' };
  }

  var h0 = ad[headerRow] || [];
  var hmap = {};
  for (var hc = 0; hc < h0.length; hc++) {
    var hk = normHead(h0[hc]);
    if (hk && hmap[hk] === undefined) hmap[hk] = hc;
  }

  var idx = function(names) {
    for (var ni = 0; ni < names.length; ni++) {
      var nk = normHead(names[ni]);
      if (hmap[nk] !== undefined) return hmap[nk];
    }
    return null;
  };

  var iStatus     = idx(['status','decision','action']);
  var iBetId      = idx(['betid','bet_id','id']);
  var iLeague     = idx(['league']);
  var iDate       = idx(['date','event_date','game_date']);
  var iTime       = idx(['time']);
  var iMatch      = idx(['match','event','fixture']);
  var iPick       = idx(['pick','selection']);
  var iType       = idx(['type','bettype','market']);
  var iOdds       = idx(['odds','decimal_odds']);
  var iConf       = idx(['confidence','conf']);
  var iNote       = idx(['note','drop_reason','reason','block_reason','rejection_reason']);
  var iReasonCode = idx(['drop_reason_code','reason_code','block_reason_code',
                         'primary_block_reason','primaryblockreason']);
  var iProof      = idx(['prooflog','proof_log','assayer_prooflog','assayer_proof_log']);

  Logger.log('[Dropped_Performance] Header at row ' + (headerRow + 1) +
             ' | status=' + iStatus + ' match=' + iMatch +
             ' pick=' + iPick + ' note=' + iNote);

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var nowIso = new Date().toISOString();
  var droppedRows = [];
  var summary = {};

  var bumpSummary_ = function(reasonKey, rec) {
    var k = reasonKey || 'UNKNOWN';
    if (!summary[k]) {
      summary[k] = {
        total: 0, won: 0, lost: 0, push: 0,
        pending: 0, upcoming: 0, noResult: 0, error: 0,
        roiSum: 0
      };
    }
    var d = summary[k];
    d.total++;
    if      (rec.grade === 'WON')       d.won++;
    else if (rec.grade === 'LOST')      d.lost++;
    else if (rec.grade === 'PUSH')      d.push++;
    else if (rec.grade === 'PENDING')   d.pending++;
    else if (rec.grade === 'UPCOMING')  d.upcoming++;
    else if (rec.grade === 'NO RESULT') d.noResult++;
    else if (rec.grade === 'ERROR')     d.error++;
    d.roiSum += (rec.roi || 0);
  };

  for (var ar = headerRow + 1; ar < ad.length; ar++) {
    var arow = ad[ar] || [];

    var aStatus = (iStatus != null) ? String(arow[iStatus] || '').trim() : '';
    if (!isDroppedStatus_(aStatus)) continue;

    var aMatchStr = (iMatch != null) ? String(arow[iMatch] || '').trim() : '';
    var aPickRaw  = (iPick  != null) ? String(arow[iPick]  || '').trim() : '';
    if (!aMatchStr || !aPickRaw) continue;

    var aLeague     = (iLeague != null)     ? String(arow[iLeague] || '').trim()     : '';
    var aDateRaw    = (iDate != null)        ? arow[iDate]                            : '';
    var aTime       = (iTime != null)        ? String(arow[iTime] || '').trim()       : '';
    var aBetId      = (iBetId != null)       ? String(arow[iBetId] || '').trim()      : '';
    var aBetType    = (iType != null)        ? String(arow[iType] || '').trim()       : '';
    var aOdds       = (iOdds != null)        ? arow[iOdds]                            : '';
    var aConfidence = (iConf != null)        ? arow[iConf]                            : '';
    var aNote       = (iNote != null)        ? String(arow[iNote] || '').trim()       : '';
    var aReasonCode = (iReasonCode != null)  ? String(arow[iReasonCode] || '').trim() : '';
    var aProofLog   = (iProof != null)       ? String(arow[iProof] || '').trim()      : '';

    var proofCodes = extractReasonCodesFromProofLog_(aProofLog);
    var reasonKey =
      aReasonCode ||
      (proofCodes.length ? proofCodes[0] : '') ||
      reasonKeyFromNote_(aNote) ||
      'UNKNOWN';

    var aDateStr = (typeof _formatDateValue === 'function') ? _formatDateValue(aDateRaw) : String(aDateRaw);
    var aParsed  = parseMatch_(aMatchStr);
    var aHome    = String(aParsed.home || '').trim();
    var aAway    = String(aParsed.away || '').trim();

    var rec = {
      gradedTs: nowIso,
      origin: 'BET_AUDIT',
      betId: aBetId,
      league: aLeague,
      date: aDateStr,
      time: aTime,
      match: aMatchStr,
      home: aHome,
      away: aAway,
      pick: aPickRaw,
      pickClean: _sanitizePickForID_(aPickRaw),
      betType: aBetType,
      odds: aOdds,
      confidence: aConfidence,
      dropNote: aNote,
      reasonKey: reasonKey,
      grade: '',
      reason: '',
      actualScore: '',
      quarterScores: null,
      roi: 0
    };

    if (!aHome || !aAway) {
      rec.grade = 'ERROR';
      rec.reason = 'Could not parse match';
      bumpSummary_(reasonKey, rec);
      droppedRows.push(rec);
      continue;
    }

    var aBetDate = tryParseDate_(aDateRaw);
    if (aBetDate && aBetDate > today) {
      rec.grade = 'UPCOMING';
      rec.reason = 'Game not yet played';
      bumpSummary_(reasonKey, rec);
      droppedRows.push(rec);
      continue;
    }

    var aResult = lookupResultByTeams_(aHome, aAway, aDateRaw);
    if (!aResult) {
      rec.grade = 'NO RESULT';
      rec.reason = 'Game not found in results';
      bumpSummary_(reasonKey, rec);
      droppedRows.push(rec);
      continue;
    }

        var finished = (aResult.isFinished === true) || (aResult.IsFinished === true) || !!(aResult.ftScore || aResult.FTScore);
    if (!finished) {
      rec.grade = 'PENDING';
      rec.reason = 'Status: ' + aResult.status;
      bumpSummary_(reasonKey, rec);
      droppedRows.push(rec);
      continue;
    }


        // Build quarters object mirroring raw result fields (keep original format)
    if (!aResult.quarters || typeof aResult.quarters !== 'object' || !Object.keys(aResult.quarters).length) {
      aResult.quarters = {};
      for (var _qi = 1; _qi <= 4; _qi++) {
        var _raw = aResult['Q' + _qi] || aResult['q' + _qi];
        if (_raw) aResult.quarters['q' + _qi] = _raw;
      }
      if (aResult.OT || aResult.ot) aResult.quarters.ot = aResult.OT || aResult.ot;
    }

    var g = _gradePickDetailed(rec.pickClean, aResult, aHome, aAway);

    rec.grade = g.grade;
    rec.reason = g.reason;
    rec.actualScore = aResult.ftScore || '';
    rec.quarterScores = aResult.quarters || null;
    rec.roi = calcRoiContribution_(aOdds, rec.grade);

    bumpSummary_(reasonKey, rec);
    droppedRows.push(rec);
  }

  if (droppedRows.length) {
    writeDroppedPerformance_(droppedRows, summary);

    var totalWL = 0, totalWon = 0;
    var sKeys = Object.keys(summary);
    for (var si = 0; si < sKeys.length; si++) {
      totalWon += summary[sKeys[si]].won;
      totalWL  += summary[sKeys[si]].won + summary[sKeys[si]].lost;
    }
    var totalWR = totalWL ? (totalWon / totalWL) : 0;
    var wrStr = (totalWR * 100).toFixed(2) + '% over ' + totalWL + ' decisions';

    Logger.log('[Dropped_Performance] RunID=' + RUN_ID);
    Logger.log('   Rows graded: ' + droppedRows.length);
    Logger.log('   WinRate (W/L only): ' + wrStr);
    Logger.log('   Reason keys: ' + sKeys.join(', '));

    return { count: droppedRows.length, winRate: wrStr };
  } else {
    Logger.log('[Dropped_Performance] No dropped rows found in Bet_Audit');
    return { count: 0, winRate: 'N/A' };
  }
}



function appendToPerformanceLog(gradedBets) {
  const cfg = _cfg_();

  if (!gradedBets || gradedBets.length === 0) {
    return { appended: 0, duplicates: 0, errors: 0 };
  }

  const sheetName = cfg.SHEETS.PERFORMANCE_LOG;
  const headers = SCHEMA.PERFORMANCE_LOG;
  const sheet = getArchiveSheet_(sheetName, headers);

  const existing = getExistingIDs_(sheetName, 'LogID');

  const rows = [];
  let dup = 0, errors = 0;

  for (let i = 0; i < gradedBets.length; i++) {
    try {
      const bet = gradedBets[i] || {};

      // If upstream didn't provide BetID, generate it (may call _matchString_)
      const betID = bet.BetID || bet.betID || generateBetID_(bet);

      const resultKeyNoScore = generateResultKeyNoScoreFromBetID_(betID);
      const logID = generateLogID_(betID, resultKeyNoScore);

      if (existing.has(logID)) { dup++; continue; }

      const entry = enrichPerformanceLogEntry_(bet, logID, betID, resultKeyNoScore);
      rows.push(headers.map(h => entry[h] !== undefined ? entry[h] : ''));
      existing.add(logID);

    } catch (e) {
      errors++;
      err_('appendToPerformanceLog error: ' + (e && e.message ? e.message : e));
    }
  }

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
    invalidateIDCache_(sheetName, 'LogID');
    log_('✅ Appended ' + rows.length + ' performance rows → ' + sheet.getName());
  }

  return { appended: rows.length, duplicates: dup, errors: errors };
}

function getHeaderIndex_(sheet, headerName) {
  const target = String(headerName || '').trim();
  if (!sheet) throw new Error('getHeaderIndex_: sheet is null');
  if (!target) throw new Error('getHeaderIndex_: headerName is blank');

  const headers = _getPhysicalHeaders_(sheet, []);
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] || '').trim() === target) return i + 1;
  }

  throw new Error(`getHeaderIndex_: Header "${target}" not found in sheet "${sheet.getName()}"`);
}

/* =========================
 * DUPLICATE DETECTION (cached, key includes idColumn)
 * ========================= */
/**
 * Returns a Set of all existing ID values for `idHeaderName` across every
 * shard of `sheetName`.  Results are cached in ScriptCache for fast re-use
 * within the same execution window.
 *
 * Resilient to:
 *  • Missing warn_ global (falls back to Logger.log)
 *  • getAllShardSheets_ returning null / undefined
 *  • Corrupted cache entries (silently rebuilds)
 *  • cfg.CACHE_SECONDS exceeding Apps Script's 21 600-second max
 *  • Header cells with leading/trailing whitespace
 *  • Duplicate header names on a shard (warned, first-wins)
 *  • Cache value exceeding 100 KB (warned, run proceeds uncached)
 *
 * Fails fast (throws) if a shard is missing the ID column entirely,
 * because skipping that shard would under-count existing IDs and
 * let duplicate rows slip through in downstream appenders.
 *
 * @param  {string} sheetName     Base sheet name (shards share this prefix)
 * @param  {string} idHeaderName  Column header whose values form the ID set
 * @return {Set<string>}
 * @throws {Error}                If any shard lacks the requested ID column
 */
function getExistingIDs_(sheetName, idHeaderName) {
  const cfg = _cfg_();

  /* ── safe logger fallback ────────────────────────────────────── */
  const _warn = (typeof warn_ === 'function')
    ? warn_
    : (msg) => Logger.log('[WARN] ' + String(msg));

  /* ── cache key (coerced + length-safe) ───────────────────────── */
  const sheetKey  = String(sheetName    || '');
  const headerKey = String(idHeaderName || '');
  const target    = headerKey.trim();

  // Apps Script cache keys must be ≤ 250 chars
  const rawKey   = 'existingIDs_' + sheetKey + '_' + target;
  const cacheKey = rawKey.length <= 240
    ? rawKey
    : 'existingIDs_' + Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawKey)
      );

  // TTL must be 1 … 21 600 (Apps Script hard max)
  const ttlRaw = (cfg && cfg.CACHE_SECONDS) ? Number(cfg.CACHE_SECONDS) : 300;
  const ttl    = Math.min(21600, Math.max(1, ttlRaw));

  /* ── attempt cache hit ───────────────────────────────────────── */
  const cache  = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return new Set(JSON.parse(cached));
    } catch (_) {
      // Corrupted / truncated entry — fall through and rebuild
    }
  }

  /* ── full shard scan ─────────────────────────────────────────── */
  const shards   = getAllShardSheets_(sheetName) || [];
  const existing = new Set();

  for (let s = 0; s < shards.length; s++) {
    const sh      = shards[s];
    const lastRow = sh.getLastRow();
    if (lastRow <= 1) continue;                   // header-only or empty

    // Normalize physical headers so whitespace can't cause false misses
    const headers = _getPhysicalHeaders_(sh, [])
      .map(h => (h === null || h === undefined) ? '' : String(h).trim());

    // Detect duplicate headers on this shard (warn, first-wins)
    const _dup = Object.create(null);
    for (let d = 0; d < headers.length; d++) {
      if (!headers[d]) continue;
      if (headers[d] in _dup) {
        _warn(
          `getExistingIDs_: duplicate header "${headers[d]}" ` +
          `at cols ${_dup[headers[d]] + 1} & ${d + 1} in "${sh.getName()}".`
        );
      } else {
        _dup[headers[d]] = d;
      }
    }

    const col0 = headers.indexOf(target);

    if (col0 < 0) {
      // Fail-fast: a missing ID column means we'd under-count existing
      // IDs and downstream appenders would create duplicates.
      throw new Error(
        `getExistingIDs_: header "${target}" not found in shard ` +
        `"${sh.getName()}". Cannot guarantee dedupe integrity.`
      );
    }

    const vals = sh.getRange(2, col0 + 1, lastRow - 1, 1).getValues();

    for (let i = 0; i < vals.length; i++) {
      const v = vals[i][0];
      if (v !== null && v !== undefined && v !== '') {
        existing.add(String(v));
      }
    }
  }

  /* ── write back to cache ─────────────────────────────────────── */
  try {
    const payload = JSON.stringify(Array.from(existing));

    // Apps Script cache value limit is 100 KB
    if (payload.length > 100000) {
      _warn(
        `getExistingIDs_: serialized ID set for ${sheetKey}/${target} ` +
        `is ${(payload.length / 1024).toFixed(1)} KB — exceeds 100 KB ` +
        `cache limit. Skipping cache write; IDs will rebuild each run.`
      );
    } else {
      cache.put(cacheKey, payload, ttl);
    }
  } catch (e) {
    _warn(
      'getExistingIDs_: could not cache IDs for ' + sheetKey + '/' +
      target + ': ' + (e && e.message ? e.message : e)
    );
  }

  return existing;
}

function invalidateIDCache_(sheetName, idColumn) {
  CacheService.getScriptCache().remove('existingIDs_' + sheetName + '_' + idColumn);
}


/**
 * Returns '' for blank / '-' / '—' / 'NA' / 'N/A'.
 * Otherwise returns the trimmed string.
 */
function _blankIfNA_(v) {
  var t = String(v ?? '').trim();
  if (!t) return '';
  var u = t.toUpperCase();
  if (u === 'NA' || u === 'N/A' || t === '-' || t === '—') return '';
  return t;
}

/**
 * Returns the first argument whose _blankIfNA_ is non-empty.
 */
function _firstMeaningful_() {
  for (var i = 0; i < arguments.length; i++) {
    var v = _blankIfNA_(arguments[i]);
    if (v) return v;
  }
  return '';
}

/**
 * Converts Forebet prediction code to a direction.
 *   1 → HOME,  2 → AWAY,  X/0 → DRAW
 */
function _normalizeForebetPred_(val) {
  if (val === null || val === undefined || val === '') return '';
  var v = String(val).trim();
  if (v === '1') return 'HOME';
  if (v === '2') return 'AWAY';
  if (v === '0' || v.toUpperCase() === 'X') return 'DRAW';
  var u = v.toUpperCase();
  if (u === 'HOME' || u === 'H') return 'HOME';
  if (u === 'AWAY' || u === 'A') return 'AWAY';
  if (u === 'DRAW' || u === 'D') return 'DRAW';
  return '';
}

/**
 * Derives WITH / AGAINST by comparing Forebet's prediction
 * direction against the bet's pick direction (HomeAwayFlag).
 *
 * @param {Object}  bet
 * @param {string=} homeAwayFlagOverride  pass if already computed
 * @return {string} 'WITH' | 'AGAINST' | ''
 */
/**
 * ✅ PATCHED v3: Derive ForebetAction using direct side comparison.
 *
 * BEFORE (bug): relied on risk score which didn't align sides,
 *               so opposite-side bets were wrongly classified as WITH.
 * AFTER:        compares bet side vs Forebet side directly.
 *               Falls back gracefully for O/U and indeterminate bets.
 *
 * @param {Object} bet           — bet object with pick, match, team info, forebet pred
 * @param {string} homeAwayFlag  — pre-computed 'HOME'|'AWAY'|'' from enrichBetForArchive_
 * @param {string} [forebetPredDir] — pre-normalised Forebet direction 'HOME'|'AWAY'|''
 * @return {string} 'WITH_FOREBET' | 'AGAINST_FOREBET' | ''
 */
function _deriveForebetAction_(bet, homeAwayFlag, forebetPredDir) {
  bet = bet || {};

  // ── Determine bet's side ───────────────────────────────────
  var betSide = String(homeAwayFlag || '').toUpperCase().trim();

  if (!betSide || betSide === 'NEUTRAL') {
    var pick  = bet.pick || bet.Pick || '';
    var match = bet.match || bet.Match || '';
    var home  = bet.HomeTeam || bet.homeTeam || bet.home || bet.Home || '';
    var away  = bet.AwayTeam || bet.awayTeam || bet.away || bet.Away || '';

    // Try existing parser first
    if (typeof parseHomeAwayFlag_ === 'function') {
      try { betSide = parseHomeAwayFlag_(pick, match) || ''; } catch (_) {}
    }

    // Fall back to side-from-pick helper                                 // ✅ v3
    if (!betSide || betSide === 'NEUTRAL') {
      betSide = _getSideFromPick(pick, home, away);
    }
  }

  // ── Determine Forebet's side ───────────────────────────────
  var fbSide = String(forebetPredDir || '').toUpperCase().trim();          // ✅ v3: accept pre-computed

  if (!fbSide || fbSide === 'NEUTRAL') {
    // Extract raw prediction from bet object
    var rawPred = _firstMeaningful_(                                      // ✅ v3
      bet.ForebetPred,    bet.forebetPred,
      bet.Pred,           bet.pred,
      bet['Forebet Pred'],bet['Pred'],
      bet['forebet pred']
    );

    if (rawPred) {
      // Try normaliser if available
      if (typeof _normalizeForebetPred_ === 'function') {
        try { fbSide = _normalizeForebetPred_(rawPred) || ''; } catch (_) {}
      }

      // Direct fallback                                                  // ✅ v3
      if (!fbSide || fbSide === 'NEUTRAL') {
        var home2 = bet.HomeTeam || bet.homeTeam || bet.home || bet.Home || '';
        var away2 = bet.AwayTeam || bet.awayTeam || bet.away || bet.Away || '';
        fbSide = _getForebetSide(rawPred, home2, away2);
      }
    }
  }

  // ── Clean ──────────────────────────────────────────────────
  betSide = String(betSide || '').toUpperCase().trim();
  fbSide  = String(fbSide  || '').toUpperCase().trim();

  // ── Direct comparison ──────────────────────────────────────  // ✅ v3: core fix
  if (betSide && fbSide &&
      betSide !== 'NEUTRAL' && fbSide !== 'NEUTRAL') {
    var action = (betSide === fbSide) ? 'WITH_FOREBET' : 'AGAINST_FOREBET';

    Logger.log(
      '[_deriveForebetAction_] betSide=' + betSide +
      ' fbSide=' + fbSide + ' → ' + action
    );

    return action;
  }

  // ── Indeterminate (O/U, missing data) → let fallback chain handle ──
  Logger.log(
    '[_deriveForebetAction_] INDETERMINATE betSide=' + betSide +
    ' fbSide=' + fbSide + ' → returning empty for fallback'
  );
  return '';
}

/* ── Header alias map ──────────────────────────────────────── */
var _HEADER_ALIAS_MAP_ = {
  'risk tier':            'RiskTier',
  'risktier':             'RiskTier',
  'risk_tier':            'RiskTier',
  'forebet action':       'ForebetAction',
  'forebetaction':        'ForebetAction',
  'forebet_action':       'ForebetAction',
  'pred':                 'ForebetPred',
  'forebetpred':          'ForebetPred',
  'forebet pred':         'ForebetPred',
  'forebet prediction':   'ForebetPred',
  'home team':            'HomeTeam',
  'hometeam':             'HomeTeam',
  'away team':            'AwayTeam',
  'awayteam':             'AwayTeam',
  'match date':           'MatchDate',
  'matchdate':            'MatchDate',
  'segment key':          'SegmentKey',
  'segmentkey':           'SegmentKey',
  'home away flag':       'HomeAwayFlag',
  'homeawayflag':         'HomeAwayFlag',
  'confidence bucket':    'ConfidenceBucket',
  'confidencebucket':     'ConfidenceBucket',
  'win loss flag':        'WinLossFlag',
  'winlossflag':          'WinLossFlag',
  'actual score':         'ActualScore',
  'actualscore':          'ActualScore',
  'graded timestamp':     'GradedTimestamp',
  'gradedtimestamp':      'GradedTimestamp',
  'sync timestamp':       'SyncTimestamp',
  'synctimestamp':        'SyncTimestamp',
  'roi contribution':     'ROI_Contribution',
  'roi_contribution':     'ROI_Contribution',
  'edge realized':        'EdgeRealized',
  'edgerealized':         'EdgeRealized'
};

function _canonicalHeaderKey_(raw) {
  if (!raw) return '';
  var trimmed = String(raw).trim();
  var lookup  = trimmed.toLowerCase();
  return _HEADER_ALIAS_MAP_[lookup] || trimmed;
}


/**
 * ✅ NEW: Derive ForebetAction from a RiskTier string.
 * Mirrors RISKY_ACCA_CONFIG.STRATEGY logic without needing Tier1_Predictions.
 * @param {string} riskTier
 * @return {string} 'AGAINST_FOREBET' | 'WITH_FOREBET' | 'SKIP' | ''
 */
/**
 * ✅ PATCHED v2: Expanded tier→action mapping.
 * Covers STRONG, WEAK, EVEN, UNKNOWN in addition to HIGH/MEDIUM/LOW/EXTREME.
 * @param {string} riskTier
 * @return {string}
 */
function _deriveForebetActionFromRiskTier_(riskTier) {
  var t = String(riskTier || '').toUpperCase().trim();
  if (!t) return '';
  if (t.indexOf('EXTREME') >= 0)  return 'SKIP';
  if (t.indexOf('HIGH') >= 0)     return 'AGAINST_FOREBET';
  if (t.indexOf('MEDIUM') >= 0)   return 'WITH_FOREBET';
  if (t.indexOf('LOW') >= 0)      return 'WITH_FOREBET';
  if (t.indexOf('STRONG') >= 0)   return 'WITH_FOREBET';
  if (t.indexOf('WEAK') >= 0)     return 'WITH_FOREBET';
  if (t.indexOf('EVEN') >= 0)     return 'WITH_FOREBET';
  if (t.indexOf('UNKNOWN') >= 0)  return 'WITH_FOREBET';
  return '';
}


/**
 * ✅ NEW v3: Map a numeric risk score to a tier label.
 * Thresholds mirror RISKY_CONFIG.STRATEGY.
 * @param {number} score
 * @return {string}
 */
function _riskTierFromScore_(score) {
  if (!isFinite(score) || score < 0) return '';
  if (score >= 75) return 'EXTREME';
  if (score >= 57) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

/**
 * ✅ PATCHED v3: Risk score with side-aligned confidence comparison.
 *
 * BEFORE (bug): compared raw maConf vs raw fbConf even when they backed
 *               opposite sides, underestimating disagreement.
 * AFTER:        flips fbConf to the bet's side before diffing.
 *
 * @param {Object} bet    — must have pick, homeTeam/home, awayTeam/away, confidence
 * @param {Object} result — must have 'forebet %', 'pred', optionally 'netrtg diff'
 * @return {number} risk score (higher = riskier)
 */
function _calculateRiskScore(bet, result) {
  bet    = bet    || {};
  result = result || {};

  // ── Confidence values ──────────────────────────────────────
  var maConf = parseFloat(
    bet.confidence || bet.Confidence || bet['MaGolide Conf %'] || bet.magConf || 0
  );
  // Normalise 0–1 → 0–100
  if (maConf > 0 && maConf <= 1) maConf = maConf * 100;

  var fbConfRaw = parseFloat(
    result['forebet %'] || result['Forebet %'] || result.forebet || result.forebetPct || 0
  );
  if (fbConfRaw > 0 && fbConfRaw <= 1) fbConfRaw = fbConfRaw * 100;

  // ── Side detection ─────────────────────────────────────────
  var home = bet.HomeTeam || bet.homeTeam || bet.home || bet.Home || '';
  var away = bet.AwayTeam || bet.awayTeam || bet.away || bet.Away || '';
  var pick = bet.pick     || bet.Pick     || '';
  var pred = result.pred  || result.Pred  || result['Forebet Pred'] || '';

  var betSide = _getSideFromPick(pick, home, away);                       // ✅ v3
  var fbSide  = _getForebetSide(pred, home, away);                        // ✅ v3

  // ── Align Forebet confidence to the bet's side ─────────────
  var fbConf = _alignFbConfToSide(fbConfRaw, betSide, fbSide);            // ✅ v3

  Logger.log(
    '[_calculateRiskScore] pick="' + pick + '" pred="' + pred + '"' +
    ' betSide=' + betSide + ' fbSide=' + fbSide +
    ' maConf=' + maConf + ' fbConfRaw=' + fbConfRaw +
    ' fbConfAligned=' + fbConf +                                          // ✅ v3: log alignment
    (betSide !== fbSide && betSide !== 'NEUTRAL' && fbSide !== 'NEUTRAL'
      ? ' [FLIPPED]' : '')
  );

  // ── Score formula (unchanged maths, fixed inputs) ──────────
  var pctDiff         = Math.abs(maConf - fbConf);
  var variancePenalty = pctDiff * 0.5;
  var netRtgDiff      = Math.abs(
    parseFloat(result['netrtg diff'] || result.netRtgDiff || 0)
  ) * 2;

  var riskScore = variancePenalty + netRtgDiff;

  Logger.log(
    '[_calculateRiskScore] pctDiff=' + pctDiff.toFixed(1) +
    ' variance=' + variancePenalty.toFixed(1) +
    ' netRtg=' + netRtgDiff.toFixed(1) +
    ' SCORE=' + riskScore.toFixed(1)
  );

  return riskScore;
}


/**
 * ✅ NEW v3: Flip Forebet's confidence to align with the bet's side.
 * If bet backs AWAY but Forebet predicts HOME at 60%, the AWAY-aligned
 * confidence is 100 − 60 = 40%. For same-side or neutral, returns as-is.
 * @param {number} fbConf  — Forebet confidence (0–100)
 * @param {string} betSide — 'HOME' | 'AWAY' | 'NEUTRAL'
 * @param {string} fbSide  — 'HOME' | 'AWAY' | 'NEUTRAL'
 * @return {number}
 */
function _alignFbConfToSide(fbConf, betSide, fbSide) {
  if (!betSide || !fbSide) return fbConf;
  if (betSide === 'NEUTRAL' || fbSide === 'NEUTRAL') return fbConf;
  if (betSide === fbSide) return fbConf;
  return 100 - fbConf;                                                    // ✅ v3: flip
}

/**
 * ✅ NEW v3: Determine which side Forebet's prediction backs.
 * Accepts: "1"/"2", team names, "Home"/"Away", normalised directions.
 * @param {*} pred     — raw Forebet prediction value
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @return {string} 'HOME' | 'AWAY' | 'NEUTRAL'
 */
function _getForebetSide(pred, homeTeam, awayTeam) {
  var p = String(pred || '').trim();
  if (!p) return 'NEUTRAL';

  // Numeric codes (most common satellite format)
  if (p === '1') return 'HOME';
  if (p === '2') return 'AWAY';

  var pLow = p.toLowerCase();
  if (pLow === 'home' || pLow === 'h') return 'HOME';
  if (pLow === 'away' || pLow === 'a') return 'AWAY';

  // Team name match
  var h = String(homeTeam || '').toLowerCase().trim();
  var a = String(awayTeam || '').toLowerCase().trim();
  if (h && h.length > 2 && pLow.indexOf(h) >= 0) return 'HOME';
  if (a && a.length > 2 && pLow.indexOf(a) >= 0) return 'AWAY';

  // Draw / X
  if (pLow === 'x' || pLow === 'draw') return 'NEUTRAL';

  return 'NEUTRAL';
}


/**
 * ✅ NEW v3: Determine which side (HOME/AWAY) a pick is backing.
 * Handles: team names, "H +3.0", "Away Win", "Q1: A +4.5 ★", numeric "1"/"2".
 * @param {string} pick
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @return {string} 'HOME' | 'AWAY' | 'NEUTRAL'
 */
function _getSideFromPick(pick, homeTeam, awayTeam) {
  var p = String(pick || '').toLowerCase().trim();
  var h = String(homeTeam || '').toLowerCase().trim();
  var a = String(awayTeam || '').toLowerCase().trim();

  if (!p) return 'NEUTRAL';

  // 1. Team name substring match (most reliable)
  if (h && h.length > 2 && p.indexOf(h) >= 0) return 'HOME';
  if (a && a.length > 2 && p.indexOf(a) >= 0) return 'AWAY';

  // 2. Directional tokens: "Q1: H +3.0", "H Win", "Home Win"
  if (/(?:^|\s|:)\s*h(?:\s|$|\+|-|\d)/i.test(p)) return 'HOME';
  if (/(?:^|\s|:)\s*a(?:\s|$|\+|-|\d)/i.test(p)) return 'AWAY';
  if (/\bhome\b/i.test(p)) return 'HOME';
  if (/\baway\b/i.test(p)) return 'AWAY';

  // 3. Numeric prediction codes
  if (/^1$/.test(p.replace(/\s/g, ''))) return 'HOME';
  if (/^2$/.test(p.replace(/\s/g, ''))) return 'AWAY';

  return 'NEUTRAL';
}

/**
 * ✅ NEW v2: Strip decorative symbols (★●○▲▼) and whitespace from tier strings.
 * @param {*} raw
 * @return {string}
 */
function _cleanTierString_(raw) {
  return String(raw || '')
    .replace(/[★●○▲▼⭐🔴🟡🟢✦✧◆◇■□▪▫]/g, '')   // ✅ PATCHED v2: strip all common symbols
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}


/**
 * ✅ NEW v2: When satellite Bet_Slips has no Tier column, derive RiskTier from confidence.
 * @param {*} confRaw — raw confidence value (number, string, percentage)
 * @return {string} tier label or ''
 */
function _deriveTierFromConfidence_(confRaw) {
  var n = NaN;
  if (typeof confRaw === 'number' && isFinite(confRaw)) {
    n = confRaw;
  } else {
    var s = String(confRaw || '').trim();
    var m = s.match(/(\d+(?:\.\d+)?)/);
    if (m) n = parseFloat(m[1]);
  }
  if (isNaN(n)) return '';
  if (n > 0 && n <= 1) n = n * 100;

  if (n >= 70) return 'STRONG';
  if (n >= 65) return 'MEDIUM';
  if (n >= 60) return 'WEAK';
  if (n >= 55) return 'EVEN';
  if (n < 55)  return 'EVEN';
  return '';
}


function enrichBetForArchive_(bet, betID) {
  bet = (bet && typeof bet === 'object') ? bet : {};

  /* ── match / pick / teams ─────────────────────────── */
  var match = _safeEnrich_(_matchString_, [bet], bet.match || bet.Match || '');
  var pick  = bet.pick || bet.Pick || '';
  var teams = _safeEnrich_(extractTeams_, [match], { home: '', away: '' });

  /* ── League: canonical code ───────────────────────── */
  var leagueKey = normalizeLeagueKey_(
    bet.league || bet.League || bet['League'] || bet['Competition'] || ''
  );

  /* ── confidence ───────────────────────────────────── */
  var conf   = _safeEnrich_(normalizeConfidence_,
    [bet.confidence || bet.Confidence], NaN);
  var conf01 = (!isNaN(conf)
    ? Math.max(0, Math.min(1, conf > 1 ? conf / 100 : conf))
    : undefined);

  /* ── match date ───────────────────────────────────── */
  var matchDateYMD = _safeEnrich_(
    _getMatchDateYYYYMMDDFromBet_, [bet, betID], ''
  );

  /* ── odds ─────────────────────────────────────────── */
  var oddsRaw = bet.odds || bet.Odds || '';
  var oddsNum = _safeEnrich_(normalizeOdds_, [oddsRaw], NaN);
  var oddsOut = isNaN(oddsNum)
    ? (String(oddsRaw).trim() === '-' ? '' : oddsRaw)
    : oddsNum;

  /* ── EV: numeric-or-blank only ────────────────────── */
  var pickClass = _safeEnrich_(_pickClass_, [bet], '');

  var evRaw = (bet.ev ?? bet.EV ?? bet.Ev ?? bet.eV ?? '');

  var _toFinite = (typeof _toFiniteNum_ === 'function')
    ? _toFiniteNum_
    : function (v) {
        if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
        var t = String(v ?? '').trim();
        if (!t || t === '-' || t === '—' || t === 'N/A') return NaN;
        var n = parseFloat(t.replace(/,/g, '.'));
        return Number.isFinite(n) ? n : NaN;
      };

  var evNum = _safeEnrich_(_toFinite, [evRaw], NaN);
  var evOut = Number.isFinite(evNum) ? evNum : '';

  /* ── Assayer Phase 2 ──────────────────────────────── */
  var a = null;
  var assayerData = null;

  if (bet.assayer && typeof bet.assayer === 'object') {
    a = bet.assayer;
  } else {
    try {
      if (typeof _getAssayerDataCached_ === 'function') {
        assayerData = _getAssayerDataCached_();
      }
    } catch (_) { /* neutral */ }

    if (assayerData && assayerData.ok &&
        typeof assayerEnrichBet_ === 'function') {
      try {
        var betForAssayer = Object.assign({}, bet);
        betForAssayer.league     = betForAssayer.league
          ?? betForAssayer.League ?? '';
        betForAssayer.match      = betForAssayer.match
          ?? betForAssayer.Match ?? match;
        betForAssayer.pick       = betForAssayer.pick
          ?? betForAssayer.Pick ?? pick;
        betForAssayer.type       = betForAssayer.type
          ?? betForAssayer.Type ?? betForAssayer.betType ?? '';
        betForAssayer.confidence = conf01;

        var enriched = assayerEnrichBet_(betForAssayer, assayerData);
        a = (enriched && enriched.assayer) ? enriched.assayer : null;
      } catch (_) { a = null; }
    }
  }

  var best         = (a && a.edge)
    ? a.edge
    : ((a && a.bestEdge) ? a.bestEdge : null);
  var purity       = (a && a.purity) ? a.purity : null;
  var purityAction = String(
    (a && (a.purityAction || a.purity_action)) || ''
  ).trim();

  var edgeMatchCount = (best ? 1 : 0);
  try {
    if (
      a && a.dims &&
      assayerData && assayerData.ok &&
      Array.isArray(assayerData.edges) &&
      typeof assayerBetMatchesEdge_ === 'function'
    ) {
      var n = 0;
      for (var ei = 0; ei < assayerData.edges.length; ei++) {
        if (assayerBetMatchesEdge_(a.dims, assayerData.edges[ei])) n++;
      }
      edgeMatchCount = n;
    }
  } catch (_) { /* neutral */ }

  /* ── RiskTier: passthrough → computed → confidence fallback ─── */
  var riskTierUpstream = _cleanTierString_(
    _firstMeaningful_(
      bet.RiskTier,      bet.riskTier,      bet.risk_tier,
      bet['RiskTier'],   bet['Risk Tier'],  bet['RISK TIER'],
      bet.Tier,          bet.tier,          bet['Tier']
    )
  );

  var riskTierComputed = _cleanTierString_(
    _safeEnrich_(_riskTier_, [bet], '')
  );

  var riskTierOut = _blankIfNA_(riskTierUpstream)
    || _blankIfNA_(riskTierComputed)
    || '';

  if (!riskTierOut) {
    var confForTier = bet.confidence || bet.Confidence || conf;
    riskTierOut = _deriveTierFromConfidence_(confForTier);
  }

  /* ── HomeAwayFlag (MUST come before ForebetAction) ── */
  var homeAwayFlag = (function () {
    var d = _safeEnrich_(
      _normalizeDirectionToken_,
      [bet.direction || bet.Direction || ''], ''
    );
    if (d === 'HOME' || d === 'AWAY') return d;
    return _safeEnrich_(parseHomeAwayFlag_, [pick, match], '');
  })();

  if (!homeAwayFlag || homeAwayFlag === 'NEUTRAL') {
    homeAwayFlag = _getSideFromPick(pick, teams.home, teams.away);
    if (homeAwayFlag === 'NEUTRAL') homeAwayFlag = '';
  }

  /* ── ForebetPred: raw 1/2 → HOME/AWAY ──────────── */
  var forebetPredRaw = _firstMeaningful_(
    bet.ForebetPrediction, bet.forebetPrediction,
    bet.ForebetPred,       bet.forebetPred,
    bet.Pred,              bet.pred,
    bet['Pred'],           bet['Forebet Pred']
  );
  var faRaw = _firstMeaningful_(
    bet.ForebetAction,    bet.forebetAction,
    bet.forebet_action,   bet['Forebet Action'],
    bet['FOREBET ACTION']
  );
  if (!forebetPredRaw && (faRaw === '1' || faRaw === '2')) {
    forebetPredRaw = faRaw;
  }
  var forebetPredDir = _normalizeForebetPred_(forebetPredRaw);

  /* ══════════════════════════════════════════════════════════════
   * ✅ FOREBET ACTION — SINGLE NORMALIZER (v4.5 CONSISTENCY FIX)
   *
   * Priority chain:
   *   1. Deterministic synced value (WITH / AGAINST / SKIP)
   *   2. Legacy _deriveForebetAction_ (may return WITH_FOREBET etc.)
   *   3. Default-to-WITH for eligible bets
   *   4. Derive from RiskTier (O/U fallback)
   *   5. Final safety net → 'NA'
   *
   * ALL outputs normalized at the end — strip _FOREBET suffix,
   * collapse to exactly: WITH | AGAINST | SKIP | NA
   * ══════════════════════════════════════════════════════════════ */
  var forebetOut = '';

  // Step 1: check deterministic synced value
  var syncedFA = String(faRaw || '').trim().toUpperCase();
  // Accept both "WITH" and "WITH_FOREBET" as valid deterministic
  var syncedNorm = syncedFA.replace(/_FOREBET$/i, '');
  var VALID_ACTIONS = ['WITH', 'AGAINST', 'SKIP'];

  if (VALID_ACTIONS.indexOf(syncedNorm) >= 0) {
    forebetOut = syncedNorm;
  }

  // Step 2: legacy derive (only if step 1 didn't resolve)
  if (!forebetOut) {
    var legacyFA = _deriveForebetAction_(bet, homeAwayFlag, forebetPredDir);
    if (legacyFA) {
      forebetOut = String(legacyFA).trim().toUpperCase().replace(/_FOREBET$/i, '');
    }
  }

  // Step 3: default to WITH for eligible bets
  if (!forebetOut &&
      typeof _shouldDefaultNAForebetToWith_ === 'function' &&
      _shouldDefaultNAForebetToWith_(bet)) {
    forebetOut = 'WITH';
  }

  // Step 4: derive from RiskTier (useful for O/U)
  if (!forebetOut && riskTierOut) {
    var tierFA = _deriveForebetActionFromRiskTier_(riskTierOut);
    if (tierFA) {
      forebetOut = String(tierFA).trim().toUpperCase().replace(/_FOREBET$/i, '');
    }
  }

  // Step 5: final safety net
  if (!forebetOut || VALID_ACTIONS.indexOf(forebetOut) < 0) {
    forebetOut = 'NA';
  }

  /* ── SegmentKey: generate with canonical league ──── */
  var betForSeg = Object.assign({}, bet, {
    league: leagueKey, League: leagueKey,
    match:  match,     Match:  match
  });
  var segmentKey = bet.SegmentKey
    || bet.segmentKey
    || generateSegmentKey_(betForSeg);

  /* ── return ───────────────────────────────────────── */
  return {
    BetID:         betID,
    SyncTimestamp: _safeEnrich_(isoNow_, [], new Date().toISOString()),

    League:   leagueKey,
    Match:    match,
    HomeTeam: teams.home || '',
    AwayTeam: teams.away || '',
    Pick:     pick,

    Type:    _safeEnrich_(_micBetType_, [bet], ''),
    SubType: _safeEnrich_(parseSubType_, [pick], ''),
    Quarter: _safeEnrich_(parseQuarter_, [pick], ''),

    Odds:       oddsOut,
    Confidence: isNaN(conf) ? '' : conf,

    ConfidenceBucket: _safeEnrich_(
      getConfidenceBucket_, [conf, 'MIC'], ''
    ),

    AssayerConfidenceBucket:
      (a && a.dims && a.dims.conf_bucket)
        ? a.dims.conf_bucket
        : (conf01 != null &&
           typeof computeConfidenceBucket_ === 'function')
          ? _safeEnrich_(computeConfidenceBucket_, [conf01], '')
          : '',

    EV: evOut,

    HomeAwayFlag:  homeAwayFlag,
    RiskTier:      riskTierOut,

    ForebetPred:   forebetPredDir,
    ForebetAction: forebetOut,

    Sport:      bet.sport || bet.Sport
      || _safeEnrich_(detectSport_, [bet], ''),
    MatchDate:  matchDateYMD,
    SegmentKey: segmentKey,

    /* ── Assayer Edge ─────────────────────────────── */
    AssayerEdgeMatched:      best ? 'YES' : 'NO',
    AssayerEdgeBestID:       best ? (best.edge_id || best.id || '') : '',
    AssayerEdgeBestGrade:    best ? (best.grade || '') : '',
    AssayerEdgeBestSymbol:   best ? (best.symbol || '') : '',
    AssayerEdgeBestLift:     best ? _numOrBlank_(best.lift) : '',
    AssayerEdgeBestWinRate:  best ? _numOrBlank_(best.win_rate) : '',
    AssayerEdgeBestN:        best ? _intOrBlank_(best.n) : '',
    AssayerEdgeBestPattern:  best ? (best.pattern || '') : '',
    AssayerEdgeBestReliable: best ? _boolToTF_(best.reliable) : '',
    AssayerEdgeMatchCount:   edgeMatchCount,

    /* ── Assayer Purity ───────────────────────────── */
    AssayerPurityGrade:     purity ? (purity.grade || '') : '',
    AssayerPurityStatus:    purity ? (purity.status || '') : '',
    AssayerPurityAction:    purityAction,
    AssayerPurityWinRate:   purity ? _numOrBlank_(purity.win_rate) : '',
    AssayerPurityN:         purity ? _numOrBlank_(purity.n) : '',
    AssayerPurityUpdatedAt: purity
      ? (purity.updated_at || purity.updatedAt || '')
      : ''
  };
}


/**
 * Calls fn with args. Returns fallback if fn doesn't exist or throws.
 * Intended for enrichment helpers that may be missing or broken.
 */
function _safeEnrich_(fn, args, fallback) {
  try {
    if (typeof fn !== 'function') return fallback;
    var result = fn.apply(null, args || []);
    return (result === undefined || result === null) ? fallback : result;
  } catch (_) {
    return fallback;
  }
}


/**
 * Returns the first argument that is a non-empty trimmed string.
 * Returns '' if none qualify.
 */
function _firstNonEmpty_() {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}



/**
 * Returns true if v is a known empty/placeholder token.
 * Does NOT treat numeric 0 as empty.
 */
function _isEmptyToken_(v) {
  if (v == null) return true;
  var s = String(v).trim().toUpperCase();
  return s === '' || s === '-' || s === 'N/A' || s === 'NA';
}

/**
 * Parses v as a number. Strips %. Returns the number or NaN.
 */
function _toNum_(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  var s = String(v || '').replace(/%/g, '').trim();
  if (!s) return NaN;
  var n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Returns v as number, or '' if not parseable. */
function _numOrBlank_(v) {
  var n = _toNum_(v);
  return Number.isFinite(n) ? n : '';
}

/** Returns v as integer, or '' if not parseable/not integer. */
function _intOrBlank_(v) {
  var n = _toNum_(v);
  return (Number.isFinite(n) && Number.isInteger(n)) ? n : '';
}

/** Returns 'TRUE'/'FALSE' for booleans, '' for anything else. */
function _boolToTF_(v) {
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return '';
}



function _normalizeSportType_(sportType) {
  const s = String(sportType || '').toUpperCase().trim();
  if (!s) return '';
  if (s === 'BASKETBALL') return 'BASKETBALL';
  if (s === 'FOOTBALL' || s === 'SOCCER') return 'FOOTBALL';
  if (s === 'TENNIS') return 'TENNIS';
  if (s === 'HOCKEY') return 'HOCKEY';
  if (s === 'BASEBALL') return 'BASEBALL';
  return s; // fallback: keep whatever config says
}

function _loadLeagueSportMapFromConfig_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'MIC_Config_LeagueSportMap_v1';

  const cached = cache.get(cacheKey);
  if (cached) {
    try { return new Map(JSON.parse(cached)); } catch (e) {}
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Config');
  const map = new Map();

  if (!sh || sh.getLastRow() < 2) {
    // no config sheet or empty config
    return map;
  }

  const data = sh.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());

  const idxLeagueCode = headers.indexOf('League Code');
  const idxSportType  = headers.indexOf('Sport Type');
  const idxLeagueName = headers.indexOf('League Name');

  if (idxLeagueCode === -1 || idxSportType === -1) return map;

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const code = String(row[idxLeagueCode] || '').toUpperCase().trim();
    const sport = _normalizeSportType_(row[idxSportType]);

    if (code && sport) map.set(code, sport);

    // Optional: also map League Name -> sport if present
    if (idxLeagueName !== -1) {
      const name = String(row[idxLeagueName] || '').toUpperCase().trim();
      if (name && sport) map.set(name, sport);
    }
  }

  try {
    cache.put(cacheKey, JSON.stringify(Array.from(map.entries())), 6 * 60 * 60); // 6 hours
  } catch (e) {}

  return map;
}

function normalizeResultLabel_(x) {
  const raw = String(x === null || x === undefined ? '' : x).trim();
  if (!raw) return 'PENDING';

  const s = raw.toUpperCase();

  // Numeric/boolean
  if (s === '1' || s === 'TRUE') return 'WON';
  if (s === '0' || s === 'FALSE') return 'LOST';

  // Symbols
  if (s === '✅' || s === '✔' || s === '🟢' || s === '✓') return 'WON';
  if (s === '❌' || s === '✖' || s === '🔴' || s === '✗') return 'LOST';

  // Short labels
  if (s === 'W' || s === 'WIN' || s === 'WON' || s === 'WINNER') return 'WON';
  if (s === 'L' || s === 'LOSS' || s === 'LOST' || s === 'LOSE' || s === 'LOSER') return 'LOST';
  if (s === 'P' || s === 'PUSH' || s === 'TIE' || s === 'DRAW') return 'PUSH';
  if (s === 'V' || s === 'VOID' || s === 'CANCELLED' || s === 'CANCELED' || s === 'REFUND') return 'VOID';

  // Embedded text
  if (s.indexOf('WON') !== -1 || s.indexOf('WIN') !== -1) return 'WON';
  if (s.indexOf('LOST') !== -1 || s.indexOf('LOSS') !== -1 || s.indexOf('LOSE') !== -1) return 'LOST';
  if (s.indexOf('PUSH') !== -1 || s.indexOf('TIE') !== -1 || s.indexOf('DRAW') !== -1) return 'PUSH';
  if (s.indexOf('VOID') !== -1 || s.indexOf('CANCEL') !== -1 || s.indexOf('REFUND') !== -1) return 'VOID';

  return 'PENDING';
}

function toWinLossFlag_(resultLabel) {
  const r = normalizeResultLabel_(resultLabel);
  if (r === 'WON') return 1;
  if (r === 'LOST') return 0;
  if (r === 'PUSH' || r === 'VOID') return -1;
  return -1;
}

function roiContribution_(resultLabel, odds) {
  const r = normalizeResultLabel_(resultLabel);

  // Loss always costs 1 unit stake, odds irrelevant
  if (r === 'LOST') return -1;

  // Win needs valid decimal odds
  const o = parseFloat(odds);
  if (!isFinite(o) || o <= 1) return 0; // unknown win profit => neutral for week-test

  if (r === 'WON') return o - 1;

  // PUSH/VOID/PENDING/UNKNOWN
  return 0;
}


/**
 * Returns '' for any value that is blank, '-', '—', 'NA', or 'N/A'.
 * Otherwise returns the trimmed string.
 */
function _blankIfNA_(v) {
  var t = String(v ?? '').trim();
  if (!t) return '';
  var u = t.toUpperCase();
  if (u === 'NA' || u === 'N/A' || t === '-' || t === '—') return '';
  return t;
}

/**
 * Returns the first argument whose _blankIfNA_ value is non-empty,
 * or '' if none qualify.
 */
function _firstMeaningful_() {
  for (var i = 0; i < arguments.length; i++) {
    var v = _blankIfNA_(arguments[i]);
    if (v) return v;
  }
  return '';
}



function enrichPerformanceLogEntry_(bet, logID, betID, resultKeyNoScore) {

  /* ── core fields ──────────────────────────────────── */
  var match = matchString(bet);
  var pick  = bet.pick || bet.Pick || '';
  var conf  = normalizeConfidence_(bet.confidence || bet.Confidence);

  var oddsNum = normalizeOdds_(bet.odds || bet.Odds);
  var oddsOut = isNaN(oddsNum) ? '' : oddsNum;

  var result      = normalizeResultLabel_(
    bet.result || bet.Result || bet.grade || bet.Grade || 'PENDING'
  );
  var winLossFlag = toWinLossFlag_(result);
  var roi         = roiContribution_(result, oddsNum);

  /* ── League: canonical code ───────────────────────── */
  var leagueKey = normalizeLeagueKey_(
    bet.league || bet.League || bet['League'] || bet['Competition'] || ''
  );

  /* ── HomeAwayFlag (MUST come before ForebetAction) ── */
  var homeAwayFlag = (function () {
    var d = _normalizeDirectionToken_(bet.direction || bet.Direction || '');
    if (d === 'HOME' || d === 'AWAY') return d;
    return parseHomeAwayFlag_(pick, match);
  })();

  /* ── ActualScore ──────────────────────────────────── */
  var actualScore =
    bet.actualScore || bet.ActualScore ||
    bet.score       || bet.Score       ||
    bet.FTScore     || bet.ftScore     ||
    '';

  /* ── RiskTier: passthrough → computed → sanitize ─── */
  var riskTierUpstream = _firstMeaningful_(
    bet.RiskTier,      bet.riskTier,      bet.risk_tier,
    bet['RiskTier'],   bet['Risk Tier'],  bet['RISK TIER']
  );
  var riskTierComputed = _riskTier_(bet);
  var riskTierOut = riskTierUpstream
    || _blankIfNA_(riskTierComputed)
    || '';

  /* ── ForebetPred: raw 1/2 → HOME/AWAY ──────────── */
  var forebetPredRaw = _firstMeaningful_(
    bet.ForebetPred,      bet.forebetPred,
    bet.Pred,             bet.pred,
    bet['Pred'],          bet['Forebet Pred']
  );
  var faRaw = _firstMeaningful_(
    bet.ForebetAction,    bet.forebetAction,
    bet.forebet_action,   bet['Forebet Action'],
    bet['FOREBET ACTION']
  );
  if (!forebetPredRaw && (faRaw === '1' || faRaw === '2')) {
    forebetPredRaw = faRaw;
  }
  var forebetPredDir = _normalizeForebetPred_(forebetPredRaw);

  /* ── ForebetAction: derived WITH/AGAINST ──────────── */
  var forebetOut = _deriveForebetAction_(bet, homeAwayFlag);
  if (!forebetOut &&
      typeof _shouldDefaultNAForebetToWith_ === 'function' &&
      _shouldDefaultNAForebetToWith_(bet)) {
    forebetOut = 'WITH';
  }

  /* ── SegmentKey: generate with canonical league ──── */
  var betForSeg = Object.assign({}, bet, {
    league: leagueKey, League: leagueKey,
    match:  match,     Match:  match
  });
  var segmentKey = bet.SegmentKey
    || bet.segmentKey
    || generateSegmentKey_(betForSeg);

  /* ── return ───────────────────────────────────────── */
  return {
    LogID:          logID,
    BetID:          betID,
    ResultID:       resultKeyNoScore,
    GradedTimestamp: bet.GradedTimestamp || isoNow_(),

    League:  leagueKey,
    Match:   match,
    Pick:    pick,

    Type:    _micBetType_(bet),
    SubType: bet.subType || bet.SubType || parseSubType_(pick),
    Quarter: bet.quarter || bet.Quarter || parseQuarter_(pick),

    Odds:             oddsOut,
    Confidence:       isNaN(conf) ? '' : conf,
    ConfidenceBucket: getConfidenceBucket_(conf),

    HomeAwayFlag:  homeAwayFlag,
    RiskTier:      riskTierOut,

    ForebetPred:   forebetPredDir,
    ForebetAction: forebetOut,

    SegmentKey: segmentKey,

    Result:      result,
    WinLossFlag: winLossFlag,
    ActualScore: actualScore,

    ROI_Contribution: roi,
    EdgeRealized:     winLossFlag === 1
      ? 'YES'
      : (winLossFlag === 0 ? 'NO' : 'NA'),

    Sport: bet.sport || bet.Sport || detectSport_(bet)
  };
}



/* =========================
 * APPEND-ONLY ARCHIVES
 * ========================= */
/**
 * Appends bet objects to the BETS_ARCHIVE sheet, deduplicating by BetID.
 * Guarantees RiskTier (and any future schema additions) are persisted.
 *
 * Resilient to:
 *  • Column reordering / extra columns in the archive sheet
 *  • Missing schema columns on the target (warned, values dropped)
 *  • Duplicate header names on the target (warned, first-wins)
 *  • Empty / sentinel BetIDs from generateBetID_
 *  • Missing log_ / err_ / warn_ globals
 *  • Missing invalidateIDCache_ global
 *  • Trailing empty header cells inflating write width
 *
 * @param  {Object[]} bets
 * @param  {Object}   [options]
 * @param  {boolean}  [options.debug=false]       Emit per-row diagnostic logs
 * @param  {number}   [options.debugLimit=0]       Cap on debug rows logged
 * @param  {boolean}  [options.returnCountOnly]    Return number instead of object (legacy compat)
 * @return {{ appended:number, duplicates:number, errors:number } | number}
 */
function appendBetsToArchive(bets, options) {
  const cfg = _cfg_();
  const opt = options || {};
  const debug      = opt.debug === true;
  const debugLimit = Math.max(0, opt.debugLimit || 0);

  /* ── safe logger fallbacks ───────────────────────────────────── */
  const _log  = (typeof log_  === 'function') ? log_  : (msg) => Logger.log(String(msg));
  const _err  = (typeof err_  === 'function') ? err_  : (msg) => Logger.log('[ERROR] ' + String(msg));
  const _warn = (typeof warn_ === 'function') ? warn_ : (msg) => Logger.log('[WARN] '  + String(msg));

  const EMPTY = opt.returnCountOnly ? 0 : { appended: 0, duplicates: 0, errors: 0 };
  if (!bets || bets.length === 0) return EMPTY;

  const sheetName = cfg.SHEETS.BETS_ARCHIVE;
  const schema    = SCHEMA.BETS_ARCHIVE;
  const sheet     = getArchiveSheet_(sheetName, schema);

  /* ── read & validate physical headers on write target ────────── */
  const physicalHeaders = _getPhysicalHeaders_(sheet, schema);
  _requireHeaders_(physicalHeaders, ['BetID'], 'appendBetsToArchive');

  // Trim trailing empty header slots so we don't write extra columns
  let effectiveWidth = physicalHeaders.length;
  while (effectiveWidth > 0 && !physicalHeaders[effectiveWidth - 1]) {
    effectiveWidth--;
  }
  const writeHeaders = physicalHeaders.slice(0, effectiveWidth);

  // Warn on duplicate header names (silent column-remapping risk)
  const _seen = Object.create(null);
  for (let h = 0; h < writeHeaders.length; h++) {
    const name = writeHeaders[h];
    if (!name) continue;
    if (name in _seen) {
      _warn(
        `appendBetsToArchive: duplicate header "${name}" ` +
        `at cols ${_seen[name] + 1} & ${h + 1} in "${sheet.getName()}".`
      );
    } else {
      _seen[name] = h;
    }
  }

  // Warn about schema columns absent from the target sheet
  for (let i = 0; i < schema.length; i++) {
    if (writeHeaders.indexOf(schema[i]) < 0) {
      _warn(
        `appendBetsToArchive: schema column "${schema[i]}" not found ` +
        `in target sheet "${sheet.getName()}" — values will be dropped.`
      );
    }
  }

  /* ── build existing BetID set (must be shard-aware) ──────────── */
  const existing = getExistingIDs_(sheetName, 'BetID');

  /* ── build rows to append ────────────────────────────────────── */
  const rows   = [];
  let dup      = 0;
  let errors   = 0;
  let debugNewCount = 0;
  let debugDupCount = 0;

  for (let i = 0; i < bets.length; i++) {
    try {
      const bet   = bets[i] || {};
      const betID = generateBetID_(bet);

      // Guard against empty / sentinel IDs that would poison the set
      if (!betID || betID === 'NA') {
        errors++;
        _warn('appendBetsToArchive: empty/sentinel BetID at index ' + i + ' — skipping.');
        continue;
      }

      const pick   = bet.pick   || bet.Pick   || '';
      const league = bet.league || bet.League || '';
      const isDup  = existing.has(betID);

      /* ── debug: log duplicate detail ─────────────────────────── */
      if (debug && isDup && debugDupCount < debugLimit) {
        const enrichedDup = enrichBetForArchive_(bet, betID);
        _log(
          '🟡 DUP #' + (debugDupCount + 1) +
          ' | BetID=' + betID +
          ' | League=' + league +
          ' | Pick="' + pick + '"' +
          ' | -> MatchDate=' + enrichedDup.MatchDate +
          ' | HomeAwayFlag=' + enrichedDup.HomeAwayFlag +
          ' | Sport=' + enrichedDup.Sport +
          ' | SegmentKey=' + enrichedDup.SegmentKey
        );
        debugDupCount++;
      }

      if (isDup) { dup++; continue; }

      const enriched = enrichBetForArchive_(bet, betID);

      /* ── debug: log new-row detail ───────────────────────────── */
      if (debug && debugNewCount < debugLimit) {
        _log(
          '🟢 NEW #' + (debugNewCount + 1) +
          ' | BetID=' + betID +
          ' | League=' + league +
          ' | Pick="' + pick + '"' +
          ' | -> MatchDate=' + enriched.MatchDate +
          ' | HomeAwayFlag=' + enriched.HomeAwayFlag +
          ' | Sport=' + enriched.Sport +
          ' | SegmentKey=' + enriched.SegmentKey
        );
        debugNewCount++;
      }

      // Map values into physical-header order so setValues lands correctly
      const row = new Array(effectiveWidth);
      for (let c = 0; c < effectiveWidth; c++) {
        const hdr = writeHeaders[c];
        row[c] = (hdr && enriched[hdr] !== undefined) ? enriched[hdr] : '';
      }
      rows.push(row);

      existing.add(betID);

    } catch (e) {
      errors++;
      _err('appendBetsToArchive error: ' + (e && e.message ? e.message : e));
    }
  }

  /* ── write & invalidate cache ────────────────────────────────── */
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, effectiveWidth).setValues(rows);
    // Cache is stale now — invalidate so next run rebuilds from truth
    if (typeof invalidateIDCache_ === 'function') {
      try { invalidateIDCache_(sheetName, 'BetID'); } catch (_) { /* non-fatal */ }
    }
    _log('✅ Appended ' + rows.length + ' bets → ' + sheet.getName());
  }

  if (opt.returnCountOnly) return rows.length;
  return { appended: rows.length, duplicates: dup, errors: errors };
}



function _requireHeaders_(headers, requiredList, contextLabel) {
  const ctx = String(contextLabel || 'UNKNOWN_CTX');
  const hs = Array.isArray(headers) ? headers : [];
  const req = Array.isArray(requiredList) ? requiredList : [];

  const missing = [];
  for (let i = 0; i < req.length; i++) {
    const name = String(req[i] || '').trim();
    if (!name) continue;
    if (hs.indexOf(name) === -1) missing.push(name);
  }

  if (missing.length) {
    throw new Error(`[${ctx}] Missing required headers: ${missing.join(', ')}`);
  }
}

/**
 * Appends new result objects to the Results Archive, deduplicating by
 * scoreless ResultID key (first 3 pipe-delimited segments).
 *
 * Resilient to:
 *  • Column reordering / extra columns in the archive sheet
 *  • Missing schema columns on the target (warned, values dropped)
 *  • Duplicate header names on the target (warned, first-wins)
 *  • Shards missing the ResultID column (warned, skipped)
 *  • getAllShardSheets_ returning null/undefined
 *  • Missing log_ / err_ / warn_ globals
 *  • Trailing empty header cells inflating write width
 *
 * @param  {Object[]} results  Raw result objects to archive.
 * @return {{ appended:number, duplicates:number, errors:number }}
 */
function appendResultsToArchive(results) {
  const cfg = _cfg_();

  /* ── safe logger fallbacks ───────────────────────────────────── */
  const _log  = (typeof log_  === 'function') ? log_  : (msg) => Logger.log(String(msg));
  const _err  = (typeof err_  === 'function') ? err_  : (msg) => Logger.log('[ERROR] ' + String(msg));
  const _warn = (typeof warn_ === 'function') ? warn_ : (msg) => Logger.log('[WARN] '  + String(msg));

  if (!results || results.length === 0) {
    return { appended: 0, duplicates: 0, errors: 0 };
  }

  const sheetName = cfg.SHEETS.RESULTS_ARCHIVE;
  const schema    = SCHEMA.RESULTS_ARCHIVE;
  const sheet     = getArchiveSheet_(sheetName, schema);

  /* ── read & validate physical headers on write target ────────── */
  const physicalHeaders = _getPhysicalHeaders_(sheet, schema);
  _requireHeaders_(physicalHeaders, ['ResultID'], 'appendResultsToArchive');

  // Trim trailing empty header slots so we don't write extra columns
  let effectiveWidth = physicalHeaders.length;
  while (effectiveWidth > 0 && !physicalHeaders[effectiveWidth - 1]) {
    effectiveWidth--;
  }
  const writeHeaders = physicalHeaders.slice(0, effectiveWidth);

  // Warn on duplicate header names (silent column-remapping risk)
  const _seen = Object.create(null);
  for (let h = 0; h < writeHeaders.length; h++) {
    const name = writeHeaders[h];
    if (!name) continue;
    if (name in _seen) {
      _warn(
        `appendResultsToArchive: duplicate header "${name}" ` +
        `at cols ${_seen[name] + 1} & ${h + 1} in "${sheet.getName()}".`
      );
    } else {
      _seen[name] = h;
    }
  }

  // Warn about schema columns absent from the target sheet
  for (let i = 0; i < schema.length; i++) {
    if (writeHeaders.indexOf(schema[i]) < 0) {
      _warn(
        `appendResultsToArchive: schema column "${schema[i]}" not found ` +
        `in target sheet "${sheet.getName()}" — values will be dropped.`
      );
    }
  }

  /* ── build existing scoreless-key set from all shards ────────── */
  const existing = (function getExistingScorelessResultKeys_() {
    const cache    = CacheService.getScriptCache();
    const cacheKey = 'existingResultNoScore_' + sheetName;

    const cached = cache.get(cacheKey);
    if (cached) {
      try { return new Set(JSON.parse(cached)); } catch (_) { /* rebuild */ }
    }

    const shards = getAllShardSheets_(sheetName) || [];
    const out    = new Set();

    for (let s = 0; s < shards.length; s++) {
      const sh      = shards[s];
      const lastRow = sh.getLastRow();
      if (lastRow <= 1) continue;

      // Header-aware lookup: find ResultID by name, not position
      const shHeaders = _getPhysicalHeaders_(sh, schema);
      const col0      = shHeaders.indexOf('ResultID');
      if (col0 < 0) {
        _warn(
          `appendResultsToArchive: "ResultID" missing in shard ` +
          `"${sh.getName()}" — skipping shard.`
        );
        continue;
      }

      const vals = sh.getRange(2, col0 + 1, lastRow - 1, 1).getValues();

      for (let i = 0; i < vals.length; i++) {
        const id = String(vals[i][0] || '').trim();
        if (!id) continue;
        const parts = id.split('|');
        if (parts.length >= 3) {
          out.add(parts[0] + '|' + parts[1] + '|' + parts[2]);
        }
      }
    }

    try {
      cache.put(cacheKey, JSON.stringify(Array.from(out)), cfg.CACHE_SECONDS);
    } catch (_) { /* non-fatal */ }

    return out;
  })();

  /* ── build rows to append ────────────────────────────────────── */
  const rows   = [];
  let dup      = 0;
  let errors   = 0;

  for (let i = 0; i < results.length; i++) {
    try {
      const r         = results[i] || {};
      const idNoScore = generateResultKeyNoScore_(r);
      if (idNoScore === 'NA|NA|NA') continue;

      if (existing.has(idNoScore)) { dup++; continue; }

      const enriched = enrichResultForArchive_(r, idNoScore);

      // Map values into physical-header order so setValues lands correctly
      const row = new Array(effectiveWidth);
      for (let c = 0; c < effectiveWidth; c++) {
        const h = writeHeaders[c];
        row[c] = (h && enriched[h] !== undefined) ? enriched[h] : '';
      }
      rows.push(row);

      existing.add(idNoScore);

    } catch (e) {
      errors++;
      _err('appendResultsToArchive error: ' + (e && e.message ? e.message : e));
    }
  }

  /* ── write & invalidate cache ────────────────────────────────── */
  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, effectiveWidth).setValues(rows);
    // Cache is stale now — remove so next run rebuilds from truth
    try {
      CacheService.getScriptCache().remove('existingResultNoScore_' + sheetName);
    } catch (_) { /* non-fatal */ }
    _log('✅ Appended ' + rows.length + ' results → ' + sheet.getName());
  }

  return { appended: rows.length, duplicates: dup, errors: errors };
}


/* =========================
 * SEGMENT LEARNING
 * ========================= */
/**
 * Loads all Performance-Log shard sheets into an array of row-objects,
 * keyed by SCHEMA.PERFORMANCE_LOG field names.
 *
 * Resilient to:
 *  • Column reordering / extra columns in individual shards
 *  • Missing schema columns (default to '')
 *  • Duplicate header names (warned, first-wins via _buildHeaderIndex_)
 *  • Entirely-blank rows left by clears or formatting artifacts
 *  • Missing warn_ global
 *
 * @return {Object[]}  Array of { [schemaField]: value, … } objects.
 */
function loadPerformanceLogAllShards_() {
  const cfg    = _cfg_();
  const schema = SCHEMA.PERFORMANCE_LOG;

  /* ── safe logger ─────────────────────────────────────────────── */
  const _warn = (typeof warn_ === 'function')
    ? warn_
    : (msg) => Logger.log('[WARN] ' + String(msg));

  /* ── collect shards (guard against null/undefined return) ───── */
  const shards = getAllShardSheets_(cfg.SHEETS.PERFORMANCE_LOG) || [];
  const out    = [];

  for (let s = 0; s < shards.length; s++) {
    const sh      = shards[s];
    const lastRow = sh.getLastRow();          // last row with any content
    if (lastRow <= 1) continue;               // header-only or empty

    /* ── read & validate physical headers ──────────────────────── */
    const physicalHeaders = _getPhysicalHeaders_(sh, schema);

    // Warn on duplicate header names (silent data-remapping risk)
    const _seen = Object.create(null);
    for (let h = 0; h < physicalHeaders.length; h++) {
      const name = physicalHeaders[h];
      if (name === '') continue;
      if (name in _seen) {
        _warn(
          `loadPerformanceLogAllShards_: duplicate header "${name}" ` +
          `at cols ${_seen[name] + 1} & ${h + 1} in "${sh.getName()}".`
        );
      } else {
        _seen[name] = h;
      }
    }

    let idx;
    try {
      idx = _buildHeaderIndex_(physicalHeaders);   // Object.create(null)
    } catch (e) {
      _warn(
        `loadPerformanceLogAllShards_: ${e.message} ` +
        `in shard "${sh.getName()}" — skipping shard.`
      );
      continue;
    }

    /* ── precompute schema→column positions (once per shard) ───── */
    const posBySchema = schema.map(h => (h in idx) ? idx[h] : -1);

    // Only read as far right as the rightmost column the schema needs
    const neededMax = posBySchema.reduce((mx, p) => Math.max(mx, p), -1);
    if (neededMax < 0) {
      _warn(
        `loadPerformanceLogAllShards_: no schema columns matched ` +
        `in shard "${sh.getName()}" — skipping shard.`
      );
      continue;
    }
    const width = neededMax + 1;               // 0-based index → col count

    /* ── single bulk read ──────────────────────────────────────── */
    const data = sh.getRange(2, 1, lastRow - 1, width).getValues();

    /* ── row-level mapping ─────────────────────────────────────── */
    for (let r = 0; r < data.length; r++) {
      const row = data[r];

      // Skip rows that are entirely empty (stray formatting / clears)
      if (row.every(v => v === '' || v == null)) continue;

      const obj = {};
      for (let i = 0; i < schema.length; i++) {
        const pos = posBySchema[i];
        obj[schema[i]] = (pos >= 0) ? row[pos] : '';
      }

      // Normalize WinLossFlag: blank / null / non-numeric → -1
      const w  = obj.WinLossFlag;
      const wi = (w === '' || w == null) ? NaN : Number(w);
      obj.WinLossFlag = Number.isFinite(wi) ? Math.trunc(wi) : -1;

      out.push(obj);
    }
  }

  return out;
}



function _getPhysicalHeaders_(sheet, fallbackHeaders) {
  const fallback = Array.isArray(fallbackHeaders) ? fallbackHeaders.slice() : [];
  if (!sheet) return fallback;

  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return fallback;

  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
  const headers = headerRow.map(h => (h === null || h === undefined) ? '' : String(h).trim());

  while (headers.length > 0 && headers[headers.length - 1] === '') headers.pop();

  return headers.length ? headers : fallback;
}



/**
 * Builds a frozen, prototype-free header-name → 0-based-column-index map.
 *
 * Resilient to:
 *  • Prototype-pollution header names ("constructor", "__proto__", "toString")
 *  • Null / undefined / numeric header values (coerced + trimmed)
 *  • Empty header cells (skipped silently)
 *  • Duplicate header names (throws with both indices for diagnosis)
 *
 * @param  {Array}  headersArray  Row-1 values from a sheet
 * @return {Object}               Frozen { headerName: 0-basedIndex, … }
 * @throws {Error}                On duplicate non-empty header names
 */
function _buildHeaderIndex_(headersArray) {
  const headers = Array.isArray(headersArray) ? headersArray : [];
  const map = Object.create(null);               // no prototype — immune to __proto__ / toString / constructor

  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i];
    const h = (raw === null || raw === undefined) ? '' : String(raw).trim();
    if (!h) continue;                             // skip blank header cells

    if (h in map) {                               // safe with Object.create(null)
      throw new Error(
        `Duplicate header "${h}" at indices ${map[h]} and ${i}`
      );
    }
    map[h] = i;                                   // 0-based column position
  }

  return Object.freeze(map);
}


function groupBySegmentKey_(perfRows) {
  const groups = {};
  for (let i=0;i<perfRows.length;i++) {
    const k = perfRows[i].SegmentKey || 'UNKNOWN';
    if (!groups[k]) groups[k] = [];
    groups[k].push(perfRows[i]);
  }
  return groups;
}

function parseTimestampMs_(x) {
  const d = new Date(x);
  const t = d.getTime();
  return isNaN(t) ? 0 : t;
}

function bayesianLowerBound_(alpha, beta, oneSidedConfidence) {
  const a = Math.max(0, safeNum_(alpha, 0));
  const b = Math.max(0, safeNum_(beta, 0));
  if (a <= 0 || b <= 0) return 0;

  // accept 80 as well as 0.80
  let c = safeNum_(oneSidedConfidence, 0.8);
  if (c > 1) c = c / 100;

  // keep within sensible numeric bounds
  c = Math.min(0.999999, Math.max(0.5, c));

  const mean = a / (a + b);
  const variance = (a * b) / (Math.pow(a + b, 2) * (a + b + 1));
  const stdDev = Math.sqrt(Math.max(0, variance));

  // one-sided lower bound is the (1 - c) quantile
  const z = normSInv_(1 - c); // negative number
  const lb = mean + z * stdDev;

  return Math.max(0, Math.min(1, lb));
}

// Acklam approximation for inverse standard normal CDF
function normSInv_(p) {
  // clamp away from 0/1 to avoid infinities
  p = Math.min(1 - 1e-16, Math.max(1e-16, p));

  const a = [-3.969683028665376e+01,  2.209460984245205e+02,
             -2.759285104469687e+02,  1.383577518672690e+02,
             -3.066479806614716e+01,  2.506628277459239e+00];

  const b = [-5.447609879822406e+01,  1.615858368580409e+02,
             -1.556989798598866e+02,  6.680131188771972e+01,
             -1.328068155288572e+01];

  const c = [-7.784894002430293e-03, -3.223964580411365e-01,
             -2.400758277161838e+00, -2.549732539343734e+00,
              4.374664141464968e+00,  2.938163982698783e+00];

  const d = [ 7.784695709041462e-03,  3.224671290700398e-01,
              2.445134137142996e+00,  3.754408661907416e+00];

  const plow = 0.02425;
  const phigh = 1 - plow;

  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
           ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q + c[1])*q + c[2])*q + c[3])*q + c[4])*q + c[5]) /
             ((((d[0]*q + d[1])*q + d[2])*q + d[3])*q + 1);
  }

  q = p - 0.5;
  r = q * q;
  return (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5]) * q /
         (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1);
}


function _purgeArchivesForRebuild() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    '⚠️ DANGER: PURGING ARCHIVES',
    'This will delete all data in Sync_Temp, Results_Temp, Archives, and Segment_Stats, and flush script properties. Proceed?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  const sheetsToClear = [
    'Sync_Temp', 'Results_Temp',
    'Historical_Bets_Archive', 'Historical_Results_Archive',
    'Historical_Performance_Log', 'Segment_Stats'
  ];

  let clearedCount = 0;
  sheetsToClear.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      if (lastRow > 1 && lastCol > 0) {
        sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
        clearedCount++;
      }
    }
  });

  PropertiesService.getScriptProperties().deleteAllProperties();

  try {
    const cache = CacheService.getScriptCache();
    cache.removeAll(['existingResultNoScore_Historical_Results_Archive']);
  } catch (e) {
    Logger.log('Cache removal skipped: ' + e.message);
  }

  ui.alert('🧹 Purge Complete',
    `Cleared ${clearedCount} data sheets and flushed ScriptProperties. You are ready to rebuild.`,
    ui.ButtonSet.OK);
}




function randomNormal_() {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2*Math.log(u1)) * Math.cos(2*Math.PI*u2);
}

function sampleGamma_(shape) {
  if (shape < 1) return sampleGamma_(shape + 1) * Math.pow(Math.random(), 1/shape);

  const d = shape - 1/3;
  const c = 1 / Math.sqrt(9*d);

  while (true) {
    let x, v;
    do {
      x = randomNormal_();
      v = 1 + c*x;
    } while (v <= 0);

    v = v*v*v;
    const u = Math.random();

    if (u < 1 - 0.0331*Math.pow(x,4)) return d*v;
    if (Math.log(u) < 0.5*x*x + d*(1 - v + Math.log(v))) return d*v;
  }
}

function sampleBeta_(alpha, beta) {
  const x = sampleGamma_(alpha);
  const y = sampleGamma_(beta);
  return x / (x + y);
}

function calculateBayesParamsWithDecay_(validBets, cfg) {
  const actions = ['WITH','AGAINST','SKIP'];
  const now = Date.now();
  const ln2 = Math.log(2);
  const halfLife = cfg.RECENCY_DECAY_HALFLIFE_DAYS;

  // OVERALL learns from ALL valid bets, regardless of ForebetAction availability/comparability.
  const params = {
    OVERALL: { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA },
    WITH:    { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA },
    AGAINST: { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA },
    SKIP:    { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA }
  };

  for (let i = 0; i < (validBets || []).length; i++) {
    const b = validBets[i];
    if (!(b.WinLossFlag === 1 || b.WinLossFlag === 0)) continue;

    const t = parseTimestampMs_(b.GradedTimestamp || b.SyncTimestamp || 0);
    const ageDays = t ? (now - t) / (1000*60*60*24) : 9999;
    const w = Math.exp(-ln2 * ageDays / halfLife);

    // 1) Update OVERALL always
    if (b.WinLossFlag === 1) params.OVERALL.alpha += w;
    else if (b.WinLossFlag === 0) params.OVERALL.beta += w;

    // 2) Update arms only when ForebetAction is known/meaningful (or safe week-test fallback)
    const act0 = String(b.ForebetAction || 'NA').toUpperCase().trim();
    let act = act0;

    if (!act || act === 'NA') {
      if (_shouldDefaultNAForebetToWith_(b)) {
        act = 'WITH'; // safe fallback only for comparable HOME/AWAY-ish markets
      } else {
        continue; // do NOT poison arms with totals / non-comparable bets
      }
    }

    if (actions.indexOf(act) === -1) continue;

    if (b.WinLossFlag === 1) params[act].alpha += w;
    else if (b.WinLossFlag === 0) params[act].beta += w;
  }

  return params;
}

function getRecommendedActions_(bayesParams, sampleSize, cfg) {
  // Backward compatible fallback if older logs exist
  const overall = bayesParams.OVERALL || bayesParams.WITH;

  const overallMean = overall.alpha / (overall.alpha + overall.beta);
  const overallLB = bayesianLowerBound_(overall.alpha, overall.beta, cfg.LOWER_BOUND_ONE_SIDED_CONFIDENCE);

  // --- 1) Choose action from OVERALL (so OU/TOTALS learn even when ForebetAction is NA) ---
  let action;
  if (sampleSize >= cfg.MIN_SAMPLE_SIZE) {
    if (overallMean < cfg.ALERT_WIN_RATE_THRESHOLD) action = 'BLOCK';
    else if (overallMean < cfg.CAUTION_MEAN_THRESHOLD) action = 'CAUTION';
    else action = 'BET';
  } else {
    if (overallLB >= cfg.EARLY_BET_LOWER_BOUND) action = 'BET';
    else if (overallLB <= cfg.EARLY_BLOCK_LOWER_BOUND) action = 'BLOCK';
    else action = 'CAUTION';
  }

  // --- 2) Choose forebetMode ONLY if there is real arm evidence ---
  const arms = ['WITH','AGAINST','SKIP'];
  const candidates = [];

  for (let i = 0; i < arms.length; i++) {
    const k = arms[i];
    const p = bayesParams[k];
    if (!p) continue;

    // require at least ~1 effective observation beyond the prior (decay can make this fractional)
    const ev = _evidenceCount_(p.alpha, p.beta, cfg);
    if (ev >= 1.0) candidates.push(k);
  }

  let chosenMode = 'WITH';
  if (candidates.length) {
    let bestVal = -1;
    for (let i = 0; i < candidates.length; i++) {
      const k = candidates[i];
      const p = bayesParams[k];
      const s = sampleBeta_(p.alpha, p.beta);
      if (s > bestVal) { bestVal = s; chosenMode = k; }
    }
  }

  // If we confidently believe "SKIP" is best (and it has evidence), hard-block.
  if (chosenMode === 'SKIP') action = 'BLOCK';

  return {
    action: action,
    forebetMode: chosenMode,
    lowerBound: overallLB,         // report confidence on the action signal
    posteriorMean: overallMean     // report mean on the action signal
  };
}

function determineTrend_(wr10, wr30, wrLife) {
  if (wr10 > wr30 * 1.10 && wr10 > wrLife * 1.05) return 'UP';
  if (wr10 < wr30 * 0.90 && wr10 < wrLife * 0.95) return 'DOWN';
  return 'STABLE';
}


function calculateSegmentStats_(segmentKey, bets, cfg) {
  // ── Normalize key to 8 parts (defensive vs old 9-part keys) ──────────────
  segmentKey = normalizeSegmentKey_(segmentKey);

  // ── Sort a COPY — don't mutate the caller's array ────────────────────────
  var sorted = (bets || []).slice().sort(function(x, y) {
    var a = parseTimestampMs_(x.GradedTimestamp);
    var b = parseTimestampMs_(y.GradedTimestamp);
    var am = isFinite(a) ? a : Infinity;
    var bm = isFinite(b) ? b : Infinity;
    return am - bm;
  });

  // ── Coerce WinLossFlag to number (Sheets often yields strings) ───────────
  var flag = function(b) { return Number(b && b.WinLossFlag); };

  var valid  = sorted.filter(function(b) { var f = flag(b); return f === 0 || f === 1; });
  var wins   = valid.filter(function(b) { return flag(b) === 1; });
  var losses = valid.filter(function(b) { return flag(b) === 0; });
  var pushes = sorted.filter(function(b) { return flag(b) === -1; });

  var last30 = valid.slice(-30);
  var last10 = valid.slice(-10);

  var wrLife = valid.length ? wins.length / valid.length : 0;
  var wr30   = last30.length ? last30.filter(function(b) { return flag(b) === 1; }).length / last30.length : 0;
  var wr10   = last10.length ? last10.filter(function(b) { return flag(b) === 1; }).length / last10.length : 0;

  // ── AvgOdds: only rows with valid decimal odds > 1 ──────────────────────
  var validOddsRows = valid.filter(function(b) {
    var o = parseFloat(b.Odds);
    return isFinite(o) && o > 1;
  });
  var avgOdds = validOddsRows.length
    ? validOddsRows.reduce(function(s, b) { return s + parseFloat(b.Odds); }, 0) / validOddsRows.length
    : 0;

  // ── AvgConfidence: NaN-safe ──────────────────────────────────────────────
  var avgConf = valid.length
    ? valid.reduce(function(s, b) {
        var c = normalizeConfidence_(b.Confidence);
        return s + (isFinite(c) ? c : 0);
      }, 0) / valid.length
    : 0;

  // ── TotalROI: fallback-calc when ROI_Contribution is missing ─────────────
  //    Losses → -1 even if odds missing; unknown-odds wins → 0; pushes → 0
  var totalROI = valid.reduce(function(s, b) {
    var stored = Number(b.ROI_Contribution);
    if (isFinite(stored)) return s + stored;
    // Fallback
    var f = flag(b);
    if (f === 0) return s - 1;                              // loss = -1 unit
    if (f === 1) {
      var o = Number(b.Odds);
      return s + ((isFinite(o) && o > 1) ? (o - 1) : 0);   // win with unknown odds = 0
    }
    return s;                                                // push / unknown = 0
  }, 0);

  var bayes = calculateBayesParamsWithDecay_(valid, cfg);
  var rec   = getRecommendedActions_(bayes, valid.length, cfg);
  var trend = determineTrend_(wr10, wr30, wrLife);

  // ── Parse the 8-part key ─────────────────────────────────────────────────
  var parts = segmentKey.split('|');

  var isActive =
    (valid.length >= cfg.MIN_SAMPLE_SIZE || rec.action === 'BET' || rec.action === 'BLOCK')
      ? 'YES'
      : 'LEARNING';

  return {
    SegmentKey:          segmentKey,
    Sport:               parts[0] || 'NA',
    League:              parts[1] || 'NA',
    BetType:             parts[2] || 'NA',
    SubType:             parts[3] || 'NA',
    Side:                parts[4] || 'NA',
    ConfidenceBucket:    parts[5] || 'NA',
    Quarter:             parts[6] || 'NA',
    RiskTier:            parts[7] || 'NA',

    TotalBets:           valid.length,
    Wins:                wins.length,
    Losses:              losses.length,
    Pushes:              pushes.length,

    WinRate_Lifetime:    (wrLife * 100).toFixed(2) + '%',
    WinRate_L30:         (wr30 * 100).toFixed(2) + '%',
    WinRate_L10:         (wr10 * 100).toFixed(2) + '%',

    AvgOdds:             avgOdds.toFixed(3),
    AvgConfidence:       (isFinite(avgConf) ? avgConf : 0).toFixed(1),
    TotalROI:            totalROI.toFixed(2),

    Alpha_WITH:          bayes.WITH.alpha,
    Beta_WITH:           bayes.WITH.beta,
    Alpha_AGAINST:       bayes.AGAINST.alpha,
    Beta_AGAINST:        bayes.AGAINST.beta,
    Alpha_SKIP:          bayes.SKIP.alpha,
    Beta_SKIP:           bayes.SKIP.beta,

    RecommendedAction:      rec.action,
    RecommendedForebetMode: rec.forebetMode,
    ConfidenceLowerBound:   (rec.lowerBound * 100).toFixed(2) + '%',

    LastUpdated:    isoNow_(),
    TrendDirection: trend,
    IsActive:       isActive
  };
}


function updateSegmentStats() {
  var cfg = _cfg_();
  log_('🧠 Updating Segment Stats...');

  var statsSheet = createSheetIfMissing_(cfg.SHEETS.SEGMENT_STATS, SCHEMA.SEGMENT_STATS);
  var perfRows = loadPerformanceLogAllShards_();
  if (!perfRows.length) { warn_('No performance data to analyze'); return; }

  // ── Normalize all keys to 8 parts before grouping ────────────────────────
  for (var i = 0; i < perfRows.length; i++) {
    if (perfRows[i].SegmentKey) {
      perfRows[i].SegmentKey = normalizeSegmentKey_(perfRows[i].SegmentKey);
    }
  }

  var groups = groupBySegmentKey_(perfRows);
  var headers = SCHEMA.SEGMENT_STATS;

  var rows = [];
  var keys = Object.keys(groups);
  for (var j = 0; j < keys.length; j++) {
    var k = keys[j];
    var stats = calculateSegmentStats_(k, groups[k], cfg);
    rows.push(headers.map(function(h) { return stats[h] !== undefined ? stats[h] : ''; }));
  }

  // Safe clear: only if there are data rows below the header
  var last = statsSheet.getLastRow();
  if (last > 1) {
    statsSheet.getRange(2, 1, last - 1, headers.length).clearContent();
  }

  if (rows.length) {
    statsSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    log_('✅ Updated ' + rows.length + ' segment rows');
  }
}

/* =========================
 * INSIGHTS (with % bug fixed)
 * ========================= */
function getAllSegmentStats_() {
  var cfg = _cfg_();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.SHEETS.SEGMENT_STATS);
  if (!sh || sh.getLastRow() < 2) return [];
  var data = sh.getDataRange().getValues();
  var headers = data[0].map(String);
  return data.slice(1).map(function(row) {
    var obj = {};
    for (var i = 0; i < headers.length; i++) obj[headers[i]] = row[i];
    // Normalize any stored 9-part keys back to 8
    if (obj.SegmentKey) obj.SegmentKey = normalizeSegmentKey_(obj.SegmentKey);
    return obj;
  });
}



/**
 * Canonicalizes any segment key to exactly 8 pipe-delimited parts.
 * Strips a 9th part (legacy ForebetAction), pads short keys with 'NA'.
 */
function normalizeSegmentKey_(key) {
  var parts = String(key || '').split('|').map(function(s) {
    var t = String(s || '').trim().toUpperCase();
    return (t && t !== 'UNKNOWN') ? t : 'NA';
  });
  // Truncate to 8, pad to 8
  parts = parts.slice(0, 8);
  while (parts.length < 8) parts.push('NA');
  return parts.join('|');
}



function parseBucketMin_(bucket) {
  const m = String(bucket).match(/(\d+)/);
  return m ? parseInt(m[1],10) : 50;
}
function parseBucketMax_(bucket) {
  const m = String(bucket).match(/\d+-(\d+)/);
  return m ? parseInt(m[1],10) : 100;
}

function generateHistoricalInsights() {
  const cfg = _cfg_();
  log_('💡 Generating Insights...');
  const stats = getAllSegmentStats_();
  if (!stats.length) { warn_('No segment stats available'); return []; }

  const insights = [];

  // High performers
  for (let i = 0; i < stats.length; i++) {
    const seg = stats[i];
    const wr = safeNum_(seg.WinRate_Lifetime, 0) / 100;
    const n = parseInt(seg.TotalBets, 10) || 0;
    if (wr >= cfg.HIGH_PERFORMER_THRESHOLD && n >= 20) {
      insights.push({
        type: 'HIGH_PERFORMER',
        segment: seg.SegmentKey,
        message: seg.League + ' ' + seg.BetType + ' ' + seg.SubType + ' @ ' + seg.ConfidenceBucket +
          ': ' + seg.WinRate_Lifetime + ' over ' + n + ' bets',
        metrics: { winRate: seg.WinRate_Lifetime, totalBets: n, roi: seg.TotalROI },
        priority: 'HIGH',
        recommendation: 'INCREASE_ALLOCATION'
      });
    }
  }

  // Underperformers
  for (let i = 0; i < stats.length; i++) {
    const seg = stats[i];
    const wr = safeNum_(seg.WinRate_Lifetime, 0) / 100;
    const l30 = safeNum_(seg.WinRate_L30, 0) / 100;
    const n = parseInt(seg.TotalBets, 10) || 0;
    if (n >= cfg.MIN_SAMPLE_SIZE && (wr < cfg.ALERT_WIN_RATE_THRESHOLD || l30 < 0.45)) {
      insights.push({
        type: 'UNDERPERFORMER',
        segment: seg.SegmentKey,
        message: seg.League + ' ' + seg.BetType + ' ' + seg.SubType + ' underperforming: ' + seg.WinRate_Lifetime,
        metrics: { winRate: seg.WinRate_Lifetime, l30: seg.WinRate_L30, roi: seg.TotalROI },
        priority: 'CRITICAL',
        recommendation: 'BLOCK'
      });
    }
  }

  // Confidence calibration
  const bucketAgg = {};
  for (let i = 0; i < stats.length; i++) {
    const b = stats[i].ConfidenceBucket;
    if (!b || b === 'NA') continue;
    if (!bucketAgg[b]) bucketAgg[b] = { wins: 0, total: 0 };
    bucketAgg[b].wins += parseInt(stats[i].Wins, 10) || 0;
    bucketAgg[b].total += parseInt(stats[i].TotalBets, 10) || 0;
  }
  const buckets = Object.keys(bucketAgg);
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i];
    const d = bucketAgg[bucket];
    if (d.total < 20) continue;
    const actual = d.wins / d.total;
    const min = parseBucketMin_(bucket) / 100;
    const max = parseBucketMax_(bucket) / 100;
    const mid = (min + max) / 2;
    if (actual < mid * 0.8) {
      insights.push({
        type: 'CALIBRATION_ISSUE',
        segment: 'Confidence Bucket: ' + bucket,
        message: bucket + ' bets winning at ' + (actual * 100).toFixed(1) + '% (expected ~' + (mid * 100).toFixed(0) + '%)',
        metrics: { actual: actual, expected: mid, sample: d.total },
        priority: 'MEDIUM',
        recommendation: 'REVIEW_CONFIDENCE_MODEL'
      });
    }
  }

  // Home/Away bias
  const sideAgg = { HOME: { wins: 0, total: 0 }, AWAY: { wins: 0, total: 0 } };
  for (let i = 0; i < stats.length; i++) {
    const side = stats[i].Side;
    if (side !== 'HOME' && side !== 'AWAY') continue;
    sideAgg[side].wins += parseInt(stats[i].Wins, 10) || 0;
    sideAgg[side].total += parseInt(stats[i].TotalBets, 10) || 0;
  }
  if (sideAgg.HOME.total >= 30 && sideAgg.AWAY.total >= 30) {
    const homeRate = sideAgg.HOME.wins / sideAgg.HOME.total;
    const awayRate = sideAgg.AWAY.wins / sideAgg.AWAY.total;
    if (Math.abs(homeRate - awayRate) > 0.1) {
      const better = homeRate > awayRate ? 'HOME' : 'AWAY';
      const betterPct = ((better === 'HOME' ? homeRate : awayRate) * 100).toFixed(1);
      const worsePct = ((better === 'HOME' ? awayRate : homeRate) * 100).toFixed(1);
      insights.push({
        type: 'HOME_AWAY_BIAS',
        segment: 'Overall',
        message: better + ' picks outperforming: ' + betterPct + '% vs ' + worsePct + '%',
        metrics: { homeRate: homeRate, awayRate: awayRate },
        priority: 'MEDIUM',
        recommendation: 'FAVOR_' + better + '_PICKS'
      });
    }
  }

  // ── NEW: Assayer-specific insights ───────────────────────────
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const norm = (s) => String(s || '').toLowerCase().trim().replace(/[\s\-]+/g, '_').replace(/[^\w]/g, '');
    const getSh = (name) => {
      try { return ss.getSheetByName(name); } catch (e) { return null; }
    };

    // Best-effort Assayer load
    let assayer = null;
    try {
      const cfg2 = (typeof _cfg_ === 'function') ? (_cfg_() || {}) : {};
      const dp = (() => { try { return PropertiesService.getDocumentProperties(); } catch (e) { return null; } })();
      const assayerSheetId =
        String(cfg2.assayer_sheet_id || cfg2.ASSAYER_SHEET_ID || (dp ? (dp.getProperty('ASSAYER_SHEET_ID') || dp.getProperty('assayer_sheet_id')) : '') || '').trim();

      const loadFn = (typeof loadAssayerData === 'function' && loadAssayerData) ||
                     (typeof loadAssayerData_ === 'function' && loadAssayerData_) || null;
      if (assayerSheetId && loadFn) assayer = loadFn(assayerSheetId);
    } catch (e) {}

    // A) Purity blocklist insight (from current Assayer purity sheet)
    if (assayer && (assayer.purity || assayer.ASSAYER_LEAGUE_PURITY)) {
      const purityRows = assayer.purity || assayer.ASSAYER_LEAGUE_PURITY || [];
      const blocked = {};
      for (const r of purityRows) {
        const grade = String(r.grade || '').toUpperCase();
        const status = String(r.status || '').toLowerCase();
        if (grade === 'CHARCOAL' && status.includes('avoid')) {
          const league = String(r.league || '').trim().toUpperCase();
          const source = String(r.source || '').trim();
          if (!league) continue;
          const k = league + '|' + source;
          blocked[k] = { league, source };
        }
      }
      const blockedList = Object.values(blocked);
      if (blockedList.length > 0) {
        insights.push({
          type: 'ASSAYER_PURITY_BLOCKLIST',
          segment: 'GLOBAL',
          message: `Assayer purity blocks ${blockedList.length} league+source combos (CHARCOAL + Avoid). Top: ` +
                   blockedList.slice(0, 8).map(x => `${x.league}(${x.source})`).join(', '),
          metrics: { blockedCombos: blockedList.length },
          priority: 'HIGH',
          recommendation: 'BLOCK'
        });
      }
    }

    // B) Edge/purity grade performance from Historical archive (if columns exist)
    //    We only compute if we can find outcome and assayer grade columns.
    const betsArchive =
      getSh('Historical_Bets_Archive') ||
      getSh('Historical_Bets') ||
      getSh('Bets_Archive') ||
      null;

    if (betsArchive && betsArchive.getLastRow() > 1) {
      const data = betsArchive.getDataRange().getValues();
      const headers = data[0].map(h => String(h || ''));
      const hmap = {};
      headers.forEach((h, i) => { const k = norm(h); if (k && hmap[k] === undefined) hmap[k] = i; });

      const idxOutcome =
        hmap['result'] ?? hmap['outcome'] ?? hmap['grade'] ?? hmap['status'] ?? null;

      const idxEdgeGrade =
        hmap['assayer_edge_grade'] ?? hmap['edge_grade'] ?? hmap['assayeredgegrade'] ?? null;

      const idxPurityGrade =
        hmap['assayer_purity_grade'] ?? hmap['purity_grade'] ?? hmap['assayerpuritygrade'] ?? null;

      if (idxOutcome !== null && (idxEdgeGrade !== null || idxPurityGrade !== null)) {
        const byEdge = {};
        const byPurity = {};
        const isWL = (s) => (s === 'WON' || s === 'LOST');

        const bump = (map, key, outcome) => {
          if (!key) key = 'UNKNOWN';
          if (!map[key]) map[key] = { won: 0, lost: 0 };
          if (outcome === 'WON') map[key].won++;
          if (outcome === 'LOST') map[key].lost++;
        };

        for (let r = 1; r < data.length; r++) {
          const row = data[r];
          const outcome = String(row[idxOutcome] || '').toUpperCase().trim();
          if (!isWL(outcome)) continue;

          if (idxEdgeGrade !== null) {
            const g = String(row[idxEdgeGrade] || '').toUpperCase().trim();
            bump(byEdge, g, outcome);
          }
          if (idxPurityGrade !== null) {
            const g = String(row[idxPurityGrade] || '').toUpperCase().trim();
            bump(byPurity, g, outcome);
          }
        }

        const fmtTop = (map) => {
          const rows = Object.keys(map).map(k => {
            const d = map[k];
            const n = d.won + d.lost;
            const wr = n > 0 ? (d.won / n) : 0;
            return { k, n, wr };
          }).filter(x => x.n >= 20).sort((a, b) => b.wr - a.wr).slice(0, 6);
          return rows.length
            ? rows.map(x => `${x.k}:${(x.wr * 100).toFixed(1)}% (n=${x.n})`).join(' | ')
            : '';
        };

        const edgeSummary = fmtTop(byEdge);
        if (edgeSummary) {
          insights.push({
            type: 'ASSAYER_EDGE_GRADE_PERFORMANCE',
            segment: 'ARCHIVE',
            message: 'Edge-grade win rates (archive, n≥20): ' + edgeSummary,
            metrics: {},
            priority: 'MEDIUM',
            recommendation: 'FAVOR_TOP_EDGE_GRADES'
          });
        }

        const puritySummary = fmtTop(byPurity);
        if (puritySummary) {
          insights.push({
            type: 'ASSAYER_PURITY_GRADE_PERFORMANCE',
            segment: 'ARCHIVE',
            message: 'Purity-grade win rates (archive, n≥20): ' + puritySummary,
            metrics: {},
            priority: 'MEDIUM',
            recommendation: 'FAVOR_TOP_PURITY_GRADES'
          });
        }
      }
    }
  } catch (e) {
    warn_('Assayer insights skipped: ' + e.message);
  }

  // Log insights
  logInsights_(insights);
  return insights;
}

function logInsights_(insights) {
  const cfg = _cfg_();
  if (!insights || !insights.length) return;
  const sh = createSheetIfMissing_(cfg.SHEETS.INSIGHTS_LOG, SCHEMA.INSIGHTS_LOG);

  const rows = insights.map((ins, i) => [
    'INS_' + Date.now() + '_' + i,
    isoNow_(),
    ins.type,
    ins.segment,
    ins.message,
    JSON.stringify(ins.metrics || {}),
    ins.recommendation || '',
    ins.priority || 'LOW'
  ]);

  sh.getRange(sh.getLastRow()+1, 1, rows.length, SCHEMA.INSIGHTS_LOG.length).setValues(rows);
  log_('💡 Logged ' + insights.length + ' insights');
}

function getRecentInsights(limit) {
  const cfg = _cfg_();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(cfg.SHEETS.INSIGHTS_LOG);
  if (!sh || sh.getLastRow() < 2) return [];
  const last = sh.getLastRow();
  const start = Math.max(2, last - (limit || 20) + 1);
  const num = last - start + 1;
  const data = sh.getRange(start,1,num,SCHEMA.INSIGHTS_LOG.length).getValues();
  const headers = SCHEMA.INSIGHTS_LOG;
  return data.map(row => {
    const o = {};
    for (let i=0;i<headers.length;i++) o[headers[i]] = row[i];
    return o;
  }).reverse();
}

/* =========================
 * POLICY OVERRIDES (optional, minimal)
 * ========================= */

function _loadActiveOverridesMap_() {
  const cfg = _cfg_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(cfg.SHEETS.POLICY_OVERRIDES);
  if (!sh || sh.getLastRow() < 2) return new Map();

  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);
  const idx = {};
  for (let i=0;i<headers.length;i++) idx[headers[i]] = i;

  const now = new Date();
  const map = new Map();

  for (let r=1;r<data.length;r++) {
    const row = data[r];
    const isActive = String(row[idx.IsActive] || '').toUpperCase() === 'YES';
    if (!isActive) continue;

    const segKey = String(row[idx.SegmentKey] || '').trim();
    if (!segKey) continue;

    const expiry = row[idx.ExpiryDate];
    if (expiry) {
      const exp = new Date(expiry);
      if (!isNaN(exp.getTime()) && exp.getTime() < now.getTime()) continue;
    }

    map.set(segKey, {
      OverrideAction: String(row[idx.OverrideAction] || '').toUpperCase().trim(),
      OverrideMode: String(row[idx.OverrideMode] || '').toUpperCase().trim(),
      Reason: String(row[idx.Reason] || '').trim()
    });
  }

  return map;
}

/* =========================
 * POLICY ENGINE (batch stats + forebet-mode consistency)
 * ========================= */

function statsToPolicy_(stats, usedKey) {
  return {
    action: stats.RecommendedAction || 'CAUTION',
    forebetMode: stats.RecommendedForebetMode || 'WITH',
    confidence: stats.IsActive === 'YES' ? 'HIGH' : 'MEDIUM',
    winRate: stats.WinRate_Lifetime,
    trend: stats.TrendDirection,
    lowerBound: stats.ConfidenceLowerBound,
    reason: usedKey + ': ' + stats.WinRate_Lifetime + ' over ' + stats.TotalBets + ' bets'
  };
}



function getDefaultPolicy_(bet) {
  // RiskTier (new rows) — check first, overrides legacy type
  const rt = String(bet?.RiskTier || bet?.riskTier || bet?.risk_tier || bet?.['Risk Tier'] || '')
    .trim().toUpperCase();

  // Legacy type/betType (archive rows) — fallback
  const t = String(bet?.type || bet?.Type || bet?.betType || '')
    .trim().toUpperCase();

  // Guard against "NOT RISKY" on both fields
  const isRisky =
    (rt.includes('RISKY') && !rt.includes('NOT RISKY')) ||
    (t.includes('RISKY')  && !t.includes('NOT RISKY'));

  return {
    action:      isRisky ? 'BLOCK' : 'CAUTION',
    forebetMode: 'WITH',
    confidence:  'LOW',
    reason:      'Insufficient historical data'
  };
}

/**
 * Key improvement vs earlier versions:
 * - SegmentStats recommends which forebetMode is best (WITH/AGAINST/SKIP).
 * - If a bet’s ForebetAction does NOT match the recommended mode, we downgrade:
 *   BET -> CAUTION (or BLOCK if recommended mode is SKIP).
 */
function _applyForebetModeConsistency_(policy, bet) {
  const betAct = String(bet.forebetAction || bet.ForebetAction || '').toUpperCase().trim();

  // If segment recommends SKIP, always block
  if (policy.forebetMode === 'SKIP') {
    policy.action = 'BLOCK';
    policy.reason += ' | segment says SKIP';
    return policy;
  }

  // Week-test: tolerate missing ForebetAction
  if (!betAct || betAct === 'NA') {
    if (false) {
      policy.reason += ' | ForebetAction missing (week-test: tolerated)';
      return policy;
    }
    // Strict mode: downgrade BET to CAUTION
    if (policy.action === 'BET') {
      policy.action = 'CAUTION';
      policy.reason += ' | missing ForebetAction => downgraded';
    }
    return policy;
  }

  // Mismatch: downgrade BET -> CAUTION
  if (betAct !== policy.forebetMode) {
    if (policy.action === 'BET') policy.action = 'CAUTION';
    policy.reason += ' | forebet mismatch (' + betAct + ' vs ' + policy.forebetMode + ')';
  }

  return policy;
}

function filterBetsWithPolicy(bets) {
  const cfg = _cfg_();
  log_('🔍 Filtering bets with policy...');

  const stats = getAllSegmentStats_();
  const statsMap = new Map(stats.map(s => [s.SegmentKey, s]));
  const overridesMap = _loadActiveOverridesMap_();

  // Phase 2 patch: Assayer cache (optional)
  let assayer = null;
  try { assayer = _getAssayerDataCached_(); } catch (e) { assayer = null; }

  const allowed = [];
  const blocked = [];
  const cautioned = [];

  for (let i = 0; i < (bets || []).length; i++) {
    const bet = bets[i];
    const segKey = generateSegmentKey_(bet);

    // 1) Manual override (exact; then parent chain)
    let override = overridesMap.get(segKey);
    let usedKey = segKey;

    if (!override) {
      let p = getParentSegmentKey_(segKey);
      while (p) {
        override = overridesMap.get(p);
        if (override) { usedKey = p; break; }
        p = getParentSegmentKey_(p);
      }
    }

    let usedManualOverride = false;

    if (override) {
      usedManualOverride = true;
      const pol = {
        action: override.OverrideAction || 'CAUTION',
        forebetMode: override.OverrideMode || 'WITH',
        confidence: 'MANUAL',
        reason: 'OVERRIDE(' + usedKey + '): ' + (override.Reason || 'manual override')
      };
      bet._policy = _applyForebetModeConsistency_(pol, bet);
    } else {
      // 2) Segment stats (exact then parent)
      let st = statsMap.get(segKey);
      usedKey = segKey;

      if (!st || st.IsActive !== 'YES') {
        let p = getParentSegmentKey_(segKey);
        while (p) {
          const ps = statsMap.get(p);
          if (ps && ps.IsActive === 'YES') { st = ps; usedKey = p; break; }
          p = getParentSegmentKey_(p);
        }
      }

      const pol = st ? statsToPolicy_(st, usedKey) : getDefaultPolicy_(bet);
      bet._policy = _applyForebetModeConsistency_(pol, bet);
    }

    // Phase 2 patch: Assayer policy signals (purity routing + edge-grade avoidance)
    // - Manual override wins (no surprise behavior).
    // - Without override: apply contract purity routing.
    // - Additionally: block bets whose BEST matched edge is CHARCOAL (avoid negative edges).
    try {
      if (!usedManualOverride && assayer) {
        const ann = assayerAnnotateBetForMother_(bet, assayer);
        bet._assayer = ann;

        // (A) Purity routing (contract)
        if (ann && ann.purity && ann.purity.motherAction) {
          const act = String(ann.purity.motherAction || '').toUpperCase();
          if (act === 'BLOCK') {
            bet._policy = {
              ...bet._policy,
              action: 'BLOCK',
              reason: 'ASSAYER_PURITY BLOCK: ' + (ann.purity.status || ann.purity.grade || 'CHARCOAL')
            };
          } else if (act === 'SUPPRESS' || act === 'CAUTION') {
            bet._policy = {
              ...bet._policy,
              action: 'CAUTION',
              reason: 'ASSAYER_PURITY ' + act + ': ' + (ann.purity.status || ann.purity.grade || '')
            };
          }
        }

        // (B) Edge-grade routing (requested: “Block CHARCOAL”)
        if (bet._policy.action !== 'BLOCK' && ann && ann.bestEdge) {
          const g = String(ann.bestEdge.grade || '').toUpperCase();
          if (g === 'CHARCOAL') {
            bet._policy = {
              ...bet._policy,
              action: 'BLOCK',
              reason: 'ASSAYER_EDGE BLOCK: CHARCOAL (' + (ann.bestEdge.edge_id || ann.bestEdge.edgeId || '') + ')'
            };
          } else if (g === 'ROCK') {
            bet._policy = {
              ...bet._policy,
              action: 'CAUTION',
              reason: 'ASSAYER_EDGE CAUTION: ROCK (' + (ann.bestEdge.edge_id || ann.bestEdge.edgeId || '') + ')'
            };
          }
        }
      }
    } catch (e) {
      // Neutral on errors
    }

    // route
    const action = bet._policy.action;
    if (action === 'BLOCK') blocked.push({ bet: bet, reason: bet._policy.reason });
    else {
      if (action === 'CAUTION') cautioned.push(bet);
      allowed.push(bet);
    }
  }

  log_('✅ Filter: ' + allowed.length + ' allowed, ' + cautioned.length + ' cautioned, ' + blocked.length + ' blocked');
  return { allowed: allowed, blocked: blocked, cautioned: cautioned };
}

/* =========================
 * MIC INTEGRATION (mothership-only)
 * ========================= */

function initializeMIC() {
  const cfg = _cfg_();
  log_('🚀 Initializing MIC...');

  try {
    createSheetIfMissing_(cfg.SHEETS.BETS_ARCHIVE, SCHEMA.BETS_ARCHIVE);
    createSheetIfMissing_(cfg.SHEETS.RESULTS_ARCHIVE, SCHEMA.RESULTS_ARCHIVE);
    createSheetIfMissing_(cfg.SHEETS.PERFORMANCE_LOG, SCHEMA.PERFORMANCE_LOG);
    createSheetIfMissing_(cfg.SHEETS.SEGMENT_STATS, SCHEMA.SEGMENT_STATS);
    createSheetIfMissing_(cfg.SHEETS.INSIGHTS_LOG, SCHEMA.INSIGHTS_LOG);

    // optional but included (small)
    createSheetIfMissing_(cfg.SHEETS.POLICY_OVERRIDES, SCHEMA.POLICY_OVERRIDES);

    // upgrade logs
    createSheetIfMissing_(cfg.SHEETS.SHADOW_BACKTEST_LOG, SCHEMA.SHADOW_BACKTEST_LOG);
    createSheetIfMissing_(cfg.SHEETS.TUNING_LOG, SCHEMA.TUNING_LOG);

    log_('✅ MIC Initialization Complete');
    return true;
  } catch (e) {
    err_('MIC Initialization Failed: ' + e.message);
    return false;
  }
}


/**
 * ONE-TIME MIGRATION — Run after deploying RiskTier change.
 * Safe to run repeatedly (idempotent).
 * Upgrades all MIC sheets + any shards named "BaseName_*".
 */
function upgradeMICSchemas_() {
  var cfg = _cfg_();
  var ss  = SpreadsheetApp.getActiveSpreadsheet();

  // Schemas that have shards (e.g., BETS_ARCHIVE_2025_01)
  var SHARD_SCHEMAS = [
    [cfg.SHEETS.BETS_ARCHIVE,    SCHEMA.BETS_ARCHIVE],
    [cfg.SHEETS.RESULTS_ARCHIVE, SCHEMA.RESULTS_ARCHIVE]
  ];

  // Schemas without shards
  var SINGLE_SCHEMAS = [
    [cfg.SHEETS.PERFORMANCE_LOG,     SCHEMA.PERFORMANCE_LOG],
    [cfg.SHEETS.SEGMENT_STATS,       SCHEMA.SEGMENT_STATS],
    [cfg.SHEETS.INSIGHTS_LOG,        SCHEMA.INSIGHTS_LOG],
    [cfg.SHEETS.POLICY_OVERRIDES,    SCHEMA.POLICY_OVERRIDES],
    [cfg.SHEETS.SHADOW_BACKTEST_LOG, SCHEMA.SHADOW_BACKTEST_LOG],
    [cfg.SHEETS.TUNING_LOG,          SCHEMA.TUNING_LOG]
  ];

  SINGLE_SCHEMAS.forEach(function(pair) {
    createSheetIfMissing_(pair[0], pair[1]);
  });

  SHARD_SCHEMAS.forEach(function(pair) {
    createSheetIfMissing_(pair[0], pair[1]);
    _upgradeShardFamily_(ss, pair[0], pair[1]);
  });

  log_('✅ MIC schema migration complete (all sheets + shards).');
}


/**
 * Finds all sheets named "baseName_*" and ensures their headers
 * contain all schema columns.
 */
function _upgradeShardFamily_(ss, baseName, schema) {
  var prefix = baseName + '_';
  var sheets = ss.getSheets();

  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name === baseName || name.indexOf(prefix) === 0) {
      var result = ensureSchemaColumns_(sheets[i], schema);
      if (result.added.length > 0) {
        log_('🔧 Shard "' + name + '": added [' + result.added.join(', ') + ']');
      }
    }
  }
}

function syncWithHistoricalArchive() {
  const cfg = _cfg_();
  log_('📥 Syncing bets → archive... (DEBUG ENABLED)');

  // Quick “version check” to ensure the correct parseHomeAwayFlag_ is the one executing
  try {
    const testPickH = 'Q1: H +3.0 ★';
    const testPickA = 'Q4: A +4.5 ●';
    log_('🧪 VersionCheck parseHomeAwayFlag_("' + testPickH + '") => ' + parseHomeAwayFlag_(testPickH, 'Team1 vs Team2'));
    log_('🧪 VersionCheck parseHomeAwayFlag_("' + testPickA + '") => ' + parseHomeAwayFlag_(testPickA, 'Team1 vs Team2'));
  } catch (e) {
    warn_('VersionCheck failed: ' + e.message);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const syncSheet = ss.getSheetByName('Sync_Temp');

  if (!syncSheet || syncSheet.getLastRow() < 2) {
    warn_('No data in Sync_Temp');
    return { bets: { appended:0, duplicates:0, errors:0 } };
  }

  const bets = sheetToObjects_(syncSheet);
  log_('📌 Sync_Temp rows loaded: ' + bets.length);

  // 🔎 Preview mapping for first N rows (even if duplicates will prevent append)
  const previewN = Math.min(12, bets.length);
  log_('🔎 Previewing first ' + previewN + ' Sync_Temp rows → what enrichment WOULD produce:');

  for (let i = 0; i < previewN; i++) {
    const bet = bets[i];
    const betID = generateBetID_(bet);

    const match = bet.match || bet.Match || '';
    const pick  = bet.pick  || bet.Pick  || '';
    const league = bet.league || bet.League || '';

    const dateFields = [
      'matchDate=' + (bet.matchDate || ''),
      'MatchDate=' + (bet.MatchDate || ''),
      'date=' + (bet.date || ''),
      'Date=' + (bet.Date || '')
    ].join(' | ');

    const enriched = enrichBetForArchive_(bet, betID);

    // detect whether sport came from Config map or fallback
    let sportSource = 'HEURISTIC';
    try {
      const map = _loadLeagueSportMapFromConfig_();
      const key = String(league || '').toUpperCase().trim();
      if (key && map.has(key)) sportSource = 'CONFIG';
    } catch (e) {}

    log_(
      '  #' + (i+1) +
      ' | League=' + league +
      ' | Match="' + match + '"' +
      ' | Pick="' + pick + '"' +
      ' | [' + dateFields + ']' +
      ' | BetID=' + betID +
      ' | -> MatchDate=' + enriched.MatchDate +
      ' | HomeAwayFlag=' + enriched.HomeAwayFlag +
      ' | Sport=' + enriched.Sport + '(' + sportSource + ')' +
      ' | SegmentKey=' + enriched.SegmentKey
    );
  }

  // Now append (may be all duplicates, but at least you got the preview logs above)
  const res = appendBetsToArchive(bets, { debug: true, debugLimit: 20 });

  log_('📊 Bets archived: ' + res.appended + ' new, ' + res.duplicates + ' dup, ' + res.errors + ' errors');

  // IMPORTANT: if everything is duplicate, remind you why the archive still looks “wrong”
  if (res.appended === 0 && res.duplicates > 0) {
    warn_(
      'All rows were duplicates. Archive is append-only, so old NA/NEUTRAL/UNKNOWN values will remain ' +
      'until you run the repair function (see: repairHistoricalBetsArchive()).'
    );
  }

  return { bets: res };
}

function syncResultsWithHistoricalArchive() {
  const cfg = _cfg_();
  log_('📥 Syncing results → archive...');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultsSheet = ss.getSheetByName('Results_Temp');

  if (!resultsSheet || resultsSheet.getLastRow() < 2) {
    warn_('No data in Results_Temp');
    return { results: { appended: 0, duplicates: 0, errors: 0 } };
  }

  const results = sheetToObjects_(resultsSheet);
  
  // Preview first few to verify matchString is working
  const previewN = Math.min(5, results.length);
  log_('🔎 Preview of Results_Temp → Archive mapping:');
  
  for (let i = 0; i < previewN; i++) {
    const r = results[i];
    const match = matchString(r);
    const league = r.league || r.League || '';
    const date = formatDateForID_(r.date || r.Date || '');
    const resultID = generateResultID_(r);
    
    log_(
      '  #' + (i + 1) +
      ' | League=' + league +
      ' | Date=' + date +
      ' | Match="' + match + '"' +
      ' | ResultID=' + resultID
    );
  }
  
  const res = appendResultsToArchive(results);

  log_('📊 Results archived: ' + res.appended + ' new, ' + res.duplicates + ' dup, ' + res.errors + ' errors');
  return { results: res };
}

function analyzeWithHistoricalTracking(gradedBets) {
  log_('📊 Analyzing with historical tracking...');

  const hasInput = Array.isArray(gradedBets) && gradedBets.length > 0;
  log_('🧾 analyzeWithHistoricalTracking input bets: ' + (hasInput ? gradedBets.length : 0));

  // IMPORTANT: Bet_Performance fallback is unreliable unless normalized.
  if (!hasInput) {
    warn_('No gradedBets provided. Skipping Bet_Performance fallback (schema mismatch). Running grader instead...');
    const gradeRes = gradeAndPopulatePerformanceLog(); // logs a lot
    log_('🧾 gradeAndPopulatePerformanceLog() returned: ' + JSON.stringify(gradeRes));

    // After grading, stats/insights rely on performance log
    updateSegmentStats();
    const insights = generateHistoricalInsights();

    log_('✅ Analysis complete (grader path): logged=' + (gradeRes.logged || 0) + ', insights=' + insights.length);
    return { logged: gradeRes.logged || 0, duplicates: gradeRes.alreadyLogged || 0, insights: insights.length };
  }

  // If you DO pass gradedBets, ensure they look sane
  const previewN = Math.min(5, gradedBets.length);
  log_('🔍 Preview graded input rows:');
  for (let i = 0; i < previewN; i++) {
    const b = gradedBets[i] || {};
    log_(
      '  #' + (i+1) +
      ' | BetID=' + (b.BetID || b.betID || 'NA') +
      ' | League=' + (b.League || b.league || 'NA') +
      ' | Match="' + (b.Match || b.match || '') + '"' +
      ' | Pick="' + (b.Pick || b.pick || '') + '"' +
      ' | Result=' + (b.Result || b.result || b.grade || 'NA')
    );
  }

  const logRes = appendToPerformanceLog(gradedBets);
  log_('✅ appendToPerformanceLog returned: ' + JSON.stringify(logRes));

  updateSegmentStats();
  const insights = generateHistoricalInsights();
  log_('✅ Analysis complete: ' + logRes.appended + ' logged, ' + insights.length + ' insights');
  return { logged: logRes.appended, duplicates: logRes.duplicates, insights: insights.length };
}

function previewSegmentStats() {
  const stats = getAllSegmentStats_();
  log_('📊 Segment Stats Preview (' + stats.length + ' segments):');
  
  const preview = Math.min(5, stats.length);
  for (let i = 0; i < preview; i++) {
    const s = stats[i];
    log_(
      '  #' + (i+1) + 
      ': ' + s.SegmentKey + 
      ' | WR=' + s.WinRate_Lifetime +
      ' | Bets=' + s.TotalBets +
      ' | Action=' + s.RecommendedAction +
      ' | Mode=' + s.RecommendedForebetMode
    );
  }
  
  return stats;
}

function runMICPipeline() {
  log_('═══════════════════════════════════════════');
  log_('🧠 MIC PIPELINE');
  log_('═══════════════════════════════════════════');

  const start = Date.now();
  const out = {};

  // Phase 2 patch: warm Assayer cache (neutral if not configured)
  try {
    const a = _getAssayerDataCached_();
    if (a && (a.edges || a.purity)) {
      log_('🧪 Assayer ready: ' +
           (a.edges ? (a.edges.length + ' edges') : 'no edges') + ', ' +
           (a.purity ? (a.purity.length + ' purity rows') : 'no purity'));
    } else {
      log_('🧪 Assayer not available (neutral)');
    }
  } catch (e) {
    log_('🧪 Assayer warm-load failed (neutral): ' + e.message);
  }

  out.betsArchive = syncWithHistoricalArchive();
  out.resultsArchive = syncResultsWithHistoricalArchive();
  out.analysis = analyzeWithHistoricalTracking();
  out.insights = getRecentInsights(10);

  log_('✅ MIC PIPELINE COMPLETE in ' + ((Date.now() - start) / 1000).toFixed(2) + 's');
  return out;
}

/* =========================
 * SHADOW BACKTEST (online, no look-ahead)
 * ========================= */

// Parse yyyymmdd from BetID to ms
function betIDToTimeMs_(betID) {
  const parts = String(betID || '').split('|');
  if (parts.length < 2) return 0;
  const ymd = parts[1];
  if (!/^\d{8}$/.test(ymd)) return 0;
  const y = parseInt(ymd.slice(0,4),10);
  const m = parseInt(ymd.slice(4,6),10)-1;
  const d = parseInt(ymd.slice(6,8),10);
  const dt = new Date(y,m,d);
  const t = dt.getTime();
  return isNaN(t) ? 0 : t;
}

// Apply exponential decay to all arms at once (per segment)
function _decayArms_(state, newTimeMs, cfg) {
  if (!state.lastTimeMs) { state.lastTimeMs = newTimeMs; return; }
  const dtDays = (newTimeMs - state.lastTimeMs) / (1000*60*60*24);
  if (dtDays <= 0) return;

  const ln2 = Math.log(2);
  const halfLife = cfg.RECENCY_DECAY_HALFLIFE_DAYS;
  const factor = Math.exp(-ln2 * dtDays / halfLife);

  // keep priors anchored
  function decayParam_(p) {
    p.alpha = cfg.PRIOR_ALPHA + (p.alpha - cfg.PRIOR_ALPHA) * factor;
    p.beta  = cfg.PRIOR_BETA  + (p.beta  - cfg.PRIOR_BETA ) * factor;
  }
  decayParam_(state.WITH);
  decayParam_(state.AGAINST);
  decayParam_(state.SKIP);

  state.lastTimeMs = newTimeMs;
}

// Deterministic (no RNG) policy for backtest: choose best arm by posterior mean
function _deterministicPolicyFromState_(state, sampleSize, cfg) {
  const means = {
    WITH: state.WITH.alpha / (state.WITH.alpha + state.WITH.beta),
    AGAINST: state.AGAINST.alpha / (state.AGAINST.alpha + state.AGAINST.beta),
    SKIP: state.SKIP.alpha / (state.SKIP.alpha + state.SKIP.beta)
  };

  let mode = 'WITH';
  let best = means.WITH;
  if (means.AGAINST > best) { best = means.AGAINST; mode = 'AGAINST'; }
  if (means.SKIP > best) mode = 'SKIP';

  const chosen = state[mode];
  const lb = bayesianLowerBound_(chosen.alpha, chosen.beta, cfg.LOWER_BOUND_ONE_SIDED_CONFIDENCE);

  if (mode === 'SKIP') return { action:'BLOCK', mode:'SKIP', lowerBound:lb, mean:best };

  if (sampleSize >= cfg.MIN_SAMPLE_SIZE) {
    if (best < cfg.ALERT_WIN_RATE_THRESHOLD) return { action:'BLOCK', mode:mode, lowerBound:lb, mean:best };
    if (best < cfg.CAUTION_MEAN_THRESHOLD) return { action:'CAUTION', mode:mode, lowerBound:lb, mean:best };
    return { action:'BET', mode:mode, lowerBound:lb, mean:best };
  }

  if (lb >= cfg.EARLY_BET_LOWER_BOUND) return { action:'BET', mode:mode, lowerBound:lb, mean:best };
  if (lb <= cfg.EARLY_BLOCK_LOWER_BOUND) return { action:'BLOCK', mode:mode, lowerBound:lb, mean:best };
  return { action:'CAUTION', mode:mode, lowerBound:lb, mean:best };
}

function runShadowBacktest(options) {
  const cfgBase = _cfg_();
  const cfg = options && options.paramsOverride ? _deepMerge_(cfgBase, options.paramsOverride) : cfgBase;

  const maxEvents = (options && options.maxEvents) || cfg.BACKTEST.MAX_EVENTS;
  const strict = (options && typeof options.strictLearning === 'boolean') ? options.strictLearning : cfg.BACKTEST.STRICT_LEARNING;
  const cautionAsBet = (options && typeof options.treatCautionAsBet === 'boolean') ? options.treatCautionAsBet : cfg.BACKTEST.TREAT_CAUTION_AS_BET;

  const perf = loadPerformanceLogAllShards_()
    .filter(r => r.WinLossFlag === 0 || r.WinLossFlag === 1);

  if (!perf.length) {
    warn_('Shadow backtest: no graded rows available');
    return null;
  }

  // Use last N, but keep chronological order within that window
  perf.sort((a,b)=>{
    const ta = betIDToTimeMs_(a.BetID) || parseTimestampMs_(a.GradedTimestamp);
    const tb = betIDToTimeMs_(b.BetID) || parseTimestampMs_(b.GradedTimestamp);
    return ta - tb;
  });
  const window = perf.slice(Math.max(0, perf.length - maxEvents));

  // Online simulation state per segment
  const segState = new Map();

  let roiIfBetAll = 0;
  let roiIfPolicy = 0;
  let placedBET = 0, placedCAUTION = 0, blocked = 0;

  for (let i=0;i<window.length;i++) {
    const row = window[i];
    const segKey = row.SegmentKey || 'UNKNOWN';
    const t = betIDToTimeMs_(row.BetID) || parseTimestampMs_(row.GradedTimestamp) || Date.now();

    // get / init state
    let st = segState.get(segKey);
    if (!st) {
      st = {
        lastTimeMs: 0,
        totalSeen: 0,
        WITH: { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA },
        AGAINST: { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA },
        SKIP: { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA }
      };
      segState.set(segKey, st);
    }

    // decay to current time
    _decayArms_(st, t, cfg);

    // decide policy BEFORE seeing outcome
    const pol = _deterministicPolicyFromState_(st, st.totalSeen, cfg);

    // enforce forebet-mode consistency (same as live system)
    const betAct = String(row.ForebetAction || 'NA').toUpperCase();
    let finalAction = pol.action;
    if (pol.mode === 'SKIP') finalAction = 'BLOCK';
    else if (!betAct || betAct === 'NA') {
      if (finalAction === 'BET') finalAction = 'CAUTION';
    } else if (betAct !== pol.mode) {
      if (finalAction === 'BET') finalAction = 'CAUTION';
    }

    // baseline: bet all
    roiIfBetAll += safeNum_(row.ROI_Contribution, 0);

    // policy result
    const wouldPlace = (finalAction === 'BET') || (cautionAsBet && finalAction === 'CAUTION');
    if (wouldPlace) {
      roiIfPolicy += safeNum_(row.ROI_Contribution, 0);
      if (finalAction === 'BET') placedBET++;
      else placedCAUTION++;
    } else {
      blocked++;
    }

    // update learning (strict = only if would have placed)
    if (!strict || wouldPlace) {
      const arm = (betAct === 'WITH' || betAct === 'AGAINST' || betAct === 'SKIP') ? betAct : 'WITH';
      if (row.WinLossFlag === 1) st[arm].alpha += 1;
      else if (row.WinLossFlag === 0) st[arm].beta += 1;
      st.totalSeen += 1;
    }
  }

  const eventsUsed = window.length;
  const placedTotal = placedBET + placedCAUTION;
  const coverage = eventsUsed ? placedTotal / eventsUsed : 0;
  const avgROI = placedTotal ? roiIfPolicy / placedTotal : 0;

  return {
    eventsUsed: eventsUsed,
    placedBET: placedBET,
    placedCAUTION: placedCAUTION,
    blocked: blocked,
    coverage: coverage,
    roiIfBetAll: roiIfBetAll,
    roiIfFollowPolicy: roiIfPolicy,
    avgROIIfFollowPolicy: avgROI,
    cfgUsed: cfg
  };
}


function logShadowBacktest_(resultObj) {
  if (!resultObj) return;
  var cfg = _cfg_();
  var sh  = createSheetIfMissing_(cfg.SHEETS.SHADOW_BACKTEST_LOG, SCHEMA.SHADOW_BACKTEST_LOG);

  var entry = {
    RunID:                  'SB_' + Date.now(),
    Timestamp:              isoNow_(),
    EventsUsed:             resultObj.eventsUsed,
    Placed_BET:             resultObj.placedBET,
    Placed_CAUTION:         resultObj.placedCAUTION,
    Blocked:                resultObj.blocked,
    Coverage:               resultObj.coverage,
    ROI_IfBetAll:           resultObj.roiIfBetAll,
    ROI_IfFollowPolicy:     resultObj.roiIfFollowPolicy,
    AvgROI_IfFollowPolicy:  resultObj.avgROIIfFollowPolicy,
    ConfigUsed:             JSON.stringify({
      RECENCY_DECAY_HALFLIFE_DAYS: resultObj.cfgUsed.RECENCY_DECAY_HALFLIFE_DAYS,
      EARLY_BET_LOWER_BOUND:      resultObj.cfgUsed.EARLY_BET_LOWER_BOUND,
      EARLY_BLOCK_LOWER_BOUND:    resultObj.cfgUsed.EARLY_BLOCK_LOWER_BOUND,
      CAUTION_MEAN_THRESHOLD:     resultObj.cfgUsed.CAUTION_MEAN_THRESHOLD,
      ALERT_WIN_RATE_THRESHOLD:   resultObj.cfgUsed.ALERT_WIN_RATE_THRESHOLD,
      MIN_SAMPLE_SIZE:            resultObj.cfgUsed.MIN_SAMPLE_SIZE
    })
  };

  appendByHeaders_(sh, [entry]);
  log_('🧪 Logged Shadow Backtest: ' + entry.RunID);
}



function logTuningRun_(baseline, best, bestOverrides, apply) {
  var cfg = _cfg_();
  var sh  = createSheetIfMissing_(cfg.SHEETS.TUNING_LOG, SCHEMA.TUNING_LOG);

  var entry = {
    TuningID:                 'TUNE_' + Date.now(),
    Timestamp:                isoNow_(),
    EventsUsed:               baseline.eventsUsed,
    Baseline_AvgROI:          baseline.avgROIIfFollowPolicy,
    Baseline_Coverage:        baseline.coverage,
    Best_AvgROI:              best ? best.avgROIIfFollowPolicy : '',
    Best_Coverage:            best ? best.coverage : '',
    RecommendedOverridesJSON: JSON.stringify(bestOverrides || {}),
    Applied:                  (apply && bestOverrides) ? 'YES' : 'NO'
  };

  appendByHeaders_(sh, [entry]);
}



function _createSyncTempSheet_(ss) {
  var sheet = ss.getSheetByName('Sync_Temp');
  if (!sheet) {
    sheet = ss.insertSheet('Sync_Temp', 1);
  }
  sheet.clear();

  _stampCanonicalHeaders_(sheet, SCHEMA.SYNC_TEMP);

  // Override styling to match original orange theme
  sheet.getRange(1, 1, 1, SCHEMA.SYNC_TEMP.length)
    .setBackground('#ff9900')
    .setFontColor('#ffffff');

  sheet.getRange('A2').setValue('⏳ Run "Sync All Leagues" to populate this sheet');
  sheet.getRange('A2:H2').merge().setFontColor('#999999').setFontStyle('italic');
  sheet.autoResizeColumns(1, SCHEMA.SYNC_TEMP.length);

  Logger.log('[Genesis] Sync_Temp sheet created');
}



/* =========================
 * AUTO-THRESHOLD TUNER (grid search)
 * ========================= */

function autoTuneMIC(options) {
  const cfg = _cfg_();
  if (!cfg.TUNING || cfg.TUNING.ENABLED !== true) {
    warn_('Auto-tune disabled');
    return null;
  }

  const apply = options && options.apply === true;
  const maxEvents = (options && options.maxEvents) || cfg.BACKTEST.MAX_EVENTS;
  const minCoverage = (options && options.minCoverage) || cfg.BACKTEST.MIN_COVERAGE;

  // Baseline (current cfg)
  const baseline = runShadowBacktest({ maxEvents: maxEvents });
  if (!baseline) return null;

  let best = null;
  let bestOverrides = null;

  const cEB = cfg.TUNING.CANDIDATE_EARLY_BET_LB || [];
  const cBL = cfg.TUNING.CANDIDATE_EARLY_BLOCK_LB || [];
  const cHL = cfg.TUNING.CANDIDATE_HALFLIFE_DAYS || [];
  const cCM = cfg.TUNING.CANDIDATE_CAUTION_MEAN || [];

  // score = avgROI if coverage meets constraint, else -Inf
  function score_(res) {
    if (!res) return -1e99;
    if (res.coverage < minCoverage) return -1e99;
    // prefer higher avg ROI; slight preference for higher coverage
    return res.avgROIIfFollowPolicy + 0.01 * res.coverage;
  }

  for (let i=0;i<cEB.length;i++) {
    for (let j=0;j<cBL.length;j++) {
      for (let k=0;k<cHL.length;k++) {
        for (let m=0;m<cCM.length;m++) {
          const overrides = {
            EARLY_BET_LOWER_BOUND: cEB[i],
            EARLY_BLOCK_LOWER_BOUND: cBL[j],
            RECENCY_DECAY_HALFLIFE_DAYS: cHL[k],
            CAUTION_MEAN_THRESHOLD: cCM[m]
          };

          // sanity: early bet LB should be > early block LB
          if (overrides.EARLY_BET_LOWER_BOUND <= overrides.EARLY_BLOCK_LOWER_BOUND) continue;

          const res = runShadowBacktest({
            maxEvents: maxEvents,
            paramsOverride: overrides
          });

          if (!res) continue;

          if (!best || score_(res) > score_(best)) {
            best = res;
            bestOverrides = overrides;
          }
        }
      }
    }
  }

  const tuningId = 'TUNE_' + Date.now();
  const sh = createSheetIfMissing_(cfg.SHEETS.TUNING_LOG, SCHEMA.TUNING_LOG);

  const applied = (apply && bestOverrides) ? 'YES' : 'NO';
  const row = [
    tuningId,
    isoNow_(),
    baseline.eventsUsed,
    baseline.avgROIIfFollowPolicy,
    baseline.coverage,
    best ? best.avgROIIfFollowPolicy : '',
    best ? best.coverage : '',
    JSON.stringify(bestOverrides || {}),
    applied
  ];
  sh.getRange(sh.getLastRow()+1,1,1,SCHEMA.TUNING_LOG.length).setValues([row]);

  log_('🧠 Tuning complete: ' + tuningId +
       ' | baseline avgROI=' + baseline.avgROIIfFollowPolicy.toFixed(4) +
       ' | best avgROI=' + (best ? best.avgROIIfFollowPolicy.toFixed(4) : 'N/A'));

  if (apply && bestOverrides) {
    // Store as runtime overrides so system adapts without code edits
    setMICRuntimeOverrides(bestOverrides);
    log_('✅ Applied tuned overrides to ScriptProperties');
  } else {
    log_('ℹ️ Recommended overrides (not applied): ' + JSON.stringify(bestOverrides || {}));
  }

  // also log backtest summary for best
  if (best) logShadowBacktest_(best);

  return {
    tuningId: tuningId,
    baseline: baseline,
    best: best,
    recommendedOverrides: bestOverrides,
    applied: applied
  };
}

function generateResultKeyNoScoreFromBetID_(betID) {
  const parts = String(betID || '').split('|');
  // BetID format: LEAGUE|YYYYMMDD|MATCH|TYPE|PICK
  if (parts.length < 3) return 'NA|NA|NA';
  return [parts[0], parts[1], parts[2]].join('|');
}

/* =========================
 * OPTIONAL: PERFORMANCE LOG MIGRATION HELPER
 * (If you previously stored score-inclusive ResultIDs in PERFORMANCE_LOG and want
 * stability + dedupe going forward, run once.)
 * ========================= */

function migratePerformanceLogToScorelessResultKey() {
  const cfg = _cfg_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(cfg.SHEETS.PERFORMANCE_LOG);
  if (!sh || sh.getLastRow() < 2) { warn_('No performance rows to migrate'); return; }

  const headers = SCHEMA.PERFORMANCE_LOG;
  const lastRow = sh.getLastRow();
  const data = sh.getRange(2,1,lastRow-1,headers.length).getValues();

  const idxBetID = headers.indexOf('BetID');
  const idxResID = headers.indexOf('ResultID');
  const idxLogID = headers.indexOf('LogID');

  if (idxBetID < 0 || idxResID < 0 || idxLogID < 0) {
    err_('Schema mismatch in PERFORMANCE_LOG, cannot migrate safely');
    return;
  }

  let changed = 0;
  for (let r=0;r<data.length;r++) {
    const betID = String(data[r][idxBetID] || '');
    if (!betID) continue;

    const scoreless = generateResultKeyNoScoreFromBetID_(betID);
    const old = String(data[r][idxResID] || '');
    if (old !== scoreless) {
      data[r][idxResID] = scoreless;
      data[r][idxLogID] = generateLogID_(betID, scoreless);
      changed++;
    }
  }

  if (changed) {
    sh.getRange(2,1,data.length,headers.length).setValues(data);
    invalidateIDCache_(cfg.SHEETS.PERFORMANCE_LOG, 'LogID');
    log_('✅ Migrated ' + changed + ' rows to scoreless ResultID + regenerated LogID');
  } else {
    log_('ℹ️ No migration changes needed');
  }
}

/* =========================
 * MENUS
 * ========================= */

function MIC_onOpen_() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🧠 MIC')
    .addItem('Initialize MIC System', 'initializeMIC')
    .addSeparator()
    .addItem('Run Full Pipeline', 'runMICPipeline')
    .addSeparator()
    .addSubMenu(ui.createMenu('📥 Archive')
      .addItem('Archive Bets (Sync_Temp)', 'syncWithHistoricalArchive')
      .addItem('Archive Results (Results_Temp)', 'syncResultsWithHistoricalArchive'))
    .addSubMenu(ui.createMenu('📊 Performance')
      .addItem('Grade & Log Performance', 'gradeAndPopulatePerformanceLog')
      .addItem('Update Segment Stats', 'updateSegmentStats')
      .addItem('Generate Insights', 'generateHistoricalInsights'))
    .addSubMenu(ui.createMenu('🔧 Repair')
      .addItem('Repair Results Archive', 'repairHistoricalResultsArchive')
      .addItem('Repair Performance Log', 'repairHistoricalPerformanceLog'))
    .addSeparator()
    .addItem('Run Shadow Backtest', 'MIC_RunShadowBacktest_Menu')
    .addItem('Auto-Tune (recommend)', 'MIC_AutoTune_Recommend_Menu')
    .addItem('Auto-Tune (apply)', 'MIC_AutoTune_Apply_Menu')
    .addToUi();
}

function MIC_RunShadowBacktest_Menu() {
  const res = runShadowBacktest();
  logShadowBacktest_(res);
}

function MIC_AutoTune_Recommend_Menu() {
  autoTuneMIC({ apply: false });
}

function MIC_AutoTune_Apply_Menu() {
  autoTuneMIC({ apply: true });
}

function MIC_ShowOverrides_Menu() {
  log_('MIC_RUNTIME_OVERRIDES=' + JSON.stringify(getMICRuntimeOverrides() || {}));
}

/***********************
 * CANONICAL RESULTS FIX
 * Put this at the VERY BOTTOM of the file
 ***********************/

// One canonical matchString (build from Home/Away if Match empty)
function matchString(obj) {
  const m = String(obj.match || obj.Match || '').trim();
  if (m && m.toUpperCase() !== 'NA') return m;

  const h = String(obj.home || obj.Home || obj.homeTeam || obj.HomeTeam || '').trim();
  const a = String(obj.away || obj.Away || obj.awayTeam || obj.AwayTeam || '').trim();

  if (h && a && h.toUpperCase() !== 'NA' && a.toUpperCase() !== 'NA') return h + ' vs ' + a;
  return '';
}

// Ensure extractTeams_ exists exactly once
/**
 * extractTeams_  (Mothership_Intelligence_Core.gs)
 *
 * PATCH: Strips trailing gender markers ("W", "Women", "Femenino", etc.)
 * and trailing club suffixes ("FC", "SC", etc.) BEFORE generating
 * deterministic IDs, so BetIDs and ResultIDs align across feeds
 * that inconsistently include/omit these suffixes.
 *
 * Stripping is trailing-only and guarded (never empties a team name).
 * Dash splitting requires surrounding spaces to protect hyphenated names.
 */
function extractTeams_(match) {
  if (!match) return { home: 'NA', away: 'NA' };
  var m = String(match).trim();
  if (!m) return { home: 'NA', away: 'NA' };

  // ── Team name cleanup (trailing-only, conservative) ──
  var cleanTeam = function(teamName) {
    var s = String(teamName || '').trim();
    if (!s) return 'NA';

    // Normalize internal whitespace
    s = s.replace(/\s+/g, ' ').trim();
    var original = s;

    // 1) Remove bracketed gender markers at end: "Team (W)", "Team [Women]"
    s = s.replace(
      /\s*[\(\[\{]\s*(?:W|WOMEN|WOMENS|WOMEN'S|LADIES|FEMENINO|FEMENINA|FEM)\s*[\)\]\}]\s*$/gi,
      ''
    ).trim();

    // 2) Strip trailing standalone tokens iteratively
    //    Uses \s+ before token (ensures it's a separate word) and \s*$ after (end of string)
    //    Only accepts the result if the remaining name is ≥ 2 characters
    var stripTrailing = function(str, tokenList) {
      var out = str;
      var changed = true;
      while (changed) {
        changed = false;
        for (var i = 0; i < tokenList.length; i++) {
          var re = new RegExp('\\s+' + tokenList[i] + '\\s*$', 'i');
          if (re.test(out)) {
            var candidate = out.replace(re, '').replace(/\s+/g, ' ').trim();
            if (candidate && candidate.length >= 2) {
              out = candidate;
              changed = true;
            }
          }
        }
      }
      return out;
    };

    // Gender markers (primary fix for ESW/ARW leak)
    s = stripTrailing(s, [
      'W', 'WOMEN', 'WOMENS', "WOMEN'S", 'LADIES',
      'FEM', 'FEMENINO', 'FEMENINA'
    ]);

    // Club suffixes (alignment helper — only if meaningful name remains)
    s = stripTrailing(s, ['FC', 'SC', 'AC', 'CF', 'CD', 'BK', 'BC']);

    // Final cleanup
    s = s.replace(/\s+/g, ' ').trim();
    return s || original || 'NA';
  };

  // ── Separator patterns (ordered by specificity) ──
  //
  //  @    — Lenient spacing (unambiguous separator, no team has @ in name)
  //  vs   — Case-insensitive, optional trailing dot
  //  v    — Case-insensitive (common in UK feeds)
  //  dash — REQUIRES spaces on both sides to protect "Paris-Saint Germain"
  //         Handles hyphen (-), en-dash (–), and em-dash (—)
  var seps = [
    { re: /\s*@\s+|\s+@\s*/,   type: 'AT'   },
    { re: /\s+vs\.?\s+/i,       type: 'VS'   },
    { re: /\s+v\s+/i,           type: 'VS'   },
    { re: /\s+[-\u2013\u2014]\s+/, type: 'DASH' }
  ];

  for (var i = 0; i < seps.length; i++) {
    if (seps[i].re.test(m)) {
      var parts = m.split(seps[i].re)
        .map(function(x) { return String(x || '').trim(); })
        .filter(function(x) { return x.length > 0; });

      if (parts.length >= 2) {
        if (seps[i].type === 'AT') {
          return { home: cleanTeam(parts[1]), away: cleanTeam(parts[0]) };
        }
        return { home: cleanTeam(parts[0]), away: cleanTeam(parts[1]) };
      }
    }
  }

  // If no separator matched, treat the whole string as "home"
  return { home: cleanTeam(m), away: 'NA' };
}

// One canonical score getter
function getScoreValue_(obj, prefix) {
  const upper = prefix.toUpperCase();
  const lower = prefix.toLowerCase();
  const cap = prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();

  return obj[upper + ' Score'] ||
         obj[upper + 'Score'] ||
         obj[lower + 'Score'] ||
         obj[cap + 'Score'] ||
         obj[lower + 'score'] ||
         obj[upper] ||
         obj[lower] ||
         obj[prefix] ||
         obj['Pred Score'] ||
         obj.predScore ||
         '';
}

// Keep your existing formatDateForID_ if it’s good; but ensure it accepts Date/serial/DD/MM
// If you already have a good one, remove this version and keep only one.
function formatDateForID_(value) {
  if (value === null || value === undefined || value === '') return 'NA';

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyyMMdd');
  }

  if (typeof value === 'number' && isFinite(value)) {
    if (value > 20000 && value < 80000) {
      const ms = Math.round((value - 25569) * 86400 * 1000);
      const dNum = new Date(ms);
      if (!isNaN(dNum.getTime())) {
        return Utilities.formatDate(dNum, Session.getScriptTimeZone(), 'yyyyMMdd');
      }
    }
  }

  const raw = String(value).trim();
  if (!raw) return 'NA';

  const datePart = raw.split(' ')[0].trim();
  if (/^\d{8}$/.test(datePart)) return datePart;

  const m = datePart.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (m) {
    const a = parseInt(m[1],10), b = parseInt(m[2],10), y = parseInt(m[3],10);
    let day, month;
    if (a > 12) { day=a; month=b; }
    else if (b > 12) { day=b; month=a; }
    else { day=a; month=b; } // assume DD/MM
    const d = new Date(y, month-1, day);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyyMMdd');
    return 'NA';
  }

  const d2 = new Date(raw);
  if (!isNaN(d2.getTime())) {
    return Utilities.formatDate(d2, Session.getScriptTimeZone(), 'yyyyMMdd');
  }
  return 'NA';
}

function generateResultID_(result) {
  // ✅ IMPORTANT: do NOT include score in ResultID
  // ResultID must match BetID[0..2] style: LEAGUE_CODE|YYYYMMDD|MATCH
  return generateResultKeyNoScore_(result);
}


// ═══════════════════════════════════════════════════════════════════
//  SCORE-PARSING HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract all (home, away) score pairs from a string.
 * Handles: "26-20", "26 - 20", "26–20", "26:20", "AOT 7 - 6"
 */
function parseScorePairs_(val) {
  const s = (val ?? '').toString();
  const re = /(\d+)\s*[-–—:]\s*(\d+)/g;
  const pairs = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    pairs.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
  }
  return pairs;
}

/**
 * Parse the first score pair from a value, or null if none found.
 */
function parseFirstScorePair_(val) {
  const pairs = parseScorePairs_(val);
  return pairs.length ? { home: pairs[0][0], away: pairs[0][1] } : null;
}

/**
 * Format a score pair as a string.
 * compact=true  → "26-20"
 * compact=false → "26 - 20"
 */
function fmtScorePair_(pair, compact) {
  if (!pair) return '';
  return compact ? pair.home + '-' + pair.away : pair.home + ' - ' + pair.away;
}

/**
 * Format the first parseable score from a raw value, or '' if unparseable.
 */
function firstScore_(val, compact) {
  return fmtScorePair_(parseFirstScorePair_(val), compact);
}

/**
 * Add two score pairs together. Returns null if either is null.
 */
function addScorePairs_(a, b) {
  if (!a || !b) return null;
  return { home: a.home + b.home, away: a.away + b.away };
}

/**
 * Sum an array of raw score strings into a single pair.
 * Skips any that don't parse. Returns null if none parse.
 */
function sumScoreParts_(vals) {
  let sum = null;
  for (const v of vals) {
    const p = parseFirstScorePair_(v);
    if (!p) continue;
    sum = sum ? addScorePairs_(sum, p) : p;
  }
  return sum;
}

/**
 * Returns true if the value contains at least one parseable score pair.
 */
function hasSingleScore_(val) {
  return parseScorePairs_(val).length > 0;
}

/**
 * Returns true if all four quarter strings contain a parseable score.
 */
function hasAllQuarters_(q1, q2, q3, q4) {
  return hasSingleScore_(q1) && hasSingleScore_(q2)
      && hasSingleScore_(q3) && hasSingleScore_(q4);
}


// ═══════════════════════════════════════════════════════════════════
//  HT / FT SELECTION LOGIC
// ═══════════════════════════════════════════════════════════════════

/**
 * Decide the best FTScore.
 *
 * Strategy:
 *   - If we have all four quarters, the computed total is ground truth.
 *   - We still accept the raw FT when it's close to computed (≤5 pts),
 *     because it may already include OT that we don't have a separate
 *     column for.
 *   - If raw FT diverges wildly (like "321-16" vs computed "32-116"),
 *     we override with computed.
 *   - If OT is present, include it in computed total.
 */
function chooseBestFT_(ftRaw, ftComputed, otRaw, status) {
  const raw  = parseFirstScorePair_(ftRaw);
  const comp = parseFirstScorePair_(ftComputed);
  const st   = ((status || '') + '').toUpperCase();

  // No computed → use raw (or blank)
  if (!comp) return raw ? fmtScorePair_(raw, true) : '';

  // No raw → use computed
  if (!raw) return fmtScorePair_(comp, true);

  // Both exist: compare totals
  const rawTotal  = raw.home + raw.away;
  const compTotal = comp.home + comp.away;
  const delta     = Math.abs(rawTotal - compTotal);

  // If status is OT/AOT and OT is already baked into computed, trust computed
  if ((st.includes('AOT') || st.includes('OT')) && hasSingleScore_(otRaw)) {
    return fmtScorePair_(comp, true);
  }

  // If raw is close to computed (within 5 pts — typical OT margin), keep raw
  // because it may include OT we didn't capture separately.
  if (delta <= 5) return fmtScorePair_(raw, true);

  // Raw is wildly divergent → trust computed (catches "321-16" type corruption)
  return fmtScorePair_(comp, true);
}

/**
 * Decide the best HTScore.
 *
 * Strategy:
 *   - NEVER accept a value that matches Pred Score (the root cause bug).
 *   - Reject HT if either side exceeds FT (impossible).
 *   - Prefer computed (Q1+Q2) when available.
 *   - Fall back to explicit HT field only if computed is unavailable.
 */
function chooseBestHT_(htRaw, htComputed, ftFinal, predRaw) {
  const comp = parseFirstScorePair_(htComputed);
  const ht   = parseFirstScorePair_(htRaw);
  const ft   = parseFirstScorePair_(ftFinal);
  const pred = parseFirstScorePair_(predRaw);

  // If we have a computed HT from quarters, it's the gold standard
  if (comp) return fmtScorePair_(comp, true);

  // No computed available — try raw HT, but validate it first
  if (!ht) return '';

  // Reject if HT literally equals the prediction
  if (pred && ht.home === pred.home && ht.away === pred.away) return '';

  // Reject if HT exceeds FT on either side (impossible in basketball)
  if (ft && (ht.home > ft.home || ht.away > ft.away)) return '';

  return fmtScorePair_(ht, true);
}


// ═══════════════════════════════════════════════════════════════════
//  MAIN ENRICHMENT FUNCTION
// ═══════════════════════════════════════════════════════════════════

function enrichResultForArchive_(result, resultID) {
  result = (result && typeof result === 'object') ? result : {};

  const match = matchString(result);
  const teams = extractTeams_(match);

  const rawDate = result.matchDate || result.MatchDate || result.date || result.Date || '';
  const matchDateYMD = formatDateForID_(rawDate);

  const leagueKey = normalizeLeagueKey_(result.league || result.League || '');

  // ── Pull quarter scores directly from explicit fields (never from generic hunting)
  const q1Raw = (result.Q1 || result.q1 || result['Q1'] || '').toString().trim();
  const q2Raw = (result.Q2 || result.q2 || result['Q2'] || '').toString().trim();
  const q3Raw = (result.Q3 || result.q3 || result['Q3'] || '').toString().trim();
  const q4Raw = (result.Q4 || result.q4 || result['Q4'] || '').toString().trim();
  const otRaw = (result.OT || result.ot || result['OT'] || '').toString().trim();

  // Normalise quarter display strings (spaced format for archive readability)
  const q1 = firstScore_(q1Raw, false);
  const q2 = firstScore_(q2Raw, false);
  const q3 = firstScore_(q3Raw, false);
  const q4 = firstScore_(q4Raw, false);

  const status = ((result.status || result.Status || '') + '').toUpperCase();

  // ── Pred Score — captured solely to reject it from HT
  const predRaw = (result['Pred Score'] || result.PredScore || result.predScore || '').toString().trim();

  // ── Raw FT Score from explicit field
  const ftRaw = (
    result['FT Score'] || result.FTScore || result.ftScore || result.score || ''
  ).toString().trim();

  // ── Raw HT Score from explicit field ONLY (never getScoreValue_ which can leak Pred Score)
  const htRaw = (
    result['HT Score'] || result.HTScore || result.htScore || result.HT || ''
  ).toString().trim();

  // ── Compute canonical HT / FT from quarters
  let htComputed = '';
  let ftComputed = '';

  if (hasAllQuarters_(q1Raw, q2Raw, q3Raw, q4Raw)) {
    const htPair = sumScoreParts_([q1Raw, q2Raw]);
    if (htPair) htComputed = fmtScorePair_(htPair, true);

    // Include OT in FT when present
    const partsForFT = [q1Raw, q2Raw, q3Raw, q4Raw];
    if (hasSingleScore_(otRaw)) partsForFT.push(otRaw);
    const ftPair = sumScoreParts_(partsForFT);
    if (ftPair) ftComputed = fmtScorePair_(ftPair, true);
  }

  // ── Choose best FT and HT using validation logic
  const ftFinal = chooseBestFT_(ftRaw, ftComputed, otRaw, status);
  const htFinal = chooseBestHT_(htRaw, htComputed, ftFinal, predRaw);

  return {
    ResultID:      resultID,
    SyncTimestamp: isoNow_(),

    League:   leagueKey,

    Match:    match,
    HomeTeam: teams.home,
    AwayTeam: teams.away,

    FTScore:  ftFinal,
    HTScore:  htFinal,

    Q1Score:  q1,
    Q2Score:  q2,
    Q3Score:  q3,
    Q4Score:  q4,

    MatchDate: matchDateYMD,
    Sport:     result.sport || result.Sport || detectSport_(result)
  };
}


// ═══════════════════════════════════════════════════════════════════
//  ONE-TIME BACKFILL: repair existing archive rows
// ═══════════════════════════════════════════════════════════════════

function repairArchiveHTAndFTScores_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Historical_Results_Archive');
  if (!sh) { Logger.log('Sheet not found'); return; }

  const data = sh.getDataRange().getValues();
  if (data.length < 2) { Logger.log('No data rows'); return; }

  const header = data[0];
  const col = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error('Missing column: ' + name);
    return i;
  };

  const iHT = col('HTScore');
  const iFT = col('FTScore');
  const iQ1 = col('Q1Score');
  const iQ2 = col('Q2Score');
  const iQ3 = col('Q3Score');
  const iQ4 = col('Q4Score');

  let htFixed = 0;
  let ftFixed = 0;

  for (let r = 1; r < data.length; r++) {
    const q1 = (data[r][iQ1] || '').toString();
    const q2 = (data[r][iQ2] || '').toString();
    const q3 = (data[r][iQ3] || '').toString();
    const q4 = (data[r][iQ4] || '').toString();

    if (!hasAllQuarters_(q1, q2, q3, q4)) continue;

    // ── Repair HT ──
    const htCurrent = parseFirstScorePair_((data[r][iHT] || '').toString());
    const htComputed = sumScoreParts_([q1, q2]);

    if (htComputed) {
      const ftForValidation = parseFirstScorePair_((data[r][iFT] || '').toString());

      const htBad =
        !htCurrent ||
        (ftForValidation && (htCurrent.home > ftForValidation.home || htCurrent.away > ftForValidation.away)) ||
        (htComputed && htCurrent.home !== htComputed.home) ||
        (htComputed && htCurrent.away !== htComputed.away);

      if (htBad) {
        data[r][iHT] = fmtScorePair_(htComputed, true);
        htFixed++;
      }
    }

    // ── Repair FT ──
    const ftCurrent = parseFirstScorePair_((data[r][iFT] || '').toString());
    const ftComputed = sumScoreParts_([q1, q2, q3, q4]);

    if (ftComputed && ftCurrent) {
      const rawTotal  = ftCurrent.home + ftCurrent.away;
      const compTotal = ftComputed.home + ftComputed.away;

      // If FT diverges from quarter sum by more than 5 (OT margin), fix it
      if (Math.abs(rawTotal - compTotal) > 5) {
        data[r][iFT] = fmtScorePair_(ftComputed, true);
        ftFixed++;
      }
    } else if (ftComputed && !ftCurrent) {
      data[r][iFT] = fmtScorePair_(ftComputed, true);
      ftFixed++;
    }
  }

  sh.getDataRange().setValues(data);
  Logger.log('Repair complete — HTScore fixed: %s, FTScore fixed: %s (of %s rows)',
             htFixed, ftFixed, data.length - 1);
}


/***********************
 * ════════════════════════════════════════════════════════════════════════════
 * MIC — ULTIMATE CONSOLIDATED PATCH BLOCK  (v3-merged)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Paste at the VERY BOTTOM of your Apps Script file.
 * Overrides all earlier definitions of the same function names.
 *
 * CHANGES:
 *  A  OVERALL posterior     — action from OVERALL mean/LB, not per-arm means
 *  B  Evidence guardrail    — early BLOCK requires ≥3 real observations beyond prior
 *  C  Week-test NA parity   — backtest mirrors live _applyForebetModeConsistency_
 *  D  Effective N           — _evidenceCount_ (decayed obs) replaces raw totalSeen
 *  E  Preloaded window      — tuner reads sheets once; all candidates share memory
 *  F  ROI accuracy          — pre-computed ROI_Contribution preferred; detects suspicious
 *                             WON+ROI=0; optional ASSUME_DECIMAL_ODDS_IF_MISSING fallback
 *  G  Tuner scoring         — optimizes ROI per EVENT under MIN_COVERAGE constraint
 *  H  Grid expansion        — EARLY_BLOCK candidates auto-expand below prior lower bound
 *  I  Extra tuning knobs    — MIN_SAMPLE_SIZE + ALERT_WIN_RATE_THRESHOLD in grid
 *  J  Live/backtest parity  — getRecommendedActions_ uses identical guardrails
 *
 * OPTIONAL RUNTIME OVERRIDES (via setMICRuntimeOverrides):
 *   BACKTEST.ASSUME_DECIMAL_ODDS_IF_MISSING: 1.85
 *   TUNING.ENABLED: true
 *
 * SIGNATURE NOTE:
 *   _deterministicPolicyFromState_ now computes effective N internally.
 *   Accepts both (state, cfg) and legacy (state, sampleSize, cfg).
 *
 ***********************/

// ═══════════════════════════════════════════════════════════════════════════
// D: Per-segment state initializer — no totalSeen (uses _evidenceCount_)
// ═══════════════════════════════════════════════════════════════════════════
function _initSegStateBacktest_(cfg) {
  return {
    lastTimeMs: 0,
    OVERALL: { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA },
    WITH:    { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA },
    AGAINST: { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA },
    SKIP:    { alpha: cfg.PRIOR_ALPHA, beta: cfg.PRIOR_BETA }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// A+D: Decay OVERALL + all arms, anchored to priors
// ═══════════════════════════════════════════════════════════════════════════
function _decayArms_(state, newTimeMs, cfg) {
  if (!state || !cfg) return;
  if (!state.lastTimeMs) { state.lastTimeMs = newTimeMs; return; }

  const dtDays = (newTimeMs - state.lastTimeMs) / 86400000;
  if (!(dtDays > 0)) return;

  const factor = Math.exp(-Math.log(2) * dtDays / cfg.RECENCY_DECAY_HALFLIFE_DAYS);

  function decay_(p) {
    p.alpha = cfg.PRIOR_ALPHA + (p.alpha - cfg.PRIOR_ALPHA) * factor;
    p.beta  = cfg.PRIOR_BETA  + (p.beta  - cfg.PRIOR_BETA)  * factor;
  }

  decay_(state.OVERALL);
  decay_(state.WITH);
  decay_(state.AGAINST);
  decay_(state.SKIP);

  state.lastTimeMs = newTimeMs;
}

// ═══════════════════════════════════════════════════════════════════════════
// F: ROI contribution per backtest event
//
// Priority: pre-computed ROI_Contribution → raw Odds → optional fallback → 0
//
// Design rationale: ROI_Contribution == 0 on a WON row almost always means
// odds were blank at grade time. Silently treating those wins as 0-profit
// makes total ROI artificially negative, and the tuner then optimizes for
// "bet less" instead of "bet smarter". We surface these as missingOddsWins
// so you can fix odds capture upstream.
// ═══════════════════════════════════════════════════════════════════════════
function _roiContributionBacktest_(row, cfg) {
  // LOST = -1 unit
  if (row.WinLossFlag === 0) return -1;

  // Not graded (should not occur given upstream filtering, but defensive)
  if (row.WinLossFlag !== 1) return 0;

  // WON: prefer pre-computed ROI_Contribution if it looks like a real win profit
  const preComp = safeNum_(row.ROI_Contribution, NaN);
  if (isFinite(preComp) && preComp > 0) return preComp;

  // WON but ROI_Contribution is 0/missing/NaN: try raw Odds column
  const o = normalizeOdds_(row.Odds || row.odds);
  if (isFinite(o) && o > 1) return o - 1;

  // Optional fallback for missing-odds wins (off by default — conservative)
  const assumed = (cfg && cfg.BACKTEST && cfg.BACKTEST.ASSUME_DECIMAL_ODDS_IF_MISSING != null)
    ? safeNum_(cfg.BACKTEST.ASSUME_DECIMAL_ODDS_IF_MISSING, NaN)
    : NaN;
  if (isFinite(assumed) && assumed > 1) return assumed - 1;

  // Truly unknown win profit — return 0 (tuner will flag via missingOddsWins counter)
  return 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// A+B+D: Deterministic policy from per-segment posterior state
//
// Backward compatible: accepts (state, cfg) or legacy (state, sampleSize, cfg)
// The sampleSize parameter (if provided) is IGNORED — effective N is computed
// internally from _evidenceCount_ on the decayed OVERALL posterior (fix D).
// ═══════════════════════════════════════════════════════════════════════════
function _deterministicPolicyFromState_(state, cfgOrLegacySampleSize, legacyCfg) {
  // Backward compat: if called with 3 args, cfg is the third; otherwise the second
  const cfg = legacyCfg || cfgOrLegacySampleSize;

  const ov   = state.OVERALL || state.WITH;
  const mean = ov.alpha / (ov.alpha + ov.beta);
  const lb   = bayesianLowerBound_(ov.alpha, ov.beta, cfg.LOWER_BOUND_ONE_SIDED_CONFIDENCE);
  const effN = _evidenceCount_(ov.alpha, ov.beta, cfg); // D: decayed real-observation count

  // ── ACTION from OVERALL ──────────────────────────────────────────────
  let action;
  if (effN >= cfg.MIN_SAMPLE_SIZE) {
    // Mature segment: posterior mean thresholds
    if      (mean < cfg.ALERT_WIN_RATE_THRESHOLD) action = 'BLOCK';
    else if (mean < cfg.CAUTION_MEAN_THRESHOLD)   action = 'CAUTION';
    else                                          action = 'BET';
  } else {
    // Early segment: lower-bound signals with evidence guardrail
    if (lb >= cfg.EARLY_BET_LOWER_BOUND) {
      action = 'BET';
    } else if (effN >= 3.0 && lb <= cfg.EARLY_BLOCK_LOWER_BOUND) {
      // B: require ≥3 real observations beyond the prior before an early BLOCK.
      // With PRIOR_ALPHA=PRIOR_BETA=2, a brand-new segment has effN=0 and
      // priorLB ≈ 0.31, so it would be blocked immediately under any
      // EARLY_BLOCK_LOWER_BOUND > 0.31 — this guardrail prevents that.
      action = 'BLOCK';
    } else {
      action = 'CAUTION'; // default: keep observing
    }
  }

  // ── FOREBET MODE from arms (only when real evidence exists) ──────────
  let forebetMode = 'WITH';
  let bestArmMean = -1;
  const armKeys   = ['WITH', 'AGAINST', 'SKIP'];

  for (let i = 0; i < armKeys.length; i++) {
    const k = armKeys[i];
    const p = state[k];
    if (!p || _evidenceCount_(p.alpha, p.beta, cfg) < 1.0) continue;
    const m = p.alpha / (p.alpha + p.beta);
    if (m > bestArmMean) { bestArmMean = m; forebetMode = k; }
  }

  // SKIP-dominant arm → hard block (the best arm is "don't bet")
  if (forebetMode === 'SKIP') action = 'BLOCK';

  return { action: action, forebetMode: forebetMode, lowerBound: lb, mean: mean };
}

// ═══════════════════════════════════════════════════════════════════════════
// J: Live getRecommendedActions_ override
//
// Identical logic to _deterministicPolicyFromState_ — guarantees that the
// live production path and the backtest path use the SAME decision rules.
// Key additions vs. earlier versions:
//   - Evidence guardrail (effN ≥ 3) for early BLOCK
//   - Deterministic forebet mode selection (no Thompson sampling drift)
//   - effN from _evidenceCount_ instead of raw sampleSize
//
// NOTE: This intentionally changes live behavior. If you want to preserve
// the original live function, comment out or rename this override.
// ═══════════════════════════════════════════════════════════════════════════
function getRecommendedActions_(bayesParams, sampleSize, cfg) {
  const ov   = bayesParams.OVERALL || bayesParams.WITH;
  const mean = ov.alpha / (ov.alpha + ov.beta);
  const lb   = bayesianLowerBound_(ov.alpha, ov.beta, cfg.LOWER_BOUND_ONE_SIDED_CONFIDENCE);
  const effN = _evidenceCount_(ov.alpha, ov.beta, cfg);

  // ── ACTION from OVERALL ──────────────────────────────────────────────
  let action;
  if (effN >= cfg.MIN_SAMPLE_SIZE) {
    if      (mean < cfg.ALERT_WIN_RATE_THRESHOLD) action = 'BLOCK';
    else if (mean < cfg.CAUTION_MEAN_THRESHOLD)   action = 'CAUTION';
    else                                          action = 'BET';
  } else {
    if (lb >= cfg.EARLY_BET_LOWER_BOUND) {
      action = 'BET';
    } else if (effN >= 3.0 && lb <= cfg.EARLY_BLOCK_LOWER_BOUND) {
      action = 'BLOCK';
    } else {
      action = 'CAUTION';
    }
  }

  // ── Deterministic forebet mode ───────────────────────────────────────
  const armKeys   = ['WITH', 'AGAINST', 'SKIP'];
  let chosenMode  = 'WITH';
  let bestArmMean = -1;

  for (let i = 0; i < armKeys.length; i++) {
    const k = armKeys[i];
    const p = bayesParams[k];
    if (!p || _evidenceCount_(p.alpha, p.beta, cfg) < 1.0) continue;
    const m = p.alpha / (p.alpha + p.beta);
    if (m > bestArmMean) { bestArmMean = m; chosenMode = k; }
  }

  if (chosenMode === 'SKIP') action = 'BLOCK';

  return {
    action:        action,
    forebetMode:   chosenMode,
    lowerBound:    lb,
    posteriorMean: mean
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// A–F: runShadowBacktest — complete corrected version
// ═══════════════════════════════════════════════════════════════════════════
function runShadowBacktest(options) {
  const cfgBase = _cfg_();
  const cfg = (options && options.paramsOverride)
    ? _deepMerge_(cfgBase, options.paramsOverride)
    : cfgBase;

  const strict = (options && typeof options.strictLearning === 'boolean')
    ? options.strictLearning
    : cfg.BACKTEST.STRICT_LEARNING;

  const cautionAsBet = (options && typeof options.treatCautionAsBet === 'boolean')
    ? options.treatCautionAsBet
    : cfg.BACKTEST.TREAT_CAUTION_AS_BET;

  // E: accept preloaded+sorted window (tuner uses this to avoid repeated sheet reads)
  let eventWindow = (options && Array.isArray(options._window)) ? options._window : null;

  if (!eventWindow) {
    const maxEvents = (options && options.maxEvents) || cfg.BACKTEST.MAX_EVENTS;
    const perf = loadPerformanceLogAllShards_()
      .filter(r => r && (r.WinLossFlag === 0 || r.WinLossFlag === 1));

    if (!perf.length) { warn_('Shadow backtest: no graded rows'); return null; }

    perf.sort((a, b) => {
      const ta = betIDToTimeMs_(a.BetID) || parseTimestampMs_(a.GradedTimestamp);
      const tb = betIDToTimeMs_(b.BetID) || parseTimestampMs_(b.GradedTimestamp);
      return ta - tb;
    });

    eventWindow = perf.slice(Math.max(0, perf.length - maxEvents));
  }

  if (!eventWindow.length) { warn_('Shadow backtest: empty window'); return null; }

  // ── Main simulation loop ─────────────────────────────────────────────
  const segState = new Map();
  let roiIfBetAll = 0, roiIfPolicy = 0;
  let placedBET = 0, placedCAUTION = 0, blocked = 0, missingOddsWins = 0;

  for (let i = 0; i < eventWindow.length; i++) {
    const row    = eventWindow[i];
    const segKey = row.SegmentKey || 'UNKNOWN';
    const t      = betIDToTimeMs_(row.BetID)
                || parseTimestampMs_(row.GradedTimestamp)
                || Date.now();

    // Initialize or retrieve segment state
    let st = segState.get(segKey);
    if (!st) { st = _initSegStateBacktest_(cfg); segState.set(segKey, st); }

    // A+D: decay all posteriors toward priors based on elapsed time
    _decayArms_(st, t, cfg);

    // A+B+D: deterministic policy decision from OVERALL posterior
    const pol = _deterministicPolicyFromState_(st, cfg);

    // C: normalize ForebetAction — mirrors live week-test behavior
    let betAct = String(row.ForebetAction || 'NA').toUpperCase().trim();
    if ((!betAct || betAct === 'NA')
        && false
        && typeof _shouldDefaultNAForebetToWith_ === 'function'
        && _shouldDefaultNAForebetToWith_(row)) {
      betAct = 'WITH';
    }

    // C: apply forebet mode consistency check (reuses live function for exact parity)
    const finalPol = _applyForebetModeConsistency_({
      action:      pol.action,
      forebetMode: pol.forebetMode,
      confidence:  'BACKTEST',
      reason:      'BACKTEST'
    }, Object.assign({}, row, { ForebetAction: betAct }));

    const finalAction = finalPol.action;

    // F: compute ROI for this event
    const roiEvt = _roiContributionBacktest_(row, cfg);
    if (row.WinLossFlag === 1 && roiEvt === 0) missingOddsWins++;
    roiIfBetAll += roiEvt;

    // Would we have placed this bet under the policy?
    const wouldPlace = (finalAction === 'BET')
                    || (cautionAsBet && finalAction === 'CAUTION');

    if (wouldPlace) {
      roiIfPolicy += roiEvt;
      if (finalAction === 'BET') placedBET++; else placedCAUTION++;
    } else {
      blocked++;
    }

    // ── Bayesian learning (no look-ahead; strictly causal) ─────────────
    if (!strict || wouldPlace) {
      // A: OVERALL always learns from every outcome
      if      (row.WinLossFlag === 1) st.OVERALL.alpha += 1;
      else if (row.WinLossFlag === 0) st.OVERALL.beta  += 1;

      // Arms learn only when ForebetAction is a valid, meaningful token
      if (betAct === 'WITH' || betAct === 'AGAINST' || betAct === 'SKIP') {
        if      (row.WinLossFlag === 1) st[betAct].alpha += 1;
        else if (row.WinLossFlag === 0) st[betAct].beta  += 1;
      }
    }
  }

  // ── Diagnostic: surface missing-odds problem ─────────────────────────
  if (missingOddsWins > 0) {
    warn_('Backtest: ' + missingOddsWins + ' WON rows have ROI_Contribution=0 '
        + '(likely missing odds at grade time). Fix odds capture upstream, or set '
        + 'BACKTEST.ASSUME_DECIMAL_ODDS_IF_MISSING in runtime overrides for fallback.');
  }

  const eventsUsed  = eventWindow.length;
  const placedTotal = placedBET + placedCAUTION;

  return {
    eventsUsed:           eventsUsed,
    placedBET:            placedBET,
    placedCAUTION:        placedCAUTION,
    blocked:              blocked,
    coverage:             eventsUsed  ? (placedTotal / eventsUsed)  : 0,
    roiIfBetAll:          roiIfBetAll,
    roiIfFollowPolicy:    roiIfPolicy,
    avgROIIfFollowPolicy: placedTotal ? (roiIfPolicy / placedTotal) : 0,
    roiPerEvent:          eventsUsed  ? (roiIfPolicy / eventsUsed)  : 0,
    missingOddsWins:      missingOddsWins,
    cfgUsed:              cfg
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// E+G+H+I: autoTuneMIC — grid search with preloaded window
//
// Performance note: with the default grid (~1,300 candidates) and a 5,000-event
// window, the inner loop runs ~6.5M arithmetic-only iterations — comfortably
// within GAS's 6-minute execution limit. If you enlarge the grid substantially,
// consider reducing MAX_EVENTS or splitting the grid.
// ═══════════════════════════════════════════════════════════════════════════
function autoTuneMIC(options) {
  const cfg = _cfg_();
  if (!cfg.TUNING || cfg.TUNING.ENABLED !== true) {
    warn_('Auto-tune disabled (set TUNING.ENABLED = true)');
    return null;
  }

  const apply       = options && options.apply === true;
  const maxEvents   = (options && options.maxEvents)   || cfg.BACKTEST.MAX_EVENTS;
  const minCoverage = (options && options.minCoverage) || cfg.BACKTEST.MIN_COVERAGE;

  // E: load + sort sheets ONCE — all candidate evaluations read from memory
  const perfAll = loadPerformanceLogAllShards_()
    .filter(r => r && (r.WinLossFlag === 0 || r.WinLossFlag === 1));

  if (!perfAll.length) { warn_('Auto-tune: no graded rows available'); return null; }

  perfAll.sort((a, b) => {
    const ta = betIDToTimeMs_(a.BetID) || parseTimestampMs_(a.GradedTimestamp);
    const tb = betIDToTimeMs_(b.BetID) || parseTimestampMs_(b.GradedTimestamp);
    return ta - tb;
  });

  const sharedWindow = perfAll.slice(Math.max(0, perfAll.length - maxEvents));
  log_('🧪 Tuner: ' + sharedWindow.length + ' events | minCoverage=' + minCoverage);

  // ── Baseline (current config) ────────────────────────────────────────
  const baseline = runShadowBacktest({ _window: sharedWindow });
  if (!baseline) return null;

  log_('🧪 Baseline | coverage='     + baseline.coverage.toFixed(3)
     + ' | ROI/event='               + baseline.roiPerEvent.toFixed(4)
     + ' | avgROI/placed='           + baseline.avgROIIfFollowPolicy.toFixed(4)
     + ' | missingOddsWins='         + baseline.missingOddsWins);

  // ── Candidate grids (with sensible fallbacks) ────────────────────────
  const cEB = (cfg.TUNING.CANDIDATE_EARLY_BET_LB
            || [0.52, 0.54, 0.55, 0.56, 0.57, 0.58]).slice();

  const cHL = (cfg.TUNING.CANDIDATE_HALFLIFE_DAYS
            || [14, 30, 60]).slice();

  const cCM = (cfg.TUNING.CANDIDATE_CAUTION_MEAN
            || [0.53, 0.54, 0.55, 0.56]).slice();

  const cMS = (cfg.TUNING.CANDIDATE_MIN_SAMPLE_SIZE           // I
            || [10, 20]).slice();

  const cAL = (cfg.TUNING.CANDIDATE_ALERT_THRESHOLD           // I
            || [0.48, 0.50]).slice();

  // H: auto-expand EARLY_BLOCK grid below prior lower bound
  // With PRIOR_ALPHA=PRIOR_BETA=2 and z≈-0.84, priorLB ≈ 0.31.
  // A grid entirely above 0.31 blocks every new segment on first sight
  // because LB starts at priorLB and the guardrail never fires.
  let cBL = (cfg.TUNING.CANDIDATE_EARLY_BLOCK_LB
          || [0.25, 0.30, 0.35, 0.40, 0.42, 0.45]).slice();

  const priorLB = bayesianLowerBound_(
    cfg.PRIOR_ALPHA, cfg.PRIOR_BETA, cfg.LOWER_BOUND_ONE_SIDED_CONFIDENCE
  );

  if (isFinite(priorLB) && Math.min.apply(null, cBL) > priorLB) {
    cBL = cBL.concat([
      Math.max(0, priorLB - 0.05),
      Math.max(0, priorLB - 0.10)
    ]);
    log_('🧪 Tuner: prior LB=' + priorLB.toFixed(3)
       + ' — expanded EARLY_BLOCK grid downward');
  }

  // Deduplicate, filter, sort
  cBL = [...new Set(cBL.map(x => Math.round(x * 10000) / 10000))]
        .filter(x => isFinite(x) && x >= 0 && x < 1)
        .sort((a, b) => a - b);

  // ── Scoring function ─────────────────────────────────────────────────
  // G: ROI per EVENT (not per placed bet — harder to game with selectivity)
  // Tiny tie-breaker: favor higher coverage when ROI/event is equal
  function score_(res) {
    if (!res || !res.eventsUsed) return -1e99;
    if (res.coverage < minCoverage) return -1e99;
    return res.roiPerEvent + 0.001 * res.coverage;
  }

  // ── Grid search ──────────────────────────────────────────────────────
  let best = null, bestOverrides = null, candidatesRun = 0;

  for (let i = 0; i < cEB.length; i++) {
    for (let j = 0; j < cBL.length; j++) {
      // BET lower bound must strictly exceed BLOCK lower bound
      if (cEB[i] <= cBL[j]) continue;

      for (let k = 0; k < cHL.length; k++) {
        for (let m = 0; m < cCM.length; m++) {
          for (let s = 0; s < cMS.length; s++) {
            for (let a = 0; a < cAL.length; a++) {
              // CAUTION threshold must be ≥ ALERT threshold (otherwise the band inverts)
              if (cCM[m] < cAL[a]) continue;

              const ov = {
                EARLY_BET_LOWER_BOUND:       cEB[i],
                EARLY_BLOCK_LOWER_BOUND:     cBL[j],
                RECENCY_DECAY_HALFLIFE_DAYS: cHL[k],
                CAUTION_MEAN_THRESHOLD:      cCM[m],
                MIN_SAMPLE_SIZE:             cMS[s],
                ALERT_WIN_RATE_THRESHOLD:    cAL[a]
              };

              const res = runShadowBacktest({
                _window:        sharedWindow,
                paramsOverride: ov
              });
              candidatesRun++;

              if (score_(res) > score_(best)) {
                best = res;
                bestOverrides = ov;
              }
            }
          }
        }
      }
    }
  }

  log_('🧪 Tuner: evaluated ' + candidatesRun + ' candidates');

  if (best) {
    log_('🧪 Best   | coverage='     + best.coverage.toFixed(3)
       + ' | ROI/event='             + best.roiPerEvent.toFixed(4)
       + ' | avgROI/placed='         + best.avgROIIfFollowPolicy.toFixed(4)
       + ' | missingOddsWins='       + best.missingOddsWins);
    log_('🧪 Best overrides: '       + JSON.stringify(bestOverrides));
  }

  // ── Log to TUNING_LOG sheet ──────────────────────────────────────────
  const tuningId = 'TUNE_' + Date.now();
  const sh       = createSheetIfMissing_(cfg.SHEETS.TUNING_LOG, SCHEMA.TUNING_LOG);
  const applied  = (apply && bestOverrides) ? 'YES' : 'NO';

  sh.getRange(sh.getLastRow() + 1, 1, 1, SCHEMA.TUNING_LOG.length).setValues([[
    tuningId,
    isoNow_(),
    baseline.eventsUsed,
    baseline.avgROIIfFollowPolicy,
    baseline.coverage,
    best ? best.avgROIIfFollowPolicy : '',
    best ? best.coverage             : '',
    JSON.stringify(bestOverrides || {}),
    applied
  ]]);

  log_('🧠 Tuning complete: ' + tuningId + ' | applied=' + applied);

  // ── Apply or recommend ───────────────────────────────────────────────
  if (apply && bestOverrides) {
    setMICRuntimeOverrides(bestOverrides);
    log_('✅ Overrides written to ScriptProperties');
  } else {
    log_('ℹ️ Recommended (not applied): ' + JSON.stringify(bestOverrides || {}));
  }

  if (best) logShadowBacktest_(best);

  return {
    tuningId:             tuningId,
    baseline:             baseline,
    best:                 best,
    recommendedOverrides: bestOverrides,
    applied:              applied
  };
}

function MIC_ApplyTuning() {
  return autoTuneMIC({ apply: true });
}

function MIC_FixMissingOddsForBacktest() {
  setMICRuntimeOverrides({
    BACKTEST: {
      ASSUME_DECIMAL_ODDS_IF_MISSING: 1.85
    }
  });
  log_('✅ Backtest will assume 1.85 decimal odds for WON rows missing odds');
}

// ═══════════════════════════════════════════════════════════════════════════
// Convenience: set sane tuning grid + reduce cold-start blocking
// Safe to run once anytime; idempotent.
// ═══════════════════════════════════════════════════════════════════════════
function MIC_SetUltimateTuningGridAndColdStartDefaults() {
  const overrides = {
    // Cold-start: set EARLY_BLOCK_LOWER_BOUND below the prior LB (~0.31)
    // so brand-new segments start as CAUTION, not BLOCK
    EARLY_BLOCK_LOWER_BOUND: 0.25,

    TUNING: {
      ENABLED: true,
      CANDIDATE_EARLY_BET_LB:    [0.52, 0.54, 0.55, 0.56, 0.57, 0.58],
      CANDIDATE_EARLY_BLOCK_LB:  [0.20, 0.25, 0.30, 0.35, 0.40, 0.42, 0.45],
      CANDIDATE_HALFLIFE_DAYS:   [14, 30, 60],
      CANDIDATE_CAUTION_MEAN:    [0.53, 0.54, 0.55, 0.56],
      CANDIDATE_MIN_SAMPLE_SIZE: [10, 20],
      CANDIDATE_ALERT_THRESHOLD: [0.48, 0.50]
    }
  };

  setMICRuntimeOverrides(overrides);
  log_('✅ Ultimate tuning grid + cold-start defaults applied via MIC_RUNTIME_OVERRIDES');
}
