/**
 * ======================================================================
 * FILE: Mothership_RiskyAccaBuilder.gs
 * PROJECT: Ma Golide - MOTHERSHIP
 * PURPOSE: Build accumulators from RISKY bets (games not yet played)
 * VERSION: 1.0
 * 
 * STRATEGY:
 * - HIGH tier (57-74): Bet AGAINST Forebet
 * - MEDIUM tier (40-56): Bet WITH Forebet
 * - LOW tier (0-39): Bet WITH Forebet
 * - EXTREME (75+): SKIP
 * ======================================================================
 */

const RISKY_ACCA_CONFIG = {
  THRESHOLDS: { EXTREME: 75, HIGH: 57, MEDIUM: 40, LOW: 0 },

  STRATEGY: {
    EXTREME: 'SKIP',
    HIGH: 'AGAINST_FOREBET',
    MEDIUM: 'WITH_FOREBET',
    LOW: 'WITH_FOREBET'
  },

  ACCA_SIZES: [6, 5, 4, 3],
  MAX_PER_LEAGUE: 2,
  TIME_WINDOW_HOURS: 48,

  MIN_CONFIDENCE_HIGH: 0.60,
  MIN_CONFIDENCE_MEDIUM: 0.55,

  DEFAULT_ODDS: 1.85,

  // ─────────────────────────────────────────────────────────────
  // PATCH: Assayer SILVER floor for risky accas
  // ─────────────────────────────────────────────────────────────
  ASSAYER_FLOOR_ENABLED: true,
  MIN_EDGE_GRADE: 'SILVER',
  MIN_PURITY_GRADE: 'SILVER',

  UNKNOWN_EDGE_ACTION: 'BLOCK',     // 'BLOCK' | 'ALLOW'
  UNKNOWN_PURITY_ACTION: 'BLOCK',   // 'BLOCK' | 'ALLOW'

  REQUIRE_RELIABLE_EDGE: false,     // safe default
  DISALLOW_SMALL_SAMPLE_EDGES: false, // safe default

  VERBOSE_FLOOR_LOGGING: true
};


var BET_STATUS = {
  MAIN:     'MAIN_ACCA',
  LEFTOVER: 'LEFTOVER_ACCA',
  RISKY:    'RISKY_ACCA',
  EXPIRED:  'EXPIRED',
  DROPPED:  'DROPPED'
};

var LEFTOVER_CONFIG = {
  ACCA_SIZES:         [6, 4, 3, 2],
  MAX_PER_LEAGUE:     3,
  TIME_WINDOW_HOURS:  24,
  MIN_POOL_SIZE:      2,
  DEFAULT_ODDS:       1.50,
  FORCE_DOUBLES:      true,
  ALLOW_SINGLES:      true,

  // ── Risky tier settings ──
  RISKY_ENABLED:          true,
  RISKY_ACCA_SIZES:       [3, 2],         // ◄◄ FIX: smaller — 4-folds at ~60% WR are decorative
  RISKY_MIN_EDGE_GRADE:   'SILVER',
  RISKY_MIN_POOL_SIZE:    2,
  RISKY_REQUIRE_RELIABLE: true,           // ◄◄ FIX: demand edge.reliable === true
  RISKY_MIN_EDGE_N:       30,             // ◄◄ FIX: no small-sample mirages
  RISKY_MAX_PER_LEAGUE:   2               // ◄◄ FIX: tighter cap than Silver
};

// ◄◄ FIX: explicit allow/deny lists so Risky is reason-gated, not "anything that failed"

/**
 * Block reasons that qualify for Risky rescue.
 * These are purity-related soft failures where the EDGE is still trustworthy.
 */
var RISKY_ALLOWED_BLOCK_REASONS = new Set([
  'NO_PURITY',            // league has zero purity rows
  'PURITY_BUILDING',      // purity row exists but status = 📊 Building
  'PURITY_RELIABILITY',   // purity row exists but not yet reliable
  'PURITY_GRADE'          // purity grade exists but below SILVER floor
]);

/**
 * Purity grades that NEVER enter Risky — these are active "avoid" signals.
 * CHARCOAL/ROCK mean the league's historical data says "stay away".
 */
var RISKY_FORBIDDEN_PURITY_GRADES = new Set([
  'CHARCOAL',
  'ROCK'
  // Add 'BRONZE' here if BRONZE is also a hard-avoid in your world
]);


/**
 * Extract purity grade from bet object (checks multiple field locations).
 */
function _riskyPurityGrade(b) {
  return String(
    b.assayer_purity_grade ||
    (b.assayer && b.assayer.purity && b.assayer.purity.grade) || ''
  ).trim().toUpperCase();
}

/**
 * Extract block reason code from bet object (checks multiple field locations).
 */
function _riskyBlockReason(b) {
  return String(
    b.assayer_block_reason_code ||
    (b.assayer && b.assayer.blockReasonCode) || ''
  ).trim().toUpperCase();
}

/**
 * Extract edge grade from bet object.
 */
function _riskyEdgeGrade(b) {
  return String(
    b.assayer_edge_grade ||
    (b.assayer && b.assayer.edge && b.assayer.edge.grade) || ''
  ).trim().toUpperCase();
}

/**
 * Check if the matched edge is flagged as reliable.
 * Strict: only returns true for explicit boolean true.
 */
function _riskyEdgeReliable(b) {
  if (b.assayer_edge_reliable === true) return true;
  if (b.assayer && b.assayer.edge && b.assayer.edge.reliable === true) return true;
  return false;
}

/**
 * Extract edge sample size (n) from bet object.
 * Returns number or null if unavailable.
 */
function _riskyEdgeN(b) {
  var n = (b.assayer && b.assayer.edge && b.assayer.edge.n);
  if (typeof n === 'number' && isFinite(n)) return n;
  // Fallback: check top-level stamp
  n = b.assayer_edge_n;
  if (typeof n === 'number' && isFinite(n)) return n;
  return null;
}

/**
 * Determine if a Silver-rejected bet qualifies for Risky tier.
 *
 * ◄◄ FIX: This is the critical gate that prevents Risky from becoming
 *          "disable the smoke alarm because dinner smells good."
 *
 * Qualifies when:
 *   - Edge grade ≥ floor (SILVER)
 *   - Edge is reliable (not a small-sample mirage)
 *   - Edge sample n ≥ threshold
 *   - Failure reason is purity-related (soft fail, not hard avoid)
 *   - Purity grade is NOT in the forbidden set (CHARCOAL/ROCK)
 *
 * Does NOT qualify when:
 *   - Edge is too weak (below SILVER)
 *   - Edge is unreliable or tiny sample
 *   - Block reason is PURITY_HARD_BLOCK
 *   - Purity grade is CHARCOAL or ROCK (active avoid signals)
 *   - Failure is edge-related, not purity-related
 */
function _isRiskyCandidate(b, LCFG, GRADE_RANK) {
  if (!b) return false;

  LCFG = LCFG || {};
  var minEdge     = String(LCFG.RISKY_MIN_EDGE_GRADE || 'SILVER').toUpperCase();
  var reqReliable = (LCFG.RISKY_REQUIRE_RELIABLE !== false);
  var minN        = Number(LCFG.RISKY_MIN_EDGE_N || 30) || 30;

  var _rank = function(g) {
    return (GRADE_RANK || {})[String(g || '').trim().toUpperCase()] || 0;
  };

  // ── Edge quality checks ──
  var edgeGrade = _riskyEdgeGrade(b);
  if (_rank(edgeGrade) < _rank(minEdge)) return false;

  if (reqReliable && !_riskyEdgeReliable(b)) return false;

  var n = _riskyEdgeN(b);
  if (n !== null && n < minN) return false;

  // ── Purity failure qualification ──
  var pg     = _riskyPurityGrade(b);
  var reason = _riskyBlockReason(b);

  // Hard-stop: forbidden purity grades are active "avoid" signals
  if (RISKY_FORBIDDEN_PURITY_GRADES.has(pg)) return false;

  // Hard-stop: explicit hard-block is not a soft failure
  if (reason === 'PURITY_HARD_BLOCK') return false;

  // Accept if: purity is missing/empty OR reason is in the allowed soft-failure list
  var purityMissing = (!pg || pg === '' || pg === 'NONE');
  var reasonAllowed = RISKY_ALLOWED_BLOCK_REASONS.has(reason);

  // Also accept if bet wasn't blocked but simply failed grade gate on purity
  // (edge ≥ SILVER but purity grade was e.g. BRONZE, which is NOT in forbidden set)
  var purityBelowFloor = (_rank(pg) > 0 && _rank(pg) < _rank('SILVER') &&
                          !RISKY_FORBIDDEN_PURITY_GRADES.has(pg));

  return (purityMissing || reasonAllowed || purityBelowFloor);
}


// File 3: Mothership_RiskyAccaBuilder.gs
// 18) buildRiskyAccumulators (BEST)

function buildRiskyAccumulators() {
  const FUNC_NAME = 'buildRiskyAccumulators';
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════════════════╗');
  Logger.log('║          🎲 RISKY ACCUMULATOR BUILDER - DUAL STRATEGY 🎲                 ║');
  Logger.log('╚══════════════════════════════════════════════════════════════════════════╝');
  Logger.log(`[${FUNC_NAME}] Started: ${new Date().toISOString()}`);

  ss.toast('🎲 Building Risky Accumulators...', 'Risky Acca Builder', 10);

  try {
    Logger.log(`[${FUNC_NAME}] STEP 1: Loading pending risky bets...`);
    const pendingRiskyBets = _loadPendingRiskyBets(ss);

    if (pendingRiskyBets.length === 0) {
      const msg = 'No pending RISKY bets found in satellites.';
      Logger.log(`[${FUNC_NAME}] ❌ ${msg}`);
      if (ui) ui.alert('❌ No Risky Bets', msg, ui.ButtonSet.OK);
      return;
    }
    Logger.log(`[${FUNC_NAME}] ✅ Loaded ${pendingRiskyBets.length} pending risky bets`);

    Logger.log(`[${FUNC_NAME}] STEP 2: Calculating riskiness scores...`);
    const enrichedBets = _enrichRiskyBetsWithStrategy(pendingRiskyBets);

    // Primary gate: SKIP
    const actionableBets = enrichedBets.filter(b => b.recommendedAction !== 'SKIP');

    // Defense-in-depth: assayer_passed must be true when floor enabled
    const filteredBets = _filterRiskyBets(actionableBets, { applyAssayerFloor: true });

    Logger.log(`[${FUNC_NAME}] ✅ ${filteredBets.length} actionable bets (${enrichedBets.length - filteredBets.length} skipped/blocked)`);

    // Assayer diagnostics (kept)
    const edgeMatched = enrichedBets.filter(b =>
      (b && b.assayerWithEdge && b.assayerWithEdge.edge_id) ||
      (b && b.assayerAgainstEdge && b.assayerAgainstEdge.edge_id) ||
      (b && b.assayer && b.assayer.edge_id)
    ).length;

    const purityBlocked = enrichedBets.filter(b => b?.assayer && (b.assayer.purity_action === 'BLOCK' || b.assayer.purityAction === 'BLOCK')).length;
    const puritySuppress = enrichedBets.filter(b => b?.assayer && (b.assayer.purity_action === 'SUPPRESS' || b.assayer.purityAction === 'SUPPRESS')).length;

    Logger.log(`[${FUNC_NAME}] Assayer coverage: edgeMatched=${edgeMatched}/${enrichedBets.length}, purityBlocked=${purityBlocked}, puritySuppress=${puritySuppress}`);

    // Tier distribution (kept)
    const tierCounts = { EXTREME: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    enrichedBets.forEach(b => { tierCounts[b.riskinessTier] = (tierCounts[b.riskinessTier] || 0) + 1; });
    Logger.log(`[${FUNC_NAME}]   EXTREME (skip): ${tierCounts.EXTREME || 0}`);
    Logger.log(`[${FUNC_NAME}]   HIGH: ${tierCounts.HIGH || 0}`);
    Logger.log(`[${FUNC_NAME}]   MEDIUM: ${tierCounts.MEDIUM || 0}`);
    Logger.log(`[${FUNC_NAME}]   LOW: ${tierCounts.LOW || 0}`);

    if (filteredBets.length < 3) {
      const msg = `Only ${filteredBets.length} actionable bets after SILVER floor. Need at least 3 for accumulator.`;
      Logger.log(`[${FUNC_NAME}] ❌ ${msg}`);
      if (ui) ui.alert('❌ Not Enough Bets', msg, ui.ButtonSet.OK);
      return;
    }

    Logger.log(`[${FUNC_NAME}] STEP 3: Building accumulators...`);
    const portfolios = _buildRiskyPortfolios(filteredBets);
    Logger.log(`[${FUNC_NAME}] ✅ Built ${portfolios.length} accumulators`);

    Logger.log(`[${FUNC_NAME}] STEP 4: Writing output...`);
    _writeRiskyAccaPortfolio(ss, portfolios, enrichedBets);

    const summary = _buildRiskyAccaSummary(portfolios, enrichedBets, tierCounts);

    Logger.log(`[${FUNC_NAME}] ✅ COMPLETED`);
    ss.toast('✅ Risky Accumulators Built!', 'Complete', 5);
    if (ui) ui.alert('🎲 Risky Accumulators Built', summary, ui.ButtonSet.OK);

  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ ERROR: ${e.message}`);
    Logger.log(`[${FUNC_NAME}] Stack: ${e.stack}`);
    if (ui) ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOAD PENDING RISKY BETS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load all pending (not yet played) RISKY bets from satellite spreadsheets.
 * PATCHED: fixed _loadResultsTemp return destructuring (was { resultsMap } on a plain object),
 *          added null guards throughout, try-catch per satellite.
 */
function _loadPendingRiskyBets(ss) {
  var FUNC_NAME = '_loadPendingRiskyBets';
  var pendingBets = [];
  var now = new Date();

  /* ── FIX: _loadResultsTemp returns a plain map, NOT { resultsMap: ... } ── */
  var resultsMap = _loadResultsTemp(ss) || {};

  var configSheet = ss.getSheetByName('Config');
  if (!configSheet) {
    Logger.log('[' + FUNC_NAME + '] ❌ Config sheet not found');
    return pendingBets;
  }

  var configData    = configSheet.getDataRange().getValues();
  if (configData.length < 2) {
    Logger.log('[' + FUNC_NAME + '] ❌ Config sheet is empty');
    return pendingBets;
  }

  var configHeaders = _createHeaderMapRobust(configData[0]);

  var leagueNameCol = (configHeaders['league name'] != null)
    ? configHeaders['league name']
    : configHeaders['league'];
  var urlCol = (configHeaders['file url'] != null)
    ? configHeaders['file url']
    : configHeaders['url'];
  var statusCol = configHeaders['status'];

  if (leagueNameCol == null || urlCol == null) {
    Logger.log('[' + FUNC_NAME + '] ❌ Config missing league-name or file-url column');
    return pendingBets;
  }

  for (var r = 1; r < configData.length; r++) {
    var cfgRow     = configData[r];
    var leagueName = String(cfgRow[leagueNameCol] || '').trim();
    var fileUrl    = String(cfgRow[urlCol] || '').trim();
    var cfgStatus  = (statusCol != null)
      ? String(cfgRow[statusCol] || 'active').toLowerCase().trim()
      : 'active';

    if (cfgStatus !== 'active' || !fileUrl ||
        fileUrl.indexOf('PASTE_') >= 0 || fileUrl.indexOf('http') !== 0) {
      continue;
    }

    try {
      Logger.log('[' + FUNC_NAME + '] Processing: ' + leagueName);
      var satellite = SpreadsheetApp.openByUrl(fileUrl);

      var analysisSheet = (typeof _findSheetByNameFuzzy === 'function')
        ? _findSheetByNameFuzzy(satellite, 'Analysis_Tier1')
        : satellite.getSheetByName('Analysis_Tier1');
      if (!analysisSheet) continue;

      var analysisData = analysisSheet.getDataRange().getValues();
      if (analysisData.length < 2) continue;

      var h = _createHeaderMapRobust(analysisData[0]);

      var homeCol       = (h['home']           != null) ? h['home']           : h['home team'];
      var awayCol       = (h['away']           != null) ? h['away']           : h['away team'];
      var dateCol       = h['date'];
      var timeCol       = (h['time']           != null) ? h['time']           : h['kickoff'];
      var magPredCol    = (h['magolide pred']  != null) ? h['magolide pred']  : h['pred'];
      var forebetPredCol = h['forebet pred'];

      var confidenceCol = (h['confidence %']   != null) ? h['confidence %']   : h['confidence'];
      var magScoreCol   = h['magolide score'];
      var forebetPctCol = (h['forebet %']      != null) ? h['forebet %']      : h['forebet'];
      var varianceCol   = h['variance penalty'];
      var pctDiffCol    = h['pct diff'];
      var netRtgDiffCol = h['netrtg diff'];

      if (homeCol == null || awayCol == null || magPredCol == null) {
        Logger.log('[' + FUNC_NAME + '] ⚠ ' + leagueName + ': missing required analysis columns');
        continue;
      }

      for (var gi = 1; gi < analysisData.length; gi++) {
        try {
          var gameRow = analysisData[gi];
          var home    = String(gameRow[homeCol] || '').trim();
          var away    = String(gameRow[awayCol] || '').trim();
          if (!home || !away) continue;

          var magPredRaw = String(gameRow[magPredCol] || '').toUpperCase().trim();
          if (magPredRaw.indexOf('RISKY') < 0) continue;

          // Check if game has already been played via resultsMap
          var dateRaw = (dateCol != null) ? gameRow[dateCol] : null;
          var result  = null;
          if (typeof _findResultMatch === 'function' && resultsMap) {
            try {
              result = _findResultMatch(resultsMap, home, away, dateRaw);
            } catch (matchErr) {
              /* guard: if _findResultMatch crashes, treat as no match */
              result = null;
            }
          }

          if (result && result.isFinished) continue;

          // Check if game time is in the future
          var gameTimeRaw = (timeCol != null) ? gameRow[timeCol] : null;
          if (typeof _parseGameDateTime === 'function') {
            var gameTime = _parseGameDateTime(dateRaw, gameTimeRaw);
            if (gameTime && gameTime < now) continue;
          }

          // Forebet prediction
          var forebetPred = (forebetPredCol != null)
            ? parseInt(gameRow[forebetPredCol], 10)
            : NaN;
          if (forebetPred !== 1 && forebetPred !== 2) continue;

          // Riskiness data
          var safeFloat = (typeof _safeParseFloat === 'function')
            ? _safeParseFloat
            : function(v) { var n = parseFloat(v); return isFinite(n) ? n : null; };

          var riskinessData = {
            confidence: (confidenceCol != null) ? safeFloat(gameRow[confidenceCol]) : null,
            magScore:   (magScoreCol   != null) ? safeFloat(gameRow[magScoreCol])   : null,
            forebetPct: (forebetPctCol != null) ? safeFloat(gameRow[forebetPctCol]) : null,
            variance:   (varianceCol   != null) ? safeFloat(gameRow[varianceCol])   : null,
            pctDiff:    (pctDiffCol    != null) ? safeFloat(gameRow[pctDiffCol])    : null,
            netRtgDiff: (netRtgDiffCol != null) ? safeFloat(gameRow[netRtgDiffCol]) : null
          };

          var displayDate = '';
          if (typeof _formatDateForDisplay === 'function' && dateRaw != null) {
            try { displayDate = _formatDateForDisplay(dateRaw); } catch (fmtErr) { displayDate = String(dateRaw); }
          } else if (dateRaw != null) {
            displayDate = String(dateRaw);
          }

          pendingBets.push({
            league:        leagueName,
            home:          home,
            away:          away,
            match:         home + ' vs ' + away,
            date:          displayDate,
            time:          (typeof _parseGameDateTime === 'function' && dateRaw)
                             ? _parseGameDateTime(dateRaw, gameTimeRaw) : null,
            forebetPred:   forebetPred,
            riskinessData: riskinessData,
            rowIndex:      gi,
            sourceSheet:   analysisSheet.getName()
          });

        } catch (gameErr) {
          Logger.log('[' + FUNC_NAME + '] ⚠ ' + leagueName + ' row ' + gi + ': ' + (gameErr.message || gameErr));
        }
      }

    } catch (satErr) {
      Logger.log('[' + FUNC_NAME + '] ❌ ' + leagueName + ': ' + (satErr.message || satErr));
    }
  }

  Logger.log('[' + FUNC_NAME + '] Total pending risky bets: ' + pendingBets.length);
  return pendingBets;
}

/**
 * Parse game date and time into a Date object
 */
function _parseGameDateTime(dateRaw, timeRaw) {
  if (!dateRaw) return null;
  
  let dateObj = null;
  
  // Parse date
  if (dateRaw instanceof Date) {
    dateObj = new Date(dateRaw);
  } else if (typeof dateRaw === 'number' && dateRaw > 40000 && dateRaw < 60000) {
    const msPerDay = 86400000;
    const sheetsEpoch = new Date(1899, 11, 30);
    dateObj = new Date(sheetsEpoch.getTime() + Math.round(dateRaw * msPerDay));
  } else if (typeof dateRaw === 'string') {
    const str = dateRaw.trim();
    const dmyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
      dateObj = new Date(parseInt(dmyMatch[3], 10), parseInt(dmyMatch[2], 10) - 1, parseInt(dmyMatch[1], 10));
    }
  }
  
  if (!dateObj || isNaN(dateObj.getTime())) return null;
  
  // Parse time
  if (timeRaw) {
    let hours = 0, minutes = 0;
    
    if (timeRaw instanceof Date) {
      hours = timeRaw.getHours();
      minutes = timeRaw.getMinutes();
    } else if (typeof timeRaw === 'number' && timeRaw < 1) {
      const totalMinutes = Math.round(timeRaw * 24 * 60);
      hours = Math.floor(totalMinutes / 60);
      minutes = totalMinutes % 60;
    } else if (typeof timeRaw === 'string') {
      const timeMatch = timeRaw.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        hours = parseInt(timeMatch[1], 10);
        minutes = parseInt(timeMatch[2], 10);
      }
    }
    
    dateObj.setHours(hours, minutes, 0, 0);
  }
  
  return dateObj;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENRICH BETS WITH STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * _enrichRiskyBetsWithStrategy — CONSOLIDATED PATCH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Scores risky bets, applies Assayer edge/purity floor, determines
 * WITH / AGAINST / SKIP action, and returns fully enriched bet objects.
 *
 * Fixes applied:
 *   FIX #1  — Single-pass scoring (no duplicate scorer call)
 *   FIX #2  — Original market type preserved; RiskTier in its own field
 *   FIX #4  — againstSupport uses its own lift (not withSupport.lift)
 *   GAP 5   — Normalizes scorer return shape so { riskinessScore,
 *             breakdown, assayerMeta } are ALWAYS present
 *   FIX #6  — NaN scores no longer coerced to 0 → prevents unscored
 *             bets from becoming LOW → WITH_FOREBET
 *   FIX #7  — Threshold percentiles computed from finite scores only
 *             (no injected zeros that collapse all tiers to EXTREME)
 *   FIX #8  — Too-few-scores fallback uses config thresholds or Infinity
 *   FIX #9  — edgeSpecificity uses edgeField() for snake+camel support
 *   FIX #10 — edgeToSupport + enriched edge blocks use edgeField()
 *             consistently (won't miss Lift/Grade/EdgeId variants)
 *   FIX #11 — assayer_passed tri-state: true/false/null
 *             (null = NOT_EVALUATED, not silently "true")
 *   FIX #12 — Array.isArray guard on bets input
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
function _enrichRiskyBetsWithStrategy(bets) {
  var FUNC_NAME = '_enrichRiskyBetsWithStrategy';

  // ═══════════════════════════════════════════════════════════════
  // Config guard — prevents ReferenceError if RISKY_ACCA_CONFIG
  // is not loaded in the current execution context
  // ═══════════════════════════════════════════════════════════════
  var CFG = (typeof RISKY_ACCA_CONFIG !== 'undefined' &&
             RISKY_ACCA_CONFIG &&
             typeof RISKY_ACCA_CONFIG === 'object')
    ? RISKY_ACCA_CONFIG
    : {};

  var STRATEGY = (CFG.STRATEGY && typeof CFG.STRATEGY === 'object')
    ? CFG.STRATEGY
    : {
        EXTREME: 'SKIP',
        HIGH:    'AGAINST_FOREBET',
        MEDIUM:  'WITH_FOREBET',
        LOW:     'WITH_FOREBET',
        UNKNOWN: 'SKIP'
      };


  // ═══════════════════════════════════════════════════════════════
  // MICRO-HELPERS
  // ═══════════════════════════════════════════════════════════════
  var asNum = function(v) {
    return (typeof v === 'number') ? v : parseFloat(v);
  };

  var isBlank = function(v) {
    return v === '' || v === null || v === undefined;
  };

  var normLeague = function(s) {
    return String(s || '').trim().toUpperCase();
  };

  var normGrade = function(g) {
    return String(g || '').trim().toUpperCase();
  };

  var GRADE_RANK = {
    PLATINUM: 6, GOLD: 5, SILVER: 4,
    BRONZE: 3, ROCK: 2, CHARCOAL: 1, NONE: 0
  };

  var gradeRank = function(g) {
    return GRADE_RANK[normGrade(g)] || 0;
  };

  var normalizeConfidenceDec = function(v) {
    var n = asNum(v);
    if (!isFinite(n)) return NaN;
    return n > 1 ? (n / 100) : n;
  };

  var deriveTierFromConf = function(confDec) {
    if (!isFinite(confDec)) return 'UNKNOWN';
    if (confDec >= 0.70) return 'STRONG';
    if (confDec >= 0.60) return 'MEDIUM';
    return 'EVEN';
  };

  var computeConfidenceBucketLocal = function(confDec) {
    if (!isFinite(confDec)) return null;
    if (confDec < 0.55) return '<55%';
    if (confDec <= 0.60) return '55-60%';
    if (confDec <= 0.65) return '60-65%';
    if (confDec <= 0.70) return '65-70%';
    return '≥70%';
  };


  // ═══════════════════════════════════════════════════════════════
  // ASSAYER LOADER
  // ═══════════════════════════════════════════════════════════════
  var getAssayerOnce = function() {
    try {
      var cfg = (typeof _cfg_ === 'function') ? (_cfg_() || {}) : {};
      var dp = (function() {
        try { return PropertiesService.getDocumentProperties(); }
        catch (e) { return null; }
      })();

      var assayerSheetId = String(
        cfg.assayer_sheet_id || cfg.ASSAYER_SHEET_ID ||
        (dp ? (dp.getProperty('ASSAYER_SHEET_ID') ||
               dp.getProperty('assayer_sheet_id')) : '') || ''
      ).trim();

      var loadFn =
        (typeof loadAssayerData === 'function' && loadAssayerData) ||
        (typeof loadAssayerData_ === 'function' && loadAssayerData_) ||
        null;

      if (assayerSheetId && loadFn) return loadFn(assayerSheetId);
    } catch (e) {
      Logger.log('[' + FUNC_NAME + '] Assayer load skipped: ' +
        (e && e.message ? e.message : e));
    }
    return null;
  };


  // ═══════════════════════════════════════════════════════════════
  // EDGE HELPERS
  //
  // FIX #10: edgeField() used EVERYWHERE edges are read.
  // Supports snake_case, camelCase, and TitleCase variants.
  // ═══════════════════════════════════════════════════════════════
  var edgeField = function(e, snake, camel) {
    if (!e) return null;
    var v = e[snake];
    if (!isBlank(v)) return v;
    var v2 = e[camel];
    if (!isBlank(v2)) return v2;
    // TitleCase fallback (Grade, Lift, etc.)
    if (camel && camel.length > 0) {
      var titled = camel.charAt(0).toUpperCase() + camel.slice(1);
      var v3 = e[titled];
      if (!isBlank(v3)) return v3;
    }
    return null;
  };

  var betMatchesEdge = function(bet, edge) {
    var edgeSource = String(
      edgeField(edge, 'source', 'source') || ''
    ).trim();
    if (edgeSource && String(bet.source || '').trim() !== edgeSource) {
      return false;
    }

    var checks = [
      ['quarter',      'quarter',       'quarter'],
      ['isWomen',      'is_women',      'isWomen'],
      ['tier',         'tier',          'tier'],
      ['side',         'side',          'side'],
      ['direction',    'direction',     'direction'],
      ['confBucket',   'conf_bucket',   'confBucket'],
      ['spreadBucket', 'spread_bucket', 'spreadBucket'],
      ['lineBucket',   'line_bucket',   'lineBucket']
    ];

    for (var i = 0; i < checks.length; i++) {
      var betK  = checks[i][0];
      var snake = checks[i][1];
      var camel = checks[i][2];

      var ev = edgeField(edge, snake, camel);
      if (isBlank(ev)) continue;

      var betVal = bet[betK];
      if (String(betVal != null ? betVal : '').trim() !==
          String(ev).trim()) {
        return false;
      }
    }
    return true;
  };

  // ─────────────────────────────────────────────────────────────
  // FIX #9: edgeSpecificity uses edgeField() for snake+camel
  //
  // Previously only checked snake_case keys. If edge rows were
  // camelCase, specificity was undercounted → wrong "best edge."
  // ─────────────────────────────────────────────────────────────
  var edgeSpecificity = function(edge) {
    var pairs = [
      ['quarter',       'quarter'],
      ['is_women',      'isWomen'],
      ['tier',          'tier'],
      ['side',          'side'],
      ['direction',     'direction'],
      ['conf_bucket',   'confBucket'],
      ['spread_bucket', 'spreadBucket'],
      ['line_bucket',   'lineBucket']
    ];
    var n = 0;
    for (var i = 0; i < pairs.length; i++) {
      var v = edgeField(edge, pairs[i][0], pairs[i][1]);
      if (!isBlank(v)) n++;
    }
    return n;
  };

  var bestEdgeForBetLocal = function(bet, edgesList) {
    var best = null;
    var bestSpec = -1;
    var bestRank = -1;
    var bestLift = -Infinity;
    var list = edgesList || [];

    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!betMatchesEdge(bet, e)) continue;

      var spec  = edgeSpecificity(e);
      // FIX #10: use edgeField for grade/lift
      var r     = gradeRank(edgeField(e, 'grade', 'grade'));
      var lift  = asNum(edgeField(e, 'lift', 'lift'));
      var liftV = isFinite(lift) ? lift : -Infinity;

      if (spec > bestSpec ||
          (spec === bestSpec && r > bestRank) ||
          (spec === bestSpec && r === bestRank && liftV > bestLift)) {
        best = e;
        bestSpec = spec;
        bestRank = r;
        bestLift = liftV;
      }
    }

    return best
      ? { edge: best, specificity: bestSpec, gradeRank: bestRank, lift: bestLift }
      : null;
  };


  // ═══════════════════════════════════════════════════════════════
  // PURITY HELPERS
  // ═══════════════════════════════════════════════════════════════
  var purityActionFrom = function(purityRow) {
    if (!purityRow) return { action: 'NEUTRAL', delta: 0 };

    var grade  = normGrade(purityRow.grade || purityRow.Grade || '');
    var status = String(
      purityRow.status || purityRow.Status || ''
    ).toLowerCase();

    if (status.indexOf('building') !== -1) {
      return { action: 'NEUTRAL', delta: 0 };
    }
    if (grade === 'CHARCOAL' && status.indexOf('avoid') !== -1) {
      return { action: 'BLOCK', delta: 100 };
    }
    if (grade === 'ROCK') {
      return { action: 'SUPPRESS', delta: 12 };
    }
    if (grade === 'BRONZE') {
      return { action: 'CAUTION', delta: 5 };
    }
    if ((grade === 'PLATINUM' || grade === 'GOLD') &&
        (status.indexOf('reliable') !== -1 ||
         status.indexOf('elite') !== -1)) {
      return { action: 'BOOST', delta: -7 };
    }
    return { action: 'NEUTRAL', delta: 0 };
  };

  var bestPurityFor = function(query, purityRowsList) {
    var qLeague  = normLeague(query.league);
    var qSource  = String(query.source || '').trim();
    var qQuarter = String(query.quarter || 'All').trim();
    var qGender  = String(query.gender || 'All').trim();
    var qTier    = String(query.tier || 'UNKNOWN').trim();

    var best = null;
    var bestScore = -1;
    var rows = purityRowsList || [];

    for (var i = 0; i < rows.length; i++) {
      var r  = rows[i];
      var lg = normLeague(r.league || r.League);
      if (!lg || lg !== qLeague) continue;

      var src = String(r.source || r.Source || '').trim();
      if (qSource && src && src !== qSource) continue;

      var quarter = String(r.quarter || r.Quarter || '').trim();
      var gender  = String(r.gender || r.Gender || '').trim();
      var tier    = String(r.tier || r.Tier || '').trim();

      var qScore = 0;
      if (qQuarter === 'All') {
        qScore = (quarter === 'All') ? 1 : (quarter === 'Full' ? 2 : 3);
      } else {
        qScore = (quarter === qQuarter)
          ? 3
          : (quarter === 'Full' ? 2 : (quarter === 'All' ? 1 : 0));
      }
      if (qScore === 0) continue;

      var gScore = 0;
      if (qGender === 'All') {
        gScore = (gender === 'All') ? 1 : 2;
      } else {
        gScore = (gender === qGender) ? 2 : (gender === 'All' ? 1 : 0);
      }
      if (gScore === 0) continue;

      var tScore = 0;
      if (qTier === 'UNKNOWN') {
        tScore = (tier === 'UNKNOWN') ? 1 : 2;
      } else {
        tScore = (tier === qTier) ? 2 : (tier === 'UNKNOWN' ? 1 : 0);
      }
      if (tScore === 0) continue;

      var score = qScore * 100 + gScore * 10 + tScore;
      if (score > bestScore) { bestScore = score; best = r; }
    }

    return best;
  };

  var getReliableFlag = function(edge) {
    if (!edge) return undefined;
    if (typeof edge.reliable === 'boolean') return edge.reliable;
    if (typeof edge.isReliable === 'boolean') return edge.isReliable;
    if (typeof edge.reliable_edge === 'boolean') return edge.reliable_edge;
    return undefined;
  };


  // ═══════════════════════════════════════════════════════════════
  // GAP 5: SCORER RETURN-SHAPE NORMALIZER
  //
  // _calculateCalibratedRiskinessScore may return:
  //   • a plain number (legacy)
  //   • { score, details, meta }             (older refactor)
  //   • { riskinessScore, breakdown, assayerMeta } (current)
  //   • null / undefined (on error)
  //
  // Guarantees: { riskinessScore, breakdown, assayerMeta }
  // ═══════════════════════════════════════════════════════════════
  var normalizeScorerResult = function(raw, scorerError) {
    var EMPTY = {
      riskinessScore: NaN,
      breakdown: null,
      assayerMeta: null
    };

    // ── null / undefined ──
    if (raw === null || raw === undefined) {
      if (scorerError) {
        return {
          riskinessScore: NaN,
          breakdown: {
            _scorerError: String(scorerError.message || scorerError),
            _scorerErrorName: String(scorerError.name || 'Error')
          },
          assayerMeta: null
        };
      }
      return EMPTY;
    }

    // ── plain number (legacy scorer) ──
    if (typeof raw === 'number') {
      return {
        riskinessScore: isFinite(raw) ? raw : NaN,
        breakdown: { _note: 'scorer_returned_number' },
        assayerMeta: null
      };
    }

    // ── string that looks like a number ──
    if (typeof raw === 'string') {
      var n = asNum(raw);
      return {
        riskinessScore: isFinite(n) ? n : NaN,
        breakdown: { _note: 'scorer_returned_string', _raw: raw },
        assayerMeta: null
      };
    }

    // ── not an object at all ──
    if (typeof raw !== 'object') return EMPTY;

    // ── object: resolve riskinessScore ──
    var scoreCand =
      (raw.riskinessScore !== undefined && raw.riskinessScore !== null)
        ? raw.riskinessScore
      : (raw.score !== undefined && raw.score !== null)
        ? raw.score
      : (raw.riskScore !== undefined && raw.riskScore !== null)
        ? raw.riskScore
      : (raw.calibratedScore !== undefined && raw.calibratedScore !== null)
        ? raw.calibratedScore
      : (raw.calibratedRiskinessScore !== undefined &&
         raw.calibratedRiskinessScore !== null)
        ? raw.calibratedRiskinessScore
      : (raw.value !== undefined && raw.value !== null)
        ? raw.value
      : undefined;

    var scoreNum = asNum(scoreCand);

    // ── object: resolve breakdown ──
    var breakdownCand =
      (raw.breakdown !== undefined) ? raw.breakdown
      : (raw.details !== undefined) ? raw.details
      : (raw.components !== undefined) ? raw.components
      : (raw.explain !== undefined) ? raw.explain
      : (raw.explanation !== undefined) ? raw.explanation
      : null;

    var breakdown;
    if (breakdownCand && typeof breakdownCand === 'object') {
      breakdown = breakdownCand;
    } else if (breakdownCand !== null && breakdownCand !== undefined) {
      breakdown = { _note: 'breakdown_was_non_object', _value: breakdownCand };
    } else {
      breakdown = null;
    }

    if (scorerError) {
      breakdown = breakdown || {};
      breakdown._scorerError = String(scorerError.message || scorerError);
      breakdown._scorerErrorName = String(scorerError.name || 'Error');
    }

    // ── object: resolve assayerMeta ──
    var metaCand =
      (raw.assayerMeta !== undefined) ? raw.assayerMeta
      : (raw.assayer_meta !== undefined) ? raw.assayer_meta
      : (raw.assayer !== undefined) ? raw.assayer
      : (raw.meta !== undefined) ? raw.meta
      : (raw.assayerResult !== undefined) ? raw.assayerResult
      : null;

    var assayerMeta = (metaCand && typeof metaCand === 'object')
      ? metaCand : null;

    return {
      riskinessScore: isFinite(scoreNum) ? scoreNum : NaN,
      breakdown: breakdown,
      assayerMeta: assayerMeta
    };
  };


  // ═══════════════════════════════════════════════════════════════
  // PERCENTILE HELPER (fallback if _computePercentileThresholds
  // is not defined)
  // ═══════════════════════════════════════════════════════════════
  var percentileOf = function(arr, p) {
    var a = [];
    for (var i = 0; i < arr.length; i++) {
      if (typeof arr[i] === 'number' && isFinite(arr[i])) a.push(arr[i]);
    }
    a.sort(function(x, y) { return x - y; });
    if (!a.length) return 0;
    var idx = (a.length - 1) * p;
    var lo = Math.floor(idx);
    var hi = Math.ceil(idx);
    if (lo === hi) return a[lo];
    var w = idx - lo;
    return a[lo] * (1 - w) + a[hi] * w;
  };


  // ═══════════════════════════════════════════════════════════════
  // RISK TIER ASSIGNER (fallback if _assignRiskTier not defined)
  //
  // FIX #6: Returns 'UNKNOWN' for non-finite scores (not LOW)
  // ═══════════════════════════════════════════════════════════════
  var assignRiskTierLocal = function(score, thr) {
    var s = asNum(score);
    if (!isFinite(s)) return 'UNKNOWN';
    if (!thr || typeof thr !== 'object') return 'UNKNOWN';

    var tEx = asNum(thr.EXTREME);
    var tHi = asNum(thr.HIGH);
    var tMe = asNum(thr.MEDIUM);

    if (isFinite(tEx) && s >= tEx) return 'EXTREME';
    if (isFinite(tHi) && s >= tHi) return 'HIGH';
    if (isFinite(tMe) && s >= tMe) return 'MEDIUM';
    return 'LOW';
  };


  // ═══════════════════════════════════════════════════════════════
  // LOAD ASSAYER PAYLOAD
  // ═══════════════════════════════════════════════════════════════
  var assayer = getAssayerOnce();

  var edges = (assayer && (
    assayer.edges || assayer.ASSAYER_EDGES || assayer.assayerEdges
  )) || [];

  var purityRows = (assayer && (
    assayer.purity || assayer.ASSAYER_LEAGUE_PURITY || assayer.assayerPurity
  )) || [];

  var assayerHasData = !!(edges && edges.length) ||
                       !!(purityRows && purityRows.length);


  // ═══════════════════════════════════════════════════════════════
  // FLOOR CONFIG (all reads through guarded CFG)
  // ═══════════════════════════════════════════════════════════════
  var floorEnabled     = (CFG.ASSAYER_FLOOR_ENABLED !== false);
  var minEdgeGrade     = normGrade(CFG.MIN_EDGE_GRADE || 'SILVER');
  var minPurityGrade   = normGrade(CFG.MIN_PURITY_GRADE || 'SILVER');
  var minEdgeRank      = gradeRank(minEdgeGrade);
  var minPurityRank    = gradeRank(minPurityGrade);

  var unknownEdgeAction   = String(
    CFG.UNKNOWN_EDGE_ACTION || 'BLOCK'
  ).toUpperCase();
  var unknownPurityAction = String(
    CFG.UNKNOWN_PURITY_ACTION || 'BLOCK'
  ).toUpperCase();

  var requireReliable      = !!CFG.REQUIRE_RELIABLE_EDGE;
  var disallowSmallSample  = !!CFG.DISALLOW_SMALL_SAMPLE_EDGES;
  var verbose              = !!CFG.VERBOSE_FLOOR_LOGGING;

  var MIN_LIFT_TO_OVERRIDE = 0.10;
  var MIN_GRADE_GAP        = 1;


  // ═══════════════════════════════════════════════════════════════
  // PASS 1: SINGLE-PASS SCORING (FIX #1 + GAP 5)
  // ═══════════════════════════════════════════════════════════════
  var resolveConfBucket = function(confDec) {
    if (typeof computeConfidenceBucket === 'function') {
      return computeConfidenceBucket(confDec);
    }
    if (typeof computeConfidenceBucket_ === 'function') {
      return computeConfidenceBucket_(confDec);
    }
    return computeConfidenceBucketLocal(confDec);
  };

  // FIX #12: guard against non-array input
  var safeBets = Array.isArray(bets) ? bets : [];
  var pass1 = [];

  for (var pi = 0; pi < safeBets.length; pi++) {
    var b = safeBets[pi];
    var bLeague = b.league || b.League || '';

    var confDec = normalizeConfidenceDec(
      (b.confidence !== undefined && b.confidence !== null)
        ? b.confidence
        : (b.Confidence !== undefined && b.Confidence !== null)
          ? b.Confidence
          : 0.60
    );

    var tier = deriveTierFromConf(confDec);
    var confBucket = resolveConfBucket(confDec);

    var ctx = assayer ? {
      assayer:       assayer,
      league:        bLeague,
      source:        'Side',
      pickSide:      null,
      quarter:       'Full',
      gender:        'All',
      tier:          tier,
      confidenceDec: confDec,
      confBucket:    confBucket
    } : null;

    // ── Call scorer with full error handling ──
    var rawResult = null;
    var scorerError = null;

    if (typeof _calculateCalibratedRiskinessScore === 'function') {
      try {
        rawResult = _calculateCalibratedRiskinessScore(
          b.riskinessData, ctx
        );
      } catch (e) {
        scorerError = e;
        rawResult = null;
        Logger.log('[' + FUNC_NAME +
          '] _calculateCalibratedRiskinessScore threw: ' +
          (e && e.message ? e.message : e));
      }
    } else {
      scorerError = {
        name: 'ReferenceError',
        message: '_calculateCalibratedRiskinessScore is not defined'
      };
      Logger.log('[' + FUNC_NAME +
        '] _calculateCalibratedRiskinessScore not found — scoring skipped');
    }

    // GAP 5: normalize into guaranteed shape
    var norm = normalizeScorerResult(rawResult, scorerError);

    pass1.push({
      riskinessScore: norm.riskinessScore,
      breakdown:      norm.breakdown,
      assayerMeta:    norm.assayerMeta,
      confDec:        confDec,
      tier:           tier,
      confBucket:     confBucket
    });
  }


  // ═══════════════════════════════════════════════════════════════
  // COMPUTE DYNAMIC THRESHOLDS
  //
  // FIX #7: Only finite scores contribute. No injected zeros.
  // FIX #8: Too-few-scores → config fallback or Infinity
  //         (Infinity means everything tiers as LOW, not EXTREME)
  // ═══════════════════════════════════════════════════════════════
  var scoresOnly = [];
  for (var si = 0; si < pass1.length; si++) {
    var sVal = pass1[si].riskinessScore;
    if (typeof sVal === 'number' && isFinite(sVal)) {
      scoresOnly.push(sVal);
    }
  }

  var MIN_SCORES_FOR_PERCENTILE = 5;
  var dynamicThresholds = null;

  if (scoresOnly.length >= MIN_SCORES_FOR_PERCENTILE) {
    // Prefer external percentile computer if available
    if (typeof _computePercentileThresholds === 'function') {
      try {
        dynamicThresholds = _computePercentileThresholds(scoresOnly);
      } catch (e) {
        Logger.log('[' + FUNC_NAME +
          '] _computePercentileThresholds threw: ' +
          (e && e.message ? e.message : e));
      }
    }

    // Inline fallback
    if (!dynamicThresholds || typeof dynamicThresholds !== 'object') {
      dynamicThresholds = {
        EXTREME: percentileOf(scoresOnly, 0.90),
        HIGH:    percentileOf(scoresOnly, 0.70),
        MEDIUM:  percentileOf(scoresOnly, 0.50)
      };
    }
  } else {
    // ── Too few scores for meaningful percentiles ──
    // Try config-defined static cutoffs first
    var cfgEx = asNum(CFG.THRESH_EXTREME);
    var cfgHi = asNum(CFG.THRESH_HIGH);
    var cfgMe = asNum(CFG.THRESH_MEDIUM);

    if (isFinite(cfgEx) && isFinite(cfgHi) && isFinite(cfgMe)) {
      dynamicThresholds = {
        EXTREME: cfgEx,
        HIGH:    cfgHi,
        MEDIUM:  cfgMe
      };
    } else {
      // Safe default: everything becomes LOW (not EXTREME)
      dynamicThresholds = {
        EXTREME: Infinity,
        HIGH:    Infinity,
        MEDIUM:  Infinity
      };
    }

    Logger.log('[' + FUNC_NAME + '] Only ' + scoresOnly.length +
      ' finite scores — using ' +
      (isFinite(cfgEx) ? 'config' : 'Infinity') + ' thresholds');
  }

  // Safe threshold logging
  try {
    var logEx = asNum(dynamicThresholds.EXTREME);
    var logHi = asNum(dynamicThresholds.HIGH);
    var logMe = asNum(dynamicThresholds.MEDIUM);
    Logger.log('[' + FUNC_NAME + '] Dynamic thresholds: ' +
      'EXTREME≥' + (isFinite(logEx) ? logEx.toFixed(1) : 'INF') + ', ' +
      'HIGH≥'    + (isFinite(logHi) ? logHi.toFixed(1) : 'INF') + ', ' +
      'MEDIUM≥'  + (isFinite(logMe) ? logMe.toFixed(1) : 'INF'));
  } catch (e) { /* never let logging kill the run */ }


  // ═══════════════════════════════════════════════════════════════
  // PASS 2: ENRICH EACH BET
  // ═══════════════════════════════════════════════════════════════
  var results = [];

  for (var idx = 0; idx < safeBets.length; idx++) {
    var bet    = safeBets[idx];
    var league = bet.league || bet.League || '';
    var p1     = pass1[idx] || {};

    // ─────────────────────────────────────────────────────────
    // FIX #6: DO NOT coerce NaN to 0
    //
    // Before: riskinessScore = isFinite(x) ? x : 0
    //   → unscored bets became 0 → LOW → WITH_FOREBET
    //
    // After: keep raw value; track validity separately
    // ─────────────────────────────────────────────────────────
    var rawScore     = p1.riskinessScore;
    var scoreIsValid = (typeof rawScore === 'number' && isFinite(rawScore));
    var breakdown    = (p1.breakdown !== undefined) ? p1.breakdown : null;
    var assayerMeta  = (p1.assayerMeta !== undefined) ? p1.assayerMeta : null;
    var confDec0     = p1.confDec;
    var tier0        = p1.tier;
    var confBucket0  = p1.confBucket;


    // ── FIX #2: capture original market type once ─────────────
    var originalType = (function() {
      var raw = (bet.Type !== undefined && bet.Type !== null &&
                 String(bet.Type).trim() !== '')
        ? bet.Type
        : bet.type;
      var s = String(raw != null ? raw : 'UNKNOWN').trim();
      return s || 'UNKNOWN';
    })();


    // ── Assign risk tier ──────────────────────────────────────
    // FIX #6: invalid scores → UNKNOWN tier → SKIP
    var riskinessTier;
    if (!scoreIsValid) {
      riskinessTier = 'UNKNOWN';
    } else if (typeof _assignRiskTier === 'function') {
      riskinessTier = _assignRiskTier(rawScore, dynamicThresholds);
    } else {
      riskinessTier = assignRiskTierLocal(rawScore, dynamicThresholds);
    }

    var recommendedAction = STRATEGY[riskinessTier] ||
                            STRATEGY.UNKNOWN || 'SKIP';

    // FIX #6: explicit safety net for unscored bets
    if (!scoreIsValid) {
      recommendedAction = STRATEGY.UNKNOWN || 'SKIP';
    }


    // ── Purity BLOCK from calibrated scorer can force SKIP ────
    if (assayerMeta &&
        (assayerMeta.purity_action === 'BLOCK' ||
         assayerMeta.purityAction === 'BLOCK')) {
      recommendedAction = 'SKIP';
    }

    var forebetPred = bet.forebetPred;
    var againstPred = forebetPred === 1 ? 2
                    : (forebetPred === 2 ? 1 : null);
    var withPred    = (forebetPred === 1 || forebetPred === 2)
                    ? forebetPred : null;


    // ── WITH vs AGAINST edge support ──────────────────────────
    var withSupport    = null;
    var againstSupport = null;

    if (assayer && withPred && againstPred &&
        recommendedAction !== 'SKIP') {

      var buildSideDims = function(pred) {
        return {
          league:        normLeague(league),
          source:        'Side',
          quarter:       null,
          isWomen:       null,
          tier:          tier0,
          side:          pred === 1 ? 'H' : 'A',
          direction:     null,
          conf_bucket:   confBucket0,
          spread_bucket: null,
          line_bucket:   null
        };
      };

      var bestEdgeForDims = function(dims) {
        var edge = null;
        if (typeof assayerMatchBetToBestEdge_ === 'function') {
          try {
            edge = assayerMatchBetToBestEdge_(dims, edges) || null;
          } catch (e) { edge = null; }
        }
        if (edge) return edge;

        var legacyBet = {
          source:       dims.source,
          quarter:      dims.quarter,
          isWomen:      dims.isWomen,
          tier:         dims.tier,
          side:         dims.side,
          direction:    dims.direction,
          confBucket:   dims.conf_bucket,
          spreadBucket: dims.spread_bucket,
          lineBucket:   dims.line_bucket
        };
        var r = bestEdgeForBetLocal(legacyBet, edges);
        return r ? r.edge : null;
      };

      // ─────────────────────────────────────────────────────
      // FIX #10: edgeToSupport uses edgeField for grade/lift
      // ─────────────────────────────────────────────────────
      var edgeToSupport = function(edge) {
        if (!edge) return null;
        var g    = edgeField(edge, 'grade', 'grade');
        var lift = asNum(edgeField(edge, 'lift', 'lift'));
        return {
          edge:      edge,
          gradeRank: gradeRank(g),
          lift:      isFinite(lift) ? lift : -Infinity
        };
      };

      withSupport    = edgeToSupport(
        bestEdgeForDims(buildSideDims(withPred))
      );
      againstSupport = edgeToSupport(
        bestEdgeForDims(buildSideDims(againstPred))
      );

      var withRank    = withSupport    ? withSupport.gradeRank    : 0;
      var againstRank = againstSupport ? againstSupport.gradeRank : 0;
      var withLift    = withSupport    ? withSupport.lift         : -Infinity;
      var againstLift = againstSupport ? againstSupport.lift      : -Infinity;

      var chooseWith =
        (withRank >= againstRank + MIN_GRADE_GAP) ||
        (withRank === againstRank &&
         isFinite(withLift) && isFinite(againstLift) &&
         (withLift - againstLift) >= 0.05) ||
        (withRank === againstRank &&
         withLift >= MIN_LIFT_TO_OVERRIDE &&
         !isFinite(againstLift));

      var chooseAgainst =
        (againstRank >= withRank + MIN_GRADE_GAP) ||
        (againstRank === withRank &&
         isFinite(againstLift) && isFinite(withLift) &&
         (againstLift - withLift) >= 0.05) ||
        (againstRank === withRank &&
         againstLift >= MIN_LIFT_TO_OVERRIDE &&
         !isFinite(withLift));

      if (chooseWith)        recommendedAction = 'WITH_FOREBET';
      else if (chooseAgainst) recommendedAction = 'AGAINST_FOREBET';
    }


    // ═══════════════════════════════════════════════════════════
    // ASSAYER FLOOR (before pick determination)
    //
    // FIX #11: assayer_passed is tri-state:
    //   true  = floor evaluated AND passed
    //   false = floor evaluated AND failed
    //   null  = floor NOT evaluated (no data / disabled / pre-skip)
    // ═══════════════════════════════════════════════════════════
    var floorPassed      = null;   // ← tri-state default
    var floorEdgeGrade   = '';
    var floorPurityGrade = '';
    var floorVerdict     = '';
    var proofParts       = [];

    if (recommendedAction === 'SKIP') {
      // Already SKIP — floor is irrelevant
      floorVerdict = 'PRE_SKIP';
      proofParts.push('preSkip(tier=' + riskinessTier + ')');
      floorPassed = null;  // NOT_EVALUATED

    } else if (!floorEnabled) {
      floorVerdict = 'FLOOR_DISABLED';
      proofParts.push('ASSAYER_FLOOR_ENABLED=false');
      floorPassed = null;  // NOT_EVALUATED (disabled ≠ passed)

    } else if (!assayer || !assayerHasData) {
      floorVerdict = 'NO_ASSAYER_DATA';
      proofParts.push('assayerMissingOrEmpty=true');
      floorPassed = null;  // NOT_EVALUATED (no data to evaluate against)

      // ── POLICY: no assayer data → allow through but mark clearly ──
      // If you want to BLOCK when assayer is missing, change this:
      // recommendedAction = 'SKIP';
      // floorPassed = false;

    } else {
      // ── Floor IS evaluated ──
      var chosenSupport =
        (recommendedAction === 'WITH_FOREBET')    ? withSupport :
        (recommendedAction === 'AGAINST_FOREBET') ? againstSupport :
        null;

      var chosenEdge = chosenSupport ? chosenSupport.edge : null;

      var reasons = [];

      // ── Edge grade check ──
      if (chosenEdge) {
        floorEdgeGrade = normGrade(
          edgeField(chosenEdge, 'grade', 'grade') || ''
        );
      }
      var edgeRk = gradeRank(floorEdgeGrade);

      if (!chosenEdge || !floorEdgeGrade) {
        if (unknownEdgeAction === 'BLOCK') {
          reasons.push('UNKNOWN_EDGE_BLOCK');
        }
        proofParts.push('edge=' + (floorEdgeGrade || 'NONE'));
      } else if (edgeRk < minEdgeRank) {
        reasons.push(
          'EDGE_GRADE_FAIL(' + floorEdgeGrade + '<' + minEdgeGrade + ')'
        );
      } else {
        proofParts.push('edgeOK(' + floorEdgeGrade + ')');
      }

      // ── Reliable flag check ──
      if (requireReliable && chosenEdge) {
        var rel = getReliableFlag(chosenEdge);
        if (rel === false) reasons.push('EDGE_NOT_RELIABLE');
        proofParts.push('reliable=' + String(rel));
      }

      // ── Sample size check ──
      if (disallowSmallSample && chosenEdge) {
        var sampleStr = String(
          chosenEdge.sample_size || chosenEdge.sampleSize || ''
        ).trim().toLowerCase();
        if (sampleStr === 'small') reasons.push('EDGE_SMALL_SAMPLE');
        if (sampleStr) proofParts.push('sample_size=' + sampleStr);
      }

      // ── Purity check ──
      var purityRow = bestPurityFor({
        league:  league,
        source:  'Side',
        quarter: 'Full',
        gender:  'All',
        tier:    tier0
      }, purityRows);

      var purityAction = 'NEUTRAL';
      if (purityRow) {
        floorPurityGrade = normGrade(
          purityRow.grade || purityRow.Grade || ''
        );
        purityAction = purityActionFrom(purityRow).action;
      }

      var purityRk = gradeRank(floorPurityGrade);

      if (!purityRow || !floorPurityGrade) {
        if (unknownPurityAction === 'BLOCK') {
          reasons.push('UNKNOWN_PURITY_BLOCK');
        }
      } else if (purityAction === 'BLOCK') {
        reasons.push('PURITY_ACTION_BLOCK');
      } else if (purityRk < minPurityRank) {
        reasons.push(
          'PURITY_GRADE_FAIL(' + floorPurityGrade +
          '<' + minPurityGrade + ')'
        );
      } else {
        proofParts.push('purityOK(' + floorPurityGrade + ')');
      }

      // ── Final floor verdict ──
      if (reasons.length === 0) {
        floorPassed  = true;
        floorVerdict = (floorEdgeGrade || 'OK') + '+' +
                       (floorPurityGrade || 'OK') + '=PASS';
      } else {
        floorPassed  = false;
        floorVerdict = (floorEdgeGrade || 'NONE') + '+' +
                       (floorPurityGrade || 'NONE') + '=FAIL';
        proofParts.push('reasons=[' + reasons.join(', ') + ']');
        recommendedAction = 'SKIP';
      }

      if (verbose) {
        Logger.log('[' + FUNC_NAME + '] FLOOR ' +
          (floorPassed ? 'PASS' : 'FAIL') + ': ' +
          (bet.match || bet.betId || '?') + ' -> ' +
          floorVerdict + ' (' + recommendedAction + ')');
      }
    }


    // ── Pick determination (post-floor) ───────────────────────
    var pick, pickDescription;

    if (recommendedAction === 'AGAINST_FOREBET' && againstPred) {
      pick = againstPred;
      pickDescription = pick === 1
        ? (bet.home || '?') + ' Win (vs FB)'
        : (bet.away || '?') + ' Win (vs FB)';

    } else if (recommendedAction === 'WITH_FOREBET' && withPred) {
      pick = withPred;
      pickDescription = pick === 1
        ? (bet.home || '?') + ' Win (w/ FB)'
        : (bet.away || '?') + ' Win (w/ FB)';

    } else {
      pick = null;
      pickDescription = 'SKIP';
      recommendedAction = 'SKIP';
    }

    var odds = (CFG.DEFAULT_ODDS !== undefined &&
                CFG.DEFAULT_ODDS !== null)
      ? CFG.DEFAULT_ODDS
      : 1.90;

    var confidence = 0.55;
    if      (riskinessTier === 'LOW')    confidence = 0.70;
    else if (riskinessTier === 'MEDIUM') confidence = 0.60;
    else if (riskinessTier === 'HIGH')   confidence = 0.65;
    // EXTREME / UNKNOWN stay at 0.55


    // ── betId (with fallback) ─────────────────────────────────
    var betId;
    if (typeof _normalizeMatchKey === 'function') {
      try {
        betId = _normalizeMatchKey(
          bet.league, bet.match, pickDescription
        );
      } catch (e) {
        betId = [
          bet.league || '', bet.match || '', pickDescription || ''
        ].join('|');
      }
    } else {
      betId = [
        bet.league || '', bet.match || '', pickDescription || ''
      ].join('|');
    }

    var RiskTier = 'RISKY_' + riskinessTier;


    // ── Build enriched output ─────────────────────────────────
    var enriched = {};

    // Copy original bet properties
    for (var k in bet) {
      if (bet.hasOwnProperty(k)) {
        enriched[k] = bet[k];
      }
    }

    // Overwrite / add enrichment fields
    // FIX #6: store null for invalid scores (not 0)
    enriched.riskinessScore    = scoreIsValid ? rawScore : null;
    enriched.riskinessTier     = riskinessTier;
    enriched.recommendedAction = recommendedAction;
    enriched.pick              = pick;
    enriched.pickDescription   = pickDescription;
    enriched.odds              = odds;
    enriched.confidence        = confidence;
    enriched.betId             = betId;

    // FIX #2: market type preserved, risk in its own field
    enriched.type     = originalType;
    enriched.Type     = originalType;
    enriched.RiskTier = RiskTier;
    enriched.riskTier = RiskTier;  // back-compat alias

    // GAP 5: breakdown and assayerMeta guaranteed non-undefined
    enriched.breakdown = breakdown;
    enriched.assayer   = assayerMeta || null;

    // ─────────────────────────────────────────────────────────
    // FIX #10: enriched edge blocks use edgeField consistently
    // FIX #4:  againstSupport uses its OWN lift
    // ─────────────────────────────────────────────────────────
    enriched.assayerWithEdge = withSupport ? {
      edge_id: edgeField(withSupport.edge, 'edge_id', 'edgeId') ||
               edgeField(withSupport.edge, 'id', 'id') || null,
      grade:   edgeField(withSupport.edge, 'grade', 'grade') || null,
      lift:    isFinite(withSupport.lift) ? withSupport.lift : null
    } : null;

    enriched.assayerAgainstEdge = againstSupport ? {
      edge_id: edgeField(againstSupport.edge, 'edge_id', 'edgeId') ||
               edgeField(againstSupport.edge, 'id', 'id') || null,
      grade:   edgeField(againstSupport.edge, 'grade', 'grade') || null,
      lift:    isFinite(againstSupport.lift) ? againstSupport.lift : null
    } : null;

    // FIX #11: tri-state floor fields
    enriched.assayer_passed       = floorPassed;     // true/false/null
    enriched.assayer_verdict      = floorVerdict;
    enriched.assayer_proof_log    = proofParts.join('; ');
    enriched.assayer_edge_grade   = floorEdgeGrade;
    enriched.assayer_purity_grade = floorPurityGrade;

    enriched.accuracyScore = (confidence || 0.55) * 100;

    results.push(enriched);
  }

  return results;
}

// File 3: Mothership_RiskyAccaBuilder.gs
// 17b) _filterRiskyBets (BEST: defense-in-depth only)

function _filterRiskyBets(bets, opts) {
  const FUNC_NAME = '_filterRiskyBets';
  opts = opts || {};

  const applyFloor = (opts.applyAssayerFloor === undefined)
    ? (RISKY_ACCA_CONFIG.ASSAYER_FLOOR_ENABLED !== false)
    : !!opts.applyAssayerFloor;

  const filtered = [];
  const rejected = [];
  const MAX_REJECTED = 200;

  let skipAction = 0;
  let floorFail = 0;

  for (const bet of (bets || [])) {
    if (String(bet?.recommendedAction || '').toUpperCase() === 'SKIP') {
      skipAction++;
      continue;
    }
    if (applyFloor && bet?.assayer_passed !== true) {
      floorFail++;
      if (rejected.length < MAX_REJECTED) {
        rejected.push({
          betId: bet?.betId || '',
          league: bet?.league || '',
          match: bet?.match || '',
          verdict: bet?.assayer_verdict || '',
          proof: bet?.assayer_proof_log || ''
        });
      }
      continue;
    }
    filtered.push(bet);
  }

  const audit = {
    at: new Date().toISOString(),
    total: (bets || []).length,
    passed: filtered.length,
    applyFloor,
    skipAction,
    floorFail,
    rejectedSample: rejected.slice(0, 50)
  };

  try {
    PropertiesService.getScriptProperties().setProperty('RISKY_ACCA_LAST_FILTER_AUDIT', JSON.stringify(audit));
  } catch (e) {}

  Logger.log(`[${FUNC_NAME}] Passed: ${filtered.length}/${(bets || []).length} (applyFloor=${applyFloor}, skip=${skipAction}, floorFail=${floorFail})`);
  return filtered;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD PORTFOLIOS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build accumulator portfolios from enriched risky bets
 */
function _buildRiskyPortfolios(bets) {
  const FUNC_NAME = '_buildRiskyPortfolios';
  const portfolios = [];
  const usedBetIds = new Set();

  const GRADE_RANK = { PLATINUM: 6, GOLD: 5, SILVER: 4, BRONZE: 3, ROCK: 2, CHARCOAL: 1 };
  const gradeRank = (g) => GRADE_RANK[String(g || '').toUpperCase()] || 0;
  const asNum = (v) => (typeof v === 'number' ? v : parseFloat(v));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

  const purityBonus = (action) => {
    switch (String(action || '').toUpperCase()) {
      case 'BOOST':    return 250;
      case 'NEUTRAL':  return 0;
      case 'CAUTION':  return -80;
      case 'SUPPRESS': return -220;
      case 'BLOCK':    return -999999;
      default:         return 0;
    }
  };

  const scoreBet = (b) => {
    const conf = asNum(b && b.confidence);
    const confPts = isFinite(conf) ? conf * 100 : 0;

    const a = b && b.assayer ? b.assayer : null;
    const pBonus = purityBonus(a && a.purity_action);

    const eRank = gradeRank(a && a.edge_grade);
    const lift = asNum(a && a.edge_lift);
    const liftPts = isFinite(lift) ? clamp(lift * 100, -30, 40) : 0; // cap extremes
    const edgePresencePts = (a && a.edge_id) ? 60 : 0;

    // Slight preference for lower riskinessScore (less risky) within same strategy pool
    const r = asNum(b && b.riskinessScore);
    const riskPts = isFinite(r) ? clamp((50 - r), -50, 50) : 0;

    return (pBonus) + (eRank * 90) + liftPts + edgePresencePts + confPts + riskPts;
  };

  // Sort bets by Assayer priority score (desc)
  const sortedBets = [...(bets || [])].sort((a, b) => scoreBet(b) - scoreBet(a));

  // Separate by strategy type
  const againstFBBets = sortedBets.filter(b => b.recommendedAction === 'AGAINST_FOREBET');
  const withFBBets = sortedBets.filter(b => b.recommendedAction === 'WITH_FOREBET');

  Logger.log(`[${FUNC_NAME}] Against Forebet bets: ${againstFBBets.length}`);
  Logger.log(`[${FUNC_NAME}] With Forebet bets: ${withFBBets.length}`);

  // Build "Against Forebet" accas
  for (const size of RISKY_ACCA_CONFIG.ACCA_SIZES) {
    const built = _buildAccasFromBetPool(againstFBBets, usedBetIds, size, '🔥 Against FB');
    built.forEach(a => portfolios.push(a));
  }

  // Build "With Forebet" accas
  for (const size of RISKY_ACCA_CONFIG.ACCA_SIZES) {
    const built = _buildAccasFromBetPool(withFBBets, usedBetIds, size, '📊 With FB');
    built.forEach(a => portfolios.push(a));
  }

  // Build mixed accas from remaining (still sorted by Assayer score)
  const remaining = sortedBets.filter(b => !usedBetIds.has(b.betId));
  for (const size of [3, 2]) {
    const built = _buildAccasFromBetPool(remaining, usedBetIds, size, '🎲 Mixed Risky');
    built.forEach(a => portfolios.push(a));
  }

  return portfolios;
}

/**
 * Build accumulators from a bet pool
 */
function _buildAccasFromBetPool(pool, usedBetIds, targetSize, namePrefix) {
  const accas = [];
  const maxWindowMs = RISKY_ACCA_CONFIG.TIME_WINDOW_HOURS * 60 * 60 * 1000;
  
  let iteration = 0;
  const maxIterations = 20;
  
  while (iteration < maxIterations) {
    iteration++;
    
    const available = pool.filter(b => !usedBetIds.has(b.betId));
    if (available.length < targetSize) break;
    
    // Try to build one acca
    const cluster = [];
    const clusterBetIds = new Set();
    const leagueCounts = {};
    let seedTime = null;
    
    for (const bet of available) {
      if (cluster.length >= targetSize) break;
      if (clusterBetIds.has(bet.betId)) continue;
      
      // League limit
      const league = bet.league || 'unknown';
      if ((leagueCounts[league] || 0) >= RISKY_ACCA_CONFIG.MAX_PER_LEAGUE) continue;
      
      // Time window check
      if (seedTime && bet.time) {
        const timeDiff = Math.abs(bet.time.getTime() - seedTime);
        if (timeDiff > maxWindowMs) continue;
      }
      
      cluster.push(bet);
      clusterBetIds.add(bet.betId);
      leagueCounts[league] = (leagueCounts[league] || 0) + 1;
      if (!seedTime && bet.time) seedTime = bet.time.getTime();
    }
    
    if (cluster.length >= targetSize) {
      const legs = cluster.slice(0, targetSize);
      legs.forEach(l => usedBetIds.add(l.betId));
      
      const acca = _createRiskyAccaObject(legs, `${namePrefix} ${targetSize}-Fold`);
      accas.push(acca);
    } else {
      break;
    }
  }
  
  return accas;
}

/**
 * Create accumulator object from legs
 */
function _createRiskyAccaObject(legs, name) {
  const times = legs.filter(l => l.time).map(l => l.time.getTime());
  const earliestStart = times.length > 0 ? new Date(Math.min(...times)) : new Date();
  const latestStart = times.length > 0 ? new Date(Math.max(...times)) : new Date();
  
  const totalOdds = legs.reduce((acc, l) => acc * l.odds, 1.0);
  const avgConfidence = legs.reduce((acc, l) => acc + l.confidence, 0) / legs.length;
  const avgRiskinessScore = legs.reduce((acc, l) => acc + l.riskinessScore, 0) / legs.length;
  
  // Count by tier
  const tierCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  legs.forEach(l => {
    if (tierCounts[l.riskinessTier] !== undefined) tierCounts[l.riskinessTier]++;
  });
  
  const timestamp = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  
  return {
    id: `RISKY_ACCA_${timestamp}`,
    name: name,
    type: name,
    legs: legs,
    totalOdds,
    avgConfidence,
    avgRiskinessScore,
    tierCounts,
    earliestStart,
    latestStart,
    timeWindow: `${_formatTimeDisplay(earliestStart)} - ${_formatTimeDisplay(latestStart)}`,
    status: 'PENDING'
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// OUTPUT WRITER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Write risky accumulator portfolio to sheet
 *
 * PATCH: League column now writes canonical code (NBA/IT2/ESW/DE2...)
 *        via normalizeLeagueKey_() instead of raw feed name.
 *        Only affects the displayed League column — BetIDs are unchanged.
 */
function _writeRiskyAccaPortfolio(ss, portfolios, allBets) {
  var FUNC_NAME = '_writeRiskyAccaPortfolio';

  // ── PATCH: One-time availability check for normalizeLeagueKey_ ──
  // If it's not in scope (wrong file load order, missing dependency),
  // we log a warning and fall back gracefully instead of silently writing raw names.
  var hasLeagueNormalizer = (typeof normalizeLeagueKey_ === 'function');
  if (!hasLeagueNormalizer) {
    Logger.log('[' + FUNC_NAME + '] ⚠️ normalizeLeagueKey_ not available in scope — League column will use raw feed values. Ensure Mothership_Intelligence_Core.gs is loaded.');
  }

  // Keep the original 12 columns intact, then append Assayer columns
  var BASE_COLS = 12;
  var EXTRA_COLS = 4; // EdgeID, EdgeGrade, EdgeLift, PurityGrade
  var NUM_COLS = BASE_COLS + EXTRA_COLS;

  var sheet = ss.getSheetByName('Risky_Acca_Portfolio');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('Risky_Acca_Portfolio');

  var output = [];

  output.push(['🎲 RISKY ACCUMULATOR PORTFOLIO - DUAL STRATEGY', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['Generated: ' + new Date().toLocaleString(), '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);

  var totalLegs = portfolios.reduce(function(sum, a) { return sum + a.legs.length; }, 0);
  output.push(['Total Accas: ' + portfolios.length, '', 'Total Bets: ' + totalLegs, '', '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);

  output.push(['STRATEGY LEGEND:', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['🔥 Against FB = HIGH tier - Bet AGAINST Forebet', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['📊 With FB = MEDIUM/LOW tier - Bet WITH Forebet', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);

  if (portfolios.length === 0) {
    output.push(['No accumulators could be built with current risky bets.', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  } else {
    var sortedPortfolios = [].concat(portfolios).sort(function(a, b) {
      var aAgainst = String(a.name || '').indexOf('Against') !== -1;
      var bAgainst = String(b.name || '').indexOf('Against') !== -1;
      if (aAgainst && !bAgainst) return -1;
      if (!aAgainst && bAgainst) return 1;
      return b.legs.length - a.legs.length;
    });

    for (var p = 0; p < sortedPortfolios.length; p++) {
      var acca = sortedPortfolios[p];
      var tierStr = 'H:' + acca.tierCounts.HIGH + ' M:' + acca.tierCounts.MEDIUM + ' L:' + acca.tierCounts.LOW;
      var headerLine = acca.name + ' | Legs: ' + acca.legs.length + ' | Odds: ' + acca.totalOdds.toFixed(2) + ' | Tiers: ' + tierStr + ' | Risk: ' + acca.avgRiskinessScore.toFixed(1);
      output.push([headerLine, '', '', '', '', '', '', '', '', '', '', acca.id, '', '', '', '']);

      // Column headers (base 12 + appended 4)
      output.push([
        'Date', 'Time', 'League', 'Match', 'Pick', 'Strategy', 'Tier', 'Risk Score', 'Odds', 'Conf%', 'Status', 'BetID',
        'EdgeID', 'EdgeGrade', 'EdgeLift', 'PurityGrade'
      ]);

      var sortedLegs = [].concat(acca.legs).sort(function(a, b) {
        var tA = (a.time instanceof Date) ? a.time.getTime() : 0;
        var tB = (b.time instanceof Date) ? b.time.getTime() : 0;
        return tA - tB;
      });

      for (var li = 0; li < sortedLegs.length; li++) {
        var leg = sortedLegs[li];
        var strategyIcon = leg.recommendedAction === 'AGAINST_FOREBET' ? '🔥 vs FB' : '📊 w/ FB';
        var tierIcon = leg.riskinessTier === 'HIGH' ? '🔴' : (leg.riskinessTier === 'MEDIUM' ? '🟡' : '🟢');

        // ── PATCH: Canonical league code for display ──
        // Uses normalizeLeagueKey_ (with fused-string recovery) if available,
        // otherwise falls back to raw value (already warned at function entry).
        var rawLeague = leg.league || leg.League || '';
        var leagueOut = hasLeagueNormalizer
          ? normalizeLeagueKey_(rawLeague)
          : String(rawLeague).trim();

        var a = leg && leg.assayer ? leg.assayer : null;
        var edgeId = a && a.edge_id ? a.edge_id : '';
        var edgeGrade = a && a.edge_grade ? a.edge_grade : '';
        var edgeLift = (a && typeof a.edge_lift === 'number' && isFinite(a.edge_lift))
          ? (a.edge_lift * 100).toFixed(1) + 'pp'
          : '';
        var purityGrade = a && a.purity_grade ? a.purity_grade : '';

        output.push([
          leg.date || '',
          leg.time ? _formatTimeDisplay(leg.time) : '',
          leagueOut,                    // ◄ PATCHED: canonical code instead of raw feed name
          leg.match,
          leg.pickDescription,
          strategyIcon,
          tierIcon + ' ' + leg.riskinessTier,
          Number(leg.riskinessScore).toFixed(1),
          Number(leg.odds).toFixed(2),
          (Number(leg.confidence) * 100).toFixed(0) + '%',
          'PENDING',
          leg.betId,

          edgeId,
          edgeGrade,
          edgeLift,
          purityGrade
        ]);
      }

      output.push(['ACCA STATUS:', 'PENDING', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
      output.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    }
  }

  var normalized = output.map(function(row) {
    var r = [].concat(row);
    while (r.length < NUM_COLS) r.push('');
    return r.slice(0, NUM_COLS);
  });

  sheet.getRange(1, 1, normalized.length, NUM_COLS).setValues(normalized);

  // Apply formatting (best-effort; formatting code might assume 12 cols)
  try {
    _applyRiskyPortfolioFormatting(sheet, normalized);
  } catch (e) {
    Logger.log('[' + FUNC_NAME + '] Formatting skipped: ' + e.message);
  }

  // Column widths (base + appended)
  var widths = [
    90, 55, 80, 180, 140, 80, 80, 70, 55, 55, 70, 180,   // original 12
    220, 90, 80, 100                                       // Assayer cols
  ];
  for (var wi = 0; wi < widths.length; wi++) {
    try { sheet.setColumnWidth(wi + 1, widths[wi]); } catch (e) {}
  }

  Logger.log('[' + FUNC_NAME + '] ✅ Written ' + portfolios.length + ' accas to Risky_Acca_Portfolio');
}

/**
 * Apply formatting to risky portfolio sheet
 */
function _applyRiskyPortfolioFormatting(sheet, data) {
  const NUM_COLS = 12;
  
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const rowNum = r + 1;
    const range = sheet.getRange(rowNum, 1, 1, NUM_COLS);
    
    const cell0 = String(row[0] || '');
    const cellStrategy = String(row[5] || '');
    const cellTier = String(row[6] || '');
    
    // Main header
    if (cell0.includes('RISKY ACCUMULATOR')) {
      range.setFontWeight('bold').setFontSize(14).setBackground('#6a1b9a').setFontColor('#ffffff');
      continue;
    }
    
    // Strategy legend
    if (cell0.includes('STRATEGY LEGEND') || cell0.includes('Against FB =') || cell0.includes('With FB =')) {
      range.setFontStyle('italic').setFontColor('#666666');
      continue;
    }
    
    // Acca header
    if ((cell0.includes('Fold') || cell0.includes('Mixed')) && cell0.includes('|')) {
      range.setFontWeight('bold').setBackground('#e1bee7').setBorder(true, true, true, true, false, false);
      if (cell0.includes('Against')) {
        range.setBackground('#ffcdd2');
      } else if (cell0.includes('With')) {
        range.setBackground('#c8e6c9');
      }
      continue;
    }
    
    // Column headers
    if (cell0 === 'Date') {
      range.setFontWeight('bold').setBackground('#f5f5f5').setFontSize(9);
      continue;
    }
    
    // ACCA STATUS
    if (cell0 === 'ACCA STATUS:') {
      range.setFontWeight('bold').setBackground('#fff3e0');
      continue;
    }
    
    // Bet rows
    if (cellStrategy.includes('vs FB')) {
      range.setBackground('#fff3e0');
    } else if (cellStrategy.includes('w/ FB')) {
      range.setBackground('#e8f5e9');
    }
    
    // Tier coloring
    if (cellTier.includes('HIGH')) {
      sheet.getRange(rowNum, 7).setBackground('#ffcdd2').setFontWeight('bold');
    } else if (cellTier.includes('MEDIUM')) {
      sheet.getRange(rowNum, 7).setBackground('#fff9c4');
    } else if (cellTier.includes('LOW')) {
      sheet.getRange(rowNum, 7).setBackground('#c8e6c9');
    }
    
    // Risk score coloring
    const riskScore = parseFloat(row[7]);
    if (!isNaN(riskScore)) {
      const riskCell = sheet.getRange(rowNum, 8);
      if (riskScore >= 75) riskCell.setBackground('#ff6b6b').setFontColor('#ffffff');
      else if (riskScore >= 57) riskCell.setBackground('#ffa726');
      else if (riskScore >= 40) riskCell.setBackground('#fff176');
      else riskCell.setBackground('#81c784');
    }
  }
  
  sheet.setFrozenRows(10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function _buildRiskyAccaSummary(portfolios, allBets, tierCounts) {
  let summary = '🎲 RISKY ACCUMULATORS BUILT\n\n';
  
  summary += `Total Bets Loaded: ${allBets.length}\n`;
  summary += `By Tier: HIGH=${tierCounts.HIGH}, MEDIUM=${tierCounts.MEDIUM}, LOW=${tierCounts.LOW}, EXTREME=${tierCounts.EXTREME}\n\n`;
  
  summary += `Accumulators Built: ${portfolios.length}\n\n`;
  
  const againstFB = portfolios.filter(p => p.name.includes('Against'));
  const withFB = portfolios.filter(p => p.name.includes('With'));
  const mixed = portfolios.filter(p => p.name.includes('Mixed'));
  
  if (againstFB.length > 0) {
    summary += `🔥 AGAINST FOREBET (${againstFB.length}):\n`;
    againstFB.forEach(a => {
      summary += `   • ${a.legs.length} legs @ ${a.totalOdds.toFixed(2)} odds\n`;
    });
    summary += '\n';
  }
  
  if (withFB.length > 0) {
    summary += `📊 WITH FOREBET (${withFB.length}):\n`;
    withFB.forEach(a => {
      summary += `   • ${a.legs.length} legs @ ${a.totalOdds.toFixed(2)} odds\n`;
    });
    summary += '\n';
  }
  
  if (mixed.length > 0) {
    summary += `🎲 MIXED (${mixed.length}):\n`;
    mixed.forEach(a => {
      summary += `   • ${a.legs.length} legs @ ${a.totalOdds.toFixed(2)} odds\n`;
    });
  }
  
  summary += '\nSee Risky_Acca_Portfolio sheet for details.';
  
  return summary;
}


/**
 * _writeRiskySheet — UPDATED leg rows + acca labels
 *
 * ◄◄ FIX: Flags DEFAULT_ODDS legs with ⚠️ in Odds column
 * ◄◄ FIX: Acca label warns when totalOdds is approximate
 * ◄◄ FIX: Strips glyphs from display pick for clean output
 */
function _writeRiskySheet(ss, portfolios) {
  var FUNC = '_writeRiskySheet';
  if (!portfolios || portfolios.length === 0) {
    Logger.log('[' + FUNC + '] No risky accas to write');
    return;
  }

  var COL_COUNT = 14;
  var DEFAULT_ODDS = (typeof LEFTOVER_CONFIG !== 'undefined' && LEFTOVER_CONFIG)
    ? (LEFTOVER_CONFIG.DEFAULT_ODDS || 1.50)
    : 1.50;

  var sheet = ss.getSheetByName('Risky_Accas');
  if (sheet) {
    sheet.clearContents();                              // ◄◄ FIX: preserves formatting
  } else {
    sheet = ss.insertSheet('Risky_Accas');
  }

  var rows = [];

  // ── Non-mutating, truncating pad ──
  var _pad = function(arr) {
    var r = (arr || []).slice(0, COL_COUNT);
    while (r.length < COL_COUNT) r.push('');
    return r;
  };

  // ── ◄◄ FIX: Strip display glyphs from pick text ──
  var _cleanPick = function(p) {
    var s = String(p || '');
    s = s.replace(/[●○★☆✅⚠️⬡♦◆■□•·🔒🎯🔥📊🔴🟡🟢]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  };

  // ── ◄◄ FIX: _riskReason prefers block-reason code without requiring assayer.blocked ──
  var _riskReason = function(b) {
    var code = _riskyBlockReason(b);
    if (code) {
      if (code === 'NO_PURITY')          return 'LEAGUE_NO_PURITY_DATA';
      if (code === 'PURITY_GRADE')       return 'PURITY_GRADE_BELOW_SILVER';
      if (code === 'PURITY_BUILDING')    return 'PURITY_STILL_BUILDING';
      if (code === 'PURITY_RELIABILITY') return 'PURITY_NOT_YET_RELIABLE';
      return 'BLOCK_' + code;
    }
    var pg = _riskyPurityGrade(b);
    if (!pg || pg === '' || pg === 'NONE') return 'PURITY_MISSING';
    return 'PURITY_' + pg + '_BELOW_FLOOR';
  };

  // ── ◄◄ FIX: Detect how many legs use default odds ──
  var _countDefaultOdds = function(legs) {
    var count = 0;
    for (var i = 0; i < legs.length; i++) {
      var o = Number(legs[i].odds || 0);
      if (o === 0 || o === DEFAULT_ODDS) count++;
    }
    return count;
  };

  // ── Header block ──
  rows.push(_pad(['⚠️ RISKY TIER PORTFOLIO (Risky_Accas)']));
  rows.push(_pad(['Generated: ' + new Date().toLocaleString()]));
  rows.push(_pad(['Edge-qualified bets (Edge≥SILVER, reliable, n≥30) where purity is missing/building/soft-fail']));
  rows.push(_pad(['⚠️ These bets have genuine statistical edge support but UNVERIFIED league purity']));
  rows.push(_pad(['⚠️ Legs marked [DEF] use default odds (' + DEFAULT_ODDS.toFixed(2) + ') — total odds are APPROXIMATE']));
  rows.push(_pad(['']));
  rows.push(_pad([
    'Risky Accas: ' + portfolios.length +
    ' | Total Legs: ' + portfolios.reduce(function(s, p) { return s + (p.legs || []).length; }, 0)
  ]));
  rows.push(_pad(['']));

  // ── Per-acca blocks ──
  for (var pi = 0; pi < portfolios.length; pi++) {
    var acca = portfolios[pi];
    var legs = acca.legs || [];

    var bankers = 0, snipers = 0;
    for (var ci = 0; ci < legs.length; ci++) {
      if (legs[ci].isBanker) bankers++;
      else snipers++;
    }

    // ◄◄ FIX: Count default-odds legs and flag in label
    var defCount = _countDefaultOdds(legs);
    var oddsWarning = (defCount > 0)
      ? ' | ⚠️ ' + defCount + '/' + legs.length + ' legs use default odds'
      : '';

    var label = '⚠️ Risky ' +
      (bankers > 0 && snipers > 0 ? 'Mixed' : bankers > 0 ? 'Banker' : 'Sniper') +
      ' ' + legs.length + '-Fold' +
      ' | Odds: ' + (acca.totalOdds || 0).toFixed(2) +
      (defCount > 0 ? ' (APPROX)' : '') +
      ' | 🔒' + bankers + ' 🎯' + snipers +
      oddsWarning;

    rows.push(_pad([label, '', '', '', '', '', '', '', '', '', '', '', '', acca.id || '']));

    // Column headers
    rows.push(_pad([
      'Date', 'Time', 'League', 'Match', 'Pick', 'Type',
      'Odds', 'Conf%', 'Status', 'Edge Grade', 'Edge n',
      'Purity Grade', 'Risk Reason', 'BetID'
    ]));

    // Leg rows
    for (var li = 0; li < legs.length; li++) {
      var leg = legs[li];
      var t = (leg.time instanceof Date) ? leg.time : new Date(leg.time);
      var dateStr = !isNaN(t) ? t.toLocaleDateString('en-GB') : '';
      var timeStr = !isNaN(t) ? t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';

      var conf = leg.confidence;
      var confStr = (typeof conf === 'number')
        ? (conf <= 1 ? Math.round(conf * 100) + '%' : Math.round(conf) + '%')
        : String(conf || '');

      var edgeN = _riskyEdgeN(leg);

      // ◄◄ FIX: Flag default odds in the odds cell
      var legOdds = Number(leg.odds || 0);
      var isDefault = (legOdds === 0 || legOdds === DEFAULT_ODDS);
      var oddsDisplay = isDefault
        ? legOdds.toFixed(2) + ' [DEF]'
        : legOdds.toFixed(2);

      rows.push(_pad([
        dateStr,
        timeStr,
        leg.league || '',
        leg.match || '',
        _cleanPick(leg.pick),                              // ◄◄ FIX: stripped glyphs
        leg.type || '',
        oddsDisplay,                                        // ◄◄ FIX: flagged default
        confStr,
        'PENDING',
        _riskyEdgeGrade(leg) || 'NONE',
        (edgeN !== null) ? edgeN : '',
        _riskyPurityGrade(leg) || 'NONE',
        _riskReason(leg),
        leg.betId || ''
      ]));
    }

    rows.push(_pad(['ACCA STATUS:', 'PENDING']));
    rows.push(_pad(['']));
  }

  // ── Final normalize — rectangular guarantee ──
  var normalized = [];
  for (var ni = 0; ni < rows.length; ni++) {
    normalized.push(_pad(rows[ni]));
  }

  if (normalized.length > 0) {
    sheet.getRange(1, 1, normalized.length, COL_COUNT).setValues(normalized);
  }

  // Column widths
  var widths = [90, 55, 120, 180, 180, 100, 80, 55, 70, 90, 60, 100, 160, 180];
  for (var wi = 0; wi < widths.length && wi < COL_COUNT; wi++) {
    try { sheet.setColumnWidth(wi + 1, widths[wi]); } catch (e) {}
  }

  Logger.log('[' + FUNC + '] ✅ Wrote ' + portfolios.length + ' risky accas to Risky_Accas');
}


/**
 * ◄◄ FIX: Strip glyphs from pick/type BEFORE dims derivation.
 * Without this, "Q1: H +5.5 ● (65%) ●" can misclassify market type
 * → wrong edge match → false NO_EDGE → wrong Risky routing.
 *
 * Call this on every bet BEFORE passing to assayerDeriveBetDims_.
 */
function _stripGlyphsForDims(bet) {
  if (!bet) return bet;

  var _clean = function(s) {
    s = String(s || '');
    try { s = s.normalize('NFKC'); } catch (e) {}

    // Remove decorative glyphs
    s = s.replace(/[●○★☆✅⚠️⬡♦◆■□•·🔒🎯🔥📊🔴🟡🟢]/g, ' ');

    // Remove embedded/standalone percentages
    s = s.replace(/\(\s*\d{1,3}(?:\.\d+)?\s*%\s*\)/g, ' ');
    s = s.replace(/\b\d{1,3}(?:\.\d+)?\s*%\b/g, ' ');

    // Standardize totals shorthand (only when numeric follows)
    s = s.replace(/\bO(?:VER)?\s*([0-9]+(?:\.[0-9]+)?)\b/gi, 'OVER $1');
    s = s.replace(/\bU(?:NDER)?\s*([0-9]+(?:\.[0-9]+)?)\b/gi, 'UNDER $1');

    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  };

  // Clean copies for dims derivation — preserve originals for display
  bet._dimsPickClean = _clean(bet.pick);
  bet._dimsTypeClean = _clean(bet.type);

  return bet;
}


// ═══════════════════════════════════════════════════════════════════════════════
// VIEW PENDING RISKY BETS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * View all pending risky bets without building accas
 */
function viewPendingRiskyBets() {
  const FUNC_NAME = 'viewPendingRiskyBets';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  
  Logger.log(`[${FUNC_NAME}] Loading pending risky bets...`);
  ss.toast('Loading pending risky bets...', 'Risky Bets', 10);
  
  try {
    const pendingBets = _loadPendingRiskyBets(ss);
    const enrichedBets = _enrichRiskyBetsWithStrategy(pendingBets);
    
    // Write to sheet
    let sheet = ss.getSheetByName('Pending_Risky_Bets');
    if (sheet) ss.deleteSheet(sheet);
    sheet = ss.insertSheet('Pending_Risky_Bets');
    
    const output = [];
    output.push(['📋 PENDING RISKY BETS', '', '', '', '', '', '', '', '', '']);
    output.push([`Generated: ${new Date().toLocaleString()}`, '', '', '', '', '', '', '', '', '']);
    output.push([`Total Pending: ${enrichedBets.length}`, '', '', '', '', '', '', '', '', '']);
    output.push(['', '', '', '', '', '', '', '', '', '']);
    output.push(['League', 'Date', 'Time', 'Match', 'Forebet', 'Recommended', 'Pick', 'Tier', 'Risk Score', 'Action']);
    
    // Sort by time
    const sorted = [...enrichedBets].sort((a, b) => {
      const tA = a.time ? a.time.getTime() : Infinity;
      const tB = b.time ? b.time.getTime() : Infinity;
      return tA - tB;
    });
    
    sorted.forEach(bet => {
      const forebetStr = bet.forebetPred === 1 ? 'Home' : 'Away';
      const actionStr = bet.recommendedAction === 'SKIP' ? '⏭️ SKIP' :
                       (bet.recommendedAction === 'AGAINST_FOREBET' ? '🔥 vs FB' : '📊 w/ FB');
      
      output.push([
        bet.league,
        bet.date,
        bet.time ? _formatTimeDisplay(bet.time) : '',
        bet.match,
        forebetStr,
        bet.pickDescription || '',
        bet.pick || '',
        bet.riskinessTier,
        bet.riskinessScore.toFixed(1),
        actionStr
      ]);
    });
    
    const normalized = output.map(row => {
      const r = [...row];
      while (r.length < 10) r.push('');
      return r.slice(0, 10);
    });
    
    sheet.getRange(1, 1, normalized.length, 10).setValues(normalized);
    sheet.getRange(1, 1, 1, 10).merge().setFontWeight('bold').setFontSize(14).setBackground('#4a148c').setFontColor('#ffffff');
    sheet.getRange(5, 1, 1, 10).setFontWeight('bold').setBackground('#e1bee7');
    sheet.autoResizeColumns(1, 10);
    
    Logger.log(`[${FUNC_NAME}] ✅ Written ${enrichedBets.length} bets to Pending_Risky_Bets`);
    ss.toast('✅ Complete!', 'Risky Bets', 3);
    
    if (ui) {
      ui.alert('📋 Pending Risky Bets',
        `Found ${enrichedBets.length} pending risky bets.\n\n` +
        `By Tier:\n` +
        `• HIGH (vs FB): ${enrichedBets.filter(b => b.riskinessTier === 'HIGH').length}\n` +
        `• MEDIUM (w/ FB): ${enrichedBets.filter(b => b.riskinessTier === 'MEDIUM').length}\n` +
        `• LOW (w/ FB): ${enrichedBets.filter(b => b.riskinessTier === 'LOW').length}\n` +
        `• EXTREME (skip): ${enrichedBets.filter(b => b.riskinessTier === 'EXTREME').length}\n\n` +
        `See Pending_Risky_Bets sheet for details.`,
        ui.ButtonSet.OK);
    }
    
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ ERROR: ${e.message}`);
    if (ui) ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}


/**
 * Check results for risky accumulators - ENHANCED VERSION
 * Grades both individual legs AND overall acca results
 */
function checkRiskyAccaResults() {
  const FUNC_NAME = 'checkRiskyAccaResults';
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════╗');
  Logger.log('║           RISKY ACCA RESULTS CHECKER v2.0                   ║');
  Logger.log('╚══════════════════════════════════════════════════════════════╝');
  Logger.log(`[${FUNC_NAME}] Checking risky acca results...`);

  ss.toast('🔍 Checking risky acca results...', 'Risky Acca', 10);

  try {
    const portfolioSheet = ss.getSheetByName('Risky_Acca_Portfolio');
    if (!portfolioSheet) {
      throw new Error('Risky_Acca_Portfolio not found. Build risky accas first.');
    }

    // STEP 1: Load results
    Logger.log(`[${FUNC_NAME}] STEP 1: Loading results from Results_Temp...`);
    // FIX: Use the universal grading loader to ensure match keys align perfectly
    const resultsMap = _loadResultsTempForGrading(ss) || {};
    const keyCount = Object.keys(resultsMap).length;

    if (keyCount === 0) {
      throw new Error('No results in Results_Temp. Sync results first.');
    }

    Logger.log(`[${FUNC_NAME}] ✅ Loaded ${keyCount} result keys`);

    // STEP 2: Grade all legs
    Logger.log(`[${FUNC_NAME}] STEP 2: Grading individual legs...`);

    const data = portfolioSheet.getDataRange().getValues();
    const legStats = { won: 0, lost: 0, pending: 0, upcoming: 0, noResult: 0 };

    // NEW: Assayer stats
    const assayerStats = {
      legsTotal: 0,
      legsWithEdge: 0,
      byEdgeGrade: {},    // grade -> {won,lost,pending}
      byPurityGrade: {},  // grade -> {won,lost,pending}
      byPurityGradeWL: {} // grade -> {won,lost} (concluded)
    };

    const bump = (map, key, grade) => {
      const k = String(key || 'UNKNOWN').toUpperCase().trim() || 'UNKNOWN';
      if (!map[k]) map[k] = { won: 0, lost: 0, pending: 0 };
      if (grade === 'WON') map[k].won++;
      else if (grade === 'LOST') map[k].lost++;
      else map[k].pending++;
    };

    const bumpWL = (map, key, grade) => {
      const k = String(key || 'UNKNOWN').toUpperCase().trim() || 'UNKNOWN';
      if (!map[k]) map[k] = { won: 0, lost: 0 };
      if (grade === 'WON') map[k].won++;
      else if (grade === 'LOST') map[k].lost++;
    };

    const accaTracking = {};
    let currentAccaId = null;

    // Column indices (safe even if sheet only has 12 cols)
    const COL_STATUS = 10;     // K
    const COL_ACCA_ID = 11;    // L (BetID column)
    const COL_EDGE_ID = 12;    // M
    const COL_EDGE_GRADE = 13; // N
    const COL_PURITY_GRADE = 15; // P (we also write EdgeLift at 14)

    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      const cell0 = String(row[0] || '').trim();

      // Detect new acca header
      if ((cell0.includes('Fold') || cell0.includes('Mixed')) && cell0.includes('|')) {
        const accaId = String(row[COL_ACCA_ID] || '').trim();
        if (accaId.startsWith('RISKY_ACCA_')) {
          currentAccaId = accaId;
          accaTracking[accaId] = {
            headerRow: r + 1,
            statusRow: null,
            legs: [],
            allGraded: true,
            anyLost: false
          };
          Logger.log(`[${FUNC_NAME}]   📊 Found acca: ${accaId} at row ${r + 1}`);
        }
        continue;
      }

      // Detect ACCA STATUS row
      if (cell0 === 'ACCA STATUS:' && currentAccaId) {
        accaTracking[currentAccaId].statusRow = r + 1;
        continue;
      }

      // Grade leg row
      const match = String(row[3] || '').trim();
      const pickDesc = String(row[4] || '').trim();
      const currentStatus = String(row[COL_STATUS] || '').trim();

      // Skip non-bet rows
      if (!match || !match.includes(' vs ') || !pickDesc || pickDesc === 'Pick') {
        continue;
      }

      // NEW: Assayer attribution from sheet (if present)
      assayerStats.legsTotal++;
      const edgeId = String(row[COL_EDGE_ID] || '').trim();
      const edgeGrade = String(row[COL_EDGE_GRADE] || '').trim();
      const purityGrade = String(row[COL_PURITY_GRADE] || '').trim();
      if (edgeId) assayerStats.legsWithEdge++;

      // Skip already graded
      if (['WON', 'LOST'].includes(currentStatus)) {
        bump(assayerStats.byEdgeGrade, edgeGrade, currentStatus);
        bump(assayerStats.byPurityGrade, purityGrade, currentStatus);
        bumpWL(assayerStats.byPurityGradeWL, purityGrade, currentStatus);

        if (currentAccaId) {
          accaTracking[currentAccaId].legs.push({ row: r + 1, grade: currentStatus, match: match });
          if (currentStatus === 'LOST') accaTracking[currentAccaId].anyLost = true;
        }
        continue;
      }

      const { home, away } = _parseMatchString(match);
      if (!home || !away) continue;

      const keysToTry = _generateAllMatchKeys(home, away);
      let result = null;
      for (const key of keysToTry) {
        if (resultsMap[key]) { result = resultsMap[key]; break; }
      }

      let grade = 'PENDING';
      let gradeReason = '';

      if (!result || !result.isFinished) {
        legStats.pending++;
        grade = 'PENDING';
        gradeReason = 'Game not finished';
        if (currentAccaId) accaTracking[currentAccaId].allGraded = false;
      } else {
        const pickedHome = pickDesc.includes(home) ||
          pickDesc.toLowerCase().includes('home') ||
          pickDesc.toLowerCase().startsWith(home.split(' ')[0].toLowerCase());
        const pickedAway = pickDesc.includes(away) ||
          pickDesc.toLowerCase().includes('away') ||
          pickDesc.toLowerCase().startsWith(away.split(' ')[0].toLowerCase());

        if (pickedHome) {
          grade = result.winner === 1 ? 'WON' : 'LOST';
          gradeReason = `${result.homeScore}-${result.awayScore}`;
        } else if (pickedAway) {
          grade = result.winner === 2 ? 'WON' : 'LOST';
          gradeReason = `${result.homeScore}-${result.awayScore}`;
        } else {
          grade = 'ERROR';
          gradeReason = 'Unknown pick format';
        }

        if (grade === 'WON') legStats.won++;
        else if (grade === 'LOST') {
          legStats.lost++;
          if (currentAccaId) accaTracking[currentAccaId].anyLost = true;
        }
      }

      // Update Assayer buckets
      bump(assayerStats.byEdgeGrade, edgeGrade, grade);
      bump(assayerStats.byPurityGrade, purityGrade, grade);
      bumpWL(assayerStats.byPurityGradeWL, purityGrade, grade);

      // Update status cell
      const statusCell = portfolioSheet.getRange(r + 1, COL_STATUS + 1);
      statusCell.setValue(grade);

      if (grade === 'WON') {
        statusCell.setBackground('#b7e1cd').setFontWeight('bold').setFontColor('#155724');
      } else if (grade === 'LOST') {
        statusCell.setBackground('#f4c7c3').setFontWeight('bold').setFontColor('#721c24');
      } else if (grade === 'PENDING') {
        statusCell.setBackground('#fff3cd').setFontWeight('bold').setFontColor('#856404');
      } else if (grade === 'ERROR') {
        statusCell.setBackground('#e0e0e0').setFontColor('#666666');
      }

      if (currentAccaId) {
        accaTracking[currentAccaId].legs.push({ row: r + 1, grade: grade, match: match, reason: gradeReason });
      }

      Logger.log(`[${FUNC_NAME}]   ${grade === 'WON' ? '✅' : grade === 'LOST' ? '❌' : '⏳'} Row ${r + 1}: ${match} → ${grade}`);
    }

    // STEP 3: Grade overall accumulators
    Logger.log(`[${FUNC_NAME}] STEP 3: Grading overall accumulators...`);

    const accaStats = { won: 0, lost: 0, pending: 0, total: 0 };

    for (const [accaId, acca] of Object.entries(accaTracking)) {
      if (!acca.statusRow) {
        Logger.log(`[${FUNC_NAME}]   ⚠️ ${accaId}: No status row found`);
        continue;
      }

      accaStats.total++;

      let overallGrade = 'PENDING';
      let overallColor = '#fff3cd';
      let fontColor = '#856404';

      if (acca.anyLost) {
        overallGrade = 'LOST';
        overallColor = '#f4c7c3';
        fontColor = '#721c24';
        accaStats.lost++;
      } else if (acca.allGraded && acca.legs.length > 0) {
        const allWon = acca.legs.every(leg => leg.grade === 'WON');
        if (allWon) {
          overallGrade = 'WON';
          overallColor = '#b7e1cd';
          fontColor = '#155724';
          accaStats.won++;
        } else {
          overallGrade = 'PENDING';
          accaStats.pending++;
        }
      } else {
        accaStats.pending++;
      }

      const statusCell = portfolioSheet.getRange(acca.statusRow, 2);
      statusCell.setValue(overallGrade);
      statusCell.setBackground(overallColor)
        .setFontWeight('bold')
        .setFontColor(fontColor)
        .setHorizontalAlignment('center');

      const wonLegs = acca.legs.filter(l => l.grade === 'WON').length;
      const lostLegs = acca.legs.filter(l => l.grade === 'LOST').length;
      const pendingLegs = acca.legs.filter(l => l.grade === 'PENDING').length;

      Logger.log(`[${FUNC_NAME}]   ${overallGrade === 'WON' ? '🏆' : overallGrade === 'LOST' ? '💔' : '⏳'} ${accaId}: ${overallGrade} (${wonLegs}W-${lostLegs}L-${pendingLegs}P)`);
    }

    // STEP 4: Summary (+ Assayer)
    Logger.log('');
    Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════`);
    Logger.log(`[${FUNC_NAME}] SUMMARY:`);
    Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════`);
    Logger.log(`[${FUNC_NAME}] Individual Legs: ✅${legStats.won} ❌${legStats.lost} ⏳${legStats.pending}`);
    Logger.log(`[${FUNC_NAME}] Accumulators: 🏆${accaStats.won} 💔${accaStats.lost} ⏳${accaStats.pending} 📊${accaStats.total}`);

    const legTotal = legStats.won + legStats.lost;
    const legWinRate = legTotal > 0 ? ((legStats.won / legTotal) * 100).toFixed(1) : 'N/A';

    const accaTotal = accaStats.won + accaStats.lost;
    const accaWinRate = accaTotal > 0 ? ((accaStats.won / accaTotal) * 100).toFixed(1) : 'N/A';

    Logger.log(`[${FUNC_NAME}] Win Rates: Legs=${legWinRate}% | Accas=${accaWinRate}%`);

    // Assayer coverage summary
    const edgeCoverage = assayerStats.legsTotal > 0 ? ((assayerStats.legsWithEdge / assayerStats.legsTotal) * 100).toFixed(1) : 'N/A';
    Logger.log(`[${FUNC_NAME}] Assayer Edge Coverage: ${assayerStats.legsWithEdge}/${assayerStats.legsTotal} (${edgeCoverage}%)`);

    const topRates = (mapWL) => {
      const rows = Object.keys(mapWL).map(k => {
        const d = mapWL[k];
        const n = d.won + d.lost;
        const wr = n > 0 ? (d.won / n) : 0;
        return { k, n, wr };
      }).filter(x => x.n >= 10).sort((a, b) => b.wr - a.wr).slice(0, 5);
      return rows.map(x => `${x.k}:${(x.wr * 100).toFixed(1)}% (n=${x.n})`).join(' | ');
    };

    const purityWL = topRates(assayerStats.byPurityGradeWL);
    if (purityWL) Logger.log(`[${FUNC_NAME}] Purity win rates (n≥10): ${purityWL}`);

    Logger.log(`[${FUNC_NAME}] ✅ COMPLETED`);

    ss.toast('✅ Results checked!', 'Risky Acca', 3);

    if (ui) {
      const summary =
        `🔍 RISKY ACCA RESULTS\n\n` +
        `INDIVIDUAL LEGS:\n` +
        `✅ Won: ${legStats.won}\n` +
        `❌ Lost: ${legStats.lost}\n` +
        `⏳ Pending: ${legStats.pending}\n` +
        `Win Rate: ${legWinRate}%\n\n` +
        `ACCUMULATORS:\n` +
        `🏆 Won: ${accaStats.won}\n` +
        `💔 Lost: ${accaStats.lost}\n` +
        `⏳ Pending: ${accaStats.pending}\n` +
        `Win Rate: ${accaWinRate}%\n\n` +
        `ASSAYER:\n` +
        `Edge Coverage: ${assayerStats.legsWithEdge}/${assayerStats.legsTotal} (${edgeCoverage}%)\n` +
        (purityWL ? `Purity (n≥10): ${purityWL}\n` : '') +
        `\nSee Risky_Acca_Portfolio for details.`;

      ui.alert('🔍 Risky Acca Results', summary, ui.ButtonSet.OK);
    }

  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ ERROR: ${e.message}`);
    Logger.log(`[${FUNC_NAME}] Stack: ${e.stack}`);
    if (ui) ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}

/**
 * Helper: Parse match string to extract home and away teams
 */
function _parseMatchString(matchStr) {
  var str = String(matchStr || '').trim();
  if (!str) return { home: '', away: '' };

  try { str = str.normalize('NFKC'); } catch (e) {}

  // Remove bracketed clutter
  str = str.replace(/\[(.*?)\]/g, ' ');

  // Remove parentheticals ONLY if they contain no digits
  // Preserves "(3-1)" scores but strips "(W)", "(Women)", "(live)"
  str = str.replace(/\(([^)]*)\)/g, function(m, inner) {
    return /\d/.test(inner) ? m : ' ';
  });

  str = str.replace(/\s+/g, ' ').trim();

  // Separators ordered by specificity (most explicit first).
  // Dash requires whitespace on BOTH sides to avoid splitting "Al-Ahly".
  var patterns = [
    /\s+vs\.?\s+/i,
    /\s+v\s+/i,
    /\s+@\s+/i,
    /\s+at\s+/i,
    /\s+[-–—]\s+/,       // "Team A - Team B" (spaces required both sides)
    /\s+x\s+/i            // "Team A x Team B"
  ];

  for (var p = 0; p < patterns.length; p++) {
    var parts = str.split(patterns[p]);
    if (parts && parts.length === 2) {
      var home = String(parts[0] || '').trim();
      var away = String(parts[1] || '').trim();
      if (home && away) return { home: home, away: away };
    }
  }

  return { home: '', away: '' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Analyze risky accumulator performance
 */
function analyzeRiskyAccaPerformance() {
  const FUNC_NAME = 'analyzeRiskyAccaPerformance';
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  // First check results
  checkRiskyAccaResults();

  Logger.log(`[${FUNC_NAME}] Analyzing performance...`);

  try {
    const portfolioSheet = ss.getSheetByName('Risky_Acca_Portfolio');
    if (!portfolioSheet) throw new Error('Risky_Acca_Portfolio not found.');

    const data = portfolioSheet.getDataRange().getValues();

    const stats = {
      byTier: {
        HIGH: { won: 0, lost: 0, pending: 0 },
        MEDIUM: { won: 0, lost: 0, pending: 0 },
        LOW: { won: 0, lost: 0, pending: 0 }
      },
      byStrategy: {
        'AGAINST_FOREBET': { won: 0, lost: 0, pending: 0 },
        'WITH_FOREBET': { won: 0, lost: 0, pending: 0 }
      },
      accas: { won: 0, lost: 0, pending: 0 },

      // NEW: Assayer
      assayer: {
        legsTotal: 0,
        legsWithEdge: 0,
        purityCounts: {},     // grade -> count
        edgeGradeWL: {},      // grade -> {won,lost}
        purityGradeWL: {}     // grade -> {won,lost}
      }
    };

    const COL_STRATEGY = 5;
    const COL_TIER = 6;
    const COL_STATUS = 10;
    const COL_EDGE_ID = 12;
    const COL_EDGE_GRADE = 13;
    const COL_PURITY_GRADE = 15;

    const bumpWL = (map, key, status) => {
      const k = String(key || 'UNKNOWN').toUpperCase().trim() || 'UNKNOWN';
      if (!map[k]) map[k] = { won: 0, lost: 0 };
      if (status === 'WON') map[k].won++;
      else if (status === 'LOST') map[k].lost++;
    };

    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      const cell0 = String(row[0] || '');
      const strategy = String(row[COL_STRATEGY] || '');
      const tierCell = String(row[COL_TIER] || '');
      const status = String(row[COL_STATUS] || '').toUpperCase().trim();

      // Count acca results
      if (cell0 === 'ACCA STATUS:') {
        const accaStatus = String(row[1] || '').toUpperCase().trim();
        if (accaStatus === 'WON') stats.accas.won++;
        else if (accaStatus === 'LOST') stats.accas.lost++;
        else stats.accas.pending++;
        continue;
      }

      // Count leg rows only
      const match = String(row[3] || '').trim();
      const pick = String(row[4] || '').trim();
      if (!match || !match.includes(' vs ') || !pick || pick === 'Pick') continue;

      // Existing tier/strategy buckets
      if (strategy && strategy !== 'Strategy') {
        const tier = tierCell.includes('HIGH') ? 'HIGH' :
          tierCell.includes('MEDIUM') ? 'MEDIUM' :
            tierCell.includes('LOW') ? 'LOW' : null;

        const strat = strategy.includes('vs') ? 'AGAINST_FOREBET' :
          strategy.includes('w/') ? 'WITH_FOREBET' : null;

        if (tier && stats.byTier[tier]) {
          if (status === 'WON') stats.byTier[tier].won++;
          else if (status === 'LOST') stats.byTier[tier].lost++;
          else stats.byTier[tier].pending++;
        }

        if (strat && stats.byStrategy[strat]) {
          if (status === 'WON') stats.byStrategy[strat].won++;
          else if (status === 'LOST') stats.byStrategy[strat].lost++;
          else stats.byStrategy[strat].pending++;
        }
      }

      // NEW: Assayer coverage + distributions
      stats.assayer.legsTotal++;
      const edgeId = String(row[COL_EDGE_ID] || '').trim();
      const edgeGrade = String(row[COL_EDGE_GRADE] || '').trim();
      const purityGrade = String(row[COL_PURITY_GRADE] || '').trim();

      if (edgeId) stats.assayer.legsWithEdge++;
      const pg = String(purityGrade || 'UNKNOWN').toUpperCase().trim() || 'UNKNOWN';
      stats.assayer.purityCounts[pg] = (stats.assayer.purityCounts[pg] || 0) + 1;

      if (status === 'WON' || status === 'LOST') {
        bumpWL(stats.assayer.edgeGradeWL, edgeGrade, status);
        bumpWL(stats.assayer.purityGradeWL, purityGrade, status);
      }
    }

    const fmtRate = (won, lost) => {
      const total = won + lost;
      return total > 0 ? ((won / total) * 100).toFixed(1) + '%' : 'N/A';
    };

    // Build report
    let report = '📈 RISKY ACCA PERFORMANCE\n\n';

    report += '═══ BY TIER ═══\n';
    for (const [tier, s] of Object.entries(stats.byTier)) {
      const total = s.won + s.lost;
      const rate = total > 0 ? ((s.won / total) * 100).toFixed(1) : 'N/A';
      report += `${tier}: ${s.won}W-${s.lost}L (${rate}%) [${s.pending} pending]\n`;
    }

    report += '\n═══ BY STRATEGY ═══\n';
    const afb = stats.byStrategy['AGAINST_FOREBET'];
    const wfb = stats.byStrategy['WITH_FOREBET'];

    report += `🔥 Against FB: ${afb.won}W-${afb.lost}L (${fmtRate(afb.won, afb.lost)})\n`;
    report += `📊 With FB: ${wfb.won}W-${wfb.lost}L (${fmtRate(wfb.won, wfb.lost)})\n`;

    report += '\n═══ ACCUMULATORS ═══\n';
    report += `💰 ${stats.accas.won}W-${stats.accas.lost}L (${fmtRate(stats.accas.won, stats.accas.lost)}) [${stats.accas.pending} pending]\n`;

    // NEW: Assayer section
    const edgeCoverage = stats.assayer.legsTotal > 0
      ? ((stats.assayer.legsWithEdge / stats.assayer.legsTotal) * 100).toFixed(1)
      : 'N/A';

    report += '\n═══ ASSAYER COVERAGE ═══\n';
    report += `Edge Coverage: ${stats.assayer.legsWithEdge}/${stats.assayer.legsTotal} (${edgeCoverage}%)\n`;

    const topDist = Object.keys(stats.assayer.purityCounts)
      .sort((a, b) => (stats.assayer.purityCounts[b] || 0) - (stats.assayer.purityCounts[a] || 0))
      .slice(0, 8)
      .map(g => `${g}:${stats.assayer.purityCounts[g]}`)
      .join(' | ');
    if (topDist) report += `Purity Dist: ${topDist}\n`;

    const topWL = (map) => {
      const rows = Object.keys(map).map(k => {
        const d = map[k];
        const n = d.won + d.lost;
        const wr = n > 0 ? (d.won / n) : 0;
        return { k, n, wr };
      }).filter(x => x.n >= 10).sort((a, b) => b.wr - a.wr).slice(0, 6);
      return rows.map(x => `${x.k}:${(x.wr * 100).toFixed(1)}% (n=${x.n})`).join(' | ');
    };

    const purityWL = topWL(stats.assayer.purityGradeWL);
    if (purityWL) report += `Purity WR (n≥10): ${purityWL}\n`;

    const edgeWL = topWL(stats.assayer.edgeGradeWL);
    if (edgeWL) report += `Edge WR (n≥10): ${edgeWL}\n`;

    Logger.log(`[${FUNC_NAME}] ${report}`);
    if (ui) ui.alert('📈 Risky Acca Performance', report, ui.ButtonSet.OK);

  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ ERROR: ${e.message}`);
    if (ui) ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}
