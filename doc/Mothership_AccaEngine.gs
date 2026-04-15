/**
 * ======================================================================
 * FILE: Mothership_AccaEngine.gs
 * PROJECT: Ma Golide - MOTHERSHIP
 * VERSION: 8.0 - USE ALL BETS
 * 
 * KEY FEATURES:
 * - ALL bets used exactly once (no leftovers)
 * - Random selection (Fisher-Yates shuffle)
 * - Same match CAN have different picks (Q1, Q3, Win all separate)
 * - Tracks by betId (league|match|pick), not just match
 * ======================================================================
 */

/**
 * ACCA_ENGINE_CONFIG — Phase 1 Patched
 *
 * Changes from previous version:
 *   - GOLD_ONLY_MODE kept for backward compat but NO LONGER auto-triggers gold gate
 *   - MIN_EDGE_GRADE / MIN_PURITY_GRADE remain as defaults for legacy gold gate path
 *   - New grade gate (Phase 1) uses caller overrides, NOT these config values
 *   - Odds range blocking removed from _filterBets (only invalid odds rejected)
 */
const ACCA_ENGINE_CONFIG = {
  TIME_WINDOW_HOURS: 48,
  MIN_CONFIDENCE: 0.50,

  DEFAULT_SNIPER_ODDS: 1.60,
  DEFAULT_BANKER_ODDS: 1.60,
  DEFAULT_SNIPER_CONF: 0.65,
  DEFAULT_BANKER_CONF: 0.75,

  ACCA_SIZES: [9, 6, 3],

  MAX_PER_LEAGUE: {
    12: 2, 9: 3, 6: 3, 5: 3, 4: 3, 3: 2, 2: 2, 1: 1
  },

  MAX_SAME_GAME_PICKS: 1,
  MAX_SAME_TIME_SLOT: 5,
  TIME_SLOT_MINUTES: 60,

  MIN_ACCURACY: { 12: 0, 9: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  EXCLUDE_PENALTY_FROM_SIZE: 99,

  MAX_WINDOW_HOURS: 24,

  DEFAULT_ACCURACY: 50,
  PENALTY_ACCURACY: 1,
  MIN_BANKER_ACCURACY: 0,
  MIN_SNIPER_ACCURACY: 0,

  STATUS: { PENDING: 'PENDING', WON: 'WON', LOST: 'LOST' },

  VERBOSE_LOGGING: true,

  // ─── Assayer Grade Policy (legacy defaults for gold gate recompute path) ───
  GOLD_ONLY_MODE: true,
  MIN_EDGE_GRADE: 'GOLD',
  MIN_PURITY_GRADE: 'GOLD',
  UNKNOWN_LEAGUE_ACTION: 'BLOCK',
  REQUIRE_RELIABLE_EDGE: true
};

// ═══════════════════════════════════════════════════════════════════════════════
// LEFTOVER BETS SYSTEM - FIXED WITH PICK-INCLUSIVE BET IDs
// ═══════════════════════════════════════════════════════════════════════════════

var LEFTOVER_CONFIG = {
  ACCA_SIZES:         [6, 4, 3, 2],  
  MAX_PER_LEAGUE:     3,              
  TIME_WINDOW_HOURS:  24,            
  MIN_POOL_SIZE:      2,              
  DEFAULT_ODDS:       1.50,          
  FORCE_DOUBLES:      true,          
  ALLOW_SINGLES:      true           
};

var BET_STATUS = {
  MAIN:     'MAIN_ACCA',
  LEFTOVER: 'LEFTOVER_ACCA',
  EXPIRED:  'EXPIRED',
  DROPPED:  'DROPPED'
};

// ============================================================
// ENRICH BETS WITH ACCURACY - PATCHED FOR SNIPER DIR
// ============================================================

/**
 * _enrichBetsWithAccuracy — Consolidated Patch
 *
 * Changes:
 *   - Stable betId via MD5 hash (not idx-dependent)
 *   - Grade histogram logged at end
 *   - ◄◄ PATCH: calls assayerStampBetEdgeRefs_ after enrichment so every bet
 *     carries explicit, provable edge references (id, pattern, type_key)
 */
function _enrichBetsWithAccuracy(bets, leagueMetrics, assayerData) {
  var FUNC_NAME = '_enrichBetsWithAccuracy';
  var PENALTY_ACCURACY = (ACCA_ENGINE_CONFIG && ACCA_ENGINE_CONFIG.PENALTY_ACCURACY) || 1.0;
  var DEFAULT_ACCURACY = (ACCA_ENGINE_CONFIG && ACCA_ENGINE_CONFIG.DEFAULT_ACCURACY) || 50.0;

  if (!bets || bets.length === 0) {
    Logger.log('[' + FUNC_NAME + '] No bets to enrich');
    return [];
  }

  var metrics = leagueMetrics || {};

  // ── Stable betId generator (MD5 hash — deterministic across runs) ──
  var _makeStableBetId = function(b) {
    var base = [
      String(b.league || '').trim().toUpperCase(),
      String(b.match || '').trim().toUpperCase(),
      String(b.pick || '').trim().toUpperCase(),
      String(b.type || '').trim().toUpperCase(),
      (b.time instanceof Date) ? b.time.toISOString() : String(b.time || '')
    ].join('|');

    try {
      var bytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5, base, Utilities.Charset.UTF_8);
      var hex = bytes.map(function(x) {
        var v = (x < 0) ? x + 256 : x;
        return ('0' + v.toString(16)).slice(-2);
      }).join('');
      return 'BET_' + hex.slice(0, 20);
    } catch (e) {
      return 'BET_' + base.replace(/[^A-Z0-9|]+/gi, '_').slice(0, 60);
    }
  };

  // ── Grade normalization helper ──
  var _normGrade = function(g) {
    var s = String(g || '').trim().toUpperCase();
    if (s === 'N/A' || s === 'NA' || s === 'UNKNOWN' || s === '-') return '';
    return s;
  };

  var bankerCount = 0;
  var sniperCount = 0;
  var sniperDirCount = 0;
  var sniperMarginCount = 0;
  var sniperOUCount = 0;
  var penaltyCount = 0;
  var matchedCount = 0;

  var assayerEdgeMatched = 0;
  var assayerPurityBlocked = 0;
  var betIdGenerated = 0;
  var edgeRefStamped = 0;                                  // ◄◄ PATCH counter

  var metricKeys = Object.keys(metrics);
  Logger.log('[' + FUNC_NAME + '] Available metric keys (' + metricKeys.length + '): ' +
    metricKeys.slice(0, 10).join(', ') + (metricKeys.length > 10 ? '...' : ''));

  var enriched = bets.map(function(bet) {
    var league = String(bet.league || '').trim();
    var betType = String(bet.type || '').toUpperCase();
    var pickStr = String(bet.pick || '').toUpperCase();

    var isBanker = betType.includes('BANKER') ||
                   betType.includes('TIER1') ||
                   betType.includes('WIN');

    var isSniper = betType.includes('SNIPER') ||
                   betType.includes('TIER2') ||
                   betType.includes('QUARTER');

    var isSniperDir = betType.includes('SNIPER DIR') ||
                      betType.includes('DIR') ||
                      (isSniper && /Q[1-4]\s*(OVER|UNDER)\s*[\d.]+/i.test(pickStr));

    var isSniperOU = betType.includes('O/U') || betType.includes('OU');
    var isSniperMargin = isSniper && !isSniperDir && !isSniperOU;

    if (isBanker) bankerCount++;
    if (isSniper) {
      sniperCount++;
      if (isSniperDir) sniperDirCount++;
      else if (isSniperOU) sniperOUCount++;
      else if (isSniperMargin) sniperMarginCount++;
    }

    // ── League metrics lookup ──
    var leagueMeta = null;
    var keysToTry = [
      league,
      league.toLowerCase(),
      league.toUpperCase(),
      league.replace(/\s+/g, ''),
      league.replace(/\s+/g, '_'),
      league.split(' ')[0],
      league.split(' ').pop()
    ];

    for (var ki = 0; ki < keysToTry.length; ki++) {
      var key = keysToTry[ki];
      if (key && metrics[key]) {
        leagueMeta = metrics[key];
        matchedCount++;
        break;
      }
    }

    if (!leagueMeta) {
      leagueMeta = {
        bankerAccuracy: PENALTY_ACCURACY,
        sniperAccuracy: PENALTY_ACCURACY,
        dirAccuracy: PENALTY_ACCURACY,
        hasTier1: false,
        hasTier2: false,
        hasDirConfig: false,
        tier1Source: 'Not Found',
        tier2Source: 'Not Found',
        dirSource: 'Not Found',
        leagueName: league,
        leagueCode: league
      };
    }

    var accuracyScore = DEFAULT_ACCURACY;
    var hasPenalty = false;
    var penaltyReason = '';
    var accuracySource = '';

    if (isBanker) {
      if (leagueMeta.hasTier1 && leagueMeta.bankerAccuracy > PENALTY_ACCURACY) {
        accuracyScore = leagueMeta.bankerAccuracy;
        accuracySource = leagueMeta.tier1Source || ('T1: ' + accuracyScore.toFixed(1) + '%');
      } else {
        accuracyScore = PENALTY_ACCURACY;
        hasPenalty = true;
        penaltyReason = '⚠️ No Config_Tier1 for ' + league;
        accuracySource = penaltyReason;
      }
    } else if (isSniperDir) {
      if (leagueMeta.hasTier2 && leagueMeta.sniperAccuracy > PENALTY_ACCURACY) {
        accuracyScore = leagueMeta.dirAccuracy || leagueMeta.sniperAccuracy;
        accuracySource = leagueMeta.dirSource || ('T2-DIR: ' + accuracyScore.toFixed(1) + '%');
      } else {
        accuracyScore = PENALTY_ACCURACY;
        hasPenalty = true;
        penaltyReason = '⚠️ No Config_Tier2 (DIR) for ' + league;
        accuracySource = penaltyReason;
      }
    } else if (isSniper) {
      if (leagueMeta.hasTier2 && leagueMeta.sniperAccuracy > PENALTY_ACCURACY) {
        accuracyScore = leagueMeta.sniperAccuracy;
        accuracySource = leagueMeta.tier2Source || ('T2: ' + accuracyScore.toFixed(1) + '%');
      } else {
        accuracyScore = PENALTY_ACCURACY;
        hasPenalty = true;
        penaltyReason = '⚠️ No Config_Tier2 for ' + league;
        accuracySource = penaltyReason;
      }
    } else {
      if (leagueMeta.hasTier1 || leagueMeta.hasTier2) {
        var scores = [];
        if (leagueMeta.bankerAccuracy > PENALTY_ACCURACY) scores.push(leagueMeta.bankerAccuracy);
        if (leagueMeta.sniperAccuracy > PENALTY_ACCURACY) scores.push(leagueMeta.sniperAccuracy);
        accuracyScore = scores.length > 0
          ? scores.reduce(function(a, b) { return a + b; }) / scores.length
          : DEFAULT_ACCURACY;
        accuracySource = 'Avg: ' + accuracyScore.toFixed(1) + '%';
      } else {
        accuracyScore = PENALTY_ACCURACY;
        hasPenalty = true;
        penaltyReason = '⚠️ No config for ' + league;
        accuracySource = penaltyReason;
      }
    }

    if (hasPenalty) penaltyCount++;

    // ── Clone bet + attach enrichment ──
    var betOut = {};
    for (var bk in bet) {
      if (Object.prototype.hasOwnProperty.call(bet, bk)) betOut[bk] = bet[bk];
    }

    // Ensure stable betId
    if (!betOut.betId || String(betOut.betId).trim() === '') {
      betOut.betId = _makeStableBetId(betOut);
      betIdGenerated++;
    }

    betOut.accuracyScore = accuracyScore;
    betOut.hasPenalty = hasPenalty;
    betOut.penaltyReason = penaltyReason;
    betOut.accuracySource = accuracySource;
    betOut.isBanker = isBanker;
    betOut.isSniper = isSniper;
    betOut.isSniperDir = isSniperDir;
    betOut.isSniperOU = isSniperOU;
    betOut.isSniperMargin = isSniperMargin;
    betOut.leagueMeta = {
      name: leagueMeta.leagueName,
      code: leagueMeta.leagueCode,
      tier1: leagueMeta.bankerAccuracy,
      tier2: leagueMeta.sniperAccuracy,
      dir: leagueMeta.dirAccuracy || leagueMeta.sniperAccuracy
    };

    // ── Assayer overlay ──
    betOut = assayerEnrichBet_(betOut, assayerData);

    // ◄◄ PATCH: stamp explicit edge references so bet proves what it matched
    if (typeof assayerStampBetEdgeRefs_ === 'function') {
      assayerStampBetEdgeRefs_(betOut);
      edgeRefStamped++;
    }

    // Preserve reliable flag at stable top-level location
    if (betOut.assayer && betOut.assayer.edge &&
        typeof betOut.assayer.edge.reliable === 'boolean') {
      betOut.assayer_edge_reliable = betOut.assayer.edge.reliable;
    }

    if (betOut.assayer && betOut.assayer.edge) assayerEdgeMatched++;
    if (betOut.assayer && betOut.assayer.blocked) assayerPurityBlocked++;

    // Apply score delta (lift pp + purity delta) — clamp to [0, 99.99]
    var delta = Number((betOut.assayer && betOut.assayer.scoreDelta) || 0);
    if (isFinite(delta) && delta !== 0) {
      betOut.accuracyScore = Math.max(0, Math.min(99.99, Number(betOut.accuracyScore) + delta));
      betOut.assayer_score_delta = delta;
    } else {
      betOut.assayer_score_delta = 0;
    }

    return betOut;
  });

  // Sort: non-penalty first, then by accuracy desc
  enriched.sort(function(a, b) {
    if (a.hasPenalty !== b.hasPenalty) return a.hasPenalty ? 1 : -1;
    return b.accuracyScore - a.accuracyScore;
  });

  // ── Grade histogram ──
  var gradeHist = {};
  for (var gi = 0; gi < enriched.length; gi++) {
    var eg = _normGrade(enriched[gi].assayer_edge_grade || '');
    var pg = _normGrade(enriched[gi].assayer_purity_grade || '');
    var gk = (eg || 'NONE') + '+' + (pg || 'NONE');
    gradeHist[gk] = (gradeHist[gk] || 0) + 1;
  }
  var histKeys = Object.keys(gradeHist).sort(function(a, b) { return gradeHist[b] - gradeHist[a]; });
  var histTop = histKeys.slice(0, 12).map(function(k) { return k + ':' + gradeHist[k]; }).join(' | ');

  // ── typeKey distribution (diagnostic for Breach 1 verification) ──       // ◄◄ PATCH
  var typeKeyHist = {};
  for (var ti = 0; ti < enriched.length; ti++) {
    var tk = enriched[ti].assayer_dims_type_key || 'NULL';
    typeKeyHist[tk] = (typeKeyHist[tk] || 0) + 1;
  }
  var tkKeys = Object.keys(typeKeyHist).sort(function(a, b) { return typeKeyHist[b] - typeKeyHist[a]; });
  var tkTop = tkKeys.map(function(k) { return k + ':' + typeKeyHist[k]; }).join(' | ');

  Logger.log('[' + FUNC_NAME + '] Assayer: edgeMatched=' + assayerEdgeMatched +
    ', purityBlocked=' + assayerPurityBlocked +
    ', edgeRefStamped=' + edgeRefStamped);                                    // ◄◄ PATCH

  if (betIdGenerated > 0) {
    Logger.log('[' + FUNC_NAME + '] ⚠️ Generated stable betId for ' + betIdGenerated +
      ' bets (missing from source)');
  }

  Logger.log('[' + FUNC_NAME + '] ═══════════════════════════════════════════════════════');
  Logger.log('[' + FUNC_NAME + '] ✅ Enriched ' + enriched.length + ' bets:');
  Logger.log('[' + FUNC_NAME + ']    🔒 Bankers: ' + bankerCount);
  Logger.log('[' + FUNC_NAME + ']    🎯 Snipers: ' + sniperCount);
  Logger.log('[' + FUNC_NAME + ']       ├─ DIR (directional O/U): ' + sniperDirCount);
  Logger.log('[' + FUNC_NAME + ']       ├─ O/U (non-directional): ' + sniperOUCount);
  Logger.log('[' + FUNC_NAME + ']       └─ Margin/Spread: ' + sniperMarginCount);
  Logger.log('[' + FUNC_NAME + ']    ✅ Matched to metrics: ' + matchedCount);
  Logger.log('[' + FUNC_NAME + ']    ⚠️ Penalties (no config): ' + penaltyCount);
  Logger.log('[' + FUNC_NAME + ']    📊 Grade distribution: ' + histTop);
  Logger.log('[' + FUNC_NAME + ']    🏷️ TypeKey distribution: ' + tkTop);    // ◄◄ PATCH
  Logger.log('[' + FUNC_NAME + '] ═══════════════════════════════════════════════════════');

  return enriched;
}

/**
 * Create enhanced acca object - PATCHED for SNIPER DIR tracking
 * @param {Array} legs - Array of bet leg objects
 * @param {string} name - Acca name/type
 * @returns {Object} Acca object with full metadata
 */
function _createAccaObjectEnhanced(legs, name) {
  const FUNC_NAME = '_createAccaObjectEnhanced';
  
  const times = legs.map(l => l.time instanceof Date ? l.time.getTime() : Date.now());
  const earliest = new Date(Math.min(...times));
  const latest = new Date(Math.max(...times));
  
  // Calculate aggregates
  const avgAccuracy = legs.reduce((sum, l) => sum + (l.accuracyScore || 1), 0) / legs.length;
  const avgConfidence = legs.reduce((sum, l) => sum + (l.confidence || 0), 0) / legs.length;
  const totalOdds = legs.reduce((acc, l) => acc * (parseFloat(l.odds) || 1.0), 1.0);
  const penaltyCount = legs.filter(l => l.hasPenalty).length;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PATCHED: Count by bet type including SNIPER DIR
  // ═══════════════════════════════════════════════════════════════════════════
  const bankerCount = legs.filter(l => l.isBanker).length;
  const sniperCount = legs.filter(l => l.isSniper).length;
  const sniperDirCount = legs.filter(l => l.isSniperDir).length;
  const sniperMarginCount = legs.filter(l => l.isSniperMargin).length;
  
  // Calculate league distribution
  const leagueCounts = {};
  legs.forEach(l => {
    const league = l.league || 'unknown';
    leagueCounts[league] = (leagueCounts[league] || 0) + 1;
  });
  const uniqueLeagues = Object.keys(leagueCounts).length;
  const maxLeagueConcentration = Math.max(...Object.values(leagueCounts));
  
  // Check for same-game picks
  const gameKeys = new Set();
  let sameGamePicks = 0;
  legs.forEach(l => {
    const key = _getGameKey(l);
    if (gameKeys.has(key)) sameGamePicks++;
    gameKeys.add(key);
  });
  
  // Calculate time spread
  const timeSpreadHours = (latest - earliest) / (1000 * 60 * 60);
  
  const acca = {
    id: `ACCA_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    name: `${name} (${avgAccuracy.toFixed(1)}% avg)`,
    type: name,
    legs: legs,
    totalOdds: totalOdds,
    avgAccuracy: avgAccuracy,
    avgConfidence: avgConfidence,
    penaltyCount: penaltyCount,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PATCHED: Bet type breakdown
    // ═══════════════════════════════════════════════════════════════════════════
    betTypeCounts: {
      banker: bankerCount,
      sniper: sniperCount,
      sniperDir: sniperDirCount,
      sniperMargin: sniperMarginCount
    },
    
    timeWindow: {
      start: earliest,
      end: latest
    },
    status: 'PENDING',
    createdAt: new Date(),
    
    // Diversification metadata
    diversification: {
      uniqueLeagues: uniqueLeagues,
      maxLeagueConcentration: maxLeagueConcentration,
      leagueCounts: leagueCounts,
      sameGamePicks: sameGamePicks,
      timeSpreadHours: timeSpreadHours.toFixed(1)
    }
  };
  
  if (ACCA_ENGINE_CONFIG?.VERBOSE_LOGGING) {
    Logger.log(`[${FUNC_NAME}] Created: ${acca.name}`);
    Logger.log(`[${FUNC_NAME}]   Legs: ${legs.length} (🔒${bankerCount} 🎯${sniperCount} DIR:${sniperDirCount})`);
    Logger.log(`[${FUNC_NAME}]   Odds: ${totalOdds.toFixed(2)}`);
    Logger.log(`[${FUNC_NAME}]   Avg Accuracy: ${avgAccuracy.toFixed(1)}%`);
  }
  
  return acca;
}

/**
 * Build multi-size summary - PATCHED for SNIPER DIR
 * @param {Array} portfolios - Array of acca portfolios
 * @param {number} totalBets - Total number of bets available
 * @returns {string} Summary text
 */
function _buildMultiSizeSummary(portfolios, totalBets) {
  const FUNC_NAME = '_buildMultiSizeSummary';
  
  if (portfolios.length === 0) {
    return 'No accumulators could be built.\n\nPossible causes:\n- Not enough bets synced\n- All bets filtered out (check time window)\n- Try syncing more leagues';
  }
  
  const totalLegs = portfolios.reduce((sum, a) => sum + a.legs.length, 0);
  const totalPenaltyLegs = portfolios.reduce((sum, a) => sum + (a.penaltyCount || 0), 0);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PATCHED: Count by bet type including SNIPER DIR
  // ═══════════════════════════════════════════════════════════════════════════
  let bankerLegs = 0;
  let sniperLegs = 0;
  let sniperDirLegs = 0;
  let sniperMarginLegs = 0;
  let sniperOULegs = 0;
  
  portfolios.forEach(p => {
    p.legs.forEach(leg => {
      const type = String(leg.type || '').toUpperCase();
      if (leg.isBanker || type.includes('BANKER')) {
        bankerLegs++;
      } else if (leg.isSniper || type.includes('SNIPER')) {
        sniperLegs++;
        if (leg.isSniperDir || type.includes('DIR')) {
          sniperDirLegs++;
        } else if (leg.isSniperOU || type.includes('O/U')) {
          sniperOULegs++;
        } else {
          sniperMarginLegs++;
        }
      }
    });
  });
  
  // Group by size
  const bySize = {};
  portfolios.forEach(p => {
    const size = p.legs.length;
    if (!bySize[size]) {
      bySize[size] = { count: 0, banker: 0, sniper: 0, mixed: 0, penalties: 0, dirLegs: 0 };
    }
    bySize[size].count++;
    bySize[size].penalties += (p.penaltyCount || 0);
    bySize[size].dirLegs += p.legs.filter(l => l.isSniperDir).length;
    
    const name = (p.name || '').toLowerCase();
    if (name.includes('banker')) bySize[size].banker++;
    else if (name.includes('sniper')) bySize[size].sniper++;
    else bySize[size].mixed++;
  });
  
  // Build summary
  let summary = `🎰 MULTI-SIZE ACCUMULATOR PORTFOLIO\n\n`;
  summary += `Built ${portfolios.length} accumulator(s)\n`;
  summary += `✅ ${totalLegs}/${totalBets} bets allocated\n`;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PATCHED: Show bet type breakdown with SNIPER DIR
  // ═══════════════════════════════════════════════════════════════════════════
  summary += `\n📋 BET TYPES:\n`;
  summary += `   🔒 Bankers: ${bankerLegs}\n`;
  summary += `   🎯 Snipers: ${sniperLegs}\n`;
  if (sniperDirLegs > 0) {
    summary += `      └─ DIR (O/U directional): ${sniperDirLegs}\n`;
  }
  if (sniperMarginLegs > 0) {
    summary += `      └─ Margin/Spread: ${sniperMarginLegs}\n`;
  }
  if (sniperOULegs > 0) {
    summary += `      └─ O/U (other): ${sniperOULegs}\n`;
  }
  
  if (totalPenaltyLegs > 0) {
    summary += `   ⚠️ Penalty legs: ${totalPenaltyLegs}\n`;
  }
  
  summary += `\n📊 BREAKDOWN BY SIZE:\n`;
  Object.keys(bySize).sort((a, b) => Number(b) - Number(a)).forEach(size => {
    const s = bySize[size];
    let line = `   ${size}-Fold: ${s.count} (🔒${s.banker} 🎯${s.sniper} ⚔️${s.mixed})`;
    if (s.dirLegs > 0) {
      line += ` [${s.dirLegs} DIR]`;
    }
    if (s.penalties > 0) {
      line += ` [${s.penalties} penalty]`;
    }
    summary += line + '\n';
  });
  
  // Highlight big accas
  const bigAccas = portfolios.filter(p => p.legs.length >= 9);
  if (bigAccas.length > 0) {
    summary += `\n🚀 BIG ACCAS (9+ legs):\n`;
    bigAccas.forEach(a => {
      const avgAcc = a.avgAccuracy ? a.avgAccuracy.toFixed(1) : '?';
      const dirCount = a.legs.filter(l => l.isSniperDir).length;
      const penaltyNote = a.penaltyCount > 0 ? ` ⚠️${a.penaltyCount} penalty` : '';
      const dirNote = dirCount > 0 ? ` 🎯${dirCount} DIR` : '';
      summary += `   • ${a.legs.length}-Fold @ ${a.totalOdds.toFixed(2)} odds (${avgAcc}% avg)${dirNote}${penaltyNote}\n`;
    });
  }
  
  summary += '\nCheck Acca_Portfolio sheet for details.';
  return summary;
}


/**
 * PATCHED: Apply visual formatting including accuracy source highlighting
 */
function _applyPortfolioFormattingEnhanced(sheet, data) {
  const FUNC_NAME = '_applyPortfolioFormattingEnhanced';
  const NUM_COLS = 12;
  const PENALTY_THRESHOLD = 5.0;
  
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const rowNum = r + 1;
    const range = sheet.getRange(rowNum, 1, 1, NUM_COLS);
    
    const cell0 = String(row[0] || '');
    const cellType = String(row[5] || '').toUpperCase();
    const cellAcc = String(row[8] || '');
    const cellInfo = String(row[10] || '');
    
    // Main header
    if (cell0.includes('MA GOLIDE')) {
      range.setFontWeight('bold').setFontSize(14).setBackground('#1a73e8').setFontColor('#ffffff');
      continue;
    }
    
    // Metadata rows
    if (cell0 === 'Generated:' || cell0 === 'Total Accas:') {
      range.setFontStyle('italic').setFontColor('#666666');
      continue;
    }
    
    // Size breakdown row
    if (cell0.includes('-Fold:')) {
      range.setFontWeight('bold').setFontColor('#1a73e8');
      continue;
    }
    
    // Acca header row
    if ((cell0.includes('-Fold') || cell0.includes('Double') || cell0.includes('Single') || cell0.includes('Treble')) && cell0.includes('|')) {
      range.setFontWeight('bold').setBackground('#e3f2fd').setBorder(true, true, true, true, false, false);
      if (cell0.includes('penalty')) {
        range.setBackground('#ffebee');
      }
      continue;
    }
    
    // Column header row
    if (cell0 === 'Date') {
      range.setFontWeight('bold').setBackground('#f5f5f5').setFontSize(9);
      continue;
    }
    
    // ACCA STATUS row
    if (cell0 === 'ACCA STATUS:') {
      const statusVal = String(row[1] || '').toUpperCase();
      let bg = '#fff3e0', fg = '#bf9000';
      if (statusVal === 'WON') { bg = '#b7e1cd'; fg = '#0f5132'; }
      if (statusVal === 'LOST') { bg = '#f4c7c3'; fg = '#c62828'; }
      range.setFontWeight('bold').setBackground(bg).setFontColor(fg);
      continue;
    }
    
    // Bet leg row
    if (cellType.includes('BANKER') || cellType.includes('SNIPER')) {
      // Row background based on type
      if (cellType.includes('BANKER')) {
        range.setBackground('#e8f5e9');
      } else {
        range.setBackground('#fffde7');
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // ACCURACY CELL (Column I) - Color based on value
      // ═══════════════════════════════════════════════════════════════════════════
      const accCell = sheet.getRange(rowNum, 9);
      
      if (cellAcc === 'PENALTY' || cellAcc === 'N/A') {
        accCell.setBackground('#d32f2f').setFontColor('#ffffff').setFontWeight('bold');
      } else {
        const accVal = parseFloat(cellAcc.replace('%', ''));
        if (!isNaN(accVal)) {
          if (accVal >= 80) {
            accCell.setBackground('#2e7d32').setFontColor('#ffffff').setFontWeight('bold');
          } else if (accVal >= 70) {
            accCell.setBackground('#4caf50').setFontColor('#ffffff').setFontWeight('bold');
          } else if (accVal >= 60) {
            accCell.setBackground('#81c784').setFontWeight('bold');
          } else if (accVal >= 50) {
            accCell.setBackground('#fff9c4');
          } else {
            accCell.setBackground('#ffcdd2');
          }
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // INFO CELL (Column K) - Color based on source type
      // ═══════════════════════════════════════════════════════════════════════════
      const infoCell = sheet.getRange(rowNum, 11);
      const infoLower = cellInfo.toLowerCase();
      
      if (infoLower.includes('⚠️') || infoLower.includes('no config') || infoLower.includes('not found')) {
        // Penalty/missing config - red
        infoCell.setBackground('#ffcdd2').setFontColor('#c62828');
      } else if (infoLower.includes('tier1') || infoLower.includes('t1:')) {
        // Tier1 source - green
        infoCell.setBackground('#c8e6c9').setFontColor('#2e7d32');
      } else if (infoLower.includes('tier2') || infoLower.includes('t2:')) {
        // Tier2 source - blue
        infoCell.setBackground('#bbdefb').setFontColor('#1565c0');
      } else if (cellInfo) {
        // Other info - light gray
        infoCell.setBackground('#f5f5f5').setFontColor('#666666');
      }
    }
  }
  
  // Freeze top rows
  sheet.setFrozenRows(6);
}

// ============================================================
// RANDOM SHUFFLE HELPER (Fisher-Yates)
// ============================================================
function _shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}


// ============================================================
// LOCAL HELPERS
// ============================================================

function _getSheet(ss, name) {
  if (!ss || !name) return null;
  const lower = name.toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === lower) return sheets[i];
  }
  return null;
}

function _createHeaderMap(headerRow) {
  const map = {};
  
  const aliases = {
    'league': ['league', 'competition', 'tournament'],
    'date': ['date', 'game date', 'match date', 'event date'],
    'time': ['time', 'kickoff', 'start time', 'datetime'],
    'match': ['match', 'game', 'matchup', 'teams'],
    'pick': ['pick', 'selection', 'bet', 'prediction'],
    'type': ['type', 'bet type', 'bettype', 'category'],
    'odds': ['odds', 'price', 'decimal odds'],
    'confidence': ['confidence', 'conf', 'conf%', 'probability', 'prob', 'margin'],
    'ev': ['ev', 'expected value', 'expectedvalue', 'value'],
    'home': ['home', 'home team', 'team1'],
    'away': ['away', 'away team', 'team2'],
    'status': ['status', 'game status', 'match status'],
    'ft score': ['ft score', 'ftscore', 'final score', 'score'],
    'q1': ['q1', 'quarter1', 'quarter 1', '1q'],
    'q2': ['q2', 'quarter2', 'quarter 2', '2q'],
    'q3': ['q3', 'quarter3', 'quarter 3', '3q'],
    'q4': ['q4', 'quarter4', 'quarter 4', '4q'],
    'pred': ['pred', 'prediction', 'predicted'],
    'acca id': ['acca id', 'accaid', 'id'],
    'legs won': ['legs won', 'legswon', 'won'],
    'legs lost': ['legs lost', 'legslost', 'lost'],
    'legs pending': ['legs pending', 'legspending', 'pending'],
    'result': ['result', 'outcome'],
    'file url': ['file url', 'fileurl', 'url', 'link'],
    'league name': ['league name', 'leaguename', 'name']
  };
  
  for (let i = 0; i < headerRow.length; i++) {
    const rawHeader = String(headerRow[i]).toLowerCase().trim();
    if (!rawHeader) continue;
    
    map[rawHeader] = i;
    
    for (const [canonical, aliasList] of Object.entries(aliases)) {
      if (aliasList.includes(rawHeader)) {
        map[canonical] = i;
      }
    }
  }
  
  return map;
}

function _normalizeMatchKey(league, match, pick) {
  const normLeague = String(league || '').toLowerCase().trim();
  const normMatch = String(match || '').toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*vs\.?\s*/gi, ' vs ')
    .replace(/[^\w\s]/g, '');
  const normPick = String(pick || '').toLowerCase().trim();
  return `${normLeague}|${normMatch}|${normPick}`;
}

function _normalizeMatchKeyForResults(team1, team2) {
  const norm1 = String(team1 || '').toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+w$/i, '')
    .trim();
  const norm2 = String(team2 || '').toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+w$/i, '')
    .trim();
  return `${norm1}|${norm2}`;
}

function _formatTimeDisplay(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '--:--';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function _formatDateValue(dateRaw) {
  if (dateRaw === null || dateRaw === undefined || dateRaw === '') return '';
  
  if (typeof dateRaw === 'number') {
    if (dateRaw > 40000 && dateRaw < 60000) {
      const msPerDay = 86400000;
      const sheetsEpoch = new Date(1899, 11, 30);
      const dateObj = new Date(sheetsEpoch.getTime() + Math.round(dateRaw * msPerDay));
      const day = String(dateObj.getDate()).padStart(2, '0');
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const year = dateObj.getFullYear();
      return `${day}/${month}/${year}`;
    }
    return ''; 
  }
  
  if (dateRaw instanceof Date) {
    if (isNaN(dateRaw.getTime())) return '';
    const day = String(dateRaw.getDate()).padStart(2, '0');
    const month = String(dateRaw.getMonth() + 1).padStart(2, '0');
    const year = dateRaw.getFullYear();
    return `${day}/${month}/${year}`;
  }
  
  if (typeof dateRaw === 'string') {
    const str = dateRaw.trim();
    
    const dmyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmyMatch) {
      const day = String(parseInt(dmyMatch[1], 10)).padStart(2, '0');
      const month = String(parseInt(dmyMatch[2], 10)).padStart(2, '0');
      const year = dmyMatch[3];
      return `${day}/${month}/${year}`;
    }
    
    const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ymdMatch) {
      const day = String(parseInt(ymdMatch[3], 10)).padStart(2, '0');
      const month = String(parseInt(ymdMatch[2], 10)).padStart(2, '0');
      const year = ymdMatch[1];
      return `${day}/${month}/${year}`;
    }
    
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const day = String(parsed.getDate()).padStart(2, '0');
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const year = parsed.getFullYear();
      return `${day}/${month}/${year}`;
    }
  }
  
  return '';
}

function _parseDateString(dateInput) {
  if (!dateInput) return null;
  
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : dateInput;
  }
  
  if (typeof dateInput === 'number' && dateInput > 40000 && dateInput < 60000) {
    const msPerDay = 86400000;
    const sheetsEpoch = new Date(1899, 11, 30);
    return new Date(sheetsEpoch.getTime() + dateInput * msPerDay);
  }
  
  const ddmmyyyy = String(dateInput).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    return new Date(
      parseInt(ddmmyyyy[3], 10),
      parseInt(ddmmyyyy[2], 10) - 1,
      parseInt(ddmmyyyy[1], 10)
    );
  }
  
  const yyyymmdd = String(dateInput).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmdd) {
    return new Date(
      parseInt(yyyymmdd[1], 10),
      parseInt(yyyymmdd[2], 10) - 1,
      parseInt(yyyymmdd[3], 10)
    );
  }
  
  const parsed = new Date(dateInput);
  return isNaN(parsed.getTime()) ? null : parsed;
}


function _parseMatchString(matchStr) {
  let str = String(matchStr || '').trim();
  if (!str) return { home: '', away: '' };

  try { str = str.normalize('NFKC'); } catch (e) {}

  // Remove obvious leading labels like "NBA: Team A vs Team B"
  str = str.replace(/^[A-Z0-9 _-]{2,16}:\s*/i, '');

  // Remove bracketed clutter
  str = str.replace(/\[(.*?)\]/g, ' ');

  // Remove parentheticals ONLY if they contain no digits
  // (preserves scores like "(3-1)" but strips "(W)", "(Women)", "(live)")
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
    /\s+[-–—]\s+/,      // "Team A - Team B" (spaces required)
    /\s+x\s+/i           // "Team A x Team B"
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


// ============================================================
// CORE PARSERS
// ============================================================

function _parseTime(timeRaw, dateRaw) {
  let betDate = new Date();
  
  if (dateRaw) {
    const dateStr = _formatDateValue(dateRaw);
    if (dateStr) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        betDate = new Date(year, month, day);
      }
    }
  }
  
  let hours = 0;
  let minutes = 0;
  let hasTimeComponent = false;
  
  if (timeRaw === null || timeRaw === undefined || timeRaw === '') {
    betDate.setHours(0, 0, 0, 0);
    return betDate;
  }
  
  if (timeRaw instanceof Date) {
    if (timeRaw.getFullYear() < 1950) {
      hours = timeRaw.getHours();
      minutes = timeRaw.getMinutes();
      hasTimeComponent = true;
    } else if (!isNaN(timeRaw.getTime())) {
      return timeRaw;
    }
  }
  
  if (typeof timeRaw === 'number' && !hasTimeComponent) {
    if (timeRaw < 1) {
      const totalMinutes = Math.round(timeRaw * 24 * 60);
      hours = Math.floor(totalMinutes / 60);
      minutes = totalMinutes % 60;
      hasTimeComponent = true;
    } else if (timeRaw > 40000 && timeRaw < 50000) {
      const msPerDay = 24 * 60 * 60 * 1000;
      const sheetsEpoch = new Date(1899, 11, 30);
      const parsed = new Date(sheetsEpoch.getTime() + timeRaw * msPerDay);
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }
  
  if (typeof timeRaw === 'string' && !hasTimeComponent) {
    const str = timeRaw.trim();
    
    const isoDate = new Date(str);
    if (!isNaN(isoDate.getTime()) && str.includes('-')) {
      return isoDate;
    }
    
    const timeMatch = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
      hasTimeComponent = true;
    }
  }
  
  if (hasTimeComponent) {
    betDate.setHours(hours, minutes, 0, 0);
    return betDate;
  }
  
  betDate.setHours(0, 0, 0, 0);
  return betDate;
}

// ============================================================
// CONFIDENCE PARSER - PATCHED FOR SNIPER DIR
// ============================================================

function _parseConfidence(confRaw, betType) {
  const typeUpper = (betType || '').toUpperCase();
  const isSniper = typeUpper.includes('SNIPER');
  const isSniperDir = typeUpper.includes('SNIPER DIR') || typeUpper.includes('DIR');
  
  // SNIPER DIR picks have actual confidence percentages (e.g., "63%")
  // Regular SNIPER margin picks have "Margin: +5.0" format
  
  if (confRaw === null || confRaw === undefined) {
    if (isSniperDir) return ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_CONF;
    if (isSniper) return ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_CONF;
    return ACCA_ENGINE_CONFIG.DEFAULT_BANKER_CONF;
  }
  
  const confStr = String(confRaw).toLowerCase().trim();
  
  if (!confStr || confStr === 'n/a' || confStr === '-' || confStr === 'na') {
    if (isSniperDir) return ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_CONF;
    if (isSniper) return ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_CONF;
    return ACCA_ENGINE_CONFIG.DEFAULT_BANKER_CONF;
  }
  
  // Handle "Margin: +X.X" format for regular snipers
  if (confStr.includes('margin')) {
    // Extract margin value and convert to pseudo-confidence
    const marginMatch = confStr.match(/[+-]?(\d+\.?\d*)/);
    if (marginMatch) {
      const margin = parseFloat(marginMatch[1]);
      // Higher margin = higher confidence (scale: margin 5 = 70%, margin 10 = 80%)
      return Math.min(0.85, 0.60 + (margin * 0.02));
    }
    return ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_CONF;
  }
  
  // Handle percentage format (e.g., "63%", "59%")
  if (confStr.includes('%')) {
    const val = parseFloat(confStr.replace('%', ''));
    return isNaN(val) ? ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_CONF : val / 100;
  }
  
  // Handle edge format (e.g., "Edge: 16.8%")
  if (confStr.includes('edge')) {
    const edgeMatch = confStr.match(/(\d+\.?\d*)/);
    if (edgeMatch) {
      // Convert edge to confidence (edge 10% = ~60% confidence)
      const edge = parseFloat(edgeMatch[1]);
      return Math.min(0.85, 0.50 + (edge / 100));
    }
    return ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_CONF;
  }
  
  const numVal = parseFloat(confStr);
  if (isNaN(numVal)) {
    if (isSniperDir) return ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_CONF;
    if (isSniper) return ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_CONF;
    return ACCA_ENGINE_CONFIG.DEFAULT_BANKER_CONF;
  }
  
  return numVal > 1 ? numVal / 100 : numVal;
}

function _parseOdds(oddsRaw, betType) {
  const isSniper = (betType || '').toUpperCase().includes('SNIPER');
  
  const oddsStr = String(oddsRaw || '').trim();
  
  if (!oddsStr || oddsStr === '-' || oddsStr === 'n/a') {
    return isSniper 
      ? ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_ODDS 
      : ACCA_ENGINE_CONFIG.DEFAULT_BANKER_ODDS;
  }
  
  const numOdds = parseFloat(oddsStr);
  
  if (isNaN(numOdds) || numOdds < 1.01) {
    return isSniper 
      ? ACCA_ENGINE_CONFIG.DEFAULT_SNIPER_ODDS 
      : ACCA_ENGINE_CONFIG.DEFAULT_BANKER_ODDS;
  }
  
  return numOdds;
}


// ============================================================
// MAIN ALLOCATION - USE ALL BETS + RANDOM
// ============================================================
/**
 * _allocatePortfolios — Phase 2 Patched (grade-agnostic)
 *
 * Changes from previous version:
 *   - Robust betId resolution via MD5 fallback (prevents silent Set misses)
 *   - Signature UNCHANGED: (bets, leagueMetrics, assayerData) — backward compatible
 *   - NO grade enforcement here: allocator builds whatever it receives.
 *     GOLD/SILVER filtering is the caller's responsibility.
 *     This ensures Phase 3 (Silver leftovers) can use the same allocator.
 */
function _allocatePortfolios(bets, leagueMetrics, assayerData) {
  const FUNC_NAME = '_allocatePortfolios';
  const portfolios = [];
  const usedBetIds = new Set();

  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════════════════╗');
  Logger.log('║     PATCHED ACCA ENGINE v3 — STRICT DP SIZE PLAN ENFORCEMENT             ║');
  Logger.log('╚══════════════════════════════════════════════════════════════════════════╝');

  // ── Robust betId accessor (MD5 fallback, matches _enrichBetsWithAccuracy) ──
  const getBetId = (b) => {
    if (!b) return '';
    var id = b.betId || b.id || b.bet_id;
    if (id && String(id).trim()) return String(id).trim();

    // MD5 fallback (same logic as _enrichBetsWithAccuracy)
    var base = [
      String(b.league || '').trim().toUpperCase(),
      String(b.match || '').trim().toUpperCase(),
      String(b.pick || '').trim().toUpperCase(),
      String(b.type || '').trim().toUpperCase(),
      (b.time instanceof Date) ? b.time.toISOString() : String(b.time || '')
    ].join('|');

    try {
      var bytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5, base, Utilities.Charset.UTF_8);
      var hex = bytes.map(function(x) {
        var v = (x < 0) ? x + 256 : x;
        return ('0' + v.toString(16)).slice(-2);
      }).join('');
      return 'BET_' + hex.slice(0, 20);
    } catch (e) {
      return 'BET_' + base.replace(/[^A-Z0-9|]+/gi, '_').slice(0, 60);
    }
  };

  // ── Ensure enriched ──
  let enrichedBets = bets;

  if (bets.length > 0 && bets[0].accuracyScore === undefined) {
    enrichedBets = _enrichBetsWithAccuracy(bets, leagueMetrics || {}, assayerData || null);
  }

  Logger.log(`[${FUNC_NAME}] Total bets available: ${enrichedBets.length}`);

  const bankers = enrichedBets.filter(b => b.isBanker);
  const snipers = enrichedBets.filter(b => b.isSniper);

  // Count distinct matches for diagnostics
  const allMatchKeys = {};
  enrichedBets.forEach(b => { allMatchKeys[_matchKey(b)] = true; });
  const distinctMatches = Object.keys(allMatchKeys).length;

  Logger.log(`[${FUNC_NAME}] 🔒 Bankers: ${bankers.length}, 🎯 Snipers: ${snipers.length}`);
  Logger.log(`[${FUNC_NAME}] Distinct matches: ${distinctMatches}`);

  // Generate balanced plan of 9s, 6s, and 3s
  const idealPlan = _buildSizePlan(enrichedBets.length, [9, 6, 3]);
  Logger.log(`[${FUNC_NAME}] Ideal size plan (${idealPlan.length} accas): ${idealPlan.join(', ')}`);

  const activeSizePlan = [...idealPlan];

  const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
  const MAX_PHASE_ACCAS = 60;

  /** Get unused bets from a pool */
  const getAvailable = (pool) => pool.filter(b => !usedBetIds.has(getBetId(b)));

  /**
   * Phase builder that respects the active size plan.
   */
  const buildPhase = (pool, label) => {
    let built = 0;
    while (built < MAX_PHASE_ACCAS) {
      const avail = getAvailable(pool);
      if (avail.length < 2) break;

      let success = false;
      const uniqueTargets = [...new Set(activeSizePlan.length > 0 ? activeSizePlan : [9, 6, 3, 2])].sort((a, b) => b - a);

      for (let si = 0; si < uniqueTargets.length; si++) {
        const size = uniqueTargets[si];
        if (avail.length < size) continue;

        const acca = _buildOneAccaWithConstraints(avail, size, label, MAX_WINDOW_MS);
        if (acca) {
          acca.legs.forEach(leg => usedBetIds.add(getBetId(leg)));
          portfolios.push(acca);
          built++;

          const planIdx = activeSizePlan.indexOf(size);
          if (planIdx !== -1) activeSizePlan.splice(planIdx, 1);

          Logger.log(`[${FUNC_NAME}]   ✅ Built ${label} ${size}-Fold (Plan remaining: ${activeSizePlan.join(',')})`);
          success = true;
          break;
        }
      }
      if (!success) break;
    }
    return built;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 1: BANKER ACCUMULATORS
  // ═════════════════════════════════════════════════════════════════════════
  Logger.log(`\n[${FUNC_NAME}] PHASE 1: BANKER ACCUMULATORS`);
  if (bankers.length >= 2) {
    buildPhase(bankers, '🔒 Banker');
  } else if (bankers.length === 1) {
    Logger.log(`[${FUNC_NAME}]   Only 1 banker — deferred to mixed phase`);
  } else {
    Logger.log(`[${FUNC_NAME}]   No bankers`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 2: SNIPER ACCUMULATORS
  // ═════════════════════════════════════════════════════════════════════════
  Logger.log(`\n[${FUNC_NAME}] PHASE 2: SNIPER ACCUMULATORS`);
  if (getAvailable(snipers).length >= 2) {
    buildPhase(snipers, '🎯 Sniper');
  } else {
    Logger.log(`[${FUNC_NAME}]   Not enough unused snipers`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 3: MIXED ACCUMULATORS (all remaining bets)
  // ═════════════════════════════════════════════════════════════════════════
  Logger.log(`\n[${FUNC_NAME}] PHASE 3: MIXED ACCUMULATORS`);
  let mixedBuilt = 0;
  while (mixedBuilt < MAX_PHASE_ACCAS) {
    const avail = getAvailable(enrichedBets);
    if (avail.length < 2) break;

    let success = false;
    const uniqueTargets = [...new Set(activeSizePlan.length > 0 ? activeSizePlan : [9, 6, 3, 2])].sort((a, b) => b - a);

    for (let si = 0; si < uniqueTargets.length; si++) {
      const size = uniqueTargets[si];
      if (avail.length < size) continue;

      const acca = _buildOneAccaWithConstraints(avail, size, '⚔️ Mixed', MAX_WINDOW_MS);
      if (acca) {
        let bCount = 0, sCount = 0;
        acca.legs.forEach(leg => {
          usedBetIds.add(getBetId(leg));
          if (leg.isBanker) bCount++;
          if (leg.isSniper) sCount++;
        });

        const mixedLabel = `⚔️ Mixed ${size}-Fold (🔒${bCount} 🎯${sCount})`;
        acca.name = `${mixedLabel} (${acca.avgAccuracy.toFixed(1)}% avg)`;
        acca.type = mixedLabel;

        portfolios.push(acca);
        mixedBuilt++;

        const planIdx = activeSizePlan.indexOf(size);
        if (planIdx !== -1) activeSizePlan.splice(planIdx, 1);

        Logger.log(`[${FUNC_NAME}]   ✅ Built ${mixedLabel}`);
        success = true;
        break;
      }
    }
    if (!success) break;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 4: DOUBLES — force remaining, still enforcing match uniqueness
  // ═════════════════════════════════════════════════════════════════════════
  Logger.log(`\n[${FUNC_NAME}] PHASE 4: DOUBLES (force remaining)`);

  let remaining = getAvailable(enrichedBets);
  Logger.log(`[${FUNC_NAME}] Remaining: ${remaining.length} bets`);

  if (typeof _shuffleArray === 'function') {
    remaining = _shuffleArray(remaining);
  }

  while (remaining.length >= 2) {
    const leg1 = remaining.shift();
    let foundPartner = false;

    for (let pi = 0; pi < remaining.length; pi++) {
      if (_matchKey(remaining[pi]) !== _matchKey(leg1)) {
        const leg2 = remaining.splice(pi, 1)[0];

        usedBetIds.add(getBetId(leg1));
        usedBetIds.add(getBetId(leg2));

        const bCount = (leg1.isBanker ? 1 : 0) + (leg2.isBanker ? 1 : 0);
        const sCount = (leg1.isSniper ? 1 : 0) + (leg2.isSniper ? 1 : 0);

        const acca = _createAccaObjectEnhanced(
          [leg1, leg2],
          `🎲 Double (🔒${bCount} 🎯${sCount})`
        );
        portfolios.push(acca);
        Logger.log(`[${FUNC_NAME}]   ✅ Built Double`);
        foundPartner = true;
        break;
      }
    }

    if (!foundPartner) {
      remaining.unshift(leg1);
      break;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 5: SINGLES — any truly unpairable bets
  // ═════════════════════════════════════════════════════════════════════════
  remaining = getAvailable(enrichedBets);

  if (remaining.length > 0) {
    Logger.log(`\n[${FUNC_NAME}] PHASE 5: SINGLES (${remaining.length} remaining)`);

    for (let ri = 0; ri < remaining.length; ri++) {
      const bet = remaining[ri];
      usedBetIds.add(getBetId(bet));
      const typeEmoji = bet.isBanker ? '🔒' : '🎯';
      const acca = _createAccaObjectEnhanced([bet], `📌 Single ${typeEmoji}`);
      portfolios.push(acca);
      Logger.log(`[${FUNC_NAME}]   ✅ Built Single: ${String(bet.pick || '').substring(0, 30)}`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // FINAL VERIFICATION
  // ═════════════════════════════════════════════════════════════════════════
  const finalUnused = getAvailable(enrichedBets);

  const sizeBreakdown = {};
  portfolios.forEach(p => {
    const n = p.legs.length;
    const key = n === 1 ? 'Singles' : (n === 2 ? 'Doubles' : `${n}-Fold`);
    sizeBreakdown[key] = (sizeBreakdown[key] || 0) + 1;
  });

  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════════════════╗');
  Logger.log('║                           ALLOCATION COMPLETE                            ║');
  Logger.log('╚══════════════════════════════════════════════════════════════════════════╝');
  Logger.log(`[${FUNC_NAME}] Total portfolios: ${portfolios.length}`);
  Logger.log(`[${FUNC_NAME}] Bets used: ${usedBetIds.size}/${enrichedBets.length}`);
  Logger.log(`[${FUNC_NAME}] 📊 Size breakdown: ${JSON.stringify(sizeBreakdown)}`);

  if (finalUnused.length > 0) {
    Logger.log(`[${FUNC_NAME}] ⚠️ UNUSED BETS (${finalUnused.length}):`);
    finalUnused.slice(0, 20).forEach(b => Logger.log(`   - ${getBetId(b)}`));
  } else {
    Logger.log(`[${FUNC_NAME}] 🎯 SUCCESS: ALL ${enrichedBets.length} BETS USED!`);
  }

  return portfolios;
}



/**
 * Build as many accas as possible from a pool until depleted
 * Uses RANDOM selection, tracks by betId (allows same match, different picks)
 */
function _buildAccasFromPool(pool, usedBetIds, legsNeeded, accaName) {
  const accas = [];
  const maxWindowMs = ACCA_ENGINE_CONFIG.MAX_WINDOW_HOURS * 60 * 60 * 1000;
  
  let iteration = 0;
  const maxIterations = 100;
  
  while (iteration < maxIterations) {
    iteration++;
    
    // Get remaining unused bets from this pool
    const available = pool.filter(b => !usedBetIds.has(b.betId));
    
    if (available.length < legsNeeded) {
      Logger.log(`   [Iter ${iteration}] Only ${available.length} bets left (need ${legsNeeded}) - stopping`);
      break;
    }
    
    // RANDOM SHUFFLE
    const shuffled = _shuffleArray(available);
    
    // Try to build one acca
    const acca = _buildSingleAccaRandom(shuffled, legsNeeded, accaName, maxWindowMs);
    
    if (!acca) {
      Logger.log(`   [Iter ${iteration}] Could not form valid ${legsNeeded}-fold - stopping`);
      break;
    }
    
    // Mark bets as used
    acca.legs.forEach(leg => usedBetIds.add(leg.betId));
    accas.push(acca);
    
    const legSummary = acca.legs.map(l => {
      const shortMatch = l.match.split(' vs ')[0].substring(0, 8);
      const shortPick = l.pick.substring(0, 10);
      return `${shortMatch}(${shortPick})`;
    }).join(', ');
    
    Logger.log(`   [Iter ${iteration}] ✅ Built: ${acca.legs.length} legs @ ${acca.totalOdds.toFixed(2)} | ${legSummary}`);
  }
  
  return accas;
}


/**
 * Build a single acca from randomly shuffled pool
 * Allows same match with different picks (tracked by betId)
 */
function _buildSingleAccaRandom(shuffledPool, legsNeeded, accaName, maxWindowMs) {
  // Try each bet as potential seed (they're already shuffled)
  for (let seedIdx = 0; seedIdx < shuffledPool.length; seedIdx++) {
    const seed = shuffledPool[seedIdx];
    const cluster = [seed];
    const usedBetIdsInAcca = new Set([seed.betId]);
    
    // --- 1. Initialize match key tracker with the seed's match ---
    const usedMatchKeys = new Set();
    // Ensure you have added the _getStrictMatchKey helper function I provided earlier
    usedMatchKeys.add(_getStrictMatchKey(seed)); 

    const leagueCounts = { [seed.league || 'unknown']: 1 };
    const t0 = seed.time instanceof Date ? seed.time.getTime() : Date.now();
    
    // Shuffle remaining candidates
    const candidates = _shuffleArray(
      shuffledPool.filter((b, idx) => idx !== seedIdx)
    );
    
    for (const cand of candidates) {
      if (cluster.length >= legsNeeded) break;
      
      // Skip if same betId already in this acca
      if (usedBetIdsInAcca.has(cand.betId)) continue;

      // --- 2. STRICT CHECK: Is this match already in the acca? ---
      const candMatchKey = _getStrictMatchKey(cand);
      if (usedMatchKeys.has(candMatchKey)) continue;
      
      // Time window check (relaxed)
      const candTime = cand.time instanceof Date ? cand.time.getTime() : Date.now();
      const timeDiff = Math.abs(candTime - t0);
      if (timeDiff > maxWindowMs) continue;
      
      // League limit check (relaxed)
      const league = cand.league || 'unknown';
      if ((leagueCounts[league] || 0) >= ACCA_ENGINE_CONFIG.MAX_PER_LEAGUE) continue;
      
      // All checks passed - add to acca
      cluster.push(cand);
      usedBetIdsInAcca.add(cand.betId);
      
      // --- 3. Add the new match key to our tracker ---
      usedMatchKeys.add(candMatchKey);
      
      leagueCounts[league] = (leagueCounts[league] || 0) + 1;
    }
    
    if (cluster.length >= legsNeeded) {
      return _createAccaObject(cluster.slice(0, legsNeeded), accaName);
    }
  }
  
  return null;
}


/**
 * Create acca object from legs
 */
function _createAccaObject(legs, name) {
  const times = legs.map(l => l.time.getTime());
  const earliestStart = new Date(Math.min(...times));
  const latestStart = new Date(Math.max(...times));
  
  const timestamp = Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
  
  return {
    id: `${name.replace(/[^\w]/g, '_')}_${timestamp}`,
    name: name,
    type: name,
    legs: legs,
    totalOdds: legs.reduce((acc, b) => acc * b.odds, 1.0),
    combinedOdds: legs.reduce((acc, b) => acc * b.odds, 1.0),
    avgConfidence: legs.reduce((acc, b) => acc + b.confidence, 0) / legs.length,
    earliestStart: earliestStart,
    latestStart: latestStart,
    timeWindow: `${_formatTimeDisplay(earliestStart)} - ${_formatTimeDisplay(latestStart)}`,
    status: ACCA_ENGINE_CONFIG.STATUS.PENDING
  };
}


// ============================================================
// OUTPUT WRITERS
// ============================================================

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * FIXED: Write accumulator portfolio to sheet
 * Resolves date formatting issue by enforcing Utilities.formatDate for all Date objects
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */
function _writePortfolio(sheet, accas) {
  const FUNC_NAME = '_writePortfolio';
  const NUM_COLS = 10;
  const TIME_ZONE = Session.getScriptTimeZone();
  
  // Clear sheet completely
  sheet.clear();
  sheet.clearFormats();
  
  const output = [];
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER SECTION
  // ═══════════════════════════════════════════════════════════════════════════
  output.push(['🎰 MA GOLIDE - ACCUMULATOR PORTFOLIO', '', '', '', '', '', '', '', '', '']);
  output.push(['', '', '', '', '', '', '', '', '', '']);
  output.push(['Generated:', _safeFormatDate(new Date(), TIME_ZONE, 'dd/MM/yyyy HH:mm'), '', '', '', '', '', '', '', '']);
  
  const totalLegs = accas.reduce((sum, a) => sum + (a.legs ? a.legs.length : 0), 0);
  output.push(['Total Accas:', String(accas.length), 'Total Bets Used:', String(totalLegs), '', '', '', '', '', '']);
  output.push(['', '', '', '', '', '', '', '', '', '']);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // EMPTY STATE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════
  if (!accas || accas.length === 0) {
    output.push(['No accumulators could be built with current data.', '', '', '', '', '', '', '', '', '']);
    output.push(['', '', '', '', '', '', '', '', '', '']);
    output.push(['Possible reasons:', '', '', '', '', '', '', '', '', '']);
    output.push(['- Not enough bets in time window', '', '', '', '', '', '', '', '', '']);
    output.push(['- Run "Sync All Leagues" first', '', '', '', '', '', '', '', '', '']);
    output.push(['- Check Sync_Temp sheet has valid data', '', '', '', '', '', '', '', '', '']);
  } else {
    // ═══════════════════════════════════════════════════════════════════════════
    // ACCUMULATOR BLOCKS
    // ═══════════════════════════════════════════════════════════════════════════
    accas.forEach(function(acca, accaIndex) {
      try {
        const legs = acca.legs || [];
        const bankerCount = legs.filter(l => l && l.isBanker).length;
        const sniperCount = legs.filter(l => l && l.isSniper).length;
        
        // Build header line safely
        const accaName = acca.name || `Acca ${accaIndex + 1}`;
        const legCount = legs.length;
        const totalOdds = (acca.totalOdds || 1).toFixed(2);
        const timeWindow = acca.timeWindow || 'N/A';
        const accaId = acca.id || `ACCA_${accaIndex}`;
        
        const headerLine = `${accaName} | ${legCount} Legs (🔒${bankerCount} 🎯${sniperCount}) | Odds: ${totalOdds} | Window: ${timeWindow}`;
        output.push([headerLine, '', '', '', '', '', '', '', '', accaId]);
        
        // Column headers
        output.push(['Date', 'Time', 'League', 'Match', 'Pick', 'Type', 'Odds', 'Conf%', 'Status', 'BetID']);
        
        // Sort legs by time
        const sortedLegs = [...legs].sort((a, b) => {
          const timeA = (a && a.time instanceof Date) ? a.time.getTime() : 0;
          const timeB = (b && b.time instanceof Date) ? b.time.getTime() : 0;
          return timeA - timeB;
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // LEG ROWS - WITH BULLETPROOF DATE FORMATTING
        // ═══════════════════════════════════════════════════════════════════════
        sortedLegs.forEach(function(leg, legIndex) {
          if (!leg) {
            Logger.log(`[${FUNC_NAME}] Skipping null leg at index ${legIndex}`);
            return;
          }
          
          // CRITICAL FIX: Format date properly
          const formattedDate = _extractFormattedDate(leg, TIME_ZONE);
          const formattedTime = _extractFormattedTime(leg, TIME_ZONE);
          
          // Build row with ALL STRING VALUES
          const legRow = [
            String(formattedDate),
            String(formattedTime),
            String(leg.league || ''),
            String(leg.match || ''),
            String(leg.pick || ''),
            String(leg.type || ''),
            _safeOddsFormat(leg.odds),
            _safeConfidenceFormat(leg.confidence),
            'PENDING',
            String(leg.betId || '')
          ];
          
          output.push(legRow);
        });
        
        // Acca status row
        output.push(['ACCA STATUS:', 'PENDING', '', '', '', '', '', '', '', '']);
        output.push(['', '', '', '', '', '', '', '', '', '']);
        
      } catch (accaError) {
        Logger.log(`[${FUNC_NAME}] Error processing acca ${accaIndex}: ${accaError.message}`);
        output.push([`Error in Acca ${accaIndex + 1}: ${accaError.message}`, '', '', '', '', '', '', '', '', '']);
        output.push(['', '', '', '', '', '', '', '', '', '']);
      }
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // NORMALIZE OUTPUT - ENSURE CONSISTENT COLUMNS AND ALL STRINGS
  // ═══════════════════════════════════════════════════════════════════════════
  const normalizedOutput = output.map((row, rowIndex) => {
    // Ensure row is an array
    const safeRow = Array.isArray(row) ? [...row] : [''];
    
    // Pad to NUM_COLS
    while (safeRow.length < NUM_COLS) {
      safeRow.push('');
    }
    
    // Truncate to NUM_COLS and FORCE STRING CONVERSION
    return safeRow.slice(0, NUM_COLS).map((cell, colIndex) => {
      return _forceCellToString(cell, TIME_ZONE, rowIndex, colIndex, FUNC_NAME);
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // WRITE TO SHEET
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    sheet.getRange(1, 1, normalizedOutput.length, NUM_COLS).setValues(normalizedOutput);
    Logger.log(`[${FUNC_NAME}] ✅ Written ${normalizedOutput.length} rows to sheet`);
  } catch (writeError) {
    Logger.log(`[${FUNC_NAME}] ❌ Write error: ${writeError.message}`);
    throw writeError;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // APPLY FORMATTING
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    _applyPortfolioFormatting(sheet, normalizedOutput);
  } catch (formatError) {
    Logger.log(`[${FUNC_NAME}] ⚠️ Formatting error (non-fatal): ${formatError.message}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SET COLUMN WIDTHS
  // ═══════════════════════════════════════════════════════════════════════════
  const columnWidths = [90, 60, 70, 200, 150, 100, 60, 60, 80, 250];
  columnWidths.forEach((width, index) => {
    try {
      sheet.setColumnWidth(index + 1, width);
    } catch (e) {
      // Ignore column width errors
    }
  });
  
  Logger.log(`[${FUNC_NAME}] ✅ Completed writing ${accas.length} accumulators`);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * HELPER: Extract and format date from leg object
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */
function _extractFormattedDate(leg, timeZone) {
  // Priority 1: Use leg.time if it's a valid Date
  if (leg.time instanceof Date && !isNaN(leg.time.getTime())) {
    try {
      return Utilities.formatDate(leg.time, timeZone, 'dd/MM/yyyy');
    } catch (e) {
      // Fall through to other methods
    }
  }
  
  // Priority 2: Use leg.date if it's a Date object
  if (leg.date instanceof Date && !isNaN(leg.date.getTime())) {
    try {
      return Utilities.formatDate(leg.date, timeZone, 'dd/MM/yyyy');
    } catch (e) {
      // Fall through to other methods
    }
  }
  
  // Priority 3: Use leg.date if it's already a formatted string
  if (typeof leg.date === 'string' && leg.date.trim()) {
    const cleaned = leg.date.trim();
    // Check if it looks like a valid short date (dd/mm/yyyy or similar)
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(cleaned)) {
      return cleaned;
    }
    // If it's a long date string, try to parse and reformat
    if (cleaned.length > 15) {
      try {
        const parsed = new Date(cleaned);
        if (!isNaN(parsed.getTime())) {
          return Utilities.formatDate(parsed, timeZone, 'dd/MM/yyyy');
        }
      } catch (e) {
        // Return truncated version as fallback
        return cleaned.substring(0, 10);
      }
    }
    return cleaned;
  }
  
  // Fallback: Return placeholder
  return '--/--/----';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * HELPER: Extract and format time from leg object
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */
function _extractFormattedTime(leg, timeZone) {
  // Priority 1: Use leg.time if it's a valid Date
  if (leg.time instanceof Date && !isNaN(leg.time.getTime())) {
    try {
      return Utilities.formatDate(leg.time, timeZone, 'HH:mm');
    } catch (e) {
      // Fall through
    }
  }
  
  // Priority 2: Check for _formatTimeDisplay function
  if (typeof _formatTimeDisplay === 'function') {
    try {
      const formatted = _formatTimeDisplay(leg.time);
      if (formatted && formatted !== 'Invalid Date' && formatted !== '[object Object]') {
        return String(formatted);
      }
    } catch (e) {
      // Fall through
    }
  }
  
  // Priority 3: If leg.time is a string
  if (typeof leg.time === 'string' && leg.time.includes(':')) {
    return leg.time.trim();
  }
  
  // Fallback
  return '--:--';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * HELPER: Force any cell value to a safe string
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */
function _forceCellToString(cell, timeZone, rowIndex, colIndex, funcName) {
  // Handle null/undefined
  if (cell === null || cell === undefined) {
    return '';
  }
  
  // Handle Date objects - THIS IS THE CRITICAL FIX
  if (cell instanceof Date) {
    if (isNaN(cell.getTime())) {
      return '';
    }
    try {
      // Determine format based on column (Date col = 0, Time col = 1)
      if (colIndex === 0) {
        return Utilities.formatDate(cell, timeZone, 'dd/MM/yyyy');
      } else if (colIndex === 1) {
        return Utilities.formatDate(cell, timeZone, 'HH:mm');
      } else {
        return Utilities.formatDate(cell, timeZone, 'dd/MM/yyyy HH:mm');
      }
    } catch (e) {
      Logger.log(`[${funcName}] Date format error at [${rowIndex},${colIndex}]: ${e.message}`);
      return '';
    }
  }
  
  // Handle numbers
  if (typeof cell === 'number') {
    return String(cell);
  }
  
  // Handle booleans
  if (typeof cell === 'boolean') {
    return cell ? 'TRUE' : 'FALSE';
  }
  
  // Handle objects (shouldn't happen but safety check)
  if (typeof cell === 'object') {
    try {
      return JSON.stringify(cell);
    } catch (e) {
      return '[Object]';
    }
  }
  
  // Default: convert to string
  return String(cell);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * HELPER: Safe date formatting with fallback
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */
function _safeFormatDate(date, timeZone, format) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '--/--/----';
  }
  try {
    return Utilities.formatDate(date, timeZone, format);
  } catch (e) {
    // Manual fallback
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    
    if (format.includes('HH:mm')) {
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    }
    return `${day}/${month}/${year}`;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * HELPER: Safe odds formatting
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */
function _safeOddsFormat(odds) {
  const numOdds = parseFloat(odds);
  if (isNaN(numOdds) || numOdds <= 0) {
    return '1.00';
  }
  return numOdds.toFixed(2);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * HELPER: Safe confidence formatting
 * ═══════════════════════════════════════════════════════════════════════════════════════
 */
function _safeConfidenceFormat(confidence) {
  const numConf = parseFloat(confidence);
  if (isNaN(numConf)) {
    return '0%';
  }
  // Handle both decimal (0.75) and percentage (75) formats
  const percentage = numConf > 1 ? numConf : numConf * 100;
  return Math.round(percentage) + '%';
}

/**
 * Apply visual formatting to portfolio sheet
 * Color-codes accuracy percentages
 */
function _applyPortfolioFormatting(sheet, data) {
  const FUNC_NAME = '_applyPortfolioFormatting';
  const NUM_COLS = 12;
  
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const rowNum = r + 1;
    const range = sheet.getRange(rowNum, 1, 1, NUM_COLS);
    
    const cell0 = String(row[0] || '');
    const cellType = String(row[5] || '').toUpperCase();
    const cellAcc = String(row[8] || '');
    const cellInfo = String(row[10] || '');
    
    // Main header
    if (cell0.includes('MA GOLIDE')) {
      range.setFontWeight('bold').setFontSize(14).setBackground('#1a73e8').setFontColor('#ffffff');
      continue;
    }
    
    // Metadata rows
    if (cell0 === 'Generated:' || cell0 === 'Total Accas:') {
      range.setFontStyle('italic').setFontColor('#666666');
      continue;
    }
    
    // Size breakdown row
    if (cell0.includes('-Fold:')) {
      range.setFontWeight('bold').setFontColor('#1a73e8');
      continue;
    }
    
    // Acca header row
    if ((cell0.includes('-Fold') || cell0.includes('Double') || cell0.includes('Single') || cell0.includes('Treble')) && cell0.includes('|')) {
      range.setFontWeight('bold').setBackground('#e3f2fd').setBorder(true, true, true, true, false, false);
      if (cell0.includes('penalty')) {
        range.setBackground('#ffebee');
      }
      continue;
    }
    
    // Column header row
    if (cell0 === 'Date') {
      range.setFontWeight('bold').setBackground('#f5f5f5').setFontSize(9);
      continue;
    }
    
    // ACCA STATUS row
    if (cell0 === 'ACCA STATUS:') {
      const statusVal = String(row[1] || '').toUpperCase();
      let bg = '#fff3e0', fg = '#bf9000';
      if (statusVal === 'WON') { bg = '#b7e1cd'; fg = '#0f5132'; }
      if (statusVal === 'LOST') { bg = '#f4c7c3'; fg = '#c62828'; }
      range.setFontWeight('bold').setBackground(bg).setFontColor(fg);
      continue;
    }
    
    // Bet leg row
    if (cellType.includes('BANKER') || cellType.includes('SNIPER')) {
      // Row background based on type
      if (cellType.includes('BANKER')) {
        range.setBackground('#e8f5e9');
      } else {
        range.setBackground('#fffde7');
      }
      
      // Accuracy cell coloring
      const accCell = sheet.getRange(rowNum, 9);
      
      if (cellAcc === 'PENALTY' || cellAcc === 'N/A') {
        accCell.setBackground('#d32f2f').setFontColor('#ffffff').setFontWeight('bold');
      } else {
        const accVal = parseFloat(cellAcc.replace('%', ''));
        if (!isNaN(accVal)) {
          if (accVal >= 70) {
            accCell.setBackground('#2e7d32').setFontColor('#ffffff').setFontWeight('bold');
          } else if (accVal >= 60) {
            accCell.setBackground('#81c784').setFontWeight('bold');
          } else if (accVal >= 50) {
            accCell.setBackground('#fff9c4');
          } else {
            accCell.setBackground('#ffcdd2');
          }
        }
      }
      
      // Info cell for penalty reason
      if (cellInfo && cellInfo.toLowerCase().includes('no config')) {
        sheet.getRange(rowNum, 11).setBackground('#ffcdd2').setFontColor('#c62828');
      }
    }
  }
  
  // Freeze top rows
  sheet.setFrozenRows(5);
}

function _writeResults(ss, portfolios) {
  let sheet = _getSheet(ss, 'Acca_Results');
  if (!sheet) sheet = ss.insertSheet('Acca_Results');
  sheet.clear();
  
  const headers = ['Acca ID', 'Type', 'Legs', 'Bankers', 'Snipers', 'Total Odds', 'Created', 'Status', 'Legs Won', 'Legs Lost', 'Legs Pending', 'Result'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#38761d').setFontColor('#ffffff');
  
  const rows = portfolios.map(acca => {
    const bankerCount = acca.legs.filter(l => l.isBanker).length;
    const sniperCount = acca.legs.filter(l => l.isSniper).length;
    
    return [
      acca.id,
      acca.name,
      acca.legs.length,
      bankerCount,
      sniperCount,
      acca.totalOdds.toFixed(2),
      new Date().toLocaleString(),
      ACCA_ENGINE_CONFIG.STATUS.PENDING,
      0, 0, acca.legs.length,
      'N/A'
    ];
  });
  
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, headers.length);
}

function _buildSummary(portfolios, totalBets) {
  if (portfolios.length === 0) {
    return 'No accumulators could be built.\n\nTry syncing more leagues.';
  }
  
  const totalLegs = portfolios.reduce((sum, a) => sum + a.legs.length, 0);
  const bankerAccas = portfolios.filter(p => p.name.includes('Banker'));
  const sniperAccas = portfolios.filter(p => p.name.includes('Sniper'));
  const mixedAccas = portfolios.filter(p => p.name.includes('Mixed'));
  const doubles = portfolios.filter(p => p.name.includes('Double'));
  const singles = portfolios.filter(p => p.name.includes('Single'));
  
  let summary = `Built ${portfolios.length} accumulator(s)\n`;
  summary += `✅ ALL ${totalLegs}/${totalBets} bets used!\n\n`;
  
  if (bankerAccas.length > 0) {
    summary += `🔒 BANKER ACCAS (${bankerAccas.length}):\n`;
    bankerAccas.forEach(a => {
      summary += `   • ${a.legs.length} legs @ ${a.totalOdds.toFixed(2)} odds\n`;
    });
    summary += '\n';
  }
  
  if (sniperAccas.length > 0) {
    summary += `🎯 SNIPER ACCAS (${sniperAccas.length}):\n`;
    sniperAccas.forEach(a => {
      summary += `   • ${a.legs.length} legs @ ${a.totalOdds.toFixed(2)} odds\n`;
    });
    summary += '\n';
  }
  
  if (mixedAccas.length > 0) {
    summary += `⚔️ MIXED ACCAS (${mixedAccas.length}):\n`;
    mixedAccas.forEach(a => {
      const b = a.legs.filter(l => l.isBanker).length;
      const s = a.legs.filter(l => l.isSniper).length;
      summary += `   • ${a.legs.length} legs (🔒${b} 🎯${s}) @ ${a.totalOdds.toFixed(2)} odds\n`;
    });
    summary += '\n';
  }
  
  if (doubles.length > 0) {
    summary += `🎲 DOUBLES (${doubles.length}):\n`;
    doubles.forEach(a => {
      summary += `   • 2 legs @ ${a.totalOdds.toFixed(2)} odds\n`;
    });
    summary += '\n';
  }
  
  if (singles.length > 0) {
    summary += `📌 SINGLES (${singles.length}):\n`;
    singles.forEach(a => {
      summary += `   • ${a.legs[0].pick} @ ${a.totalOdds.toFixed(2)} odds\n`;
    });
  }
  
  summary += '\nCheck Acca_Portfolio sheet for details.';
  return summary;
}

// 15. _writePortfolioWithAccuracy  (PATCHED: 13 columns + dedicated Assayer Proof column, no silent swallow)

function _writePortfolioWithAccuracy(sheet, accas, leagueMetrics) {
  const FUNC_NAME = '_writePortfolioWithAccuracy';
  const NUM_COLS = 13; // PATCHED
  const PENALTY_THRESHOLD = 5.0;
  
  // Ensure we have metrics to look up
  const metrics = leagueMetrics || {};
  const hasMetrics = Object.keys(metrics).length > 0;
  
  Logger.log(`[${FUNC_NAME}] Starting write with ${accas.length} accas, metrics available: ${hasMetrics} (${Object.keys(metrics).length} keys)`);
  
  sheet.clear();
  
  const output = [];
  
  // Header section
  output.push(['🎰 MA GOLIDE - MULTI-SIZE PORTFOLIO', '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['Generated:', new Date().toLocaleString(), '', '', '', '', '', '', '', '', '', '', '']);
  
  const totalLegs = accas.reduce((sum, a) => sum + a.legs.length, 0);
  output.push(['Total Accas:', accas.length, '', 'Total Bets:', totalLegs, '', '', '', '', '', '', '', '']);
  output.push(['', '', '', '', '', '', '', '', '', '', '', '', '']);
  
  // Size breakdown
  const sizeMap = {};
  accas.forEach(a => {
    const size = a.legs.length;
    sizeMap[size] = (sizeMap[size] || 0) + 1;
  });
  const sizeStr = Object.keys(sizeMap)
    .sort((a, b) => Number(b) - Number(a))
    .map(s => `${s}-Fold: ${sizeMap[s]}`)
    .join(' | ');
  output.push([sizeStr || 'No accumulators', '', '', '', '', '', '', '', '', '', '', '', '']);
  output.push(['', '', '', '', '', '', '', '', '', '', '', '', '']);
  
  if (accas.length === 0) {
    output.push(['No accumulators built with current configuration.', '', '', '', '', '', '', '', '', '', '', '', '']);
  } else {
    // Sort accas by size descending
    const sortedAccas = [...accas].sort((a, b) => b.legs.length - a.legs.length);
    
    for (const acca of sortedAccas) {
      // Calculate average accuracy (excluding penalties)
      let sumAcc = 0, countAcc = 0, penaltyLegs = 0;
      
      for (const leg of acca.legs) {
        if (leg.hasPenalty || leg.accuracyScore <= PENALTY_THRESHOLD) {
          penaltyLegs++;
        } else {
          sumAcc += leg.accuracyScore;
          countAcc++;
        }
      }
      
      const avgAcc = countAcc > 0 ? (sumAcc / countAcc).toFixed(1) : 'N/A';
      const penaltyNote = penaltyLegs > 0 ? ` | ⚠️${penaltyLegs} penalty` : '';
      
      // Acca header row
      const accaHeader = `${acca.type || acca.name} | Legs: ${acca.legs.length} | Odds: ${acca.totalOdds.toFixed(2)} | Avg Acc: ${avgAcc}%${penaltyNote}`;
      output.push([accaHeader, '', '', '', '', '', '', '', '', '', '', '', acca.id || '']);
      
      // Column headers
      output.push(['Date', 'Time', 'League', 'Match', 'Pick', 'Type', 'Odds', 'Conf%', 'Acc%', 'Status', 'Info', 'Assayer Proof', 'BetID']);
      
      // Sort legs by time
      const sortedLegs = [...acca.legs].sort((a, b) => {
        const tA = a.time instanceof Date ? a.time.getTime() : 0;
        const tB = b.time instanceof Date ? b.time.getTime() : 0;
        return tA - tB;
      });
      
      for (const leg of sortedLegs) {
        // Format time
        let timeDisplay = '';
        if (leg.time instanceof Date) {
          try {
            timeDisplay = Utilities.formatDate(leg.time, Session.getScriptTimeZone(), 'HH:mm');
          } catch (e) {
            timeDisplay = leg.time.toTimeString().substring(0, 5);
          }
        } else if (leg.time) {
          timeDisplay = String(leg.time);
        }
        
        // Format confidence
        const confDisplay = leg.confidence ? `${(leg.confidence * 100).toFixed(0)}%` : 'N/A';
        
        // Format accuracy
        let accDisplay = 'N/A';
        if (leg.accuracyScore !== undefined && leg.accuracyScore !== null) {
          if (leg.hasPenalty || leg.accuracyScore <= PENALTY_THRESHOLD) {
            accDisplay = 'PENALTY';
          } else {
            accDisplay = `${leg.accuracyScore.toFixed(2)}%`;
          }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // INFO COLUMN: Look up source directly from metrics at write time
        // ═══════════════════════════════════════════════════════════════════════════
        let infoDisplay = '';
        
        // First try to use pre-computed accuracySource if available
        if (leg.accuracySource && leg.accuracySource.length > 0) {
          infoDisplay = leg.accuracySource;
        } 
        // Otherwise, look up from metrics directly
        else if (hasMetrics) {
          const leagueKey = String(leg.league || '').trim();
          const betType = String(leg.type || '').toUpperCase();
          const isBanker = betType.includes('BANKER');
          const isSniper = betType.includes('SNIPER');
          
          // Try multiple lookup keys
          const keysToTry = [leagueKey, leagueKey.toLowerCase(), leagueKey.toUpperCase()];
          let foundMeta = null;
          
          for (const key of keysToTry) {
            if (metrics[key]) {
              foundMeta = metrics[key];
              break;
            }
          }
          
          if (foundMeta) {
            if (isBanker && foundMeta.hasTier1) {
              infoDisplay = foundMeta.tier1Source || `T1: ${foundMeta.bankerAccuracy.toFixed(1)}%`;
            } else if (isSniper && foundMeta.hasTier2) {
              infoDisplay = foundMeta.tier2Source || `T2: ${foundMeta.sniperAccuracy.toFixed(1)}%`;
            } else if (isBanker && !foundMeta.hasTier1) {
              infoDisplay = '⚠️ No Tier1';
            } else if (isSniper && !foundMeta.hasTier2) {
              infoDisplay = '⚠️ No Tier2';
            }
          } else {
            infoDisplay = `⚠️ No config: ${leagueKey}`;
          }
        }
        // Fallback to penalty reason
        else if (leg.penaltyReason) {
          infoDisplay = leg.penaltyReason;
        }

        // PATCHED: dedicated proof column
        let assayerProof = '';
        if (leg.assayer_proof_log && String(leg.assayer_proof_log).length > 0) {
          assayerProof = String(leg.assayer_proof_log);
        } else if (leg.assayer_verdict) {
          assayerProof = String(leg.assayer_verdict);
        }

        // PHASE 1: prepend Assayer edge + purity to Info column
        try {
          const edge = leg.assayer?.edge;
          const purity = leg.assayer?.purity;
        
          const parts = [];
        
          if (edge && edge.edge_id) {
            const liftPP = (typeof edge.lift === "number") ? (edge.lift * 100) : null;
            const liftTxt = (liftPP != null) ? `${liftPP >= 0 ? "+" : ""}${liftPP.toFixed(1)}pp` : "";
            const sym = edge.symbol || "EDGE";
            const g = edge.grade || "";
            parts.push(`${sym} ${g} ${liftTxt}`.trim());
          }
        
          if (purity && purity.grade) {
            const st = purity.status || "";
            parts.push(`${st} ${purity.grade}`.trim());
          }
        
          if (parts.length) {
            infoDisplay = `${parts.join(" | ")} | ${infoDisplay}`.trim();
          }
        } catch (e) {
          // never break writer
          if (!assayerProof) assayerProof = `AssayerVerdict=ERROR; reasons=[WRITER_RENDER_EXCEPTION]; err="${String(e && e.message || e)}"`;
        }
        
        // Debug log for first few legs
        if (output.length < 15) {
          Logger.log(`[${FUNC_NAME}] Leg: ${leg.league} | Type: ${leg.type} | Acc: ${accDisplay} | Info: "${infoDisplay}"`);
        }
        
        output.push([
          leg.date || '',
          timeDisplay,
          leg.league || '',
          leg.match || '',
          leg.pick || '',
          leg.type || '',
          (parseFloat(leg.odds) || 1).toFixed(2),
          confDisplay,
          accDisplay,
          'PENDING',
          infoDisplay,
          assayerProof,
          leg.betId || ''
        ]);
      }
      
      // Acca status row
      output.push(['ACCA STATUS:', 'PENDING', '', '', '', '', '', '', '', '', '', '', '']);
      output.push(['', '', '', '', '', '', '', '', '', '', '', '', '']);
    }
  }
  
  // Normalize row lengths
  const normalized = output.map(row => {
    const r = [...row];
    while (r.length < NUM_COLS) r.push('');
    return r.slice(0, NUM_COLS);
  });
  
  // Write data
  sheet.getRange(1, 1, normalized.length, NUM_COLS).setValues(normalized);
  
  // Apply formatting
  _applyPortfolioFormattingWithInfo(sheet, normalized);
  
  // Set column widths - make Info column wider
  const widths = [90, 55, 70, 200, 140, 100, 55, 55, 70, 70, 180, 320, 140]; // PATCHED
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  
  Logger.log(`[${FUNC_NAME}] ✅ Portfolio written (${normalized.length} rows, ${accas.length} accas)`);
}


// ============================================================
// PORTFOLIO FORMATTING - PATCHED FOR SNIPER DIR
// ============================================================

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PORTFOLIO FORMATTING - PATCHED FOR SNIPER DIR
 * Applies visual styling with distinct colors for SNIPER DIR
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Apply formatting to portfolio sheet - PATCHED for SNIPER DIR
 * @param {Sheet} sheet - The portfolio sheet
 * @param {Array} data - 2D array of data
 */
function _applyPortfolioFormattingWithInfo(sheet, data) {
  const FUNC_NAME = '_applyPortfolioFormattingWithInfo';
  const NUM_COLS = 12;
  
  Logger.log(`[${FUNC_NAME}] Applying formatting to ${data.length} rows...`);
  
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const rowNum = r + 1;
    const range = sheet.getRange(rowNum, 1, 1, NUM_COLS);
    
    const cell0 = String(row[0] || '');
    const cellType = String(row[5] || '').toUpperCase();
    const cellPick = String(row[4] || '').toUpperCase();
    const cellAcc = String(row[8] || '');
    const cellInfo = String(row[10] || '');
    
    // Main header
    if (cell0.includes('MA GOLIDE')) {
      range.setFontWeight('bold').setFontSize(14)
           .setBackground('#1a73e8').setFontColor('#ffffff');
      continue;
    }
    
    // Metadata rows
    if (cell0 === 'Generated:' || cell0 === 'Total Accas:') {
      range.setFontStyle('italic').setFontColor('#666666');
      continue;
    }
    
    // Size breakdown row
    if (cell0.includes('-Fold:')) {
      range.setFontWeight('bold').setFontColor('#1a73e8');
      continue;
    }
    
    // Acca header row
    if ((cell0.includes('-Fold') || cell0.includes('Double') || 
         cell0.includes('Single') || cell0.includes('Treble')) && cell0.includes('|')) {
      range.setFontWeight('bold').setBackground('#e3f2fd')
           .setBorder(true, true, true, true, false, false);
      continue;
    }
    
    // Column header row
    if (cell0 === 'Date') {
      range.setFontWeight('bold').setBackground('#f5f5f5').setFontSize(9);
      continue;
    }
    
    // ACCA STATUS row
    if (cell0 === 'ACCA STATUS:') {
      const statusVal = String(row[1] || '').toUpperCase();
      let bg = '#fff3e0', fg = '#bf9000';
      if (statusVal === 'WON') { bg = '#b7e1cd'; fg = '#0f5132'; }
      if (statusVal === 'LOST') { bg = '#f4c7c3'; fg = '#c62828'; }
      range.setFontWeight('bold').setBackground(bg).setFontColor(fg);
      continue;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PATCHED: Bet leg rows with SNIPER DIR-specific styling
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Detect SNIPER DIR from type OR pick format
    const isSniperDir = cellType.includes('SNIPER DIR') || 
                        cellType.includes('DIR') ||
                        /Q[1-4]\s*(OVER|UNDER)/i.test(cellPick);
    
    if (cellType.includes('BANKER')) {
      // Banker - green background
      range.setBackground('#e8f5e9');
    } 
    else if (isSniperDir) {
      // ═══════════════════════════════════════════════════════════════════════════
      // SNIPER DIR - Cyan/teal background (distinguishes from regular snipers)
      // ═══════════════════════════════════════════════════════════════════════════
      range.setBackground('#e0f7fa');
    }
    else if (cellType.includes('O/U') || cellType.includes('OU')) {
      // SNIPER O/U (non-directional) - light blue background
      range.setBackground('#e3f2fd');
    }
    else if (cellType.includes('SNIPER')) {
      // Regular SNIPER (margin) - yellow background
      range.setBackground('#fffde7');
    }
    
    // Apply accuracy/info formatting only to bet rows
    if (cellType.includes('BANKER') || cellType.includes('SNIPER')) {
      // ═══════════════════════════════════════════════════════════════════════════
      // Accuracy cell coloring (Column I = 9)
      // ═══════════════════════════════════════════════════════════════════════════
      const accCell = sheet.getRange(rowNum, 9);
      
      if (cellAcc === 'PENALTY' || cellAcc === 'N/A') {
        accCell.setBackground('#d32f2f').setFontColor('#ffffff').setFontWeight('bold');
      } else {
        const accVal = parseFloat(cellAcc.replace('%', ''));
        if (!isNaN(accVal)) {
          if (accVal >= 80) {
            accCell.setBackground('#2e7d32').setFontColor('#ffffff').setFontWeight('bold');
          } else if (accVal >= 70) {
            accCell.setBackground('#4caf50').setFontColor('#ffffff').setFontWeight('bold');
          } else if (accVal >= 60) {
            accCell.setBackground('#81c784').setFontWeight('bold');
          } else if (accVal >= 50) {
            accCell.setBackground('#fff9c4');
          } else {
            accCell.setBackground('#ffcdd2');
          }
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════════════
      // Info cell coloring (Column K = 11) - PATCHED for T2-DIR
      // ═══════════════════════════════════════════════════════════════════════════
      if (cellInfo && cellInfo.length > 0) {
        const infoCell = sheet.getRange(rowNum, 11);
        const infoLower = cellInfo.toLowerCase();
        
        if (infoLower.includes('⚠️') || infoLower.includes('no tier') || infoLower.includes('no config')) {
          // Penalty/missing config - red
          infoCell.setBackground('#ffcdd2').setFontColor('#c62828').setFontWeight('bold');
        } 
        else if (infoLower.includes('t2-dir') || (infoLower.includes('tier2') && infoLower.includes('dir'))) {
          // ═══════════════════════════════════════════════════════════════════════════
          // PATCHED: T2-DIR source - cyan tint (matches DIR row background)
          // ═══════════════════════════════════════════════════════════════════════════
          infoCell.setBackground('#b2ebf2').setFontColor('#00838f');
        }
        else if (infoLower.includes('tier1') || infoLower.includes('t1:') || infoLower.includes('config_tier1')) {
          // Tier1 source - green
          infoCell.setBackground('#c8e6c9').setFontColor('#1b5e20');
        }
        else if (infoLower.includes('tier2') || infoLower.includes('t2:') || infoLower.includes('config_tier2')) {
          // Tier2 source - blue
          infoCell.setBackground('#bbdefb').setFontColor('#0d47a1');
        }
        else {
          // Other info - light gray
          infoCell.setBackground('#f5f5f5').setFontColor('#424242');
        }
      }
    }
  }
  
  // Freeze header rows
  sheet.setFrozenRows(6);
  
  Logger.log(`[${FUNC_NAME}] ✅ Formatting applied to ${data.length} rows`);
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================
// ============================================================
// MAIN ENTRY POINT
// ============================================================
/**
 * buildAccumulatorPortfolio — Consolidated Patch (GOLD-locked main portfolio)
 *
 * ◄◄ PATCH: calls accaEngineSyncAssayerBridgeConfig_ BEFORE enrichment
 *           so Bridge stamps metadata under GOLD gates, not defaults.
 *
 * ◄◄ PATCH: BIG BANG EXTRACTOR — post-build cherry-pick of TOP 10% by
 *           totalOdds (with league-diversity tie-break) → Blockbuster_Accas
 */
function buildAccumulatorPortfolio() {
  var FUNC_NAME = 'buildAccumulatorPortfolio';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════════════════╗');
  Logger.log('║              🎰 MA GOLIDE - ACCUMULATOR PORTFOLIO BUILDER 🎰              ║');
  Logger.log('╚══════════════════════════════════════════════════════════════════════════╝');
  Logger.log('[' + FUNC_NAME + '] Started at: ' + new Date().toISOString());
  Logger.log('[' + FUNC_NAME + '] Spreadsheet: ' + ss.getName());
  Logger.log('[' + FUNC_NAME + '] Target sizes: ' + ACCA_ENGINE_CONFIG.ACCA_SIZES.join(', '));

  Logger.log('[CONFIG] GOLD_ONLY_MODE=' + ACCA_ENGINE_CONFIG.GOLD_ONLY_MODE
    + ' MIN_EDGE_GRADE=' + ACCA_ENGINE_CONFIG.MIN_EDGE_GRADE
    + ' MIN_PURITY_GRADE=' + ACCA_ENGINE_CONFIG.MIN_PURITY_GRADE
    + ' UNKNOWN_LEAGUE_ACTION=' + ACCA_ENGINE_CONFIG.UNKNOWN_LEAGUE_ACTION
    + ' REQUIRE_RELIABLE_EDGE=' + ACCA_ENGINE_CONFIG.REQUIRE_RELIABLE_EDGE);

  ss.toast('🎰 Building Multi-Size Portfolio (3,6,9)...', 'AccaEngine', 5);

  // ── Local helpers (grade logging) ──────────────────────────
  var _normGrade = function(g) {
    var s = String(g || '').trim().toUpperCase();
    if (s === 'N/A' || s === 'NA' || s === 'UNKNOWN' || s === '-') return '';
    return s;
  };

  var _gradeKey = function(b) {
    var eg = _normGrade((b && (b.assayer_edge_grade ||
      (b.assayer && b.assayer.edge && b.assayer.edge.grade))) || '');
    var pg = _normGrade((b && (b.assayer_purity_grade ||
      (b.assayer && b.assayer.purity && b.assayer.purity.grade))) || '');
    return (eg || 'NONE') + '+' + (pg || 'NONE');
  };

  var _logGradeDistribution = function(label, arr) {
    var map = {};
    for (var i = 0; i < arr.length; i++) {
      var k = _gradeKey(arr[i]);
      map[k] = (map[k] || 0) + 1;
    }
    var keys = Object.keys(map).sort(function(a, b) { return map[b] - map[a]; });
    var top = keys.slice(0, 12).map(function(k) { return k + ':' + map[k]; });
    Logger.log('[' + FUNC_NAME + '] ' + label + ' grades: ' + top.join(' | '));
  };

  // ── Big Bang helpers ───────────────────────────────────────
  /** Safely extract a numeric totalOdds from a portfolio object */
  var _getTotalOdds = function(p) {
    if (!p) return 0;
    // Try direct field first, then alternates
    var raw = p.totalOdds || p.total_odds || p.odds || 0;
    var n = parseFloat(raw);
    if (isFinite(n) && n > 0) return n;

    // Fallback: multiply individual leg odds if totalOdds wasn't stored
    if (p.legs && p.legs.length) {
      var product = 1;
      for (var li = 0; li < p.legs.length; li++) {
        var legOdds = parseFloat(p.legs[li].odds || p.legs[li].decimal_odds || 0);
        if (isFinite(legOdds) && legOdds > 0) {
          product *= legOdds;
        }
      }
      return product > 1 ? product : 0;
    }
    return 0;
  };

  /** Count unique leagues in a portfolio (for diversity tie-break) */
  var _uniqueLeagueCount = function(p) {
    if (!p || !p.legs) return 0;
    var seen = {};
    for (var li = 0; li < p.legs.length; li++) {
      var lg = String(p.legs[li].league || p.legs[li].competition || '').trim().toUpperCase();
      if (lg) seen[lg] = true;
    }
    return Object.keys(seen).length;
  };

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Load bets from Sync_Temp
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');
    Logger.log('STEP 1: LOADING BETS FROM SYNC_TEMP');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');

    var syncSheet = _getSheet(ss, 'Sync_Temp');
    if (!syncSheet) {
      throw new Error('Sync_Temp sheet not found. Run "Sync All Leagues" first.');
    }

    var lastRow = syncSheet.getLastRow();
    Logger.log('[' + FUNC_NAME + '] Sync_Temp found with ' + lastRow + ' rows');

    if (lastRow <= 1) {
      throw new Error('No synced data in Sync_Temp. Run "Sync All Leagues" first.');
    }

    var rawBets = _loadBets(syncSheet);
    Logger.log('[' + FUNC_NAME + '] ✅ Loaded ' + rawBets.length + ' raw bets');

    if (rawBets.length === 0) {
      throw new Error('No bets loaded from Sync_Temp. Check data format.');
    }

    if (rawBets.length > 0 && ACCA_ENGINE_CONFIG.VERBOSE_LOGGING) {
      Logger.log('[' + FUNC_NAME + '] Sample bet structure:');
      var sample = rawBets[0];
      var sKeys = Object.keys(sample);
      for (var sk = 0; sk < sKeys.length; sk++) {
        Logger.log('[' + FUNC_NAME + ']   ' + sKeys[sk] + ': ' +
          JSON.stringify(sample[sKeys[sk]]).substring(0, 50));
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Pre-enrichment filter (time/confidence/invalidOdds ONLY)
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');
    Logger.log('STEP 2: FILTERING BETS (PRE-ENRICHMENT)');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');

    var edgeBetsOnly = rawBets.filter(function(b) {
      var pickText = String(b.pick || '').toLowerCase();
      var typeText = String(b.type || '').toLowerCase();
      return !pickText.includes('highest scoring quarter') && !typeText.includes('high qtr');
    });

    var validBets = _filterBets(edgeBetsOnly, {
      applyAssayerBlocks: false,
      applyGoldGate: false
    });
    Logger.log('[' + FUNC_NAME + '] ✅ ' + validBets.length + '/' + edgeBetsOnly.length +
      ' bets passed pre-enrichment filter');

    if (validBets.length < 1) {
      throw new Error('No valid bets after filtering (' + rawBets.length +
        ' rejected). Check time window and confidence settings.');
    }

    var preBankers = 0;
    var preSnipers = 0;
    for (var vi = 0; vi < validBets.length; vi++) {
      var vType = String(validBets[vi].type || '').toUpperCase();
      if (vType.includes('BANKER') || vType.includes('TIER1') || vType.includes('WIN')) preBankers++;
      if (vType.includes('SNIPER') || vType.includes('TIER2') || vType.includes('QUARTER')) preSnipers++;
    }
    Logger.log('[' + FUNC_NAME + '] Valid bets breakdown: 🔒Bankers=' + preBankers +
      ', 🎯Snipers=' + preSnipers);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Fetch accuracy metrics from satellites
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');
    Logger.log('STEP 3: FETCHING LEAGUE ACCURACY METRICS');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');

    ss.toast('📊 Fetching league accuracy metrics...', 'AccaEngine', 3);
    var leagueMetrics = fetchLeagueAccuracyMetrics();
    var metricsCount = Object.keys(leagueMetrics).length;
    Logger.log('[' + FUNC_NAME + '] ✅ Fetched metrics for ' + metricsCount + ' leagues');

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3b: Load Assayer edges + purity data
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');
    Logger.log('STEP 3b: LOADING ASSAYER EDGES + PURITY');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');

    ss.toast('💎 Loading Assayer edges + purity...', 'AccaEngine', 3);
    var assayerData = null;
    try {
      assayerData = (typeof _getAssayerDataCached_ === 'function')
        ? _getAssayerDataCached_() : null;
    } catch (e) {
      assayerData = null;
    }
    if (!assayerData) {
      var assayerSheetId = getAssayerSheetIdForMother_(ss);
      assayerData = assayerSheetId
        ? loadAssayerData_(assayerSheetId)
        : { ok: false, error: 'Missing/invalid assayer_sheet_id' };
    }

    if (!assayerData || !assayerData.ok) {
      var guardMsg = 'Assayer data failed to load (' +
        (assayerData ? assayerData.error : 'null') +
        '). Phase 2 requires Assayer to assign GOLD grades. Cannot proceed.';
      Logger.log('[' + FUNC_NAME + '] ❌ ' + guardMsg);
      throw new Error(guardMsg);
    }

    Logger.log('[' + FUNC_NAME + '] ✅ Assayer loaded: edges=' +
      assayerData.meta.edgeCount + ', purity=' + assayerData.meta.purityCount);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Enrich bets with accuracy scores (+ Assayer overlay)
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');
    Logger.log('STEP 4: ENRICHING BETS WITH ACCURACY SCORES (+ ASSAYER OVERLAY)');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');

    // ◄◄ PATCH: sync GOLD config into Bridge BEFORE enrichment stamps metadata
    accaEngineSyncAssayerBridgeConfig_(ACCA_ENGINE_CONFIG, FUNC_NAME);

    var enrichedBets0 = _enrichBetsWithAccuracy(validBets, leagueMetrics, assayerData);
    Logger.log('[' + FUNC_NAME + '] ✅ Enriched ' + enrichedBets0.length + ' bets');

    _logGradeDistribution('FULL ENRICHED POOL', enrichedBets0);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4b: PHASE 2 — GOLD FLOOR FILTER
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');
    Logger.log('STEP 4b: APPLYING GOLD FLOOR (edge>=GOLD, purity>=GOLD)');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');

    var goldBets = _filterBets(enrichedBets0, {
      applyAssayerBlocks: true,
      skipStandard: true,
      applyGoldGate: false,
      minEdgeGrade: 'GOLD',
      minPurityGrade: 'GOLD'
    });

    Logger.log('[' + FUNC_NAME + '] ✅ GOLD filter: ' + goldBets.length + '/' +
      enrichedBets0.length + ' bets qualified for GOLD PORTFOLIO');

    var goldAudit = null;
    try { goldAudit = goldBets._audit || null; } catch(e) { goldAudit = null; }
    if (goldAudit && goldAudit.excluded) {
      Logger.log('[' + FUNC_NAME + '] GOLD filter excluded: ' +
        JSON.stringify(goldAudit.excluded));
    }

    _logGradeDistribution('GOLD POOL', goldBets);

    if (goldBets.length < 1) {
      throw new Error('No GOLD+GOLD bets available after filtering. ' +
        'Check Assayer data and grade assignments. See logs for full grade distribution.');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5: Build multi-size portfolios (GOLD ONLY)
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');
    Logger.log('STEP 5: BUILDING MULTI-SIZE PORTFOLIOS (GOLD ONLY)');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');

    ss.toast('🏗️ Building GOLD portfolios...', 'AccaEngine', 3);
    var portfolios = _allocatePortfolios(goldBets, leagueMetrics, assayerData);
    Logger.log('[' + FUNC_NAME + '] ✅ Built ' + portfolios.length + ' portfolios');

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 6: Write portfolio output + Big Bang extraction
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');
    Logger.log('STEP 6: WRITING OUTPUT');
    Logger.log('═══════════════════════════════════════════════════════════════════════════');

    var portfolioSheet = _getSheet(ss, 'Acca_Portfolio');
    if (!portfolioSheet) {
      Logger.log('[' + FUNC_NAME + '] Creating new Acca_Portfolio sheet...');
      portfolioSheet = ss.insertSheet('Acca_Portfolio');
    }

    _writePortfolioWithAccuracy(portfolioSheet, portfolios, leagueMetrics);
    Logger.log('[' + FUNC_NAME + '] ✅ Written to Acca_Portfolio sheet');

    // ---------------------------------------------------------
    // 👑 THE BIG BANG EXTRACTOR (TOP 10% BY ODDS)
    // ---------------------------------------------------------
    try {
      if (portfolios && portfolios.length) {

        // 1) Sort by TOTAL ODDS descending (massive payouts first)
        //    Tie-break: prefer more unique leagues (diversity bonus)
        var rankedAccas = portfolios.slice().sort(function(a, b) {
          var oddsA = _getTotalOdds(a);
          var oddsB = _getTotalOdds(b);
          if (oddsB !== oddsA) return oddsB - oddsA;
          // tie-break: more leagues = more diverse = preferred
          return _uniqueLeagueCount(b) - _uniqueLeagueCount(a);
        });

        // 2) Take the top 10% (always at least 1)
        var top10Count = Math.max(1, Math.floor(rankedAccas.length * 0.10));
        var bigBangAccas = rankedAccas.slice(0, top10Count);

        // 3) Clone and add VIP flair
        var blockbusterClones = [];
        for (var bb = 0; bb < bigBangAccas.length; bb++) {
          var clone = Object.assign({}, bigBangAccas[bb]);
          // Preserve legs array reference (shallow clone is fine, we only change top-level fields)
          var legsCount = (clone.legs && clone.legs.length) ? clone.legs.length : 0;
          var cloneOdds = _getTotalOdds(clone);

          clone.type = 'BLOCKBUSTER';
          clone.name = '👑 BIG BANG ' + legsCount + '-Fold (' +
            cloneOdds.toFixed(2) + 'x | ' +
            _uniqueLeagueCount(clone) + ' leagues)';

          // Stamp computed totalOdds so the writer always has it
          clone.totalOdds = cloneOdds;

          blockbusterClones.push(clone);
        }

        // 4) Write to dedicated VIP sheet (clear old data first)
        var bbSheet = _getSheet(ss, 'Blockbuster_Accas');
        if (!bbSheet) {
          bbSheet = ss.insertSheet('Blockbuster_Accas');
        } else {
          bbSheet.clearContents();
        }

        _writePortfolioWithAccuracy(bbSheet, blockbusterClones, leagueMetrics);

        Logger.log('[' + FUNC_NAME + '] ✅ Extracted ' + top10Count +
          ' Big Bang Accas to Blockbuster_Accas');
        Logger.log('[' + FUNC_NAME + ']   Top entry: ' +
          (blockbusterClones[0] ? blockbusterClones[0].name : 'none'));

      } else {
        Logger.log('[' + FUNC_NAME + '] ℹ️ Big Bang extraction skipped: no portfolios built.');
      }
    } catch (bbErr) {
      Logger.log('[' + FUNC_NAME + '] ⚠️ Big Bang extraction skipped: ' + bbErr.message);
    }
    // ---------------------------------------------------------

    _writeResults(ss, portfolios);
    Logger.log('[' + FUNC_NAME + '] ✅ Written to Acca_Results sheet');

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 7: Update dashboard
    // ═══════════════════════════════════════════════════════════════════════════
    if (typeof updateDashboard === 'function') {
      try {
        Logger.log('[' + FUNC_NAME + '] Updating dashboard...');
        updateDashboard();
        Logger.log('[' + FUNC_NAME + '] ✅ Dashboard updated');
      } catch (dashErr) {
        Logger.log('[' + FUNC_NAME + '] ⚠️ Dashboard update skipped: ' + dashErr.message);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 8: Summary
    // ═══════════════════════════════════════════════════════════════════════════
    var summary = _buildMultiSizeSummary(portfolios, goldBets.length);

    Logger.log('');
    Logger.log('╔══════════════════════════════════════════════════════════════════════════╗');
    Logger.log('║                         BUILD COMPLETE!                                  ║');
    Logger.log('╚══════════════════════════════════════════════════════════════════════════╝');
    Logger.log('[' + FUNC_NAME + '] Completed at: ' + new Date().toISOString());
    Logger.log('[' + FUNC_NAME + '] Summary:\n' + summary);

    ui.alert('✅ Portfolio Built (GOLD-only)!', summary, ui.ButtonSet.OK);
    ss.toast('✅ Portfolio complete!', 'AccaEngine', 3);

  } catch (e) {
    Logger.log('');
    Logger.log('╔══════════════════════════════════════════════════════════════════════════╗');
    Logger.log('║                              ❌ ERROR ❌                                  ║');
    Logger.log('╚══════════════════════════════════════════════════════════════════════════╝');
    Logger.log('[' + FUNC_NAME + '] ERROR: ' + e.message);
    Logger.log('[' + FUNC_NAME + '] Stack trace:');
    Logger.log(e.stack);
    ui.alert('❌ Build Error', e.message + '\n\nCheck View → Logs for details.', ui.ButtonSet.OK);
  }
}

function _generateAllMatchKeys(team1, team2) {
  var stripDiacritics = function(s) {
    try {
      return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    } catch (e) {
      return String(s || '');
    }
  };

  var normalizeTeam = function(str) {
    var s = stripDiacritics(str);
    s = String(s || '').toLowerCase().trim();

    // Women's markers / gender tokens across feeds
    s = s.replace(/\b(w|womens|women|women's|ladies|femenino|fem)\b/gi, ' ');

    // Common club affixes
    s = s.replace(/\b(fc|sc|ac|cf|cd|bk|bc|kc|sv|fk|sk)\b/gi, ' ');

    // Locale glue words that often appear/disappear
    s = s.replace(/\b(club|de|del|la|el|the)\b/gi, ' ');

    // Punctuation -> spaces
    s = s.replace(/[^\w\s]/g, ' ');

    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();

    return s;
  };

  var t1 = normalizeTeam(team1);
  var t2 = normalizeTeam(team2);
  if (!t1 || !t2) return [];

  var keys = [];
  var seen = {};
  var add = function(k) { if (!seen[k]) { seen[k] = true; keys.push(k); } };

  // Full normalized names
  add(t1 + '|' + t2);

  // First token only
  var t1First = t1.split(' ')[0] || '';
  var t2First = t2.split(' ')[0] || '';
  if (t1First.length > 2 && t2First.length > 2) add(t1First + '|' + t2First);

  // Last significant token
  var sig = function(s) { return s.split(' ').filter(function(w) { return w.length > 2; }); };
  var a = sig(t1), b = sig(t2);
  if (a.length && b.length) add(a[a.length - 1] + '|' + b[b.length - 1]);

  // Strip mega-city prefixes
  var stripCity = function(s) {
    return s.replace(/^(los angeles|new york|san antonio|golden state|oklahoma city)\s+/i, '').trim();
  };
  var t1c = stripCity(t1);
  var t2c = stripCity(t2);
  if (t1c && t2c && (t1c !== t1 || t2c !== t2)) add(t1c + '|' + t2c);

  // Space-collapsed (helps "obras sanitarias" vs "obrassanitarias")
  add(t1.replace(/\s+/g, '') + '|' + t2.replace(/\s+/g, ''));

  return keys;
}

/**
 * Reverse a quarter score string (e.g., "25-22" becomes "22-25")
 */
function _reverseQuarterScore(qScore) {
  if (qScore === null || qScore === undefined) return null;
  
  const str = String(qScore).replace(/[–—−]/g, '-').replace(/\s+/g, '');
  const match = str.match(/(\d+)\s*-\s*(\d+)/);
  
  if (!match) return qScore;
  return `${match[2]}-${match[1]}`;
}


/**
 * Load Results_Temp into a searchable map with multiple key formats.
 * PATCHED: guards around external helpers, try-catch per row, safe returns.
 */
function _loadResultsTempForGrading(ss) {
  var FUNC_NAME = '_loadResultsTempForGrading';

  var sheet = ss.getSheetByName('Results_Temp');
  if (!sheet) {
    Logger.log('[' + FUNC_NAME + '] ❌ Results_Temp sheet not found');
    return {};
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('[' + FUNC_NAME + '] ❌ Results_Temp is empty');
    return {};
  }

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });

  var findColumn = function(aliases) {
    for (var a = 0; a < aliases.length; a++) {
      var idx = headers.indexOf(aliases[a]);
      if (idx >= 0) return idx;
    }
    for (var i = 0; i < headers.length; i++) {
      for (var a2 = 0; a2 < aliases.length; a2++) {
        if (headers[i].indexOf(aliases[a2]) >= 0) return i;
      }
    }
    return -1;
  };

  var cols = {
    league:  findColumn(['league', 'competition']),
    home:    findColumn(['home', 'home team', 'hometeam']),
    away:    findColumn(['away', 'away team', 'awayteam']),
    date:    findColumn(['date', 'game date']),
    status:  findColumn(['status', 'game status']),
    ftScore: findColumn(['ft score', 'ftscore', 'final score', 'score']),
    q1:      findColumn(['q1', 'quarter 1', 'quarter1']),
    q2:      findColumn(['q2', 'quarter 2', 'quarter2']),
    q3:      findColumn(['q3', 'quarter 3', 'quarter3']),
    q4:      findColumn(['q4', 'quarter 4', 'quarter4']),
    ot:      findColumn(['ot', 'overtime'])
  };

  Logger.log('[' + FUNC_NAME + '] Column mapping: Home=' + cols.home +
    ', Away=' + cols.away + ', Status=' + cols.status + ', FT=' + cols.ftScore);

  if (cols.home < 0 || cols.away < 0) {
    Logger.log('[' + FUNC_NAME + '] ❌ Missing required Home/Away columns');
    return {};
  }

  var results        = {};
  var processedCount = 0;
  var finishedCount  = 0;
  var FINISHED_STATUSES = ['FT', 'FINAL', 'FINISHED', 'AET', 'AOT', 'OT',
                           'COMPLETE', 'COMPLETED', 'ENDED', 'FULL TIME'];

  for (var i = 1; i < data.length; i++) {
    try {
      var row  = data[i];
      var home = String(row[cols.home] || '').trim();
      var away = String(row[cols.away] || '').trim();
      if (!home || !away) continue;
      processedCount++;

      var league = cols.league >= 0 ? String(row[cols.league] || '').trim() : '';
      var status = cols.status >= 0 ? String(row[cols.status] || '').toUpperCase().trim() : '';
      var ftRaw  = cols.ftScore >= 0 ? row[cols.ftScore] : '';

      var ftStr   = String(ftRaw).replace(/[–—−]/g, '-').replace(/\s+/g, '').trim();
      var ftMatch = ftStr.match(/(\d+)\s*[-:]\s*(\d+)/);

      var homeScore = ftMatch ? parseInt(ftMatch[1], 10) : null;
      var awayScore = ftMatch ? parseInt(ftMatch[2], 10) : null;

      var winner = null;
      if (homeScore !== null && awayScore !== null) {
        if (homeScore > awayScore)      winner = 1;
        else if (awayScore > homeScore) winner = 2;
        else                            winner = 0;
      }

      var isFinished = (FINISHED_STATUSES.indexOf(status) >= 0) ||
                       (homeScore !== null && awayScore !== null);
      if (isFinished) finishedCount++;

      var quarters = {
        q1: cols.q1 >= 0 ? row[cols.q1] : null,
        q2: cols.q2 >= 0 ? row[cols.q2] : null,
        q3: cols.q3 >= 0 ? row[cols.q3] : null,
        q4: cols.q4 >= 0 ? row[cols.q4] : null,
        ot: cols.ot >= 0 ? row[cols.ot] : null
      };

      var resultObj = {
        rowIndex:   i,
        league:     league,
        home:       home,
        away:       away,
        status:     status,
        ftScore:    ftRaw,
        homeScore:  homeScore,
        awayScore:  awayScore,
        winner:     winner,
        isFinished: isFinished,
        quarters:   quarters,
        _reversed:  false
      };

      /* ── primary keys ── */
      var keys = (typeof _generateAllMatchKeys === 'function')
        ? _generateAllMatchKeys(home, away)
        : [home.toLowerCase().trim() + '|' + away.toLowerCase().trim()];

      for (var ki = 0; ki < keys.length; ki++) {
        if (!results[keys[ki]]) results[keys[ki]] = resultObj;
      }

      /* ── reversed keys ── */
      var reversedResult = {
        rowIndex:   i,
        league:     league,
        home:       away,
        away:       home,
        status:     status,
        ftScore:    ftRaw,
        homeScore:  awayScore,
        awayScore:  homeScore,
        winner:     winner === 1 ? 2 : (winner === 2 ? 1 : winner),
        isFinished: isFinished,
        quarters:   {
          q1: (typeof _reverseQuarterScore === 'function') ? _reverseQuarterScore(quarters.q1) : quarters.q1,
          q2: (typeof _reverseQuarterScore === 'function') ? _reverseQuarterScore(quarters.q2) : quarters.q2,
          q3: (typeof _reverseQuarterScore === 'function') ? _reverseQuarterScore(quarters.q3) : quarters.q3,
          q4: (typeof _reverseQuarterScore === 'function') ? _reverseQuarterScore(quarters.q4) : quarters.q4,
          ot: (typeof _reverseQuarterScore === 'function') ? _reverseQuarterScore(quarters.ot) : quarters.ot
        },
        _reversed:  true
      };

      var reversedKeys = (typeof _generateAllMatchKeys === 'function')
        ? _generateAllMatchKeys(away, home)
        : [away.toLowerCase().trim() + '|' + home.toLowerCase().trim()];

      for (var rki = 0; rki < reversedKeys.length; rki++) {
        if (!results[reversedKeys[rki]]) results[reversedKeys[rki]] = reversedResult;
      }

    } catch (rowErr) {
      Logger.log('[' + FUNC_NAME + '] ⚠ Row ' + i + ' skipped: ' + rowErr.message);
    }
  }

  Logger.log('[' + FUNC_NAME + '] ✅ Processed ' + processedCount + ' games, ' +
    finishedCount + ' finished, ' + Object.keys(results).length + ' lookup keys');

  var sampleKeys = Object.keys(results).slice(0, 5);
  if (sampleKeys.length) {
    Logger.log('[' + FUNC_NAME + '] Sample keys: ' + sampleKeys.join(', '));
  }

  return results;
}


/**
 * Sync Acca_Results sheet from graded Acca_Portfolio
 * Calculates leg counts and overall status for each accumulator
 */
function _syncAccaResultsFromPortfolio(ss) {
  const FUNC_NAME = '_syncAccaResultsFromPortfolio';
  
  const portfolioSheet = ss.getSheetByName('Acca_Portfolio');
  const resultsSheet = ss.getSheetByName('Acca_Results');
  
  if (!portfolioSheet || !resultsSheet) {
    Logger.log(`[${FUNC_NAME}] ⚠️ Missing required sheets`);
    return 0;
  }
  
  const pData = portfolioSheet.getDataRange().getValues();
  const rData = resultsSheet.getDataRange().getValues();
  
  if (rData.length < 2) {
    Logger.log(`[${FUNC_NAME}] ⚠️ Acca_Results is empty`);
    return 0;
  }
  
  // Map Acca_Results headers
  const rHeaders = rData[0].map(h => String(h).toLowerCase().trim());
  const rCols = {
    accaId: -1,
    status: -1,
    legsWon: -1,
    legsLost: -1,
    legsPending: -1,
    result: -1
  };
  
  rHeaders.forEach((h, i) => {
    if (h.includes('acca id') || h === 'accaid' || h === 'id') rCols.accaId = i;
    if (h === 'status') rCols.status = i;
    if (h.includes('legs won') || h === 'legswon' || h === 'won') rCols.legsWon = i;
    if (h.includes('legs lost') || h === 'legslost' || h === 'lost') rCols.legsLost = i;
    if (h.includes('legs pending') || h === 'legspending' || h === 'pending') rCols.legsPending = i;
    if (h === 'result' || h === 'outcome') rCols.result = i;
  });
  
  Logger.log(`[${FUNC_NAME}] Acca_Results columns: ID=${rCols.accaId}, Status=${rCols.status}, Won=${rCols.legsWon}`);
  
  if (rCols.accaId < 0) {
    Logger.log(`[${FUNC_NAME}] ❌ Cannot find Acca ID column in Acca_Results`);
    return 0;
  }
  
  // Parse portfolio to build stats for each acca
  const accaStats = {};
  let currentAccaId = null;
  let currentStats = null;
  
  // Find column indices in portfolio
  const statusColIdx = 9; // Status column (J)
  const matchColIdx = 3;  // Match column (D)
  
  // FIX: Dynamically find BetID column
  const portfolioHeaders = pData[5] || pData[4] || [];
  let betIdColIdx = 11;
  for (let c = 8; c < portfolioHeaders.length; c++) {
    if (String(portfolioHeaders[c]).toUpperCase().includes('BETID')) {
      betIdColIdx = c;
      break;
    }
  }
  Logger.log(`[${FUNC_NAME}] BetID column detected at index: ${betIdColIdx}`);
  
  for (let r = 0; r < pData.length; r++) {
    const row = pData[r];
    const cell0 = String(row[0] || '').trim();
    const cellBetId = String(row[betIdColIdx] || '').trim();
    const cellMatch = String(row[matchColIdx] || '').trim();
    
    // Check for acca header row
    const isAccaHeader = (cell0.includes('-Fold') || cell0.includes('Double') || 
                          cell0.includes('Single') || cell0.includes('Treble')) &&
                         cellBetId.startsWith('ACCA_');
    
    if (isAccaHeader) {
      // Save previous acca stats
      if (currentAccaId && currentStats) {
        accaStats[currentAccaId] = { ...currentStats };
      }
      
      // Start new acca
      currentAccaId = cellBetId;
      currentStats = { won: 0, lost: 0, pending: 0, total: 0 };
      continue;
    }
    
    // Skip non-data rows
    if (!currentAccaId || !currentStats) continue;
    if (cell0 === 'Date' || cell0 === 'ACCA STATUS:' || cell0.includes('MA GOLIDE')) continue;
    
    // Check if this is a leg row
    if (cellMatch && (cellMatch.toLowerCase().includes(' vs ') || cellMatch.includes(' @ '))) {
      const legStatus = String(portfolioSheet.getRange(r + 1, statusColIdx + 1).getValue() || 'PENDING')
        .toUpperCase().trim();
      
      currentStats.total++;
      if (legStatus === 'WON') currentStats.won++;
      else if (legStatus === 'LOST') currentStats.lost++;
      else currentStats.pending++;
    }
  }
  
  // Save last acca
  if (currentAccaId && currentStats) {
    accaStats[currentAccaId] = { ...currentStats };
  }
  
  Logger.log(`[${FUNC_NAME}] Parsed ${Object.keys(accaStats).length} accumulators from portfolio`);
  
  // Update Acca_Results sheet
  let updateCount = 0;
  
  for (let r = 1; r < rData.length; r++) {
    const accaId = String(rData[r][rCols.accaId] || '').trim();
    const stats = accaStats[accaId];
    
    if (!stats) {
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: Acca ID "${accaId}" not found in portfolio`);
      continue;
    }
    
    const rowNum = r + 1;
    
    // Determine overall status
    let status = 'PENDING';
    if (stats.lost > 0) {
      status = 'LOST';
    } else if (stats.pending === 0 && stats.won > 0) {
      status = 'WON';
    }
    
    // Update cells
    if (rCols.status >= 0) {
      const cell = resultsSheet.getRange(rowNum, rCols.status + 1);
      cell.setValue(status).setFontWeight('bold');
      if (status === 'WON') cell.setBackground('#b7e1cd').setFontColor('#0f5132');
      else if (status === 'LOST') cell.setBackground('#f4c7c3').setFontColor('#c62828');
      else cell.setBackground('#fff2cc').setFontColor('#bf9000');
    }
    
    if (rCols.legsWon >= 0) {
      resultsSheet.getRange(rowNum, rCols.legsWon + 1).setValue(stats.won);
    }
    if (rCols.legsLost >= 0) {
      resultsSheet.getRange(rowNum, rCols.legsLost + 1).setValue(stats.lost);
    }
    if (rCols.legsPending >= 0) {
      resultsSheet.getRange(rowNum, rCols.legsPending + 1).setValue(stats.pending);
    }
    
    if (rCols.result >= 0) {
      let resultText = '⏳ Pending';
      if (status === 'WON') resultText = '💰 WIN';
      if (status === 'LOST') resultText = '❌ LOSS';
      resultsSheet.getRange(rowNum, rCols.result + 1).setValue(resultText);
    }
    
    updateCount++;
    Logger.log(`[${FUNC_NAME}] Updated ${accaId}: ${stats.won}W/${stats.lost}L/${stats.pending}P → ${status}`);
  }
  
  Logger.log(`[${FUNC_NAME}] ✅ Updated ${updateCount} rows in Acca_Results`);
  return updateCount;
}

// ============================================================
// RESULT CHECKER
// ============================================================
/**
 * Check accumulator results using Results_Temp sheet
 * Grades all portfolio legs and updates Acca_Results
 */
function checkAccumulatorResults() {
  const FUNC_NAME = 'checkAccumulatorResults';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  
  ss.toast('🔍 Checking Results...', 'AccaEngine', 15);
  
  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════╗');
  Logger.log('║              ACCUMULATOR RESULT CHECKER                      ║');
  Logger.log('╚══════════════════════════════════════════════════════════════╝');
  Logger.log(`[${FUNC_NAME}] Started: ${new Date().toISOString()}`);
  
  try {
    // STEP 1: Load and index all results from Results_Temp
    Logger.log(`[${FUNC_NAME}] STEP 1: Loading Results_Temp...`);
    const resultsMap = _loadResultsTempForGrading(ss);
    const keyCount = Object.keys(resultsMap).length;
    
    if (keyCount === 0) {
      const msg = 'No results found in Results_Temp. Run "Sync All Results" first.';
      Logger.log(`[${FUNC_NAME}] ❌ ${msg}`);
      if (ui) ui.alert('❌ No Results', msg, ui.ButtonSet.OK);
      return;
    }
    
    // Count unique finished games (exclude reversed entries)
    const finishedGames = new Set();
    Object.entries(resultsMap).forEach(([key, res]) => {
      if (res.isFinished && !res._reversed) {
        finishedGames.add(`${res.home}|${res.away}`);
      }
    });
    Logger.log(`[${FUNC_NAME}] ✅ Loaded ${keyCount} lookup keys for ${finishedGames.size} finished games`);
    
    // STEP 2: Grade each leg in Acca_Portfolio
    Logger.log(`[${FUNC_NAME}] STEP 2: Grading portfolio legs...`);
    const gradeReport = _gradePortfolioLegs(ss, resultsMap);
    
    // STEP 3: Update Acca_Results sheet with rollup stats
    Logger.log(`[${FUNC_NAME}] STEP 3: Updating Acca_Results...`);
    const updateCount = _syncAccaResultsFromPortfolio(ss);
    Logger.log(`[${FUNC_NAME}] ✅ Updated ${updateCount} accumulators in Acca_Results`);
    
    // STEP 4: Refresh dashboard if available
    if (typeof updateDashboard === 'function') {
      try {
        updateDashboard();
        Logger.log(`[${FUNC_NAME}] ✅ Dashboard refreshed`);
      } catch (e) {
        Logger.log(`[${FUNC_NAME}] ⚠️ Dashboard update skipped: ${e.message}`);
      }
    }
    
    ss.toast('✅ Results checked!', 'Complete', 5);
    Logger.log(`[${FUNC_NAME}] ✅ COMPLETED SUCCESSFULLY`);
    
    if (ui) ui.alert('✅ Results Checked', gradeReport, ui.ButtonSet.OK);
    
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ ERROR: ${e.message}`);
    Logger.log(`[${FUNC_NAME}] Stack: ${e.stack}`);
    ss.toast('❌ Error checking results', 'Error', 5);
    if (ui) ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}

function _findResultsSheet(spreadsheet) {
  if (!spreadsheet) return null;

  const preferred = ['ResultsClean', 'Clean', 'Results'];
  for (const name of preferred) {
    const sheets = spreadsheet.getSheets();
    for (const sh of sheets) {
      if (sh.getName().toLowerCase() === name.toLowerCase()) {
        return sh;
      }
    }
  }

  const sheets = spreadsheet.getSheets();
  return sheets.find(sh => {
    const name = sh.getName().toLowerCase();
    return name.includes('result') || name.includes('clean');
  }) || null;
}

function _loadAllSatelliteResults(ss) {
  const results = {};

  const configSheet = _getSheet(ss, 'Config');
  if (!configSheet) throw new Error('Config sheet not found');

  const configData = configSheet.getDataRange().getValues();
  const configHeaders = _createHeaderMap(configData[0]);

  const urlCol = configHeaders['file url'] !== undefined ? configHeaders['file url'] : configHeaders['url'];
  const statusCol = configHeaders['status'];
  const leagueCol = configHeaders['league name'] !== undefined ? configHeaders['league name'] : configHeaders['league'];
  if (urlCol === undefined) throw new Error('Config missing "File URL" column');

  for (let r = 1; r < configData.length; r++) {
    const row = configData[r];
    const fileUrl = String(row[urlCol] || '').trim();
    const status = statusCol !== undefined ? String(row[statusCol] || '').toLowerCase() : 'active';
    const leagueName = leagueCol !== undefined ? String(row[leagueCol] || '') : `League${r}`;

    if (status !== 'active' || !fileUrl || fileUrl.includes('PASTE_')) continue;

    try {
      const satellite = SpreadsheetApp.openByUrl(fileUrl);
      const resultsSheet = _findResultsSheet(satellite);
      if (!resultsSheet) continue;

      const data = resultsSheet.getDataRange().getValues();
      if (data.length < 2) continue;

      const headers = _createHeaderMap(data[0]);
      const homeCol = headers['home'];
      const awayCol = headers['away'];
      const statusColR = headers['status'];
      const ftScoreCol = headers['ft score'] !== undefined ? headers['ft score'] : headers['ftscore'];
      const q1Col = headers['q1'];
      const q2Col = headers['q2'];
      const q3Col = headers['q3'];
      const q4Col = headers['q4'];

      if (homeCol === undefined || awayCol === undefined) continue;

      for (let i = 1; i < data.length; i++) {
        const rowData = data[i];
        const home = String(rowData[homeCol] || '').trim();
        const away = String(rowData[awayCol] || '').trim();
        const gameStatus = statusColR !== undefined ? String(rowData[statusColR] || '').toUpperCase() : '';

        if (!home || !away) continue;
        if (!['FT', 'FINAL', 'FINISHED', 'AET'].includes(gameStatus)) continue;

        const ftScoreRaw = ftScoreCol !== undefined ? String(rowData[ftScoreCol] || '') : '';
        const ftScore = ftScoreRaw.replace(/\s/g, '');
        let homeScore = 0, awayScore = 0;
        if (ftScore && ftScore.includes('-')) {
          const parts = ftScore.split('-').map(s => parseInt(s.trim(), 10));
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            homeScore = parts[0];
            awayScore = parts[1];
          }
        }

        let winner = 0;
        if (homeScore > awayScore) winner = 1;
        else if (awayScore > homeScore) winner = 2;

        const quarters = {
          q1: q1Col !== undefined ? rowData[q1Col] : '',
          q2: q2Col !== undefined ? rowData[q2Col] : '',
          q3: q3Col !== undefined ? rowData[q3Col] : '',
          q4: q4Col !== undefined ? rowData[q4Col] : ''
        };

        const resultObj = {
          home, away, homeScore, awayScore, winner,
          ftScore: ftScoreRaw, league: leagueName, quarters
        };

        const key1 = _normalizeMatchKeyForResults(home, away);
        const key2 = _normalizeMatchKeyForResults(away, home);

        results[key1] = resultObj;
        results[key2] = { ...resultObj, reversed: true };
      }
    } catch (err) {
      Logger.log(`[Results] ${leagueName}: ${err.message}`);
    }
  }

  return results;
}

// ============================================================
// GRADE SINGLE PICK - PATCHED FOR SNIPER DIR O/U
// ============================================================

function _gradeSinglePick(pickStr, result, originalHome, originalAway) {
  const FUNC_NAME = '_gradeSinglePick';
  
  const pick = String(pickStr).toLowerCase().trim();
  const { homeScore, awayScore, winner, quarters, home, away } = result;
  
  // Normalize team names
  const normalizeName = (str) => {
    return String(str || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };
  
  const homeNorm = normalizeName(home);
  const awayNorm = normalizeName(away);
  const origHomeNorm = normalizeName(originalHome);
  const origAwayNorm = normalizeName(originalAway);
  
  const getMainWord = (str) => {
    const words = str.split(' ').filter(w => w.length > 2);
    return words.length > 0 ? words[words.length - 1] : str;
  };
  
  const homeWord = getMainWord(homeNorm);
  const awayWord = getMainWord(awayNorm);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PATCHED: Handle SNIPER DIR O/U picks (e.g., "Q4 UNDER 56.2", "Q1 OVER 58.9")
  // ═══════════════════════════════════════════════════════════════════════════
  const ouMatch = pick.match(/q([1-4])\s*(over|under)\s*([\d.]+)/i);
  if (ouMatch) {
    const qNum = ouMatch[1];
    const direction = ouMatch[2].toUpperCase();
    const line = parseFloat(ouMatch[3]);
    const qKey = `q${qNum}`;
    const qRaw = quarters[qKey];
    
    if (!qRaw) {
      return { grade: 'PENDING', reason: `Q${qNum} score not available` };
    }
    
    // Parse quarter score
    const qStr = String(qRaw).replace(/[–—−]/g, '-').replace(/\s+/g, '');
    const qMatch = qStr.match(/(\d+)\s*-\s*(\d+)/);
    
    if (!qMatch) {
      return { grade: 'PENDING', reason: `Q${qNum} score format invalid: "${qRaw}"` };
    }
    
    const homeQ = parseInt(qMatch[1], 10);
    const awayQ = parseInt(qMatch[2], 10);
    const totalQ = homeQ + awayQ;
    
    if (direction === 'OVER') {
      const won = totalQ > line;
      return {
        grade: won ? 'WON' : 'LOST',
        reason: `Q${qNum}: ${homeQ}+${awayQ}=${totalQ} vs Line ${line} (${direction})`
      };
    } else if (direction === 'UNDER') {
      const won = totalQ < line;
      return {
        grade: won ? 'WON' : 'LOST',
        reason: `Q${qNum}: ${homeQ}+${awayQ}=${totalQ} vs Line ${line} (${direction})`
      };
    }
  }
  
  // === BANKER: Win picks ===
  if (pick.includes('win') || pick.includes(' ml') || pick.includes('moneyline')) {
    let pickedHome = false;
    let pickedAway = false;
    
    if (pick.includes(homeNorm) || pick.includes(homeWord) || pick.includes(origHomeNorm)) {
      pickedHome = true;
    } else if (pick.includes(awayNorm) || pick.includes(awayWord) || pick.includes(origAwayNorm)) {
      pickedAway = true;
    } else if (pick.includes('home')) {
      pickedHome = true;
    } else if (pick.includes('away')) {
      pickedAway = true;
    } else {
      const pickWords = pick.replace(/win|ml|moneyline/gi, '').trim().split(' ').filter(w => w.length > 2);
      for (const word of pickWords) {
        if (homeNorm.includes(word) || homeWord === word) { pickedHome = true; break; }
        if (awayNorm.includes(word) || awayWord === word) { pickedAway = true; break; }
      }
    }
    
    if (pickedHome) {
      const won = winner === 1;
      return { 
        grade: won ? 'WON' : 'LOST', 
        reason: `FT: ${homeScore}-${awayScore}, Home ${won ? 'wins' : 'loses'}` 
      };
    }
    if (pickedAway) {
      const won = winner === 2;
      return { 
        grade: won ? 'WON' : 'LOST', 
        reason: `FT: ${homeScore}-${awayScore}, Away ${won ? 'wins' : 'loses'}` 
      };
    }
    
    return { grade: 'PENDING', reason: 'Could not determine picked team' };
  }
  
  // === SNIPER: Quarter margin picks (e.g., "Q4: A +5.0") ===
  const quarterMarginMatch = pick.match(/q([1-4])\s*[:\-]?\s*([ha])\s*([+-]?\d+\.?\d*)/i);
  if (quarterMarginMatch) {
    const qNum = quarterMarginMatch[1];
    const side = quarterMarginMatch[2].toLowerCase();
    const spreadRaw = parseFloat(quarterMarginMatch[3]);
    const qKey = `q${qNum}`;
    const qRaw = quarters[qKey];
    
    if (!qRaw) {
      return { grade: 'PENDING', reason: `Q${qNum} score not available` };
    }
    
    const qStr = String(qRaw).replace(/[–—−]/g, '-').replace(/\s+/g, '');
    const qMatch = qStr.match(/(\d+)\s*-\s*(\d+)/);
    
    if (!qMatch) {
      return { grade: 'PENDING', reason: `Q${qNum} score format invalid: "${qRaw}"` };
    }
    
    const homeQ = parseInt(qMatch[1], 10);
    const awayQ = parseInt(qMatch[2], 10);
    
    if (side === 'h') {
      const won = homeQ > awayQ;
      return { 
        grade: won ? 'WON' : 'LOST', 
        reason: `Q${qNum}: ${homeQ}-${awayQ}, Home ${won ? 'wins' : 'loses'} quarter` 
      };
    }
    if (side === 'a') {
      const won = awayQ > homeQ;
      return { 
        grade: won ? 'WON' : 'LOST', 
        reason: `Q${qNum}: ${homeQ}-${awayQ}, Away ${won ? 'wins' : 'loses'} quarter` 
      };
    }
  }
  
  // === Legacy quarter format (Q1: H +5.5) ===
  const quarterMatch = pick.match(/q([1-4])\s*[:\-]?\s*(.+)/i);
  if (quarterMatch) {
    const qNum = quarterMatch[1];
    const signal = quarterMatch[2].trim().toLowerCase();
    const qKey = `q${qNum}`;
    const qRaw = quarters[qKey];
    
    if (!qRaw) {
      return { grade: 'PENDING', reason: `Q${qNum} score not available` };
    }
    
    const qStr = String(qRaw).replace(/[–—−]/g, '-').replace(/\s+/g, '');
    const qMatch = qStr.match(/(\d+)\s*-\s*(\d+)/);
    
    if (!qMatch) {
      return { grade: 'PENDING', reason: `Q${qNum} score format invalid: "${qRaw}"` };
    }
    
    const homeQ = parseInt(qMatch[1], 10);
    const awayQ = parseInt(qMatch[2], 10);
    
    const pickedHome = /^h\b/.test(signal) || signal.includes('home') || signal.startsWith('h ');
    const pickedAway = /^a\b/.test(signal) || signal.includes('away') || signal.startsWith('a ');
    
    if (pickedHome) {
      const won = homeQ > awayQ;
      return { 
        grade: won ? 'WON' : 'LOST', 
        reason: `Q${qNum}: ${homeQ}-${awayQ}, Home ${won ? 'wins' : 'loses'} quarter` 
      };
    }
    if (pickedAway) {
      const won = awayQ > homeQ;
      return { 
        grade: won ? 'WON' : 'LOST', 
        reason: `Q${qNum}: ${homeQ}-${awayQ}, Away ${won ? 'wins' : 'loses'} quarter` 
      };
    }
    
    if (signal.includes(homeWord) || signal.includes(homeNorm)) {
      const won = homeQ > awayQ;
      return { grade: won ? 'WON' : 'LOST', reason: `Q${qNum}: ${homeQ}-${awayQ}` };
    }
    if (signal.includes(awayWord) || signal.includes(awayNorm)) {
      const won = awayQ > homeQ;
      return { grade: won ? 'WON' : 'LOST', reason: `Q${qNum}: ${homeQ}-${awayQ}` };
    }
    
    return { grade: 'PENDING', reason: `Could not parse Q${qNum} pick: "${signal}"` };
  }
  
  // === Fallback: Simple team name match ===
  if (pick === '1' || pick === 'home') {
    return { grade: winner === 1 ? 'WON' : 'LOST', reason: `FT: ${homeScore}-${awayScore}` };
  }
  if (pick === '2' || pick === 'away') {
    return { grade: winner === 2 ? 'WON' : 'LOST', reason: `FT: ${homeScore}-${awayScore}` };
  }
  if (pick.includes(homeWord) || pick.includes(homeNorm)) {
    return { 
      grade: winner === 1 ? 'WON' : 'LOST', 
      reason: `FT: ${homeScore}-${awayScore}` 
    };
  }
  if (pick.includes(awayWord) || pick.includes(awayNorm)) {
    return { 
      grade: winner === 2 ? 'WON' : 'LOST', 
      reason: `FT: ${homeScore}-${awayScore}` 
    };
  }
  
  return { grade: 'PENDING', reason: 'Unknown pick format' };
}


/**
 * Grade all legs in portfolio - PATCHED for SNIPER DIR
 * @param {Spreadsheet} ss - Active spreadsheet
 * @param {Object} resultsMap - Map of match keys to result objects
 * @returns {string} Summary report
 */
function _gradePortfolioLegs(ss, resultsMap) {
  const FUNC_NAME = '_gradePortfolioLegs';
  
  const portfolioSheet = ss.getSheetByName('Acca_Portfolio');
  if (!portfolioSheet) {
    throw new Error('Acca_Portfolio sheet not found. Build portfolio first.');
  }
  
  const data = portfolioSheet.getDataRange().getValues();
  if (data.length < 2) {
    throw new Error('Acca_Portfolio is empty.');
  }
  
  // Find column indices
  let colMap = { match: 3, pick: 4, type: 5, status: 9, league: 2 };
  
  // Try to find header row
  for (let r = 0; r < Math.min(10, data.length); r++) {
    const row = data[r];
    const rowStr = row.map(c => String(c).toLowerCase()).join('|');
    if (rowStr.includes('date') && rowStr.includes('match') && rowStr.includes('pick')) {
      row.forEach((cell, idx) => {
        const key = String(cell).toLowerCase().trim();
        if (key === 'match') colMap.match = idx;
        if (key === 'pick') colMap.pick = idx;
        if (key === 'status') colMap.status = idx;
        if (key === 'type') colMap.type = idx;
        if (key === 'league') colMap.league = idx;
      });
      break;
    }
  }
  
  Logger.log(`[${FUNC_NAME}] Column map: Match=${colMap.match}, Pick=${colMap.pick}, Status=${colMap.status}, Type=${colMap.type}`);
  
  // Stats tracking with SNIPER DIR breakdown
  let stats = { 
    won: 0, lost: 0, pending: 0, noResult: 0, skipped: 0, error: 0,
    bankerWon: 0, bankerLost: 0,
    sniperWon: 0, sniperLost: 0,
    sniperDirWon: 0, sniperDirLost: 0  // NEW: SNIPER DIR tracking
  };
  
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const cell0 = String(row[0] || '').trim();
    const matchStr = String(row[colMap.match] || '').trim();
    const pickStr = String(row[colMap.pick] || '').trim();
    const typeStr = String(row[colMap.type] || '').toUpperCase();
    
    // Skip non-leg rows
    if (!matchStr || !pickStr) { stats.skipped++; continue; }
    if (cell0 === 'Date' || cell0 === 'ACCA STATUS:') { stats.skipped++; continue; }
    if (cell0.includes('MA GOLIDE') || cell0.includes('Generated') || cell0.includes('Total')) { stats.skipped++; continue; }
    if (cell0.includes('-Fold') || cell0.includes('Double') || cell0.includes('Single') || cell0.includes('Treble')) { stats.skipped++; continue; }
    
    // Must contain "vs" to be a valid match
    if (!matchStr.toLowerCase().includes(' vs ') && !matchStr.includes(' @ ')) { stats.skipped++; continue; }
    
    // Parse match teams
    const { home, away } = _parseMatchString(matchStr);
    if (!home || !away) {
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: Could not parse match "${matchStr}"`);
      stats.noResult++;
      continue;
    }
    
    // Find result
    let result = null;
    const keysToTry = _generateAllMatchKeys(home, away);
    
    for (const key of keysToTry) {
      if (resultsMap[key]) {
        result = resultsMap[key];
        break;
      }
    }
    
    if (!result) {
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: No result found for "${matchStr}"`);
      stats.noResult++;
      continue;
    }
    
    if (!result.isFinished) {
      stats.pending++;
      continue;
    }
    
    // Grade the pick using enhanced grader
    const gradeResult = _gradePickDetailed(pickStr, result, home, away);
    const grade = gradeResult.grade;
    const reason = gradeResult.reason;
    
    // Determine bet type for stats
    const isBanker = typeStr.includes('BANKER');
    const isSniper = typeStr.includes('SNIPER');
    const isSniperDir = typeStr.includes('DIR') || /Q[1-4]\s*(OVER|UNDER)/i.test(pickStr);
    
    // Update stats
    if (grade === 'WON') {
      stats.won++;
      if (isBanker) stats.bankerWon++;
      if (isSniper) stats.sniperWon++;
      if (isSniperDir) stats.sniperDirWon++;
    } else if (grade === 'LOST') {
      stats.lost++;
      if (isBanker) stats.bankerLost++;
      if (isSniper) stats.sniperLost++;
      if (isSniperDir) stats.sniperDirLost++;
    } else if (grade === 'ERROR') {
      stats.error++;
    } else {
      stats.pending++;
    }
    
    // Update the status cell
    const statusCell = portfolioSheet.getRange(r + 1, colMap.status + 1);
    statusCell.setValue(grade);
    
    if (grade === 'WON') {
      statusCell.setBackground('#b7e1cd').setFontWeight('bold').setFontColor('#0f5132');
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: ✅ WON - ${matchStr} | ${pickStr} | ${reason}`);
    } else if (grade === 'LOST') {
      statusCell.setBackground('#f4c7c3').setFontWeight('bold').setFontColor('#c62828');
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: ❌ LOST - ${matchStr} | ${pickStr} | ${reason}`);
    } else if (grade === 'ERROR') {
      statusCell.setBackground('#fff3cd').setFontWeight('bold').setFontColor('#856404');
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: ⚠️ ERROR - ${matchStr} | ${pickStr} | ${reason}`);
    } else {
      statusCell.setBackground('#fff2cc').setFontWeight('bold').setFontColor('#bf9000');
    }
  }
  
  // Update ACCA STATUS rows
  _updateAccaStatusRows(portfolioSheet);
  
  // Build summary with SNIPER DIR breakdown
  Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════`);
  Logger.log(`[${FUNC_NAME}] ✅ Grading complete:`);
  Logger.log(`[${FUNC_NAME}]    Won: ${stats.won}, Lost: ${stats.lost}`);
  Logger.log(`[${FUNC_NAME}]    Pending: ${stats.pending}, No Result: ${stats.noResult}`);
  Logger.log(`[${FUNC_NAME}]    🔒 Bankers: ${stats.bankerWon}W / ${stats.bankerLost}L`);
  Logger.log(`[${FUNC_NAME}]    🎯 Snipers: ${stats.sniperWon}W / ${stats.sniperLost}L`);
  Logger.log(`[${FUNC_NAME}]       └─ DIR: ${stats.sniperDirWon}W / ${stats.sniperDirLost}L`);
  Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════`);
  
  let report = `Grading Complete:\n\n`;
  report += `✅ Won: ${stats.won}\n`;
  report += `❌ Lost: ${stats.lost}\n`;
  report += `⏳ Pending: ${stats.pending}\n`;
  report += `❓ No Result: ${stats.noResult}\n`;
  if (stats.error > 0) report += `⚠️ Errors: ${stats.error}\n`;
  report += `\n`;
  report += `🔒 Bankers: ${stats.bankerWon}W / ${stats.bankerLost}L\n`;
  report += `🎯 Snipers: ${stats.sniperWon}W / ${stats.sniperLost}L\n`;
  if (stats.sniperDirWon > 0 || stats.sniperDirLost > 0) {
    report += `   └─ DIR O/U: ${stats.sniperDirWon}W / ${stats.sniperDirLost}L\n`;
  }
  
  return report;
}

function _gradePick(pickStr, result, home, away) {
  const pick = pickStr.toLowerCase().trim();
  const { homeScore, awayScore, winner, quarters } = result;
  const homeLower = home.toLowerCase().trim();
  const awayLower = away.toLowerCase().trim();
  
  // BANKER: Win picks
  if (pick.includes('win')) {
    const homeFirst = homeLower.split(' ')[0];
    const awayFirst = awayLower.split(' ')[0];
    
    if (pick.includes(homeLower) || pick.includes(homeFirst) || pick.startsWith(homeFirst)) {
      return winner === 1 ? 'WON' : 'LOST';
    }
    if (pick.includes(awayLower) || pick.includes(awayFirst) || pick.startsWith(awayFirst)) {
      return winner === 2 ? 'WON' : 'LOST';
    }
  }
  
  // SNIPER: Quarter picks (Q1: H +5.5)
  const quarterMatch = pick.match(/q([1-4]):\s*(.+)/i);
  if (quarterMatch) {
    const qNum = quarterMatch[1];
    const signal = quarterMatch[2].trim().toLowerCase();
    const qKey = `q${qNum}`;
    const qScore = quarters[qKey];
    
    if (!qScore) return 'PENDING';
    
    const scoreStr = String(qScore).replace(/[–—]/g, '-').replace(/\s/g, '');
    if (!scoreStr.includes('-')) return 'PENDING';
    
    const parts = scoreStr.split('-').map(s => parseInt(s.trim(), 10));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return 'PENDING';
    
    const homeQ = parts[0];
    const awayQ = parts[1];
    
    const pickedHome = signal.startsWith('h ') || signal.startsWith('h+') || signal.startsWith('h-') || signal === 'h';
    const pickedAway = signal.startsWith('a ') || signal.startsWith('a+') || signal.startsWith('a-') || signal === 'a';
    
    if (pickedHome) return homeQ > awayQ ? 'WON' : 'LOST';
    if (pickedAway) return awayQ > homeQ ? 'WON' : 'LOST';
    
    return 'PENDING';
  }
  
  // Moneyline
  if (pick === homeLower || pick.includes(homeLower)) return winner === 1 ? 'WON' : 'LOST';
  if (pick === awayLower || pick.includes(awayLower)) return winner === 2 ? 'WON' : 'LOST';
  
  return 'PENDING';
}

/**
 * Update all ACCA STATUS rows in portfolio based on leg results
 */
function _updateAccaStatusRows(sheet) {
  const FUNC_NAME = '_updateAccaStatusRows';
  
  const data = sheet.getDataRange().getValues();
  const numRows = data.length;
  
  // Find status column index
  let statusColIdx = 9; // Default
  for (let r = 0; r < Math.min(10, numRows); r++) {
    const row = data[r];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).toLowerCase() === 'status') {
        statusColIdx = c;
        break;
      }
    }
  }
  
  let updatedCount = 0;
  
  for (let r = 0; r < numRows; r++) {
    const cell0 = String(data[r][0] || '').trim();
    
    if (cell0 !== 'ACCA STATUS:') continue;
    
    // Scan backwards to collect leg statuses
    const legStatuses = [];
    
    for (let j = r - 1; j >= 0; j--) {
      const prevCell0 = String(data[j][0] || '').trim();
      const prevMatch = String(data[j][3] || '').trim(); // Match column
      
      // Stop at acca header or other headers
      if (prevCell0.includes('-Fold') || prevCell0.includes('Double') || 
          prevCell0.includes('Single') || prevCell0.includes('Treble') ||
          prevCell0 === 'Date' || prevCell0.includes('MA GOLIDE')) {
        break;
      }
      
      // If this looks like a leg row (has match with "vs")
      if (prevMatch && (prevMatch.toLowerCase().includes(' vs ') || prevMatch.includes(' @ '))) {
        const legStatus = String(sheet.getRange(j + 1, statusColIdx + 1).getValue() || 'PENDING').toUpperCase().trim();
        if (['WON', 'LOST', 'PENDING'].includes(legStatus)) {
          legStatuses.push(legStatus);
        }
      }
    }
    
    // Determine overall acca status
    let accaStatus = 'PENDING';
    let bgColor = '#fff2cc';
    let fontColor = '#bf9000';
    
    if (legStatuses.length === 0) {
      accaStatus = 'PENDING';
    } else if (legStatuses.includes('LOST')) {
      accaStatus = 'LOST';
      bgColor = '#f4c7c3';
      fontColor = '#c62828';
    } else if (legStatuses.every(s => s === 'WON')) {
      accaStatus = 'WON';
      bgColor = '#b7e1cd';
      fontColor = '#0f5132';
    }
    
    // Update the status cell (column B of ACCA STATUS row)
    const statusCell = sheet.getRange(r + 1, 2);
    statusCell.setValue(accaStatus)
      .setBackground(bgColor)
      .setFontWeight('bold')
      .setFontColor(fontColor);
    
    updatedCount++;
    Logger.log(`[${FUNC_NAME}] Row ${r + 1}: ${legStatuses.length} legs → ${accaStatus}`);
  }
  
  Logger.log(`[${FUNC_NAME}] ✅ Updated ${updatedCount} ACCA STATUS rows`);
}

function _updateAccaResultsSummary(ss) {
  const resultsSheet = _getSheet(ss, 'Acca_Results');
  const portfolioSheet = _getSheet(ss, 'Acca_Portfolio');
  
  if (!resultsSheet || !portfolioSheet) return;
  
  const portfolioData = portfolioSheet.getDataRange().getValues();
  const accaData = {};
  
  let currentAccaId = null;
  let currentCounts = { won: 0, lost: 0, pending: 0, total: 0 };
  
  for (let i = 0; i < portfolioData.length; i++) {
    const row = portfolioData[i];
    const firstCell = String(row[0] || '').trim();
    const col10 = String(row[9] || '').trim();
    
    if (col10 && col10.includes('_') && !col10.includes('|')) {
      const rowStr = row.join(' ');
      if (rowStr.includes('Leg') || rowStr.includes('Fold') || rowStr.includes('Double') || rowStr.includes('Single')) {
        if (currentAccaId && currentCounts.total > 0) {
          let status = 'PENDING';
          if (currentCounts.lost > 0) status = 'LOST';
          else if (currentCounts.pending === 0 && currentCounts.won > 0) status = 'WON';
          accaData[currentAccaId] = { ...currentCounts, status };
        }
        
        currentAccaId = col10;
        currentCounts = { won: 0, lost: 0, pending: 0, total: 0 };
        continue;
      }
    }
    
    if (firstCell === 'Date' || firstCell.includes('ACCA STATUS')) continue;
    if (!firstCell || firstCell.includes('MA GOLIDE') || firstCell.includes('Generated') || firstCell.includes('Total Accas')) continue;
    
    if (currentAccaId) {
      const legStatus = String(row[8] || '').toUpperCase().trim();
      
      if (legStatus === 'WON') { currentCounts.won++; currentCounts.total++; }
      else if (legStatus === 'LOST') { currentCounts.lost++; currentCounts.total++; }
      else if (legStatus === 'PENDING') { currentCounts.pending++; currentCounts.total++; }
    }
  }
  
  if (currentAccaId && currentCounts.total > 0) {
    let status = 'PENDING';
    if (currentCounts.lost > 0) status = 'LOST';
    else if (currentCounts.pending === 0 && currentCounts.won > 0) status = 'WON';
    accaData[currentAccaId] = { ...currentCounts, status };
  }
  
  const resultsData = resultsSheet.getDataRange().getValues();
  if (resultsData.length < 2) return;
  
  const resultsHeaders = _createHeaderMap(resultsData[0]);
  const idCol = resultsHeaders['acca id'];
  const statusCol = resultsHeaders['status'];
  const legsWonCol = resultsHeaders['legs won'];
  const legsLostCol = resultsHeaders['legs lost'];
  const legsPendingCol = resultsHeaders['legs pending'];
  const resultCol = resultsHeaders['result'];
  
  if (idCol === undefined) return;
  
  for (let i = 1; i < resultsData.length; i++) {
    const accaId = String(resultsData[i][idCol] || '').trim();
    const counts = accaData[accaId];
    
    if (!counts) continue;
    
    const rowNum = i + 1;
    
    if (statusCol !== undefined) {
      const cell = resultsSheet.getRange(rowNum, statusCol + 1);
      cell.setValue(counts.status).setFontWeight('bold');
      if (counts.status === 'WON') cell.setBackground('#b7e1cd').setFontColor('#0f5132');
      else if (counts.status === 'LOST') cell.setBackground('#f4c7c3').setFontColor('#c62828');
      else cell.setBackground('#fff2cc').setFontColor('#bf9000');
    }
    
    if (legsWonCol !== undefined) resultsSheet.getRange(rowNum, legsWonCol + 1).setValue(counts.won);
    if (legsLostCol !== undefined) resultsSheet.getRange(rowNum, legsLostCol + 1).setValue(counts.lost);
    if (legsPendingCol !== undefined) resultsSheet.getRange(rowNum, legsPendingCol + 1).setValue(counts.pending);
    
    if (resultCol !== undefined) {
      const resultText = counts.status === 'WON' ? '💰 WIN' : counts.status === 'LOST' ? '❌ LOSS' : '⏳ Pending';
      resultsSheet.getRange(rowNum, resultCol + 1).setValue(resultText);
    }
  }
}


// ============================================================
// DEBUG HELPER
// ============================================================

function debugDatePipeline() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('===== DATE PIPELINE DEBUG =====');
  
  const syncSheet = _getSheet(ss, 'Sync_Temp');
  if (syncSheet && syncSheet.getLastRow() > 1) {
    const headers = syncSheet.getRange(1, 1, 1, 10).getValues()[0];
    Logger.log('Headers: ' + headers.join(' | '));
    
    const firstRow = syncSheet.getRange(2, 1, 1, 10).getValues()[0];
    Logger.log('First row: ' + firstRow.join(' | '));
  }
  
  Logger.log('===== END DEBUG =====');
}


/**
 * Build as many accas of a target size as possible from pool
 * Uses STRICT diversification rules
 */
function _buildAccasOfTargetSize(pool, usedBetIds, targetSize, typePrefix) {
  const FUNC_NAME = '_buildAccasOfTargetSize';
  const accas = [];
  const maxWindowMs = ACCA_ENGINE_CONFIG.MAX_WINDOW_HOURS * 60 * 60 * 1000;
  const maxIterations = 50;
  
  // Get constraints for this size
  const maxPerLeague = ACCA_ENGINE_CONFIG.MAX_PER_LEAGUE[targetSize] || 2;
  const minAccuracy = ACCA_ENGINE_CONFIG.MIN_ACCURACY[targetSize] || 50;
  const excludePenalty = targetSize >= ACCA_ENGINE_CONFIG.EXCLUDE_PENALTY_FROM_SIZE;
  
  Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════════════`);
  Logger.log(`[${FUNC_NAME}] Target: ${targetSize}-Fold ${typePrefix}`);
  Logger.log(`[${FUNC_NAME}] Pool size: ${pool.length}, Already used: ${usedBetIds.size}`);
  Logger.log(`[${FUNC_NAME}] Constraints: maxPerLeague=${maxPerLeague}, minAcc=${minAccuracy}%, noPenalty=${excludePenalty}`);
  
  for (let iter = 0; iter < maxIterations; iter++) {
    // Get available bets (not yet used)
    let available = pool.filter(b => !usedBetIds.has(b.betId));
    
    // Apply quality filters for this size
    if (excludePenalty) {
      available = available.filter(b => !b.hasPenalty);
    }
    if (minAccuracy > 0) {
      available = available.filter(b => (b.accuracyScore || 0) >= minAccuracy);
    }
    
    Logger.log(`[${FUNC_NAME}]   Iteration ${iter + 1}: ${available.length} eligible bets`);
    
    if (available.length < targetSize) {
      Logger.log(`[${FUNC_NAME}]   ⏹️ Not enough eligible bets (${available.length} < ${targetSize})`);
      break;
    }
    
    // Attempt to build one acca with constraints
    const acca = _buildOneAccaWithConstraints(available, targetSize, typePrefix, maxWindowMs);
    
    if (!acca) {
      Logger.log(`[${FUNC_NAME}]   ⏹️ Cannot build acca with current constraints`);
      break;
    }
    
    // Mark legs as used
    acca.legs.forEach(leg => usedBetIds.add(leg.betId));
    accas.push(acca);
    
    // Log acca details
    const leagueCounts = {};
    acca.legs.forEach(l => {
      const league = l.league || 'unknown';
      leagueCounts[league] = (leagueCounts[league] || 0) + 1;
    });
    
    const avgAcc = acca.avgAccuracy.toFixed(1);
    const penaltyCount = acca.legs.filter(l => l.hasPenalty).length;
    const leagueSummary = Object.entries(leagueCounts).map(([k, v]) => `${k}:${v}`).join(', ');
    
    Logger.log(`[${FUNC_NAME}]   ✅ Built ${targetSize}-Fold #${accas.length}`);
    Logger.log(`[${FUNC_NAME}]      Avg Accuracy: ${avgAcc}%, Penalties: ${penaltyCount}`);
    Logger.log(`[${FUNC_NAME}]      Leagues: ${leagueSummary}`);
  }
  
  Logger.log(`[${FUNC_NAME}] Result: Built ${accas.length} ${targetSize}-Fold(s)`);
  
  return accas;
}

/**
 * Stable match key — two bets with the same key are from the SAME game
 * and CANNOT coexist in one accumulator.
 * Format: "league|normalized match"  (date omitted — portfolio is single-session)
 */
function _matchKey(bet) {
  const league = String(bet.league || '').toLowerCase().trim();
  let match = String(bet.match || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!match) {
    const home = String(bet.home || '').toLowerCase().trim();
    const away = String(bet.away || '').toLowerCase().trim();
    if (home && away) match = home + ' vs ' + away;
  }
  return league + '|' + match;
}

/**
 * Can this candidate be added without duplicating a match?
 */
function _canAddToAcca(legs, candidate) {
  const key = _matchKey(candidate);
  for (let i = 0; i < legs.length; i++) {
    if (_matchKey(legs[i]) === key) return false;
  }
  return true;
}

/**
 * Count how many legs share a match with another leg (0 = clean acca).
 */
function _countSameGame(legs) {
  const seen = {};
  let dupes = 0;
  for (let i = 0; i < legs.length; i++) {
    const k = _matchKey(legs[i]);
    if (seen[k]) dupes++;
    else seen[k] = true;
  }
  return dupes;
}

/**
 * Balanced Size Planner
 * Allocates bets evenly across requested sizes to ensure portfolio diversity,
 * rather than greedily minimizing the total number of accumulators.
 */
function _buildSizePlan(totalBets, preferredSizes) {
  if (!preferredSizes || preferredSizes.length === 0) return [totalBets];
  
  const sizes = [...preferredSizes].sort((a, b) => b - a);
  const plan = [];
  let remaining = totalBets;
  
  // Phase 1: Distribute available bets equally among the preferred sizes
  // e.g., for 136 bets and 3 sizes, each size "bucket" aims for ~45 bets
  const targetBetsPerSize = Math.floor(totalBets / sizes.length);
  
  sizes.forEach(size => {
    // How many accas of this size cleanly fit into the target bucket?
    let count = Math.floor(targetBetsPerSize / size);
    for(let i = 0; i < count; i++) {
      plan.push(size);
      remaining -= size;
    }
  });
  
  // Phase 2: Mop up the remainder greedily (largest to smallest)
  for (let s = 0; s < sizes.length; s++) {
    const sz = sizes[s];
    while (remaining >= sz) {
      plan.push(sz);
      remaining -= sz;
    }
  }
  
  // Phase 3: Catch any final stragglers (Doubles or Singles)
  while (remaining >= 2) { plan.push(2); remaining -= 2; }
  while (remaining >= 1) { plan.push(1); remaining -= 1; }
  
  // Return sorted Largest to Smallest
  return plan.sort((a, b) => b - a);
}

/**
 * _buildOneAccaWithConstraints
 *
 * ARCHITECTURE NOTE: When GOLD_ONLY_MODE is true, this function enforces
 * candidate.assayer_passed === true. Because Gold Gate is now disabled in
 * _filterBets, the assayer_passed value here is the BRIDGE's decision
 * (set during enrichment by assayerEnrichBet_). This is correct —
 * the Bridge is the authority, and this function respects it.
 *
 * If GOLD_ONLY_MODE is false, no quality gate is applied here.
 */
function _buildOneAccaWithConstraints(available, size, label, maxWindowMs) {
  if (size < 1 || available.length < size) return null;

  // ── Sort: multi-criteria, best first ──
  var GRADE_RANK = { GOLD: 4, SILVER: 3, BRONZE: 2, ROCK: 1, CHARCOAL: 0 };
  var normGrade = function(g) { return String(g || '').trim().toUpperCase(); };
  var rankOf = function(g) {
    var n = normGrade(g);
    return GRADE_RANK[n] !== undefined ? GRADE_RANK[n] : -1;
  };

  var sorted = available.slice().sort(function(a, b) {
    // 1. assayer_passed (true first)
    var aPass = (a.assayer_passed === true);
    var bPass = (b.assayer_passed === true);
    if (aPass !== bPass) return aPass ? -1 : 1;

    // 2. edge grade
    var aEdgeRank = rankOf(a.assayer_edge_grade ||
      (a.assayer && a.assayer.edge ? a.assayer.edge.grade : ''));
    var bEdgeRank = rankOf(b.assayer_edge_grade ||
      (b.assayer && b.assayer.edge ? b.assayer.edge.grade : ''));
    if (aEdgeRank !== bEdgeRank) return bEdgeRank - aEdgeRank;

    // 3. purity grade
    var aPurRank = rankOf(a.assayer_purity_grade ||
      (a.assayer && a.assayer.purity ? a.assayer.purity.grade : ''));
    var bPurRank = rankOf(b.assayer_purity_grade ||
      (b.assayer && b.assayer.purity ? b.assayer.purity.grade : ''));
    if (aPurRank !== bPurRank) return bPurRank - aPurRank;

    // 4. lift
    var aLift = (a.assayer && a.assayer.edge && typeof a.assayer.edge.lift === 'number')
      ? a.assayer.edge.lift : -999;
    var bLift = (b.assayer && b.assayer.edge && typeof b.assayer.edge.lift === 'number')
      ? b.assayer.edge.lift : -999;
    if (aLift !== bLift) return bLift - aLift;

    // 5. sample size
    var aN = Number((a.assayer && a.assayer.edge
      ? (a.assayer.edge.n || a.assayer.edge.sampleSize) : 0) || 0);
    var bN = Number((b.assayer && b.assayer.edge
      ? (b.assayer.edge.n || b.assayer.edge.sampleSize) : 0) || 0);
    if (aN !== bN) return bN - aN;

    // 6. accuracyScore
    return (Number(b.accuracyScore || 0) - Number(a.accuracyScore || 0));
  });

  var legs = [];
  var inclusionLog = [];
  var MAX_INCLUSION_LOG = 50;

  var usedStrictMatchCounts = {};
  var usedGameKeys = {};
  var usedLeagueCounts = {};

  var maxPerLeague = (ACCA_ENGINE_CONFIG.MAX_PER_LEAGUE &&
    ACCA_ENGINE_CONFIG.MAX_PER_LEAGUE[size] !== undefined)
    ? Number(ACCA_ENGINE_CONFIG.MAX_PER_LEAGUE[size])
    : size;

  var maxSameGamePicks = Number(ACCA_ENGINE_CONFIG.MAX_SAME_GAME_PICKS || 1);

  for (var i = 0; i < sorted.length; i++) {
    if (legs.length >= size) break;

    var candidate = sorted[i];

    // PATCH: Safety warning when assayer_passed is missing entirely
    if (ACCA_ENGINE_CONFIG.GOLD_ONLY_MODE &&
        typeof candidate.assayer_passed !== 'boolean') {
      if (ACCA_ENGINE_CONFIG.VERBOSE_LOGGING) {
        Logger.log('[WARN] candidate ' + (candidate.betId || '?') +
          ' has no assayer_passed value — treating as FAIL');
      }
    }

    // ── Quality gate: reads Bridge's assayer_passed decision ──
    if (ACCA_ENGINE_CONFIG.GOLD_ONLY_MODE && candidate.assayer_passed !== true) continue;

    var strictKey = _getStrictMatchKey(candidate);
    var gameKey = _getGameKey(candidate);

    // ── Match uniqueness ──
    var alreadyFromMatch = usedStrictMatchCounts[strictKey] || 0;
    if (maxSameGamePicks <= 1) {
      if (alreadyFromMatch >= 1) continue;
    } else {
      if (alreadyFromMatch >= maxSameGamePicks) continue;
      if (usedGameKeys[gameKey]) continue;
    }

    // ── Max per league ──
    var leagueKey = String(candidate.league || '').toLowerCase().trim();
    var leagueCount = usedLeagueCounts[leagueKey] || 0;
    if (maxPerLeague > 0 && leagueCount >= maxPerLeague) continue;

    // ── Time window ──
    if (legs.length > 0 && maxWindowMs) {
      var cTime = (candidate.time instanceof Date) ? candidate.time.getTime() : Date.now();
      var minT = cTime, maxT = cTime;
      for (var t = 0; t < legs.length; t++) {
        var lt = (legs[t].time instanceof Date) ? legs[t].time.getTime() : Date.now();
        if (lt < minT) minT = lt;
        if (lt > maxT) maxT = lt;
      }
      if (maxT - minT > maxWindowMs) continue;
    }

    // ── Accept leg ──
    legs.push(candidate);

    usedStrictMatchCounts[strictKey] = alreadyFromMatch + 1;
    usedLeagueCounts[leagueKey] = leagueCount + 1;
    usedGameKeys[gameKey] = true;

    if (inclusionLog.length < MAX_INCLUSION_LOG) {
      inclusionLog.push({
        betId: candidate.betId || '',
        league: candidate.league || '',
        verdict: candidate.assayer_verdict || '',
        proof: candidate.assayer_proof_log || ''
      });
    }

    if (ACCA_ENGINE_CONFIG.VERBOSE_LOGGING) {
      Logger.log('[_buildOneAccaWithConstraints] ✅ Added betId=' + (candidate.betId || '?')
        + ' verdict=' + (candidate.assayer_verdict || '')
        + ' acc=' + Number(candidate.accuracyScore || 0).toFixed(2));
    }
  }

  if (legs.length < size) return null;

  // ── Post-build verification ──
  if (ACCA_ENGINE_CONFIG.GOLD_ONLY_MODE) {
    for (var j = 0; j < legs.length; j++) {
      if (legs[j].assayer_passed !== true) return null;
    }
  }

  // ── Build acca object ──
  var foldLabel = size === 1 ? '' : ' ' + size + '-Fold';
  var acca = _createAccaObjectEnhanced(legs, label + foldLabel);

  try { acca.inclusionLog = inclusionLog; } catch (e) { /* swallow */ }

  return acca;
}

/**
 * STRICT MATCH KEY GENERATOR
 * Ignores pick type/market. Enforces 1 bet per match.
 */
function _getStrictMatchKey(bet) {
  const league = String(bet.league || '').toLowerCase().trim();
  // Normalize match name to handle slight spacing variations
  const match = String(bet.match || '').toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*vs\.?\s*/gi, ' vs ') 
    .replace(/[^\w\s]/g, ''); // Remove punctuation
  
  return `${league}|${match}`;
}

/**
 * PATCHED: Generate a unique key for a game pick (not just game)
 * CHANGED: Now includes pick type so Q1, Q3, Win from same game are DIFFERENT
 */
function _getGameKey(bet) {
  const league = String(bet.league || '').toLowerCase().trim();
  const match = String(bet.match || '').toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '');
  
  // Extract pick category (Q1, Q2, Q3, Q4, Win)
  const pick = String(bet.pick || '').toLowerCase();
  let pickCategory = 'win';
  
  const qMatch = pick.match(/q([1-4])/i);
  if (qMatch) {
    pickCategory = `q${qMatch[1]}`;
  }
  
  // Same match + same pick category = same game key
  // Same match + different pick category = different game key
  return `${league}|${match}|${pickCategory}`;
}

/**
 * Get time slot key (hour) for clustering protection
 */
function _getTimeSlot(time) {
  if (!time || !(time instanceof Date)) return 'unknown';
  const date = time.toISOString().split('T')[0];
  const hour = time.getHours();
  return `${date}_${String(hour).padStart(2, '0')}`;
}

/**
 * Create a fully-populated acca object from a set of legs.
 * 
 * PATCHED:
 *   - Same-game detection now uses _matchKey (league+match)
 *     instead of the broken _getGameKey which compared pick text.
 *   - Logs duplicate-match details when detected (should be 0
 *     if _buildOneAccaWithConstraints is doing its job).
 */
function _createAccaObjectEnhanced(legs, name) {
  const FUNC_NAME = '_createAccaObjectEnhanced';

  // ── Time bounds ──
  const times = legs.map(l =>
    (l.time instanceof Date) ? l.time.getTime() : Date.now()
  );
  const earliest = times.length > 0 ? new Date(Math.min.apply(null, times)) : new Date();
  const latest   = times.length > 0 ? new Date(Math.max.apply(null, times)) : new Date();

  // ── Aggregates ──
  let sumAcc = 0, sumConf = 0, totalOdds = 1.0, penaltyCount = 0;
  const leagueCounts = {};

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    sumAcc   += (leg.accuracyScore || ACCA_ENGINE_CONFIG.PENALTY_ACCURACY);
    sumConf  += (leg.confidence || 0);
    totalOdds *= (parseFloat(leg.odds) || 1.0);
    if (leg.hasPenalty) penaltyCount++;

    const lg = leg.league || 'unknown';
    leagueCounts[lg] = (leagueCounts[lg] || 0) + 1;
  }

  const avgAccuracy   = legs.length > 0 ? sumAcc  / legs.length : 0;
  const avgConfidence = legs.length > 0 ? sumConf / legs.length : 0;

  const leagueKeys = Object.keys(leagueCounts);
  const uniqueLeagues = leagueKeys.length;
  const leagueVals = leagueKeys.map(k => leagueCounts[k]);
  const maxLeagueConcentration = leagueVals.length > 0
    ? Math.max.apply(null, leagueVals) : 0;

  // ── FIX: real same-game detection via _matchKey ──
  const sameGamePicks = _countSameGame(legs);

  const timeSpreadHours = (latest - earliest) / (1000 * 60 * 60);

  const acca = {
    id: 'ACCA_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
    name: name + ' (' + avgAccuracy.toFixed(1) + '% avg)',
    type: name,
    legs: legs,
    totalOdds: totalOdds,
    avgAccuracy: avgAccuracy,
    avgConfidence: avgConfidence,
    penaltyCount: penaltyCount,
    timeWindow: {
      start: earliest,
      end: latest
    },
    status: ACCA_ENGINE_CONFIG.STATUS.PENDING,
    createdAt: new Date(),

    diversification: {
      uniqueLeagues: uniqueLeagues,
      maxLeagueConcentration: maxLeagueConcentration,
      leagueCounts: leagueCounts,
      sameGamePicks: sameGamePicks,
      timeSpreadHours: timeSpreadHours.toFixed(1)
    }
  };

  if (ACCA_ENGINE_CONFIG.VERBOSE_LOGGING) {
    Logger.log('[' + FUNC_NAME + '] Created: ' + acca.name);
    Logger.log('[' + FUNC_NAME + ']   ID: ' + acca.id);
    Logger.log('[' + FUNC_NAME + ']   Legs: ' + legs.length + ' from ' + uniqueLeagues + ' leagues');
    Logger.log('[' + FUNC_NAME + ']   Odds: ' + totalOdds.toFixed(2));
    Logger.log('[' + FUNC_NAME + ']   Avg Accuracy: ' + avgAccuracy.toFixed(1) + '%');
    Logger.log('[' + FUNC_NAME + ']   Penalty bets: ' + penaltyCount);
    Logger.log('[' + FUNC_NAME + ']   Max league concentration: ' + maxLeagueConcentration);
    Logger.log('[' + FUNC_NAME + ']   Same-game picks: ' + sameGamePicks + ' (should be 0)');
    Logger.log('[' + FUNC_NAME + ']   Time spread: ' + timeSpreadHours.toFixed(1) + ' hours');

    // If same-game slipped through, log which matches are duplicated
    if (sameGamePicks > 0) {
      Logger.log('[' + FUNC_NAME + ']   ⚠️ DUPLICATE MATCHES IN THIS ACCA:');
      const mc = {};
      for (let d = 0; d < legs.length; d++) {
        const mk = _matchKey(legs[d]);
        mc[mk] = (mc[mk] || 0) + 1;
      }
      const mcKeys = Object.keys(mc);
      for (let d = 0; d < mcKeys.length; d++) {
        if (mc[mcKeys[d]] > 1) {
          Logger.log('[' + FUNC_NAME + ']     ' + mcKeys[d] + ' ×' + mc[mcKeys[d]]);
        }
      }
    }
  }

  return acca;
}

/**
 * Scan existing accumulators for vulnerabilities
 * Run this after building to verify constraints were applied
 */
function scanAccaVulnerabilities() {
  const FUNC_NAME = 'scanAccaVulnerabilities';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  
  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════════════════╗');
  Logger.log('║               🛡️ ACCUMULATOR VULNERABILITY SCANNER 🛡️                    ║');
  Logger.log('╚══════════════════════════════════════════════════════════════════════════╝');
  
  ss.toast('🛡️ Scanning for vulnerabilities...', 'Acca Scanner', 10);
  
  const issues = { critical: [], warnings: [] };
  
  const portfolioSheet = ss.getSheetByName('Acca_Portfolio');
  if (!portfolioSheet) {
    if (ui) ui.alert('❌ Error', 'Acca_Portfolio sheet not found.', ui.ButtonSet.OK);
    return;
  }
  
  const data = portfolioSheet.getDataRange().getValues();
  
  let currentAccaId = null;
  let currentAccaName = '';
  let currentLegs = [];
  
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const cell0 = String(row[0] || '').trim();
    const lastCell = String(row[row.length - 1] || '').trim();
    
    // Detect acca header
    if ((cell0.includes('Fold') || cell0.includes('Double')) && 
        (lastCell.startsWith('ACCA_'))) {
      
      // Analyze previous acca
      if (currentAccaId && currentLegs.length > 0) {
        _analyzeAccaForIssues(currentAccaId, currentAccaName, currentLegs, issues);
      }
      
      currentAccaId = lastCell;
      currentAccaName = cell0;
      currentLegs = [];
      continue;
    }
    
    // Skip non-data rows
    if (cell0 === 'Date' || cell0 === 'ACCA STATUS:' || cell0 === '' || 
        cell0.includes('MA GOLIDE') || cell0.includes('Generated')) {
      continue;
    }
    
    // Collect leg data
    if (currentAccaId) {
      const league = String(row[2] || '').trim();
      const match = String(row[3] || '').trim();
      const pick = String(row[4] || '').trim();
      const accuracy = String(row[8] || '');
      const timeStr = String(row[1] || '');
      
      if (match && match.includes(' vs ')) {
        currentLegs.push({ league, match, pick, accuracy, timeStr });
      }
    }
  }
  
  // Analyze last acca
  if (currentAccaId && currentLegs.length > 0) {
    _analyzeAccaForIssues(currentAccaId, currentAccaName, currentLegs, issues);
  }
  
  // Generate report
  let report = `🛡️ VULNERABILITY SCAN COMPLETE\n\n`;
  report += `🔴 Critical Issues: ${issues.critical.length}\n`;
  report += `🟡 Warnings: ${issues.warnings.length}\n\n`;
  
  if (issues.critical.length > 0) {
    report += `CRITICAL:\n`;
    issues.critical.slice(0, 5).forEach(i => {
      report += `• ${i}\n`;
    });
    if (issues.critical.length > 5) {
      report += `... and ${issues.critical.length - 5} more\n`;
    }
    report += '\n';
  }
  
  if (issues.warnings.length > 0) {
    report += `WARNINGS:\n`;
    issues.warnings.slice(0, 5).forEach(w => {
      report += `• ${w}\n`;
    });
    if (issues.warnings.length > 5) {
      report += `... and ${issues.warnings.length - 5} more\n`;
    }
  }
  
  if (issues.critical.length === 0 && issues.warnings.length === 0) {
    report += `✅ No vulnerabilities found! Your accas are well-diversified.`;
  }
  
  Logger.log(`[${FUNC_NAME}] ✅ Scan complete: ${issues.critical.length} critical, ${issues.warnings.length} warnings`);
  
  if (ui) ui.alert('🛡️ Vulnerability Scan', report, ui.ButtonSet.OK);
  
  return issues;
}

/**
 * Analyze a single acca for vulnerabilities
 */
function _analyzeAccaForIssues(accaId, accaName, legs, issues) {
  const accaSize = legs.length;
  const maxPerLeague = ACCA_ENGINE_CONFIG.MAX_PER_LEAGUE[accaSize] || 2;
  
  // Check league concentration
  const leagueCounts = {};
  legs.forEach(leg => {
    const league = leg.league || 'Unknown';
    leagueCounts[league] = (leagueCounts[league] || 0) + 1;
  });
  
  for (const [league, count] of Object.entries(leagueCounts)) {
    if (count > maxPerLeague) {
      issues.critical.push(`${accaName}: ${count} legs from "${league}" (max ${maxPerLeague})`);
    }
  }
  
  // Check same-game picks
  const gameMap = {};
  legs.forEach(leg => {
    const gameKey = `${leg.league}|${leg.match}`;
    if (!gameMap[gameKey]) gameMap[gameKey] = [];
    gameMap[gameKey].push(leg.pick);
  });
  
  for (const [game, picks] of Object.entries(gameMap)) {
    if (picks.length > 1) {
      const matchName = game.split('|')[1];
      issues.critical.push(`${accaName}: ${picks.length} picks from same game "${matchName}"`);
    }
  }
  
  // Check penalty bets in large accas
  if (accaSize >= ACCA_ENGINE_CONFIG.EXCLUDE_PENALTY_FROM_SIZE) {
    const penaltyLegs = legs.filter(l => 
      l.accuracy.includes('PENALTY') || l.accuracy.includes('N/A')
    );
    if (penaltyLegs.length > 0) {
      issues.warnings.push(`${accaName}: ${penaltyLegs.length} penalty bet(s) in ${accaSize}-fold`);
    }
  }
  
  // Check time clustering
  const timeSlots = {};
  legs.forEach(leg => {
    const hour = leg.timeStr.substring(0, 2) || 'XX';
    timeSlots[hour] = (timeSlots[hour] || 0) + 1;
  });
  
  for (const [slot, count] of Object.entries(timeSlots)) {
    if (count > ACCA_ENGINE_CONFIG.MAX_SAME_TIME_SLOT) {
      issues.warnings.push(`${accaName}: ${count} legs in same hour (${slot}:00)`);
    }
  }
}

// ============================================================
// SUMMARY BUILDER - PATCHED FOR SNIPER DIR
// ============================================================

function _buildMultiSizeSummary(portfolios, totalBets) {
  const FUNC_NAME = '_buildMultiSizeSummary';
  
  if (portfolios.length === 0) {
    return 'No accumulators could be built.\n\nPossible causes:\n- Not enough bets synced\n- All bets filtered out (check time window)\n- Try syncing more leagues';
  }
  
  const totalLegs = portfolios.reduce((sum, a) => sum + a.legs.length, 0);
  const totalPenaltyLegs = portfolios.reduce((sum, a) => sum + (a.penaltyCount || 0), 0);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PATCHED: Count by bet type including SNIPER DIR
  // ═══════════════════════════════════════════════════════════════════════════
  let bankerLegs = 0, sniperLegs = 0, sniperDirLegs = 0, sniperMarginLegs = 0;
  
  portfolios.forEach(p => {
    p.legs.forEach(leg => {
      const type = String(leg.type || '').toUpperCase();
      if (type.includes('BANKER')) {
        bankerLegs++;
      } else if (type.includes('SNIPER')) {
        sniperLegs++;
        if (type.includes('DIR')) {
          sniperDirLegs++;
        } else if (!type.includes('O/U') && !type.includes('OU')) {
          sniperMarginLegs++;
        }
      }
    });
  });
  
  // Group by size
  const bySize = {};
  portfolios.forEach(p => {
    const size = p.legs.length;
    if (!bySize[size]) bySize[size] = { count: 0, banker: 0, sniper: 0, mixed: 0, penalties: 0 };
    bySize[size].count++;
    bySize[size].penalties += (p.penaltyCount || 0);
    
    const name = p.name.toLowerCase();
    if (name.includes('banker')) bySize[size].banker++;
    else if (name.includes('sniper')) bySize[size].sniper++;
    else bySize[size].mixed++;
  });
  
  let summary = `🎰 MULTI-SIZE ACCUMULATOR PORTFOLIO\n\n`;
  summary += `Built ${portfolios.length} accumulator(s)\n`;
  summary += `✅ ${totalLegs}/${totalBets} bets allocated\n`;
  
  // PATCHED: Show bet type breakdown
  summary += `\n📋 BET TYPES:\n`;
  summary += `   🔒 Bankers: ${bankerLegs}\n`;
  summary += `   🎯 Snipers: ${sniperLegs}`;
  if (sniperDirLegs > 0 || sniperMarginLegs > 0) {
    summary += ` (DIR: ${sniperDirLegs}, Margin: ${sniperMarginLegs})`;
  }
  summary += `\n`;
  
  if (totalPenaltyLegs > 0) {
    summary += `   ⚠️ Penalty legs: ${totalPenaltyLegs}\n`;
  }
  
  summary += `\n📊 BREAKDOWN BY SIZE:\n`;
  Object.keys(bySize).sort((a, b) => Number(b) - Number(a)).forEach(size => {
    const s = bySize[size];
    let line = `   ${size}-Fold: ${s.count} (🔒${s.banker} 🎯${s.sniper} ⚔️${s.mixed})`;
    if (s.penalties > 0) {
      line += ` [${s.penalties} penalty legs]`;
    }
    summary += line + '\n';
  });
  
  // Highlight big accas
  const bigAccas = portfolios.filter(p => p.legs.length >= 9);
  if (bigAccas.length > 0) {
    summary += `\n🚀 BIG ACCAS (9+ legs):\n`;
    bigAccas.forEach(a => {
      const avgAcc = a.avgAccuracy ? a.avgAccuracy.toFixed(1) : '?';
      const penaltyNote = a.penaltyCount > 0 ? ` ⚠️${a.penaltyCount} penalty` : '';
      summary += `   • ${a.legs.length}-Fold @ ${a.totalOdds.toFixed(2)} odds (${avgAcc}% avg)${penaltyNote}\n`;
    });
  }
  
  summary += '\nCheck Acca_Portfolio sheet for details.';
  return summary;
}




/**
 * PATCH 12: Apply color formatting including accuracy highlighting
 */
function _applyAccuracyFormatting(sheet, data) {
  const FUNC_NAME = '_applyAccuracyFormatting';
  const numCols = 12;
  
  Logger.log(`[${FUNC_NAME}] Applying formatting to ${data.length} rows...`);
  
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const rowNum = r + 1;
    const range = sheet.getRange(rowNum, 1, 1, numCols);
    
    const cell0 = String(row[0] || '');
    const cell5 = String(row[5] || '').toUpperCase();
    const cell10 = String(row[10] || ''); // Penalty column
    
    if (cell0.includes('MA GOLIDE')) {
      // Main header
      range.setFontWeight('bold').setFontSize(14)
           .setBackground('#1a73e8').setFontColor('#ffffff');
    }
    else if (cell0.includes('Fold') && cell0.includes('|')) {
      // Acca header row
      range.setFontWeight('bold').setBackground('#e3f2fd')
           .setBorder(true, true, true, true, false, false);
      
      // Gold highlight for big accas (9+ legs)
      if (cell0.includes('12-Fold') || cell0.includes('9-Fold')) {
        range.setBackground('#fff8e1');
      }
      
      // Red tint if contains penalty legs
      if (cell0.includes('penalty')) {
        range.setBackground('#ffebee');
      }
    }
    else if (cell0 === 'Date') {
      // Column header row
      range.setFontWeight('bold').setBackground('#f5f5f5').setFontSize(9);
    }
    else if (cell0 === 'ACCA STATUS:') {
      // Status row
      range.setFontWeight('bold').setBackground('#fff3e0');
    }
    else if (cell5.includes('BANKER')) {
      // Banker leg row
      range.setBackground('#e8f5e9');
      _colorAccuracyCell(sheet, rowNum, row[8]);
      if (cell10.includes('⚠️')) {
        sheet.getRange(rowNum, 11).setBackground('#ffcdd2');
      }
    }
    else if (cell5.includes('SNIPER')) {
      // Sniper leg row
      range.setBackground('#fffde7');
      _colorAccuracyCell(sheet, rowNum, row[8]);
      if (cell10.includes('⚠️')) {
        sheet.getRange(rowNum, 11).setBackground('#ffcdd2');
      }
    }
  }
  
  // Freeze header rows
  sheet.setFrozenRows(6);
  
  Logger.log(`[${FUNC_NAME}] ✅ Formatting applied`);
}

/**
 * PATCH 13: Color-code accuracy cell based on value
 */
function _colorAccuracyCell(sheet, rowNum, accValue) {
  const val = parseFloat(String(accValue).replace('%', ''));
  if (isNaN(val)) return;
  
  const cell = sheet.getRange(rowNum, 9); // Column I (Acc%)
  
  if (val <= ACCA_ENGINE_CONFIG.PENALTY_ACCURACY) {
    // Penalty - bright red
    cell.setBackground('#d32f2f').setFontColor('#ffffff').setFontWeight('bold');
  } else if (val >= 80) {
    // Excellent - dark green
    cell.setBackground('#2e7d32').setFontColor('#ffffff').setFontWeight('bold');
  } else if (val >= 65) {
    // Good - light green
    cell.setBackground('#81c784').setFontWeight('bold');
  } else if (val >= 50) {
    // Average - yellow
    cell.setBackground('#fff9c4');
  } else {
    // Below average - red tint
    cell.setBackground('#ffcdd2');
  }
}

/**
 * PATCH 14: Format time for display
 */
function _formatTimeDisplay(time) {
  if (!time) return '';
  
  if (typeof time === 'string') {
    return time;
  }
  
  if (time instanceof Date) {
    try {
      return Utilities.formatDate(time, Session.getScriptTimeZone(), 'HH:mm');
    } catch (e) {
      return time.toTimeString().substring(0, 5);
    }
  }
  
  // Handle serial number (decimal representing time)
  if (typeof time === 'number' && time < 1) {
    const totalMinutes = Math.round(time * 24 * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  
  return String(time);
}

/**
 * Helper: Get sheet by name (case-sensitive)
 */
function _getSheet(ss, name) {
  if (!ss || !name) return null;
  return ss.getSheetByName(name);
}


/**
 * PATCH 5: Update Acca_Results from Portfolio
 * Module: Mothership_AccaEngine.gs
 * Purpose: Manually updates Acca_Results sheet by parsing current Acca_Portfolio statuses
 */
function updateAccaResultsFromPortfolio() {
  const FUNC_NAME = 'updateAccaResultsFromPortfolio';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] Running without UI context`);
  }
  
  Logger.log(`[${FUNC_NAME}] ╔══════════════════════════════════════════════════════════════╗`);
  Logger.log(`[${FUNC_NAME}] ║         UPDATE ACCA_RESULTS FROM PORTFOLIO                   ║`);
  Logger.log(`[${FUNC_NAME}] ╚══════════════════════════════════════════════════════════════╝`);
  Logger.log(`[${FUNC_NAME}] Started at: ${new Date().toISOString()}`);
  
  try {
    ss.toast('🔄 Updating Acca_Results...', 'AccaEngine', 5);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Load Acca_Portfolio
    // ═══════════════════════════════════════════════════════════════════════════
    const portfolioSheet = ss.getSheetByName('Acca_Portfolio');
    if (!portfolioSheet) {
      throw new Error('Acca_Portfolio sheet not found. Build portfolio first.');
    }
    
    const portfolioData = portfolioSheet.getDataRange().getValues();
    Logger.log(`[${FUNC_NAME}] Acca_Portfolio loaded: ${portfolioData.length} rows`);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Parse portfolio to extract acca statuses
    // ═══════════════════════════════════════════════════════════════════════════
    const accaStatuses = {};
    let currentAccaId = null;
    let currentStats = { won: 0, lost: 0, pending: 0, total: 0 };
    
    // Column indices based on schema
    const STATUS_COL = 9;  // Column J (0-indexed)
    
    // FIX: Dynamically find BetID column
    const portfolioHeaders = portfolioData[5] || portfolioData[4] || [];
    let BETID_COL = 11;
    for (let c = 8; c < portfolioHeaders.length; c++) {
      if (String(portfolioHeaders[c]).toUpperCase().includes('BETID')) {
        BETID_COL = c;
        break;
      }
    }
    Logger.log(`[${FUNC_NAME}] BetID column detected at index: ${BETID_COL}`);
    
    for (let i = 0; i < portfolioData.length; i++) {
      const row = portfolioData[i];
      const cell0 = String(row[0] || '').trim();
      const cellLast = String(row[BETID_COL] || '').trim();
      
      // Detect acca header row (contains "Fold" and has ACCA_ ID in last column)
      if ((cell0.includes('Fold') || cell0.includes('Double') || cell0.includes('Single')) &&
          cellLast && cellLast.startsWith('ACCA_')) {
        
        // Save previous acca if exists
        if (currentAccaId && currentStats.total > 0) {
          let status = 'PENDING';
          if (currentStats.lost > 0) status = 'LOST';
          else if (currentStats.pending === 0 && currentStats.won > 0) status = 'WON';
          
          accaStatuses[currentAccaId] = { ...currentStats, status: status };
          Logger.log(`[${FUNC_NAME}]   Parsed: ${currentAccaId} → ${status} (W:${currentStats.won} L:${currentStats.lost} P:${currentStats.pending})`);
        }
        
        // Start new acca
        currentAccaId = cellLast;
        currentStats = { won: 0, lost: 0, pending: 0, total: 0 };
        Logger.log(`[${FUNC_NAME}]   Found acca header: ${currentAccaId}`);
        continue;
      }
      
      // Skip non-leg rows
      if (cell0 === 'Date' || cell0.includes('MA GOLIDE') || cell0.includes('Generated') || cell0 === '') {
        continue;
      }
      
      // Handle ACCA STATUS row (captures displayed status)
      if (cell0 === 'ACCA STATUS:') {
        const displayedStatus = String(row[1] || '').toUpperCase().trim();
        if (currentAccaId && accaStatuses[currentAccaId] && ['WON', 'LOST', 'PENDING'].includes(displayedStatus)) {
          accaStatuses[currentAccaId].status = displayedStatus;
          Logger.log(`[${FUNC_NAME}]   ACCA STATUS row override: ${currentAccaId} → ${displayedStatus}`);
        }
        continue;
      }
      
      // Count leg statuses (legs have bet ID format with "|" in last column)
      if (currentAccaId && cellLast && cellLast.includes('|')) {
        const legStatus = String(row[STATUS_COL] || '').toUpperCase().trim();
        
        if (legStatus === 'WON') {
          currentStats.won++;
          currentStats.total++;
        } else if (legStatus === 'LOST') {
          currentStats.lost++;
          currentStats.total++;
        } else {
          currentStats.pending++;
          currentStats.total++;
        }
      }
    }
    
    // Save last acca
    if (currentAccaId && currentStats.total > 0) {
      let status = 'PENDING';
      if (currentStats.lost > 0) status = 'LOST';
      else if (currentStats.pending === 0 && currentStats.won > 0) status = 'WON';
      
      accaStatuses[currentAccaId] = { ...currentStats, status: status };
      Logger.log(`[${FUNC_NAME}]   Parsed: ${currentAccaId} → ${status} (W:${currentStats.won} L:${currentStats.lost} P:${currentStats.pending})`);
    }
    
    Logger.log(`[${FUNC_NAME}] Total accas parsed: ${Object.keys(accaStatuses).length}`);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Update Acca_Results sheet
    // ═══════════════════════════════════════════════════════════════════════════
    const resultsSheet = ss.getSheetByName('Acca_Results');
    if (!resultsSheet) {
      throw new Error('Acca_Results sheet not found. Build portfolio first.');
    }
    
    const resultsData = resultsSheet.getDataRange().getValues();
    Logger.log(`[${FUNC_NAME}] Acca_Results loaded: ${resultsData.length} rows`);
    
    if (resultsData.length < 2) {
      throw new Error('Acca_Results is empty. Build portfolio first.');
    }
    
    // Map headers
    const headers = resultsData[0];
    const headerMap = {};
    headers.forEach((h, i) => {
      headerMap[String(h).toLowerCase().trim()] = i;
    });
    
    Logger.log(`[${FUNC_NAME}] Acca_Results headers: ${headers.join(' | ')}`);
    
    const idCol = headerMap['acca id'];
    const statusCol = headerMap['status'];
    const legsWonCol = headerMap['legs won'];
    const legsLostCol = headerMap['legs lost'];
    const legsPendingCol = headerMap['legs pending'];
    const resultCol = headerMap['result'];
    
    if (idCol === undefined) {
      throw new Error('Acca_Results missing "Acca ID" column');
    }
    
    let updatedCount = 0;
    
    for (let i = 1; i < resultsData.length; i++) {
      const accaId = String(resultsData[i][idCol] || '').trim();
      const stats = accaStatuses[accaId];
      
      if (!stats) {
        Logger.log(`[${FUNC_NAME}]   Row ${i + 1}: Acca ID "${accaId}" not found in portfolio`);
        continue;
      }
      
      const rowNum = i + 1;
      
      // Update status
      if (statusCol !== undefined) {
        const cell = resultsSheet.getRange(rowNum, statusCol + 1);
        cell.setValue(stats.status).setFontWeight('bold');
        
        if (stats.status === 'WON') {
          cell.setBackground('#b7e1cd').setFontColor('#0f5132');
        } else if (stats.status === 'LOST') {
          cell.setBackground('#f4c7c3').setFontColor('#c62828');
        } else {
          cell.setBackground('#fff2cc').setFontColor('#bf9000');
        }
      }
      
      // Update leg counts
      if (legsWonCol !== undefined) {
        resultsSheet.getRange(rowNum, legsWonCol + 1).setValue(stats.won);
      }
      if (legsLostCol !== undefined) {
        resultsSheet.getRange(rowNum, legsLostCol + 1).setValue(stats.lost);
      }
      if (legsPendingCol !== undefined) {
        resultsSheet.getRange(rowNum, legsPendingCol + 1).setValue(stats.pending);
      }
      
      // Update result column
      if (resultCol !== undefined) {
        let resultText = '⏳ Pending';
        if (stats.status === 'WON') resultText = '💰 WIN';
        else if (stats.status === 'LOST') resultText = '❌ LOSS';
        resultsSheet.getRange(rowNum, resultCol + 1).setValue(resultText);
      }
      
      updatedCount++;
      Logger.log(`[${FUNC_NAME}]   Updated row ${rowNum}: ${accaId} → ${stats.status}`);
    }
    
    Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════════════`);
    Logger.log(`[${FUNC_NAME}] ✅ COMPLETED: Updated ${updatedCount} accumulators`);
    
    if (ui) {
      ui.alert('✅ Acca_Results Updated',
        `Updated ${updatedCount} accumulators.\n\nCheck Acca_Results sheet for details.`,
        ui.ButtonSet.OK);
    }
    
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ ERROR: ${e.message}`);
    Logger.log(`[${FUNC_NAME}] Stack: ${e.stack}`);
    if (ui) {
      ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
    }
  }
}

/**
 * PATCH 6: Generate League Performance Report
 * Module: Mothership_AccaEngine.gs
 * Purpose: Analyzes graded bets by league to identify which leagues contribute to wins/losses
 */
function generateLeaguePerformanceReport() {
  const FUNC_NAME = 'generateLeaguePerformanceReport';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] Running without UI context`);
  }
  
  Logger.log(`[${FUNC_NAME}] ╔══════════════════════════════════════════════════════════════╗`);
  Logger.log(`[${FUNC_NAME}] ║         LEAGUE PERFORMANCE REPORT                            ║`);
  Logger.log(`[${FUNC_NAME}] ╚══════════════════════════════════════════════════════════════╝`);
  Logger.log(`[${FUNC_NAME}] Started at: ${new Date().toISOString()}`);
  
  try {
    ss.toast('📊 Generating league performance report...', 'Analytics', 10);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Load Bet_Performance data
    // ═══════════════════════════════════════════════════════════════════════════
    const perfSheet = ss.getSheetByName('Bet_Performance');
    if (!perfSheet) {
      throw new Error('Bet_Performance sheet not found. Run "Analyze Bet Performance" first.');
    }
    
    const perfData = perfSheet.getDataRange().getValues();
    Logger.log(`[${FUNC_NAME}] Bet_Performance loaded: ${perfData.length} rows`);
    
    // Find data start row (after headers)
    let dataStartRow = 0;
    for (let i = 0; i < perfData.length; i++) {
      if (String(perfData[i][0]).trim() === 'League') {
        dataStartRow = i + 1;
        Logger.log(`[${FUNC_NAME}] Header row found at index ${i}, data starts at ${dataStartRow}`);
        break;
      }
    }
    
    if (dataStartRow === 0) {
      throw new Error('Could not find data section in Bet_Performance (no "League" header found)');
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Aggregate stats by league
    // ═══════════════════════════════════════════════════════════════════════════
    const leagueStats = {};
    
    for (let i = dataStartRow; i < perfData.length; i++) {
      const row = perfData[i];
      const league = String(row[0] || '').trim();
      const betType = String(row[3] || '').toUpperCase();
      const grade = String(row[4] || '').toUpperCase();
      
      if (!league) continue;
      
      // Initialize league if not exists
      if (!leagueStats[league]) {
        leagueStats[league] = {
          total: 0, won: 0, lost: 0, pending: 0, noResult: 0,
          bankerTotal: 0, bankerWon: 0, bankerLost: 0,
          sniperTotal: 0, sniperWon: 0, sniperLost: 0
        };
      }
      
      const stats = leagueStats[league];
      stats.total++;
      
      // Count by grade
      if (grade === 'WON') stats.won++;
      else if (grade === 'LOST') stats.lost++;
      else if (grade === 'PENDING') stats.pending++;
      else stats.noResult++;
      
      // Count by type
      const isBanker = betType.includes('BANKER');
      const isSniper = betType.includes('SNIPER');
      
      if (isBanker) {
        stats.bankerTotal++;
        if (grade === 'WON') stats.bankerWon++;
        else if (grade === 'LOST') stats.bankerLost++;
      }
      
      if (isSniper) {
        stats.sniperTotal++;
        if (grade === 'WON') stats.sniperWon++;
        else if (grade === 'LOST') stats.sniperLost++;
      }
    }
    
    Logger.log(`[${FUNC_NAME}] Aggregated stats for ${Object.keys(leagueStats).length} leagues`);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: Calculate metrics and rank
    // ═══════════════════════════════════════════════════════════════════════════
    const leagueRankings = Object.entries(leagueStats).map(([league, stats]) => {
      const gradedBets = stats.won + stats.lost;
      const overallWinRate = gradedBets > 0 ? (stats.won / gradedBets) * 100 : null;
      
      const bankerGraded = stats.bankerWon + stats.bankerLost;
      const bankerWinRate = bankerGraded > 0 ? (stats.bankerWon / bankerGraded) * 100 : null;
      
      const sniperGraded = stats.sniperWon + stats.sniperLost;
      const sniperWinRate = sniperGraded > 0 ? (stats.sniperWon / sniperGraded) * 100 : null;
      
      // Success score: 60% win rate, 40% volume (capped at 20 bets)
      let successScore = 0;
      if (overallWinRate !== null) {
        const volumeScore = Math.min(gradedBets / 20, 1) * 100;
        successScore = (overallWinRate * 0.6) + (volumeScore * 0.4);
      }
      
      return {
        league, ...stats, graded: gradedBets,
        overallWinRate, bankerWinRate, sniperWinRate, successScore
      };
    }).sort((a, b) => b.successScore - a.successScore);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Write report
    // ═══════════════════════════════════════════════════════════════════════════
    let reportSheet = ss.getSheetByName('League_Performance');
    if (!reportSheet) {
      reportSheet = ss.insertSheet('League_Performance');
    }
    reportSheet.clear();
    
    const report = [];
    
    // Title
    report.push(['📊 LEAGUE PERFORMANCE REPORT', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    report.push([`Generated: ${new Date().toLocaleString()}`, '', '', '', '', '', '', '', '', '', '', '', '', '']);
    report.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    
    // Summary
    const totalWon = leagueRankings.reduce((s, l) => s + l.won, 0);
    const totalLost = leagueRankings.reduce((s, l) => s + l.lost, 0);
    const totalGraded = totalWon + totalLost;
    const overallRate = totalGraded > 0 ? ((totalWon / totalGraded) * 100).toFixed(1) : 'N/A';
    report.push([`OVERALL: ${totalWon}W / ${totalLost}L (${overallRate}%)`, '', '', '', '', '', '', '', '', '', '', '', '', '']);
    report.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '']);
    
    // Headers
    report.push([
      'Rank', 'League', 'Score', 'Win Rate', 'Won', 'Lost', 'Graded',
      'Banker W%', 'B Won', 'B Lost', 'Sniper W%', 'S Won', 'S Lost', 'Status'
    ]);
    
    // Data rows
    leagueRankings.forEach((l, idx) => {
      const winRateStr = l.overallWinRate !== null ? `${l.overallWinRate.toFixed(1)}%` : 'N/A';
      const bankerRateStr = l.bankerWinRate !== null ? `${l.bankerWinRate.toFixed(1)}%` : 'N/A';
      const sniperRateStr = l.sniperWinRate !== null ? `${l.sniperWinRate.toFixed(1)}%` : 'N/A';
      
      let status = '❓ NO DATA';
      if (l.overallWinRate !== null) {
        if (l.overallWinRate >= 60) status = '🏆 EXCELLENT';
        else if (l.overallWinRate >= 50) status = '✅ GOOD';
        else if (l.overallWinRate >= 40) status = '⚠️ AVERAGE';
        else status = '❌ POOR';
      } else if (l.pending > 0 || l.noResult > 0) {
        status = '⏳ PENDING';
      }
      
      report.push([
        idx + 1, l.league, l.successScore.toFixed(1), winRateStr,
        l.won, l.lost, l.graded,
        bankerRateStr, l.bankerWon, l.bankerLost,
        sniperRateStr, l.sniperWon, l.sniperLost, status
      ]);
      
      Logger.log(`[${FUNC_NAME}]   ${idx + 1}. ${l.league}: ${winRateStr} (${l.won}W/${l.lost}L) - ${status}`);
    });
    
    // Write to sheet
    reportSheet.getRange(1, 1, report.length, 14).setValues(report);
    
    // Format
    reportSheet.getRange(1, 1, 1, 14).merge()
      .setFontWeight('bold').setFontSize(16)
      .setBackground('#2d3436').setFontColor('#ffffff');
    reportSheet.getRange(6, 1, 1, 14)
      .setFontWeight('bold').setBackground('#4a86e8').setFontColor('#ffffff');
    
    // Color code win rates
    for (let i = 0; i < leagueRankings.length; i++) {
      const rowNum = 7 + i;
      const l = leagueRankings[i];
      
      if (l.overallWinRate !== null) {
        const rateCell = reportSheet.getRange(rowNum, 4);
        if (l.overallWinRate >= 60) {
          rateCell.setBackground('#d4edda').setFontColor('#155724').setFontWeight('bold');
        } else if (l.overallWinRate >= 50) {
          rateCell.setBackground('#d1ecf1').setFontColor('#0c5460');
        } else if (l.overallWinRate >= 40) {
          rateCell.setBackground('#fff3cd').setFontColor('#856404');
        } else {
          rateCell.setBackground('#f8d7da').setFontColor('#721c24');
        }
      }
      
      // Alternate row shading
      if (i % 2 === 1) {
        reportSheet.getRange(rowNum, 1, 1, 14).setBackground('#f8f9fa');
      }
    }
    
    reportSheet.autoResizeColumns(1, 14);
    reportSheet.setFrozenRows(6);
    
    Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════════════`);
    Logger.log(`[${FUNC_NAME}] ✅ COMPLETED: Report written to League_Performance sheet`);
    
    // Summary alert
    let summary = `📊 LEAGUE PERFORMANCE REPORT\n\n`;
    summary += `Total Leagues: ${leagueRankings.length}\n`;
    summary += `Overall: ${totalWon}W / ${totalLost}L (${overallRate}%)\n\n`;
    
    summary += `🏆 TOP 3:\n`;
    leagueRankings.slice(0, 3).forEach((l, i) => {
      const rate = l.overallWinRate !== null ? `${l.overallWinRate.toFixed(1)}%` : 'N/A';
      summary += `   ${i + 1}. ${l.league}: ${rate}\n`;
    });
    
    const poorLeagues = leagueRankings.filter(l => l.overallWinRate !== null && l.overallWinRate < 45);
    if (poorLeagues.length > 0) {
      summary += `\n❌ NEEDS IMPROVEMENT:\n`;
      poorLeagues.slice(0, 3).forEach(l => {
        summary += `   • ${l.league}: ${l.overallWinRate.toFixed(1)}%\n`;
      });
    }
    
    summary += `\nSee League_Performance sheet for full report.`;
    
    if (ui) {
      ui.alert('📊 League Performance Report', summary, ui.ButtonSet.OK);
    }
    
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ ERROR: ${e.message}`);
    Logger.log(`[${FUNC_NAME}] Stack: ${e.stack}`);
    if (ui) {
      ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
    }
  }
}

/**
 * PATCH 7: Debug Accuracy Metrics
 * Module: Mothership_AccaEngine.gs
 * Purpose: Debug tool to check which leagues have Config_Tier1/Config_Tier2_Proposals sheets
 */
function debugAccuracyMetrics() {
  const FUNC_NAME = 'debugAccuracyMetrics';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  Logger.log(`[${FUNC_NAME}] ╔══════════════════════════════════════════════════════════════╗`);
  Logger.log(`[${FUNC_NAME}] ║         DEBUG: ACCURACY METRICS & CONFIG SHEETS              ║`);
  Logger.log(`[${FUNC_NAME}] ╚══════════════════════════════════════════════════════════════╝`);
  Logger.log(`[${FUNC_NAME}] Started at: ${new Date().toISOString()}`);
  
  const results = {
    withBoth: [],
    withTier1Only: [],
    withTier2Only: [],
    withNeither: [],
    errors: []
  };
  
  try {
    const configSheet = ss.getSheetByName('Config');
    if (!configSheet) {
      Logger.log(`[${FUNC_NAME}] ❌ Config sheet not found`);
      return;
    }
    
    const configData = configSheet.getDataRange().getValues();
    Logger.log(`[${FUNC_NAME}] Config sheet: ${configData.length - 1} leagues`);
    
    // Map headers
    const headers = configData[0].map(h => String(h).toLowerCase().trim());
    const nameCol = headers.findIndex(h => h.includes('league name') || h === 'league');
    const urlCol = headers.findIndex(h => h.includes('url'));
    const statusCol = headers.indexOf('status');
    
    Logger.log(`[${FUNC_NAME}] Columns: nameCol=${nameCol}, urlCol=${urlCol}, statusCol=${statusCol}`);
    
    for (let r = 1; r < configData.length; r++) {
      const row = configData[r];
      const leagueName = nameCol >= 0 ? String(row[nameCol] || '').trim() : `League_Row${r}`;
      const fileUrl = String(row[urlCol] || '').trim();
      const status = statusCol >= 0 ? String(row[statusCol] || 'active').toLowerCase() : 'active';
      
      if (status !== 'active' || !fileUrl || fileUrl.includes('PASTE_')) {
        Logger.log(`[${FUNC_NAME}]   ⏭️ SKIP: ${leagueName} (status=${status}, url valid=${!!fileUrl})`);
        continue;
      }
      
      Logger.log(`[${FUNC_NAME}] ───────────────────────────────────────────────────────────`);
      Logger.log(`[${FUNC_NAME}] Checking: ${leagueName}`);
      
      try {
        const satellite = SpreadsheetApp.openByUrl(fileUrl);
        const sheetNames = satellite.getSheets().map(s => s.getName());
        Logger.log(`[${FUNC_NAME}]   Sheets: ${sheetNames.join(', ')}`);
        
        const hasTier1 = sheetNames.some(n => n === 'Config_Tier1');
        const hasTier2 = sheetNames.some(n => n === 'Config_Tier2_Proposals');
        
        let tier1Acc = null, tier2Acc = null;
        
        if (hasTier1) {
          const t1 = satellite.getSheetByName('Config_Tier1').getDataRange().getValues();
          for (let i = 0; i < t1.length; i++) {
            if (String(t1[i][0]).toLowerCase().includes('accuracy')) {
              tier1Acc = parseFloat(String(t1[i][1]).replace('%', ''));
              break;
            }
          }
          Logger.log(`[${FUNC_NAME}]   ✅ Config_Tier1: ${tier1Acc !== null ? tier1Acc + '%' : 'found but no accuracy row'}`);
        } else {
          Logger.log(`[${FUNC_NAME}]   ❌ Config_Tier1: NOT FOUND`);
        }
        
        if (hasTier2) {
          const t2 = satellite.getSheetByName('Config_Tier2_Proposals').getDataRange().getValues();
          let propCol = 1;
          if (t2[0]) {
            const pIdx = t2[0].findIndex(c => String(c).toLowerCase().includes('proposed'));
            if (pIdx >= 0) propCol = pIdx;
          }
          for (let i = 0; i < t2.length; i++) {
            if (String(t2[i][0]).toLowerCase().includes('side accuracy')) {
              tier2Acc = parseFloat(String(t2[i][propCol]).replace('%', ''));
              break;
            }
          }
          Logger.log(`[${FUNC_NAME}]   ✅ Config_Tier2_Proposals: ${tier2Acc !== null ? tier2Acc + '%' : 'found but no accuracy row'}`);
        } else {
          Logger.log(`[${FUNC_NAME}]   ❌ Config_Tier2_Proposals: NOT FOUND`);
        }
        
        // Categorize
        if (hasTier1 && hasTier2) {
          results.withBoth.push({ league: leagueName, tier1: tier1Acc, tier2: tier2Acc });
        } else if (hasTier1) {
          results.withTier1Only.push({ league: leagueName, tier1: tier1Acc });
        } else if (hasTier2) {
          results.withTier2Only.push({ league: leagueName, tier2: tier2Acc });
        } else {
          results.withNeither.push({ league: leagueName });
        }
        
      } catch (e) {
        Logger.log(`[${FUNC_NAME}]   ❌ ERROR: ${e.message}`);
        results.errors.push({ league: leagueName, error: e.message });
      }
    }
    
    // Summary
    Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════════════`);
    Logger.log(`[${FUNC_NAME}] SUMMARY:`);
    Logger.log(`[${FUNC_NAME}]   ✅ With BOTH configs: ${results.withBoth.length}`);
    results.withBoth.forEach(l => Logger.log(`[${FUNC_NAME}]      ${l.league}: Tier1=${l.tier1}%, Tier2=${l.tier2}%`));
    
    Logger.log(`[${FUNC_NAME}]   ⚠️ With Tier1 ONLY: ${results.withTier1Only.length}`);
    results.withTier1Only.forEach(l => Logger.log(`[${FUNC_NAME}]      ${l.league}: Tier1=${l.tier1}%`));
    
    Logger.log(`[${FUNC_NAME}]   ⚠️ With Tier2 ONLY: ${results.withTier2Only.length}`);
    results.withTier2Only.forEach(l => Logger.log(`[${FUNC_NAME}]      ${l.league}: Tier2=${l.tier2}%`));
    
    Logger.log(`[${FUNC_NAME}]   🚨 With NEITHER (PENALTY): ${results.withNeither.length}`);
    results.withNeither.forEach(l => Logger.log(`[${FUNC_NAME}]      ${l.league} → Bets will be LAST in acca building`));
    
    Logger.log(`[${FUNC_NAME}]   ❌ Errors: ${results.errors.length}`);
    results.errors.forEach(l => Logger.log(`[${FUNC_NAME}]      ${l.league}: ${l.error}`));
    
    Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════════════`);
    
    // UI Alert
    try {
      const ui = SpreadsheetApp.getUi();
      ui.alert('🔍 Debug Accuracy Metrics',
        `✅ With Both Configs: ${results.withBoth.length}\n` +
        `⚠️ With Tier1 Only: ${results.withTier1Only.length}\n` +
        `⚠️ With Tier2 Only: ${results.withTier2Only.length}\n` +
        `🚨 With Neither (PENALTY): ${results.withNeither.length}\n` +
        `❌ Errors: ${results.errors.length}\n\n` +
        `Check View → Logs for detailed output.`,
        ui.ButtonSet.OK);
    } catch (e) {}
    
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ ERROR: ${e.message}`);
    Logger.log(`[${FUNC_NAME}] Stack: ${e.stack}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════════
// FIXED BET ID - Now includes PICK for uniqueness
// ═══════════════════════════════════════════════════════════════════════════════

function _generateBetId(league, match, pick) {
  const cleanLeague = (league || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanMatch = (match || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanPick = (pick || '').toLowerCase()
    .replace(/[^a-z0-9\s\.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return `${cleanLeague}|${cleanMatch}|${cleanPick}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STANDALONE ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * runLeftoverProcessing — Three-Tier (SILVER + Reason-Gated RISKY)
 *
 * ◄◄ FIX: GOLD_ONLY_MODE set to false when floor is SILVER (no semantic conflict).
 * ◄◄ FIX: UI summary includes Risky rejection breakdown.
 */
function runLeftoverProcessing() {
  var FUNC = 'runLeftoverProcessing';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (_) {}

  Logger.log('[' + FUNC + '] ✅ Phase 3 starting (SILVER + RISKY)...');
  ss.toast('🧹 Phase 3: Silver leftovers + Risky rescue...', 'Leftover Handler', 15);

  try {
    var allBets = _loadBetsFromSyncTemp(ss);
    if (!allBets || allBets.length === 0) throw new Error('Sync_Temp has no valid bets');
    Logger.log('[' + FUNC + '] Loaded: ' + allBets.length);

    var usedBetIds = _extractUsedBetIdsFromAccaPortfolio(ss);
    Logger.log('[' + FUNC + '] Main-used: ids=' + usedBetIds.size);

    var leagueMetrics = fetchLeagueAccuracyMetrics();
    Logger.log('[' + FUNC + '] ✅ Metrics: ' + Object.keys(leagueMetrics || {}).length);

    var assayerData = null;
    try {
      assayerData = (typeof _getAssayerDataCached_ === 'function')
        ? _getAssayerDataCached_() : null;
    } catch (_) { assayerData = null; }

    if (!assayerData) {
      var sid = getAssayerSheetIdForMother_(ss);
      assayerData = sid
        ? loadAssayerData_(sid)
        : { ok: false, error: 'Missing assayer_sheet_id' };
    }
    if (!assayerData || !assayerData.ok)
      throw new Error('Assayer failed: ' + (assayerData ? assayerData.error : 'null'));

    Logger.log('[' + FUNC + '] ✅ Assayer: edges=' +
      assayerData.meta.edgeCount + ', purity=' + assayerData.meta.purityCount);

    // ◄◄ FIX: GOLD_ONLY_MODE=false when floor is SILVER (avoids semantic conflict)
    accaEngineSyncAssayerBridgeConfig_({
      GOLD_ONLY_MODE:        false,
      MIN_EDGE_GRADE:        'SILVER',
      MIN_PURITY_GRADE:      'SILVER',
      UNKNOWN_LEAGUE_ACTION: (ACCA_ENGINE_CONFIG && ACCA_ENGINE_CONFIG.UNKNOWN_LEAGUE_ACTION) || 'BLOCK',
      REQUIRE_RELIABLE_EDGE: false
    }, FUNC);

    var result = processLeftoverBets(
      ss, allBets, usedBetIds, leagueMetrics, assayerData);

    ss.toast('✅ Phase 3 complete! (Silver + Risky)', 'Done', 5);

    if (ui && result && result.summary) {
      var s = result.summary;
      var rr = s.riskyRejectedBreakdown || {};

      ui.alert('🧹 Phase 3 — Silver + Risky',
        '═══ THREE-TIER PORTFOLIO ═══\n\n' +
        'Total Sync_Temp: ' + s.total + '\n' +
        'In Main (GOLD): ' + s.inMain + '\n' +
        'Expired: ' + s.expired + '\n\n' +
        '── SILVER TIER ──\n' +
        'Standard Qualified: ' + s.standardQualified + '\n' +
        'Silver Qualified: ' + s.silverQualified + '\n' +
        'Used In Leftover: ' + s.inLeftover + '\n' +
        'Leftover Accas: ' + s.leftoverAccas + '\n\n' +
        '── RISKY TIER (reason-gated) ──\n' +
        'Risky Qualified: ' + (rr.qualified || 0) + '\n' +
        'Risky Pool (after exclusions): ' + s.riskyPool + '\n' +
        'Used In Risky Accas: ' + s.inRisky + '\n' +
        'Risky Accas Built: ' + s.riskyAccas + '\n\n' +
        '── RISKY REJECTIONS ──\n' +
        'Edge too weak: ' + (rr.edgeTooWeak || 0) + '\n' +
        'Edge unreliable: ' + (rr.edgeUnreliable || 0) + '\n' +
        'Edge small sample: ' + (rr.edgeTooSmall || 0) + '\n' +
        'Purity hard-block: ' + (rr.purityHardBlock || 0) + '\n' +
        'Purity forbidden grade: ' + (rr.purityForbiddenGrade || 0) + '\n' +
        'Not purity failure: ' + (rr.notPurityFailure || 0) + '\n\n' +
        'Sheets: Leftover_Accas, Risky_Accas, Bet_Audit',
        ui.ButtonSet.OK);
    }

    Logger.log('[' + FUNC + '] ✅ Phase 3 complete');
    return result;

  } catch (e) {
    Logger.log('[' + FUNC + '] ❌ ' + e.message);
    Logger.log('[' + FUNC + '] Stack: ' + e.stack);
    ss.toast('❌ ' + e.message, 'Error', 10);
    if (ui) ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
    return null;
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHECK LEFTOVER ACCUMULATOR RESULTS
 * Module: Mothership_AccaEngine.gs
 * Purpose: Check results for leftover accumulators in the Leftover_Accas sheet
 * ═══════════════════════════════════════════════════════════════════════════
 */
function checkLeftoverAccumulatorResults() {
  const FUNC_NAME = 'checkLeftoverAccumulatorResults';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}
  
  ss.toast('🔍 Checking Leftover Results...', 'LeftoverChecker', 15);
  
  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════╗');
  Logger.log('║              LEFTOVER ACCUMULATOR RESULT CHECKER             ║');
  Logger.log('╚══════════════════════════════════════════════════════════════╝');
  Logger.log(`[${FUNC_NAME}] Started: ${new Date().toISOString()}`);
  
  try {
    // STEP 1: Load and index all results from Results_Temp
    Logger.log(`[${FUNC_NAME}] STEP 1: Loading Results_Temp...`);
    const resultsMap = _loadResultsTempForGrading(ss);
    const keyCount = Object.keys(resultsMap).length;
    
    if (keyCount === 0) {
      const msg = 'No results found in Results_Temp. Run "Sync All Results" first.';
      Logger.log(`[${FUNC_NAME}] ❌ ${msg}`);
      if (ui) ui.alert('❌ No Results', msg, ui.ButtonSet.OK);
      return;
    }
    
    // Count unique finished games (exclude reversed entries)
    const finishedGames = new Set();
    Object.entries(resultsMap).forEach(([key, res]) => {
      if (res.isFinished && !res._reversed) {
        finishedGames.add(`${res.home}|${res.away}`);
      }
    });
    Logger.log(`[${FUNC_NAME}] ✅ Loaded ${keyCount} lookup keys for ${finishedGames.size} finished games`);
    
    // STEP 2: Grade each leg in Leftover_Accas
    Logger.log(`[${FUNC_NAME}] STEP 2: Grading leftover portfolio legs...`);
    const gradeReport = _gradeLeftoverPortfolioLegs(ss, resultsMap);
    
    // STEP 3: Update leftover acca status rows
    Logger.log(`[${FUNC_NAME}] STEP 3: Updating leftover acca statuses...`);
    _updateLeftoverAccaStatusRows(ss);
    
    // STEP 4: Create/Update Leftover_Results sheet
    Logger.log(`[${FUNC_NAME}] STEP 4: Creating Leftover_Results summary...`);
    _createLeftoverResultsSheet(ss);
    
    // STEP 5: Refresh dashboard if available
    if (typeof updateDashboard === 'function') {
      try {
        updateDashboard();
        Logger.log(`[${FUNC_NAME}] ✅ Dashboard refreshed`);
      } catch (e) {
        Logger.log(`[${FUNC_NAME}] ⚠️ Dashboard update skipped: ${e.message}`);
      }
    }
    
    ss.toast('✅ Leftover results checked!', 'Complete', 5);
    Logger.log(`[${FUNC_NAME}] ✅ COMPLETED SUCCESSFULLY`);
    
    if (ui) ui.alert('✅ Leftover Results Checked', gradeReport, ui.ButtonSet.OK);
    
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ ERROR: ${e.message}`);
    Logger.log(`[${FUNC_NAME}] Stack: ${e.stack}`);
    ss.toast('❌ Error checking leftover results', 'Error', 5);
    if (ui) ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}

/**
 * Grade all legs in leftover portfolio - similar to main portfolio grading
 * @param {Spreadsheet} ss - Active spreadsheet
 * @param {Object} resultsMap - Map of match keys to result objects
 * @returns {string} Summary report
 */
function _gradeLeftoverPortfolioLegs(ss, resultsMap) {
  const FUNC_NAME = '_gradeLeftoverPortfolioLegs';
  
  const leftoverSheet = ss.getSheetByName('Leftover_Accas');
  if (!leftoverSheet) {
    throw new Error('Leftover_Accas sheet not found. Run "Process Leftover Bets" first.');
  }
  
  const data = leftoverSheet.getDataRange().getValues();
  if (data.length < 2) {
    throw new Error('Leftover_Accas is empty.');
  }
  
  // Find column indices - similar structure to Acca_Portfolio
  let colMap = { match: 3, pick: 4, type: 5, status: 8, league: 2 };
  
  // Try to find header row
  for (let r = 0; r < Math.min(15, data.length); r++) {
    const row = data[r];
    const rowStr = row.map(c => String(c).toLowerCase()).join('|');
    if (rowStr.includes('date') && rowStr.includes('match') && rowStr.includes('pick')) {
      row.forEach((cell, idx) => {
        const key = String(cell).toLowerCase().trim();
        if (key === 'match') colMap.match = idx;
        if (key === 'pick') colMap.pick = idx;
        if (key === 'status') colMap.status = idx;
        if (key === 'type') colMap.type = idx;
        if (key === 'league') colMap.league = idx;
      });
      break;
    }
  }
  
  Logger.log(`[${FUNC_NAME}] Column map: Match=${colMap.match}, Pick=${colMap.pick}, Status=${colMap.status}, Type=${colMap.type}`);
  
  // Stats tracking
  let stats = { 
    won: 0, lost: 0, pending: 0, noResult: 0, skipped: 0, error: 0,
    bankerWon: 0, bankerLost: 0,
    sniperWon: 0, sniperLost: 0,
    leftoverWon: 0, leftoverLost: 0
  };
  
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const cell0 = String(row[0] || '').trim();
    const matchStr = String(row[colMap.match] || '').trim();
    const pickStr = String(row[colMap.pick] || '').trim();
    const typeStr = String(row[colMap.type] || '').toUpperCase();
    
    // Skip non-leg rows
    if (!matchStr || !pickStr) { stats.skipped++; continue; }
    if (cell0 === 'Date' || cell0 === 'ACCA STATUS:') { stats.skipped++; continue; }
    if (cell0.includes('LEFTOVER') || cell0.includes('Generated') || cell0.includes('Total')) { stats.skipped++; continue; }
    if (cell0.includes('Fold') || cell0.includes('Double') || cell0.includes('Single') || cell0.includes('Treble')) { stats.skipped++; continue; }
    
    // Must contain "vs" to be a valid match
    if (!matchStr.toLowerCase().includes(' vs ') && !matchStr.includes(' @ ')) { stats.skipped++; continue; }
    
    // Parse match teams
    const { home, away } = _parseMatchString(matchStr);
    if (!home || !away) {
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: Could not parse match "${matchStr}"`);
      stats.noResult++;
      continue;
    }
    
    // Find result
    let result = null;
    const keysToTry = _generateAllMatchKeys(home, away);
    
    for (const key of keysToTry) {
      if (resultsMap[key]) {
        result = resultsMap[key];
        break;
      }
    }
    
    if (!result) {
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: No result found for "${matchStr}"`);
      stats.noResult++;
      continue;
    }
    
    if (!result.isFinished) {
      stats.pending++;
      continue;
    }
    
    // Grade the pick using detailed grader
    const gradeResult = _gradeSinglePick(pickStr, result, home, away);
    const grade = gradeResult.grade;
    const reason = gradeResult.reason;
    
    // Determine bet type for stats
    const isBanker = typeStr.includes('BANKER');
    const isSniper = typeStr.includes('SNIPER');
    const isLeftover = typeStr.includes('LEFTOVER') || cell0.includes('♻️');
    
    // Update stats
    if (grade === 'WON') {
      stats.won++;
      if (isBanker) stats.bankerWon++;
      if (isSniper) stats.sniperWon++;
      if (isLeftover) stats.leftoverWon++;
    } else if (grade === 'LOST') {
      stats.lost++;
      if (isBanker) stats.bankerLost++;
      if (isSniper) stats.sniperLost++;
      if (isLeftover) stats.leftoverLost++;
    } else if (grade === 'ERROR') {
      stats.error++;
    } else {
      stats.pending++;
    }
    
    // Update the status cell
    const statusCell = leftoverSheet.getRange(r + 1, colMap.status + 1);
    statusCell.setValue(grade);
    
    if (grade === 'WON') {
      statusCell.setBackground('#b7e1cd').setFontWeight('bold').setFontColor('#0f5132');
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: ✅ WON - ${matchStr} | ${pickStr} | ${reason}`);
    } else if (grade === 'LOST') {
      statusCell.setBackground('#f4c7c3').setFontWeight('bold').setFontColor('#c62828');
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: ❌ LOST - ${matchStr} | ${pickStr} | ${reason}`);
    } else if (grade === 'ERROR') {
      statusCell.setBackground('#fff3cd').setFontWeight('bold').setFontColor('#856404');
      Logger.log(`[${FUNC_NAME}] Row ${r + 1}: ⚠️ ERROR - ${matchStr} | ${pickStr} | ${reason}`);
    } else {
      statusCell.setBackground('#fff2cc').setFontWeight('bold').setFontColor('#bf9000');
    }
  }
  
  // Build summary
  Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════`);
  Logger.log(`[${FUNC_NAME}] ✅ Leftover grading complete:`);
  Logger.log(`[${FUNC_NAME}]    Won: ${stats.won}, Lost: ${stats.lost}`);
  Logger.log(`[${FUNC_NAME}]    Pending: ${stats.pending}, No Result: ${stats.noResult}`);
  Logger.log(`[${FUNC_NAME}]    🔒 Bankers: ${stats.bankerWon}W / ${stats.bankerLost}L`);
  Logger.log(`[${FUNC_NAME}]    🎯 Snipers: ${stats.sniperWon}W / ${stats.sniperLost}L`);
  Logger.log(`[${FUNC_NAME}]    ♻️ Leftovers: ${stats.leftoverWon}W / ${stats.leftoverLost}L`);
  Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════`);
  
  let report = `Leftover Grading Complete:\n\n`;
  report += `✅ Won: ${stats.won}\n`;
  report += `❌ Lost: ${stats.lost}\n`;
  report += `⏳ Pending: ${stats.pending}\n`;
  report += `❓ No Result: ${stats.noResult}\n`;
  if (stats.error > 0) report += `⚠️ Errors: ${stats.error}\n`;
  report += `\n`;
  report += `♻️ Leftover Performance:\n`;
  report += `   Total: ${stats.leftoverWon}W / ${stats.leftoverLost}L\n`;
  if (stats.bankerWon > 0 || stats.bankerLost > 0) {
    report += `   🔒 Bankers: ${stats.bankerWon}W / ${stats.bankerLost}L\n`;
  }
  if (stats.sniperWon > 0 || stats.sniperLost > 0) {
    report += `   🎯 Snipers: ${stats.sniperWon}W / ${stats.sniperLost}L\n`;
  }
  
  return report;
}

/**
 * Update all ACCA STATUS rows in leftover sheet based on leg results
 */
function _updateLeftoverAccaStatusRows(ss) {
  const FUNC_NAME = '_updateLeftoverAccaStatusRows';
  
  const sheet = ss.getSheetByName('Leftover_Accas');
  if (!sheet) {
    Logger.log(`[${FUNC_NAME}] Leftover_Accas sheet not found`);
    return;
  }
  
  const data = sheet.getDataRange().getValues();
  const numRows = data.length;
  
  // Find status column index
  let statusColIdx = 8; // Default for leftover sheet
  for (let r = 0; r < Math.min(10, numRows); r++) {
    const row = data[r];
    for (let c = 0; c < row.length; c++) {
      if (String(row[c]).toLowerCase() === 'status') {
        statusColIdx = c;
        break;
      }
    }
  }
  
  let updatedCount = 0;
  
  for (let r = 0; r < numRows; r++) {
    const cell0 = String(data[r][0] || '').trim();
    
    if (cell0 !== 'ACCA STATUS:') continue;
    
    // Scan backwards to collect leg statuses
    const legStatuses = [];
    
    for (let j = r - 1; j >= 0; j--) {
      const prevCell0 = String(data[j][0] || '').trim();
      const prevMatch = String(data[j][3] || '').trim(); // Match column
      
      // Stop at acca header or other headers
      if (prevCell0.includes('Fold') || prevCell0.includes('Double') || 
          prevCell0.includes('Single') || prevCell0.includes('Treble') ||
          prevCell0 === 'Date' || prevCell0.includes('LEFTOVER')) {
        break;
      }
      
      // If this looks like a leg row (has match with "vs")
      if (prevMatch && (prevMatch.toLowerCase().includes(' vs ') || prevMatch.includes(' @ '))) {
        const legStatus = String(sheet.getRange(j + 1, statusColIdx + 1).getValue() || 'PENDING').toUpperCase().trim();
        if (['WON', 'LOST', 'PENDING'].includes(legStatus)) {
          legStatuses.push(legStatus);
        }
      }
    }
    
    // Determine overall acca status
    let accaStatus = 'PENDING';
    let bgColor = '#fff2cc';
    let fontColor = '#bf9000';
    
    if (legStatuses.length === 0) {
      accaStatus = 'PENDING';
    } else if (legStatuses.includes('LOST')) {
      accaStatus = 'LOST';
      bgColor = '#f4c7c3';
      fontColor = '#c62828';
    } else if (legStatuses.every(s => s === 'WON')) {
      accaStatus = 'WON';
      bgColor = '#b7e1cd';
      fontColor = '#0f5132';
    }
    
    // Update the status cell (column B of ACCA STATUS row)
    const statusCell = sheet.getRange(r + 1, 2);
    statusCell.setValue(accaStatus)
      .setBackground(bgColor)
      .setFontWeight('bold')
      .setFontColor(fontColor);
    
    updatedCount++;
    Logger.log(`[${FUNC_NAME}] Row ${r + 1}: ${legStatuses.length} legs → ${accaStatus}`);
  }
  
  Logger.log(`[${FUNC_NAME}] ✅ Updated ${updatedCount} leftover ACCA STATUS rows`);
}

/**
 * Create or update Leftover_Results sheet with summary of leftover accas
 */
function _createLeftoverResultsSheet(ss) {
  const FUNC_NAME = '_createLeftoverResultsSheet';
  
  const leftoverSheet = ss.getSheetByName('Leftover_Accas');
  if (!leftoverSheet) {
    Logger.log(`[${FUNC_NAME}] No Leftover_Accas sheet found`);
    return;
  }
  
  let resultsSheet = ss.getSheetByName('Leftover_Results');
  if (resultsSheet) ss.deleteSheet(resultsSheet);
  resultsSheet = ss.insertSheet('Leftover_Results');
  
  // Parse leftover accas from sheet
  const data = leftoverSheet.getDataRange().getValues();
  const leftoverAccas = [];
  let currentAcca = null;
  
  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const cell0 = String(row[0] || '').trim();
    const cellLast = String(row[row.length - 1] || '').trim();
    
    // Detect acca header row
    if ((cell0.includes('Fold') || cell0.includes('Double') || cell0.includes('Single')) &&
        cellLast.startsWith('LEFTOVER_')) {
      
      // Save previous acca
      if (currentAcca) {
        leftoverAccas.push(currentAcca);
      }
      
      // Start new acca
      currentAcca = {
        id: cellLast,
        name: cell0,
        legs: 0,
        won: 0,
        lost: 0,
        pending: 0,
        status: 'PENDING'
      };
      continue;
    }
    
    // Count leg statuses
    if (currentAcca && cell0 !== 'Date' && cell0 !== 'ACCA STATUS:' && cell0 !== '') {
      const match = String(row[3] || '').trim();
      if (match && match.includes(' vs ')) {
        currentAcca.legs++;
        const legStatus = String(row[8] || '').toUpperCase().trim();
        if (legStatus === 'WON') currentAcca.won++;
        else if (legStatus === 'LOST') currentAcca.lost++;
        else currentAcca.pending++;
      }
    }
    
    // Check ACCA STATUS row
    if (currentAcca && cell0 === 'ACCA STATUS:') {
      const statusVal = String(row[1] || '').toUpperCase().trim();
      if (['WON', 'LOST', 'PENDING'].includes(statusVal)) {
        currentAcca.status = statusVal;
      }
    }
  }
  
  // Save last acca
  if (currentAcca) {
    leftoverAccas.push(currentAcca);
  }
  
  Logger.log(`[${FUNC_NAME}] Found ${leftoverAccas.length} leftover accumulators`);
  
  // Write results sheet
  const headers = ['Acca ID', 'Type', 'Legs', 'Status', 'Legs Won', 'Legs Lost', 'Legs Pending', 'Result', 'Created'];
  resultsSheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#ff6f00').setFontColor('#ffffff');
  
  const rows = leftoverAccas.map(acca => {
    let result = '⏳ Pending';
    if (acca.status === 'WON') result = '💰 WIN';
    if (acca.status === 'LOST') result = '❌ LOSS';
    
    return [
      acca.id,
      acca.name,
      acca.legs,
      acca.status,
      acca.won,
      acca.lost,
      acca.pending,
      result,
      new Date().toLocaleString()
    ];
  });
  
  if (rows.length > 0) {
    resultsSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    
    // Apply formatting
    for (let r = 0; r < rows.length; r++) {
      const rowNum = r + 2;
      const status = rows[r][3];
      const statusCell = resultsSheet.getRange(rowNum, 4);
      
      if (status === 'WON') {
        statusCell.setBackground('#b7e1cd').setFontColor('#0f5132').setFontWeight('bold');
      } else if (status === 'LOST') {
        statusCell.setBackground('#f4c7c3').setFontColor('#c62828').setFontWeight('bold');
      } else {
        statusCell.setBackground('#fff2cc').setFontColor('#bf9000').setFontWeight('bold');
      }
    }
  }
  
  resultsSheet.autoResizeColumns(1, headers.length);
  Logger.log(`[${FUNC_NAME}] ✅ Created Leftover_Results sheet with ${leftoverAccas.length} accumulators`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// _gradePickDetailed — Single authoritative definition
//
// Enhanced pick grader that delegates to _gradeSinglePick with error handling.
// Handles various bet types including SNIPER DIR.
//
// @param  {string} pickStr       The pick string to grade
// @param  {Object} result        The match result object
// @param  {string} originalHome  Original home team name
// @param  {string} originalAway  Original away team name
// @return {Object}               { grade: string, reason: string, ... }
// ═══════════════════════════════════════════════════════════════════════════════

function _gradePickDetailed(pickStr, result, originalHome, originalAway) {
  var FUNC_NAME = '_gradePickDetailed';

  try {
    return _gradeSinglePick(pickStr, result, originalHome, originalAway);
  } catch (e) {
    Logger.log('[' + FUNC_NAME + '] Error grading pick "' + pickStr + '": ' + e.message);
    return { grade: 'ERROR', reason: 'Grading error: ' + e.message };
  }
}


function _parseQuarterFromPick_(pickStr) {
  if (!pickStr) return '';
  const s = String(pickStr).trim();

  const qm = s.match(/\bQ([1-4])\b/i);
  if (qm) return 'Q' + qm[1];

  if (/\bH1\b|\bFIRST[\s_]?HALF\b/i.test(s))                    return 'H1';
  if (/\bH2\b|\bSECOND[\s_]?HALF\b/i.test(s))                   return 'H2';
  if (/\bOT\b|\bOVERTIME\b|\bEXTRA[\s_]?TIME\b/i.test(s))       return 'OT';
  if (/\bFT\b|\bFULL[\s_]?TIME\b/i.test(s))                      return 'FT';

  return '';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * _loadBetsFromSyncTemp — CONSOLIDATED PATCH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Fixes applied:
 *  1. time stored as Date object  → comparisons like bet.time > now work
 *  2. timeMs stored as epoch ms   → survives JSON.stringify / web serialization
 *  3. timeParseFailed flag        → downstream knows which rows had bad times
 *  4. dateStr via Utilities.formatDate in spreadsheet TZ (DST-safe)
 *  5. Numeric fraction-of-day time cells normalized before _parseTime
 *  6. RISKY_ stripped from type; typeRaw preserved for audit
 *  7. Zero-edge market exclusion (highest scoring quarter / HIGH QTR)
 *  8. Quarter: explicit column → _parseQuarterFromPick_ fallback
 *  9. ForebetAction: validated; junk/empty → 'NA' (never silently → 'WITH')
 * 10. Debug logs use local TZ, not misleading UTC/toISOString
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
function _loadBetsFromSyncTemp(ss) {
  const FUNC_NAME = '_loadBetsFromSyncTemp';
  const sheet = ss.getSheetByName('Sync_Temp');

  if (!sheet) {
    Logger.log(`[${FUNC_NAME}] ❌ Sync_Temp sheet not found`);
    return [];
  }

  var tz = (ss && typeof ss.getSpreadsheetTimeZone === 'function')
    ? ss.getSpreadsheetTimeZone()
    : Session.getScriptTimeZone();

  var data = sheet.getDataRange().getValues();
  var bets = [];
  if (!data || !data.length) return bets;

  var headerRow = 0;
  for (var r = 0; r < Math.min(5, data.length); r++) {
    var row = data[r] || [];
    if (String(row[0] || '').toLowerCase().includes('league') ||
        String(row[3] || '').toLowerCase().includes('match')) {
      headerRow = r;
      break;
    }
  }

  var headers = (data[headerRow] || []).map(function(h) {
    return String(h).toLowerCase().trim();
  });

  var norm = function(s) {
    return String(s || '').toLowerCase().replace(/[\s_]+/g, '');
  };

  var colIdx = {
    league:        headers.indexOf('league'),
    date:          headers.indexOf('date'),
    time:          headers.indexOf('time'),
    match:         headers.indexOf('match'),
    pick:          headers.indexOf('pick'),
    type:          headers.indexOf('type'),
    odds:          headers.indexOf('odds'),
    confidence:    headers.findIndex(function(h) { return h.includes('conf'); }),
    ev:            headers.indexOf('ev'),
    quarter:       headers.findIndex(function(h) { return h === 'quarter' || h === 'period'; }),

    forebetPrediction: headers.findIndex(function(h) {
      return norm(h) === 'forebetprediction';
    }),
    forebetAction: headers.findIndex(function(h) {
      return norm(h) === 'forebetaction';
    })
  };

  Logger.log(
    '[' + FUNC_NAME + '] Header indices: league=' + colIdx.league +
    ', match=' + colIdx.match +
    ', pick=' + colIdx.pick +
    ', type=' + colIdx.type +
    ', time=' + colIdx.time +
    ', quarter=' + colIdx.quarter +
    ', forebetPrediction=' + colIdx.forebetPrediction +
    ', forebetAction=' + colIdx.forebetAction
  );

  var getCell = function(row, idx) {
    return (idx >= 0 && idx < row.length ? row[idx] : undefined);
  };

  function _normalizeTimeCell(val, dateVal) {
    if (val instanceof Date) return val;

    if (typeof val === 'number' && val >= 0 && val < 1) {
      var totalMinutes = Math.round(val * 24 * 60);
      var hours   = Math.floor(totalMinutes / 60);
      var minutes = totalMinutes % 60;

      var base;
      if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
        base = new Date(dateVal);
      } else {
        base = new Date();
      }
      base.setHours(hours, minutes, 0, 0);
      return base;
    }

    return val;
  }

  function _coerceForebetPrediction_(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return (v === 1 || v === 2) ? v : '';
    var s = String(v).trim().toUpperCase();
    if (!s) return '';
    if (s === '1' || s === 'HOME' || s === 'H') return 1;
    if (s === '2' || s === 'AWAY' || s === 'A') return 2;
    return '';
  }

  for (var r = headerRow + 1; r < data.length; r++) {
    var row = data[r] || [];

    var match = String(getCell(row, colIdx.match) || '').trim();
    var pick  = String(getCell(row, colIdx.pick)  || '').trim();
    if (!match || match.indexOf(' vs ') < 0 || !pick) continue;

    var league  = String(getCell(row, colIdx.league) || '').trim();
    var dateRaw = getCell(row, colIdx.date);
    var timeRaw = getCell(row, colIdx.time);

    var typeRaw = (colIdx.type >= 0)
      ? String(getCell(row, colIdx.type) || '').trim()
      : '';
    var type = typeRaw || 'UNKNOWN';

    if (type.toUpperCase().startsWith('RISKY_')) {
      type = type.replace(/^RISKY_/i, '').trim() || 'UNKNOWN';
    }

    if (pick.toLowerCase().includes('highest scoring quarter') ||
        type.toUpperCase().includes('HIGH QTR')) {
      continue;
    }

    var odds = LEFTOVER_CONFIG.DEFAULT_ODDS;
    if (colIdx.odds >= 0) {
      var oddsVal = getCell(row, colIdx.odds);
      if (typeof oddsVal === 'number' && oddsVal > 1) {
        odds = oddsVal;
      } else if (typeof oddsVal === 'string') {
        var parsed = parseFloat(oddsVal);
        if (!isNaN(parsed) && parsed > 1) odds = parsed;
      }
    }

    var confidence = 0.7;
    if (colIdx.confidence >= 0) {
      var confVal = getCell(row, colIdx.confidence);
      if (typeof confVal === 'number') {
        confidence = confVal > 1 ? confVal / 100 : confVal;
      } else if (typeof confVal === 'string') {
        var cm = confVal.match(/([\d.]+)/);
        if (cm) {
          var num = parseFloat(cm[1]);
          confidence = num > 1 ? num / 100 : num;
        }
      }
    }

    var timeObj         = null;
    var dateStr         = '';
    var timeParseFailed = false;

    try {
      timeRaw = _normalizeTimeCell(timeRaw, dateRaw);
      timeObj = _parseTime(timeRaw, dateRaw);

      if (!(timeObj instanceof Date) || isNaN(timeObj.getTime())) {
        Logger.log(
          '[' + FUNC_NAME + '] Row ' + (r + 1) + ': _parseTime returned invalid result ' +
          'for "' + match + '" — fallback now+24h'
        );
        timeObj = new Date(Date.now() + 24 * 60 * 60 * 1000);
        timeParseFailed = true;
      }

      dateStr = Utilities.formatDate(timeObj, tz, 'dd/MM/yyyy');

    } catch (e) {
      Logger.log(
        '[' + FUNC_NAME + '] Row ' + (r + 1) + ': Time parse error for "' + match + '": ' +
        e.message + ' — fallback now+24h'
      );
      timeObj = new Date(Date.now() + 24 * 60 * 60 * 1000);
      timeParseFailed = true;
      dateStr = '--/--/----';
    }

    var quarter = '';
    if (colIdx.quarter >= 0) {
      quarter = String(getCell(row, colIdx.quarter) || '').trim();
    }
    if (!quarter && typeof _parseQuarterFromPick_ === 'function') {
      quarter = String(_parseQuarterFromPick_(pick) || '').trim();
    }

    // ✅ FOREBET PATCH: read deterministic values from Sync_Temp
    var forebetPrediction = '';
    if (colIdx.forebetPrediction >= 0) {
      forebetPrediction = _coerceForebetPrediction_(getCell(row, colIdx.forebetPrediction));
    }

    var forebetAction = 'NA';
    if (colIdx.forebetAction >= 0) {
      var faRaw = String(getCell(row, colIdx.forebetAction) || '').trim().toUpperCase();
      var VALID_FA = ['WITH', 'AGAINST', 'SKIP', 'NA'];
      if (faRaw && VALID_FA.indexOf(faRaw) >= 0) {
        forebetAction = faRaw;
      }
    }

    var betId = _generateBetId(league, match, pick);

    bets.push({
      betId:           betId,
      league:          league,

      date:            dateStr,
      time:            timeObj,
      timeMs:          timeObj.getTime(),
      timeParseFailed: timeParseFailed,

      match:           match,
      pick:            pick,

      type:            type,
      typeRaw:         typeRaw,
      quarter:         quarter,

      odds:            odds,
      confidence:      confidence,

      forebetPrediction:  forebetPrediction,
      ForebetPrediction:  forebetPrediction,
      forebetAction:      forebetAction,
      ForebetAction:      forebetAction,

      isBanker:      type.toUpperCase().indexOf('BANKER') >= 0,
      isSniper:      type.toUpperCase().indexOf('SNIPER') >= 0,
      isDirectional: type.toUpperCase().indexOf('DIR') >= 0
    });
  }

  Logger.log('[' + FUNC_NAME + '] ✅ Loaded ' + bets.length + ' valid bets');

  if (bets.length > 0) {
    var nowMs          = Date.now();
    var nowLocal       = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
    var futureCount    = bets.filter(function(b) { return b.timeMs > nowMs; }).length;
    var pastCount      = bets.length - futureCount;
    var parseFailCount = bets.filter(function(b) { return b.timeParseFailed; }).length;

    Logger.log('[' + FUNC_NAME + '] Current time (' + tz + '): ' + nowLocal);
    Logger.log(
      '[' + FUNC_NAME + '] Time breakdown: ' + futureCount + ' future, ' +
      pastCount + ' past, ' + parseFailCount + ' parse-failed'
    );

    var s = bets[0];
    Logger.log(
      '[' + FUNC_NAME + '] Sample bet: "' + s.match + '" | type="' + s.type + '" | ' +
      'time=' + Utilities.formatDate(s.time, tz, 'yyyy-MM-dd HH:mm:ss') + ' | ' +
      'future=' + (s.timeMs > nowMs) + ' | parseFailed=' + s.timeParseFailed + ' | ' +
      'forebetPrediction=' + s.forebetPrediction + ' forebetAction=' + s.forebetAction
    );
  }

  return bets;
}

/**
 * DEBUG: Check why leftover accas aren't building
 */
function debugLeftoverSystem() {
  const FUNC_NAME = 'debugLeftoverSystem';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  Logger.log('\n' + '═'.repeat(80));
  Logger.log('DEBUG: LEFTOVER SYSTEM');
  Logger.log('═'.repeat(80));
  
  // 1. Load all bets
  const allBets = _loadBetsFromSyncTemp(ss);
  Logger.log(`\n1️⃣ Loaded ${allBets.length} bets from Sync_Temp`);
  
  if (allBets.length === 0) {
    Logger.log('❌ PROBLEM: No bets loaded from Sync_Temp');
    return;
  }
  
  // 2. Check time validity
  const now = new Date();
  const futureBets = allBets.filter(b => b.time instanceof Date && b.time > now);
  const pastBets = allBets.filter(b => b.time instanceof Date && b.time <= now);
  const invalidBets = allBets.filter(b => !(b.time instanceof Date) || isNaN(b.time.getTime()));
  
  Logger.log(`\n2️⃣ Time Analysis:`);
  Logger.log(`   Current time: ${now.toISOString()}`);
  Logger.log(`   ✅ Future bets (available): ${futureBets.length}`);
  Logger.log(`   ⏰ Past bets (expired): ${pastBets.length}`);
  Logger.log(`   ⚠️ Invalid time objects: ${invalidBets.length}`);
  
  if (futureBets.length === 0) {
    Logger.log('❌ PROBLEM: No future bets available for leftover processing');
    Logger.log('   All bets are marked as expired!');
    
    // Show sample expired bet
    if (pastBets.length > 0) {
      const sample = pastBets[0];
      Logger.log(`\n   Sample expired bet:`);
      Logger.log(`     Match: ${sample.match}`);
      Logger.log(`     Time: ${sample.time}`);
      Logger.log(`     Time is Date: ${sample.time instanceof Date}`);
      Logger.log(`     Time value: ${sample.time.getTime()}`);
    }
    return;
  }
  
  // 3. Get used bet IDs
  const usedIds = _extractUsedBetIdsFromAccaPortfolio(ss);
  Logger.log(`\n3️⃣ Found ${usedIds.size} bets used in main accas`);
  
  // 4. Categorize
  const available = futureBets.filter(b => !usedIds.has(b.betId));
  Logger.log(`\n4️⃣ Available for leftover: ${available.length}`);
  
  if (available.length < LEFTOVER_CONFIG.MIN_POOL_SIZE) {
    Logger.log(`❌ PROBLEM: Only ${available.length} bets available (min ${LEFTOVER_CONFIG.MIN_POOL_SIZE} required)`);
    return;
  }
  
  // 5. Try building
  Logger.log(`\n5️⃣ Attempting to build leftover accas...`);
  const result = _buildLeftoverAccas(available);
  
  Logger.log(`   Built: ${result.portfolios.length} accas`);
  Logger.log(`   Used: ${result.usedIds.size} bets`);
  
  if (result.portfolios.length === 0) {
    Logger.log('❌ PROBLEM: No leftover accas could be built');
    Logger.log('   Check league diversity and time windows');
  } else {
    Logger.log('✅ SUCCESS: Leftover accas were built');
    Logger.log('   Now trying to write to sheet...');
    
    try {
      _writeLeftoverSheet(ss, result.portfolios);
      Logger.log('✅ Sheet write successful!');
    } catch (e) {
      Logger.log(`❌ PROBLEM writing sheet: ${e.message}`);
      Logger.log(e.stack);
    }
  }
  
  Logger.log('\n' + '═'.repeat(80));
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACT USED BET IDs FROM Acca_Portfolio - FIXED to include pick
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * _extractUsedBetIdsFromAccaPortfolio — Phase 3 Patched
 *
 * Reads Acca_Portfolio sheet. Returns Set of used bet IDs.
 * Also attaches ._keys (Set of LEAGUE|MATCH|PICK|TYPE signatures) for fallback matching.
 *
 * When BetID column is present: uses it directly.
 * When missing: reconstructs same MD5 hash as Phase 2 enrichment from row fields.
 */
function _extractUsedBetIdsFromAccaPortfolio(ss) {
  var FUNC = '_extractUsedBetIdsFromAccaPortfolio';
  var sheet = ss.getSheetByName('Acca_Portfolio');

  // ── Return container ──
  var usedIds      = new Set();   // raw BetID strings
  var canonKeys    = new Set();   // LEAGUE|MATCH|canonPick|canonType
  var canonPicks   = new Set();   // LEAGUE|MATCH|canonPick
  var stableIds    = new Set();   // BET_<md5-20>

  usedIds._keys      = canonKeys;
  usedIds._pickKeys  = canonPicks;
  usedIds._stableIds = stableIds;

  if (!sheet) { Logger.log('[' + FUNC + '] Acca_Portfolio not found'); return usedIds; }
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) { Logger.log('[' + FUNC + '] empty'); return usedIds; }

  // ── Shared canon helpers ──
  var _up   = function(s) { return String(s || '').trim().toUpperCase(); };
  var _cpk  = function(p) {
    var s = _up(p);
    s = s.replace(/\(\s*\d{1,3}\s*%\s*\)/g, ' ');
    s = s.replace(/\b\d{1,3}\s*%\b/g, ' ');
    s = s.replace(/[●○★☆✅⚠️⬡♦◆■□•·]/g, ' ');
    s = s.replace(/[():+]/g, ' ');
    s = s.replace(/[^A-Z0-9.\-\s]/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  };
  var _ctp  = function(t) {
    var s = _up(t);
    s = s.replace(/[●○★☆✅⚠️⬡♦◆■□•·]/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  };
  var _joinDT = function(dc, tc) {
    var d = (dc instanceof Date && !isNaN(dc)) ? new Date(dc) : null;
    if (!d) { var dd = new Date(dc); if (!isNaN(dd)) d = dd; }
    if (!d) return null;
    if (tc instanceof Date && !isNaN(tc)) {
      d.setHours(tc.getHours(), tc.getMinutes(), tc.getSeconds(), 0);
      return d;
    }
    var m = String(tc || '').match(/^(\d{1,2}):(\d{2})/);
    if (m) d.setHours(+m[1], +m[2], 0, 0);
    return d;
  };
  var _md5 = function(base) {
    try {
      var b = Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5, base, Utilities.Charset.UTF_8);
      return 'BET_' + b.map(function(x) {
        return ('0' + ((x < 0 ? x + 256 : x).toString(16))).slice(-2);
      }).join('').slice(0, 20);
    } catch (_) {
      return 'BET_' + base.replace(/[^A-Z0-9|]/gi, '_').slice(0, 60);
    }
  };

  // ── Find BetID column ──
  var bidCol = -1;
  for (var r0 = 0; r0 < Math.min(60, data.length) && bidCol < 0; r0++)
    for (var c0 = 0; c0 < data[r0].length; c0++)
      if (_up(data[r0][c0]) === 'BETID') { bidCol = c0; break; }

  Logger.log('[' + FUNC + '] BetID col: ' +
    (bidCol < 0 ? 'NOT FOUND' : 'col ' + (bidCol + 1)));

  // ── Scan rows  (cols: 0=Date 1=Time 2=League 3=Match 4=Pick 5=Type) ──
  var rows = 0, fromCol = 0;
  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    if (!row || row.length < 6) continue;

    var league = String(row[2] || '').trim();
    var match  = String(row[3] || '').trim();
    var pick   = String(row[4] || '').trim();
    var type   = String(row[5] || '').trim();

    if (match.indexOf(' vs ') === -1 || !pick || pick === 'Pick') continue;
    rows++;

    var cp = _cpk(pick), ct = _ctp(type);
    canonKeys.add([_up(league), _up(match), cp, ct].join('|'));
    canonPicks.add([_up(league), _up(match), cp].join('|'));

    var dt = _joinDT(row[0], row[1]);
    stableIds.add(_md5(
      [_up(league), _up(match), cp, ct,
       dt ? dt.toISOString() : ''].join('|')));

    if (bidCol >= 0) {
      var bid = String(row[bidCol] || '').trim();
      if (bid) { usedIds.add(bid); fromCol++; }
    }
  }

  Logger.log('[' + FUNC + '] Result: ids=' + usedIds.size +
    ' (fromCol=' + fromCol + '), keys=' + canonKeys.size +
    ', pickKeys=' + canonPicks.size + ', stableIds=' + stableIds.size +
    ' (rows=' + rows + ')');

  return usedIds;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * processLeftoverBets — Corrected Three-Tier (SILVER + RISKY)
 *
 * ◄◄ FIX: Risky is reason-whitelisted, not "anything that failed Silver."
 *          Only purity-related soft failures with reliable, well-sampled edges.
 *          PURITY_HARD_BLOCK / CHARCOAL / ROCK never enter Risky.
 * ◄◄ FIX: Edge reliability and minimum sample size enforced for Risky.
 * ◄◄ FIX: Granular audit reasons split into EDGE_INSUFFICIENT vs
 *          PURITY_FAILED_RESCUED (in Risky) vs PURITY_HARD_BLOCK_CORRECT_DROP.
 */
function processLeftoverBets(ss, allBets, usedBetIds, leagueMetrics, assayerData) {
  var FUNC = 'processLeftoverBets';
  var now = new Date();

  if (!ss) ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!allBets) allBets = [];
  if (!usedBetIds) usedBetIds = new Set();

  var usedKeys     = usedBetIds._keys      || new Set();
  var usedPickKeys = usedBetIds._pickKeys   || new Set();
  var usedStable   = usedBetIds._stableIds  || new Set();

  var LCFG = (typeof LEFTOVER_CONFIG !== 'undefined' && LEFTOVER_CONFIG)
    ? LEFTOVER_CONFIG : {};
  var MIN_POOL       = Math.max(2, Number(LCFG.MIN_POOL_SIZE || 2) || 2);
  var RISKY_ENABLED  = (LCFG.RISKY_ENABLED !== false);
  var RISKY_MIN_POOL = Math.max(2, Number(LCFG.RISKY_MIN_POOL_SIZE || 2) || 2);

  var GRADE_RANK = (typeof ASSAYER_GRADE_RANK !== 'undefined') ? ASSAYER_GRADE_RANK
    : { PLATINUM: 6, GOLD: 5, SILVER: 4, BRONZE: 3, ROCK: 2, CHARCOAL: 1, NONE: 0 };
  var _rank = function(g) { return GRADE_RANK[String(g || '').trim().toUpperCase()] || 0; };

  Logger.log('\n════════════════════════════════════════════════════════');
  Logger.log('   🧹 PHASE 3 — SILVER + RISKY TIERS');
  Logger.log('════════════════════════════════════════════════════════');
  Logger.log('[' + FUNC + '] Input: total=' + allBets.length +
    ', usedIds=' + usedBetIds.size +
    ', RISKY_ENABLED=' + RISKY_ENABLED);

  // ── Shared canon helpers ──
  var _up = function(s) { return String(s || '').trim().toUpperCase(); };
  var _cpk = function(p) {
    var s = _up(p);
    s = s.replace(/\(\s*\d{1,3}\s*%\s*\)/g, ' ');
    s = s.replace(/\b\d{1,3}\s*%\b/g, ' ');
    s = s.replace(/[●○★☆✅⚠️⬡♦◆■□•·]/g, ' ');
    s = s.replace(/[():+]/g, ' ');
    s = s.replace(/[^A-Z0-9.\-\s]/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  };
  var _ctp = function(t) {
    var s = _up(t);
    s = s.replace(/[●○★☆✅⚠️⬡♦◆■□•·]/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
  };
  var _pt = function(x) {
    if (x instanceof Date && !isNaN(x)) return x;
    var d = new Date(x); return (!isNaN(d)) ? d : null;
  };
  var _md5 = function(base) {
    try {
      var b = Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5, base, Utilities.Charset.UTF_8);
      return 'BET_' + b.map(function(x) {
        return ('0' + ((x < 0 ? x + 256 : x).toString(16))).slice(-2);
      }).join('').slice(0, 20);
    } catch (_) {
      return 'BET_' + base.replace(/[^A-Z0-9|]/gi, '_').slice(0, 60);
    }
  };
  var _sid = function(b) {
    var t = _pt(b && b.time);
    return _md5([_up(b&&b.league), _up(b&&b.match),
      _cpk(b&&b.pick), _ctp(b&&b.type),
      t ? t.toISOString() : ''].join('|'));
  };
  var _fk = function(b) {
    return [_up(b&&b.league), _up(b&&b.match),
      _cpk(b&&b.pick), _ctp(b&&b.type)].join('|');
  };
  var _pk = function(b) {
    return [_up(b&&b.league), _up(b&&b.match),
      _cpk(b&&b.pick)].join('|');
  };
  var _rid = function(b) {
    var id = b && (b.betId || b.id || b.bet_id);
    return (id && String(id).trim()) ? String(id).trim() : '';
  };

  for (var i0 = 0; i0 < allBets.length; i0++) {
    if (allBets[i0] && !_rid(allBets[i0]))
      allBets[i0].betId = _sid(allBets[i0]);
  }

  var mainHitLog = 0;
  var _isMain = function(b) {
    var id = _rid(b), sid = _sid(b), fk = _fk(b), pk = _pk(b);
    var matcher = null;
    if (id && usedBetIds.has(id))  matcher = 'rawId';
    else if (usedStable.has(sid))  matcher = 'stableId';
    else if (usedKeys.has(fk))     matcher = 'fullKey';
    else if (usedPickKeys.has(pk)) matcher = 'pickKey';

    if (matcher && mainHitLog < 8) {
      mainHitLog++;
      Logger.log('[' + FUNC + '] main-match via ' + matcher +
        ': ' + String(b.match||'').substring(0,40) + ' / ' +
        String(b.pick||'').substring(0,30));
    }
    return !!matcher;
  };

  var _isExpired = function(b) {
    var t = _pt(b && b.time);
    return (t && t < now);
  };

  // ══════════════════════════════════════════════════
  // 1. Categorise full pool
  // ══════════════════════════════════════════════════
  var cats = { main: [], expired: [], candidate: [] };
  for (var i = 0; i < allBets.length; i++) {
    var bet = allBets[i];
    if (!bet) continue;
    if (_isMain(bet))         cats.main.push(bet);
    else if (_isExpired(bet)) cats.expired.push(bet);
    else                      cats.candidate.push(bet);
  }
  Logger.log('[' + FUNC + '] Categorised: main=' + cats.main.length +
    ', expired=' + cats.expired.length +
    ', candidate=' + cats.candidate.length);

  // ══════════════════════════════════════════════════
  // 2. STANDARD gate on candidates
  // ══════════════════════════════════════════════════
  var stdQ = _filterBets(cats.candidate, {
    applyAssayerBlocks: false, applyGoldGate: false
  });
  Logger.log('[' + FUNC + '] ✅ Standard qualified: ' +
    stdQ.length + '/' + cats.candidate.length);

  var stdIdSet = new Set();
  for (var s0 = 0; s0 < stdQ.length; s0++)
    stdIdSet.add(_rid(stdQ[s0]) || _sid(stdQ[s0]));

  // ══════════════════════════════════════════════════
  // 3. Enrich standard-qualified
  // ══════════════════════════════════════════════════
  accaEngineSyncAssayerBridgeConfig_({
    GOLD_ONLY_MODE:        false,          // ◄◄ FIX: don't set true when floor is SILVER
    MIN_EDGE_GRADE:        'SILVER',
    MIN_PURITY_GRADE:      'SILVER',
    UNKNOWN_LEAGUE_ACTION: (typeof ACCA_ENGINE_CONFIG !== 'undefined' &&
                            ACCA_ENGINE_CONFIG.UNKNOWN_LEAGUE_ACTION)
                            ? ACCA_ENGINE_CONFIG.UNKNOWN_LEAGUE_ACTION : 'BLOCK',
    REQUIRE_RELIABLE_EDGE: false
  }, FUNC);

  var enriched = stdQ;
  if (stdQ.length > 0 && stdQ[0].accuracyScore === undefined) {
    if (!leagueMetrics || !assayerData || !assayerData.ok)
      throw new Error('Missing leagueMetrics/assayerData for enrichment');
    enriched = _enrichBetsWithAccuracy(stdQ, leagueMetrics, assayerData);
  }
  Logger.log('[' + FUNC + '] ✅ Enriched: ' + enriched.length);

  var assayerBlockedInStd = 0;
  for (var e0 = 0; e0 < enriched.length; e0++)
    if (enriched[e0] && enriched[e0].assayer &&
        enriched[e0].assayer.blocked === true) assayerBlockedInStd++;

  // ══════════════════════════════════════════════════
  // 4. SILVER gate + Assayer blocks
  // ══════════════════════════════════════════════════
  var silQ = _filterBets(enriched, {
    applyAssayerBlocks: true,
    skipStandard: true,
    applyGoldGate: false,
    minEdgeGrade: 'SILVER',
    minPurityGrade: 'SILVER'
  });
  Logger.log('[' + FUNC + '] ✅ Silver qualified: ' +
    silQ.length + '/' + enriched.length);

  var silIdSet = new Set();
  for (var si0 = 0; si0 < silQ.length; si0++)
    silIdSet.add(_rid(silQ[si0]) || _sid(silQ[si0]));

  var silPool = [];
  for (var si = 0; si < silQ.length; si++)
    if (!_isMain(silQ[si])) silPool.push(silQ[si]);

  var silPoolIdSet = new Set();
  for (var sp = 0; sp < silPool.length; sp++)
    silPoolIdSet.add(_rid(silPool[sp]) || _sid(silPool[sp]));

  Logger.log('[' + FUNC + '] Silver pool after exclude-main: ' + silPool.length);

  // ══════════════════════════════════════════════════
  // 5. Build leftover accas (Silver tier)
  // ══════════════════════════════════════════════════
  var portfolios = [];
  var leftoverUsedIds = new Set();

  if (silPool.length >= MIN_POOL) {
    var buildRes = _buildLeftoverAccas(silPool);
    portfolios      = (buildRes && buildRes.portfolios) || [];
    leftoverUsedIds = (buildRes && buildRes.usedIds) || new Set();
  }

  var leftoverStableSet = new Set();
  var accaByStable = {};
  for (var pi = 0; pi < portfolios.length; pi++) {
    var acca = portfolios[pi];
    var legs = (acca && acca.legs) || [];
    for (var li = 0; li < legs.length; li++) {
      var lst = _sid(legs[li]);
      leftoverStableSet.add(lst);
      accaByStable[lst] = {
        name: acca.name || acca.type || 'Leftover',
        odds: acca.totalOdds || null
      };
    }
  }

  Logger.log('[' + FUNC + '] ✅ Silver accas=' + portfolios.length +
    ', usedBets=' + leftoverStableSet.size);

  // ══════════════════════════════════════════════════════════════════════
  // 6. ◄◄ FIX: RISKY TIER — reason-whitelisted, quality-gated
  //
  // NOT "anything that failed Silver."
  // Only bets that:
  //   (a) have edge ≥ SILVER AND edge.reliable AND edge.n ≥ 30
  //   (b) failed ONLY because of purity (missing/building/soft-fail)
  //   (c) do NOT have forbidden purity grades (CHARCOAL/ROCK)
  //   (d) were NOT PURITY_HARD_BLOCKed
  // ══════════════════════════════════════════════════════════════════════
  var riskyPortfolios = [];
  var riskyStableSet = new Set();
  var riskyAccaByStable = {};
  var riskyPoolSize = 0;
  var riskyRejectedCounts = {             // ◄◄ FIX: diagnostic counters
    alreadySilver: 0,
    notStandard: 0,
    edgeTooWeak: 0,
    edgeUnreliable: 0,
    edgeTooSmall: 0,
    purityHardBlock: 0,
    purityForbiddenGrade: 0,
    notPurityFailure: 0,
    qualified: 0
  };

  if (RISKY_ENABLED) {
    Logger.log('[' + FUNC + '] ── RISKY TIER (reason-whitelisted) ──');
    Logger.log('[' + FUNC + '] Gates: edgeFloor=' + (LCFG.RISKY_MIN_EDGE_GRADE || 'SILVER') +
      ' reqReliable=' + (LCFG.RISKY_REQUIRE_RELIABLE !== false) +
      ' minN=' + (LCFG.RISKY_MIN_EDGE_N || 30) +
      ' allowedReasons=[' + Array.from(RISKY_ALLOWED_BLOCK_REASONS).join(',') + ']' +
      ' forbiddenGrades=[' + Array.from(RISKY_FORBIDDEN_PURITY_GRADES).join(',') + ']');

    // 6a. Identify candidates using the gated helper
    var riskyQ = [];
    for (var ri = 0; ri < enriched.length; ri++) {
      var rb = enriched[ri];
      if (!rb) continue;
      var rbid = _rid(rb) || _sid(rb);

      if (silIdSet.has(rbid)) { riskyRejectedCounts.alreadySilver++; continue; }
      if (!stdIdSet.has(rbid)) { riskyRejectedCounts.notStandard++; continue; }

      // ◄◄ FIX: use the gated helper instead of raw grade check
      if (_isRiskyCandidate(rb, LCFG, GRADE_RANK)) {
        riskyQ.push(rb);
        riskyRejectedCounts.qualified++;
      } else {
        // Log why it was rejected for diagnostics
        var eg = _riskyEdgeGrade(rb);
        var pg = _riskyPurityGrade(rb);
        var br = _riskyBlockReason(rb);

        if (_rank(eg) < _rank(LCFG.RISKY_MIN_EDGE_GRADE || 'SILVER'))
          riskyRejectedCounts.edgeTooWeak++;
        else if (LCFG.RISKY_REQUIRE_RELIABLE !== false && !_riskyEdgeReliable(rb))
          riskyRejectedCounts.edgeUnreliable++;
        else if (_riskyEdgeN(rb) !== null && _riskyEdgeN(rb) < (LCFG.RISKY_MIN_EDGE_N || 30))
          riskyRejectedCounts.edgeTooSmall++;
        else if (br === 'PURITY_HARD_BLOCK')
          riskyRejectedCounts.purityHardBlock++;
        else if (RISKY_FORBIDDEN_PURITY_GRADES.has(pg))
          riskyRejectedCounts.purityForbiddenGrade++;
        else
          riskyRejectedCounts.notPurityFailure++;
      }
    }

    Logger.log('[' + FUNC + '] Risky candidate analysis: ' +
      JSON.stringify(riskyRejectedCounts));

    // 6b. Exclude main-used and leftover-used
    var riskyPool = [];
    for (var rp = 0; rp < riskyQ.length; rp++) {
      if (!_isMain(riskyQ[rp]) && !leftoverStableSet.has(_sid(riskyQ[rp]))) {
        riskyPool.push(riskyQ[rp]);
      }
    }
    riskyPoolSize = riskyPool.length;
    Logger.log('[' + FUNC + '] Risky pool after exclusions: ' + riskyPoolSize);

    // 6c. Log sample of rescued bets
    var riskyLog = Math.min(riskyPool.length, 10);
    for (var rl = 0; rl < riskyLog; rl++) {
      var rlb = riskyPool[rl];
      Logger.log('[' + FUNC + ']   ⚠️ RISKY: ' +
        (rlb.league||'') + ' | ' + String(rlb.pick||'').substring(0,40) +
        ' | edge=' + _riskyEdgeGrade(rlb) +
        ' | edgeN=' + (_riskyEdgeN(rlb) || '?') +
        ' | reliable=' + _riskyEdgeReliable(rlb) +
        ' | purity=' + (_riskyPurityGrade(rlb) || 'NONE') +
        ' | reason=' + (_riskyBlockReason(rlb) || 'GRADE_GATE'));
    }

    // 6d. Build risky accas (smaller sizes)
    if (riskyPool.length >= RISKY_MIN_POOL) {
      var origSizes = LCFG.ACCA_SIZES;
      var origMaxPerLeague = LCFG.MAX_PER_LEAGUE;

      LCFG.ACCA_SIZES = LCFG.RISKY_ACCA_SIZES || [3, 2];
      LCFG.MAX_PER_LEAGUE = LCFG.RISKY_MAX_PER_LEAGUE || 2;  // ◄◄ FIX: tighter

      var riskyRes = _buildLeftoverAccas(riskyPool);

      LCFG.ACCA_SIZES = origSizes;
      LCFG.MAX_PER_LEAGUE = origMaxPerLeague;

      riskyPortfolios = (riskyRes && riskyRes.portfolios) || [];

      // Relabel as RISKY
      for (var rpi = 0; rpi < riskyPortfolios.length; rpi++) {
        riskyPortfolios[rpi].type = 'RISKY';
        riskyPortfolios[rpi].id =
          (riskyPortfolios[rpi].id || '').replace(/^LEFTOVER_/, 'RISKY_');
        if (riskyPortfolios[rpi].name) {
          riskyPortfolios[rpi].name =
            riskyPortfolios[rpi].name.replace(/Leftover/gi, 'Risky');
        }
      }

      for (var rsi = 0; rsi < riskyPortfolios.length; rsi++) {
        var rLegs = (riskyPortfolios[rsi] && riskyPortfolios[rsi].legs) || [];
        for (var rli = 0; rli < rLegs.length; rli++) {
          var rSt = _sid(rLegs[rli]);
          riskyStableSet.add(rSt);
          riskyAccaByStable[rSt] = {
            name: riskyPortfolios[rsi].name || 'Risky',
            odds: riskyPortfolios[rsi].totalOdds || null
          };
        }
      }
    } else {
      Logger.log('[' + FUNC + '] Risky pool too small: ' +
        riskyPool.length + ' < ' + RISKY_MIN_POOL);
    }

    Logger.log('[' + FUNC + '] ✅ Risky accas=' + riskyPortfolios.length +
      ', usedBets=' + riskyStableSet.size);
  }

  // ══════════════════════════════════════════════════
  // 7. Full-pool audit (◄◄ FIX: granular drop reasons)
  // ══════════════════════════════════════════════════
  var ST = (typeof BET_STATUS !== 'undefined' && BET_STATUS)
    ? BET_STATUS
    : { MAIN:'MAIN_ACCA', LEFTOVER:'LEFTOVER_ACCA',
        RISKY:'RISKY_ACCA', EXPIRED:'EXPIRED', DROPPED:'DROPPED' };

  var enrichedMap = {};
  for (var em = 0; em < enriched.length; em++) {
    var emb = enriched[em];
    var emid = _rid(emb) || _sid(emb);
    enrichedMap[emid] = emb;
  }

  var audit = [];
  for (var a = 0; a < allBets.length; a++) {
    var b = allBets[a];
    if (!b) continue;

    var bid  = _rid(b) || _sid(b);
    var bSid = _sid(b);
    var tA   = _pt(b.time);
    var status = ST.DROPPED, note = '', accaInfo = null;

    if (_isMain(b)) {
      status = ST.MAIN;
      note = 'Used in Acca_Portfolio (main)';

    } else if (tA && tA < now) {
      status = ST.EXPIRED;
      note = 'Kickoff passed';

    } else if (leftoverStableSet.has(bSid)) {
      status = ST.LEFTOVER;
      accaInfo = accaByStable[bSid] || null;
      note = 'Allocated to Leftover_Accas (SILVER)';

    } else if (riskyStableSet.has(bSid)) {
      status = ST.RISKY;
      accaInfo = riskyAccaByStable[bSid] || null;
      note = 'Allocated to Risky_Accas (edge-qualified, purity soft-fail)';

    } else {
      // ◄◄ FIX: precise drop reasons
      if (!stdIdSet.has(bid)) {
        note = 'STANDARD_GATE_FAIL';

      } else if (silIdSet.has(bid)) {
        note = silPoolIdSet.has(bid)
          ? 'SILVER_QUALIFIED_UNUSED_BY_BUILDER'
          : 'SILVER_QUALIFIED_EXCLUDED_AS_MAIN';

      } else {
        // Failed Silver — determine WHY with enriched data
        var enr = enrichedMap[bid] || b;
        var dropEdge = _riskyEdgeGrade(enr);
        var dropPurity = _riskyPurityGrade(enr);
        var dropReason = _riskyBlockReason(enr);

        if (_rank(dropEdge) < _rank('SILVER')) {
          // Edge itself is too weak
          note = 'EDGE_INSUFFICIENT' + (dropEdge ? ' (' + dropEdge + ')' : ' (NO_EDGE)');

        } else if (RISKY_FORBIDDEN_PURITY_GRADES.has(dropPurity)) {
          // Purity is an active avoid signal — correct to drop
          note = 'PURITY_HARD_AVOID (' + dropPurity + ') — CORRECT_DROP';

        } else if (dropReason === 'PURITY_HARD_BLOCK') {
          note = 'PURITY_HARD_BLOCK — CORRECT_DROP';

        } else if (_riskyEdgeReliable(enr) === false) {
          // Edge not reliable — too risky even for Risky
          note = 'EDGE_NOT_RELIABLE — RISKY_REJECTED';

        } else {
          var enrN = _riskyEdgeN(enr);
          if (enrN !== null && enrN < (LCFG.RISKY_MIN_EDGE_N || 30)) {
            note = 'EDGE_SMALL_SAMPLE (n=' + enrN + ') — RISKY_REJECTED';
          } else if (RISKY_ENABLED) {
            note = 'PURITY_SOFT_FAIL_RISKY_POOL_UNUSED';
          } else {
            note = 'PURITY_SOFT_FAIL_RISKY_DISABLED';
          }
        }
      }
    }

    audit.push({
      status: status,
      league: b.league || '',
      date:   b.date   || '',
      time:   tA || b.time || '',
      match:  b.match  || '',
      pick:   b.pick   || '',
      type:   b.type   || '',
      odds:   Number(b.odds || 0),
      betId:  bid,
      note:   note,
      acca:   accaInfo
    });
  }

  // ══════════════════════════════════════════════════
  // 8. Write sheets
  // ══════════════════════════════════════════════════
  if (portfolios.length > 0) _writeLeftoverSheet(ss, portfolios);
  else Logger.log('[' + FUNC + '] No leftover accas to write');

  if (riskyPortfolios.length > 0) _writeRiskySheet(ss, riskyPortfolios);
  else Logger.log('[' + FUNC + '] No risky accas to write');

  _writeAuditSheet(ss, audit);

  // ══════════════════════════════════════════════════
  // 9. Summary
  // ══════════════════════════════════════════════════
  var summary = {
    total:                   allBets.length,
    inMain:                  cats.main.length,
    expired:                 cats.expired.length,
    candidate:               cats.candidate.length,
    standardQualified:       enriched.length,
    assayerBlockedInStdPool: assayerBlockedInStd,
    silverQualified:         silQ.length,
    silverAfterExclude:      silPool.length,
    inLeftover:              leftoverStableSet.size,
    droppedFromSilver:       Math.max(0, silPool.length - leftoverStableSet.size),
    leftoverAccas:           portfolios.length,
    riskyPool:               riskyPoolSize,
    riskyRejectedBreakdown:  riskyRejectedCounts,
    inRisky:                 riskyStableSet.size,
    riskyAccas:              riskyPortfolios.length
  };

  Logger.log('[' + FUNC + '] SUMMARY: ' + JSON.stringify(summary));
  return {
    leftoverPortfolios: portfolios,
    riskyPortfolios:    riskyPortfolios,
    summary:            summary
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD LEFTOVER ACCAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * _buildLeftoverAccas — Phase 3 Patched
 *
 * Dedicated leftover builder. Does NOT reuse _allocatePortfolios
 * (which builds singles — wrong for leftovers).
 *
 * Uses _buildFromPool if available, else _buildOneAccaWithConstraints,
 * else naive unique-match fallback.
 */
function _buildLeftoverAccas(availableBets) {
  var FUNC = '_buildLeftoverAccas';

  var LCFG = (typeof LEFTOVER_CONFIG !== 'undefined' && LEFTOVER_CONFIG)
    ? LEFTOVER_CONFIG : {};
  var sizes = (LCFG.ACCA_SIZES && LCFG.ACCA_SIZES.length)
    ? LCFG.ACCA_SIZES.slice() : [6, 3, 2];
  var minPool = Math.max(2, Number(LCFG.MIN_POOL_SIZE || 2) || 2);
  var maxWinMs = (Number(LCFG.TIME_WINDOW_HOURS || 24) || 24) * 3600000;
  var FORCE_DOUBLES = (LCFG.FORCE_DOUBLES !== false);   // default true
  var ALLOW_SINGLES = (LCFG.ALLOW_SINGLES === true);    // default false

  var portfolios = [];
  var usedIds = new Set();

  if (!availableBets || availableBets.length < minPool) {
    Logger.log('[' + FUNC + '] Pool too small: ' +
      (availableBets ? availableBets.length : 0));
    return { portfolios: portfolios, usedIds: usedIds };
  }

  // ── Helpers ──
  var _pt = function(x) {
    if (x instanceof Date && !isNaN(x)) return x;
    var d = new Date(x); return (!isNaN(d)) ? d : null;
  };

  var getBetId = function(b) {
    var id = b && (b.betId || b.id || b.bet_id);
    if (id && String(id).trim()) return String(id).trim();

    // Deterministic fallback (same logic as processLeftoverBets._sid)
    var _up = function(s) { return String(s||'').trim().toUpperCase(); };
    var base = [_up(b&&b.league), _up(b&&b.match),
      _up(b&&b.pick), _up(b&&b.type),
      (b&&b.time instanceof Date) ? b.time.toISOString()
        : String(b&&b.time||'')].join('|');
    try {
      var bytes = Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5, base, Utilities.Charset.UTF_8);
      return 'BET_' + bytes.map(function(x) {
        return ('0'+((x<0?x+256:x).toString(16))).slice(-2);
      }).join('').slice(0,20);
    } catch(_) {
      return 'BET_' + base.replace(/[^A-Z0-9|]/gi,'_').slice(0,60);
    }
  };

  // Fill missing betIds
  var filled = 0;
  for (var i = 0; i < availableBets.length; i++) {
    if (availableBets[i] && !availableBets[i].betId) {
      availableBets[i].betId = getBetId(availableBets[i]);
      filled++;
    }
  }
  if (filled) Logger.log('[' + FUNC + '] Filled betId for ' + filled);

  // Sort best-first
  availableBets.sort(function(a,b) {
    return Number(b.accuracyScore||0) - Number(a.accuracyScore||0);
  });

  var isUnused  = function(b) { return b && !usedIds.has(getBetId(b)); };
  var remaining = function(p) { return p.filter(isUnused); };

  var pushAcca = function(acca) {
    if (!acca || !acca.legs || !acca.legs.length) return;
    for (var k = 0; k < acca.legs.length; k++)
      usedIds.add(getBetId(acca.legs[k]));
    portfolios.push(acca);
  };

  var matchKey = function(b) {
    return (typeof _matchKey === 'function')
      ? _matchKey(b)
      : (String(b.match||'') + '|' + String(b.league||''));
  };

  // ── Type pools ──
  var isBanker = function(b) {
    if (b && b.isBanker) return true;
    var t = String((b&&b.type)||'').toUpperCase();
    return t.indexOf('BANKER')!==-1 || t.indexOf('TIER1')!==-1;
  };
  var isSniper = function(b) {
    if (b && b.isSniper) return true;
    var t = String((b&&b.type)||'').toUpperCase();
    return t.indexOf('SNIPER')!==-1 || t.indexOf('TIER2')!==-1 ||
           t.indexOf('QUARTER')!==-1;
  };

  var pools = {
    bankers: availableBets.filter(isBanker),
    snipers: availableBets.filter(function(b){ return isSniper(b)&&!isBanker(b); }),
    all:     availableBets
  };

  Logger.log('[' + FUNC + '] Pools: bankers=' + pools.bankers.length +
    ', snipers=' + pools.snipers.length + ', all=' + pools.all.length +
    ' | sizes=' + JSON.stringify(sizes) +
    ' | FORCE_DOUBLES=' + FORCE_DOUBLES +
    ' | ALLOW_SINGLES=' + ALLOW_SINGLES);

  // ── Generic single-acca builder ──
  var tryBuild = function(pool, size, label) {
    var avail = remaining(pool);
    if (avail.length < size) return false;

    if (typeof _buildFromPool === 'function') {
      var before = portfolios.length;
      _buildFromPool(pool, usedIds, size, label, maxWinMs, portfolios);
      return portfolios.length > before;
    }
    if (typeof _buildOneAccaWithConstraints === 'function') {
      var acca = _buildOneAccaWithConstraints(avail, size, label, maxWinMs);
      if (!acca) return false;
      pushAcca(acca); return true;
    }

    // Naive fallback
    var legs = [], seen = {};
    for (var k = 0; k < avail.length; k++) {
      var mk = matchKey(avail[k]);
      if (seen[mk]) continue;
      seen[mk] = true;
      legs.push(avail[k]);
      if (legs.length >= size) break;
    }
    if (legs.length < size) return false;

    var acca2 = (typeof _createAccaObjectEnhanced === 'function')
      ? _createAccaObjectEnhanced(legs, label + ' ' + size + '-Fold')
      : { name: label+' '+size+'-Fold', type: label,
          legs: legs, totalOdds: null };
    pushAcca(acca2);
    return true;
  };

  // ═══════════════════════════════════════
  // PHASE A — Planned accas (big → small)
  // ═══════════════════════════════════════
  sizes.sort(function(a,b){ return b-a; });

  var buildAll = function(pool, label) {
    for (var s = 0; s < sizes.length; s++) {
      var sz = sizes[s];
      var cap = 0;
      while (tryBuild(pool, sz, label) && ++cap < 50) {
        Logger.log('[' + FUNC + '] ✅ ' + label + ' ' + sz + '-Fold');
      }
    }
  };

  buildAll(pools.bankers, '♻️ Leftover Banker');
  buildAll(pools.snipers, '♻️ Leftover Sniper');
  buildAll(pools.all,     '♻️ Leftover Mixed');

  // ═══════════════════════════════════════
  // PHASE B — Force doubles (drain)
  // ═══════════════════════════════════════
  if (FORCE_DOUBLES) {
    Logger.log('[' + FUNC + '] Phase B: forcing doubles...');
    var dblCount = 0;

    while (true) {
      var rem = remaining(pools.all);
      if (rem.length < 2) break;

      var leg1 = rem[0];
      var mk1  = matchKey(leg1);
      var t1   = _pt(leg1.time);

      var pIdx = -1;
      for (var j = 1; j < rem.length; j++) {
        if (matchKey(rem[j]) === mk1) continue;           // same-game block
        var t2 = _pt(rem[j].time);
        if (t1 && t2 && Math.abs(t2-t1) > maxWinMs) continue; // time window
        pIdx = j;
        break;
      }

      if (pIdx === -1) break; // can't pair without constraint violation

      var leg2 = rem[pIdx];
      var dbl = (typeof _createAccaObjectEnhanced === 'function')
        ? _createAccaObjectEnhanced([leg1, leg2], '🎲 Leftover Double')
        : { name: '🎲 Leftover Double', type: '🎲 Leftover Double',
            legs: [leg1, leg2], totalOdds: null };
      pushAcca(dbl);
      dblCount++;
    }
    Logger.log('[' + FUNC + '] Phase B complete: ' + dblCount + ' doubles');
  }

  // ═══════════════════════════════════════
  // PHASE C — Force singles (optional)
  // ═══════════════════════════════════════
  var finalRem = remaining(pools.all);

  if (finalRem.length > 0) {
    if (ALLOW_SINGLES) {
      Logger.log('[' + FUNC + '] Phase C: ' +
        finalRem.length + ' singles...');
      for (var r = 0; r < finalRem.length; r++) {
        var sgl = (typeof _createAccaObjectEnhanced === 'function')
          ? _createAccaObjectEnhanced(
              [finalRem[r]], '📌 Leftover Single')
          : { name: '📌 Leftover Single',
              type: '📌 Leftover Single',
              legs: [finalRem[r]], totalOdds: null };
        pushAcca(sgl);
      }
    } else {
      Logger.log('[' + FUNC + '] ⚠️ ' + finalRem.length +
        ' bets unallocated (ALLOW_SINGLES=false). Logging:');
      finalRem.slice(0, 25).forEach(function(bu) {
        Logger.log('[' + FUNC + ']   UNUSED: ' +
          matchKey(bu) + ' | ' +
          String(bu.pick||'').substring(0,50));
      });
    }
  }

  Logger.log('[' + FUNC + '] RESULT: accas=' + portfolios.length +
    ', used=' + usedIds.size + ', pool=' + availableBets.length +
    ', unused=' + remaining(pools.all).length);

  return { portfolios: portfolios, usedIds: usedIds };
}

function _buildFromPool(pool, usedIds, targetSize, namePrefix, maxWindowMs, output) {
  let iter = 0;

  while (iter++ < 10) {
    const available = pool.filter(b => !usedIds.has(b.betId))
                          .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    if (available.length < targetSize) break;

    const cluster = [];
    const leagueCount = {};
    const matchesUsed = new Set(); // Prevent same match in one acca
    let seedTime = null;

    for (const bet of available) {
      if (cluster.length >= targetSize) break;

      // Don't use same match twice in one acca
      if (matchesUsed.has(bet.match)) continue;

      const league = bet.league || 'unknown';
      if ((leagueCount[league] || 0) >= LEFTOVER_CONFIG.MAX_PER_LEAGUE) continue;

      if (seedTime && bet.time) {
        if (Math.abs(bet.time.getTime() - seedTime) > maxWindowMs) continue;
      }

      cluster.push(bet);
      matchesUsed.add(bet.match);
      leagueCount[league] = (leagueCount[league] || 0) + 1;
      if (!seedTime && bet.time) seedTime = bet.time.getTime();
    }

    if (cluster.length < targetSize) break;

    const legs = cluster.slice(0, targetSize);
    legs.forEach(l => usedIds.add(l.betId));
    output.push(_createLeftoverAcca(legs, `${namePrefix} ${targetSize}-Fold`));
  }
}

/**
 * Create an acca object from a set of legs.
 * Accepts optional tier parameter ('LEFTOVER' or 'RISKY').
 */
function _createLeftoverAcca(legs, name, tier) {
  tier = (tier && typeof tier === 'string') ? tier.toUpperCase() : 'LEFTOVER';
  var prefix = (tier === 'RISKY') ? 'RISKY_' : 'LEFTOVER_';

  const times = legs.filter(l => l.time).map(l => l.time.getTime());
  const totalOdds = legs.reduce((acc, l) => acc * (l.odds || LEFTOVER_CONFIG.DEFAULT_ODDS), 1);
  const avgConf = legs.reduce((acc, l) => acc + (l.confidence || 0.7), 0) / legs.length;

  const typeCounts = { BANKER: 0, SNIPER: 0, SNIPER_DIR: 0 };
  legs.forEach(l => {
    if (l.isBanker) typeCounts.BANKER++;
    else if (l.isDirectional) typeCounts.SNIPER_DIR++;
    else if (l.isSniper) typeCounts.SNIPER++;
  });

  return {
    id: prefix + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4),
    name,
    type: tier,
    legs,
    totalOdds,
    avgConfidence: avgConf,
    typeCounts,
    earliestStart: times.length ? new Date(Math.min(...times)) : new Date(),
    latestStart: times.length ? new Date(Math.max(...times)) : new Date(),
    status: 'PENDING'
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

function _buildAudit(cats, leftoverUsedIds, leftoverPortfolios) {
  const audit = [];

  // Build betId -> acca lookup
  const betToAcca = {};
  (leftoverPortfolios || []).forEach(a => {
    (a.legs || []).forEach(l => {
      if (l && l.betId) {
        betToAcca[l.betId] = { type: 'LEFTOVER', name: a.name, odds: a.totalOdds };
      }
    });
  });

  // Main acca bets
  (cats.main || []).forEach(bet => {
    audit.push({ ...bet, status: BET_STATUS.MAIN, acca: { type: 'MAIN', name: 'Acca_Portfolio' }, note: 'Used in main accumulator' });
  });

  // Expired
  (cats.expired || []).forEach(bet => {
    audit.push({ ...bet, status: BET_STATUS.EXPIRED, acca: null, note: 'Kickoff passed before processing' });
  });

  // Available - check if made it into leftover
  (cats.available || []).forEach(bet => {
    if (leftoverUsedIds.has(bet.betId)) {
      audit.push({ ...bet, status: BET_STATUS.LEFTOVER, acca: betToAcca[bet.betId], note: 'Used in leftover accumulator' });
    } else {
      audit.push({ ...bet, status: BET_STATUS.DROPPED, acca: null, note: 'Constraints prevented placement' });
    }
  });

  return audit;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE LEFTOVER SHEET
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * _writeLeftoverSheet — Phase 3 Patched
 *
 * Changes: Header reflects SILVER tier. Column 10 (was blank) now shows
 * edge+purity grades for debugging. All date safety preserved.
 */
function _writeLeftoverSheet(ss, portfolios) {
  const FUNC_NAME = '_writeLeftoverSheet';
  const COLS = 11;
  const TIME_ZONE = Session.getScriptTimeZone();

  let sheet = ss.getSheetByName('Leftover_Accas');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('Leftover_Accas');

  const rows = [];

  // Header
  rows.push(['🥈 SILVER TIER PORTFOLIO (Leftover_Accas)', '', '', '', '', '', '', '', '', '', '']);

  const now = new Date();
  const timestamp = Utilities.formatDate(now, TIME_ZONE, 'dd/MM/yyyy HH:mm');
  rows.push(['Generated: ' + timestamp, '', '', '', '', '', '', '', '', '', '']);
  rows.push(['Silver+ bets (Edge≥SILVER & Purity≥SILVER) not in main portfolio', '', '', '', '', '', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '', '', '', '', '', '']);

  const totalLegs = portfolios.reduce(function(s, a) {
    return s + (a.legs || []).length;
  }, 0);
  rows.push(['Leftover Accas: ' + portfolios.length + ' | Total Legs: ' + totalLegs, '', '', '', '', '', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '', '', '', '', '', '']);

  for (var ai = 0; ai < portfolios.length; ai++) {
    var acca = portfolios[ai];
    var tc = acca.typeCounts || { BANKER: 0, SNIPER: 0, SNIPER_DIR: 0 };
    var typeStr = '🔒' + (tc.BANKER || 0) + ' 🎯' + ((tc.SNIPER || 0) + (tc.SNIPER_DIR || 0));
    var oddsStr = (acca.totalOdds || 1.0).toFixed(2);

    rows.push([
      (acca.name || '') + ' | Odds: ' + oddsStr + ' | ' + typeStr,
      '', '', '', '', '', '', '', '', '',
      acca.id || ''
    ]);

    // Column headers (col 10 = Grades)
    rows.push([
      'Date', 'Time', 'League', 'Match', 'Pick',
      'Type', 'Odds', 'Conf%', 'Status', 'Grades', 'BetID'
    ]);

    var sorted = (acca.legs || []).slice().sort(function(a, b) {
      var tA = (a.time instanceof Date) ? a.time.getTime() : 0;
      var tB = (b.time instanceof Date) ? b.time.getTime() : 0;
      return tA - tB;
    });

    for (var li = 0; li < sorted.length; li++) {
      var leg = sorted[li];
      var dateStr = '';
      var timeStr = '';

      if (leg.time instanceof Date && !isNaN(leg.time.getTime())) {
        try {
          dateStr = Utilities.formatDate(leg.time, TIME_ZONE, 'dd/MM/yyyy');
          timeStr = Utilities.formatDate(leg.time, TIME_ZONE, 'HH:mm');
        } catch (e) {
          var day = String(leg.time.getDate()).padStart(2, '0');
          var month = String(leg.time.getMonth() + 1).padStart(2, '0');
          var year = leg.time.getFullYear();
          dateStr = day + '/' + month + '/' + year;
          var hours = String(leg.time.getHours()).padStart(2, '0');
          var minutes = String(leg.time.getMinutes()).padStart(2, '0');
          timeStr = hours + ':' + minutes;
        }
      }

      if (!dateStr && leg.date) {
        if (typeof leg.date === 'string' && leg.date.includes('/')) {
          dateStr = leg.date;
        } else if (leg.date instanceof Date && !isNaN(leg.date.getTime())) {
          try {
            dateStr = Utilities.formatDate(leg.date, TIME_ZONE, 'dd/MM/yyyy');
          } catch (e2) {
            dateStr = String(leg.date);
          }
        }
      }

      if (!dateStr) dateStr = '--/--/----';
      if (!timeStr) timeStr = '--:--';

      // Grades column
      var eg = String(leg.assayer_edge_grade ||
        (leg.assayer && leg.assayer.edge && leg.assayer.edge.grade) || '').trim().toUpperCase();
      var pg = String(leg.assayer_purity_grade ||
        (leg.assayer && leg.assayer.purity && leg.assayer.purity.grade) || '').trim().toUpperCase();
      var gradeStr = (eg || 'NONE') + '+' + (pg || 'NONE');

      var LCFG = (typeof LEFTOVER_CONFIG !== 'undefined' && LEFTOVER_CONFIG)
        ? LEFTOVER_CONFIG : {};

      rows.push([
        String(dateStr),
        String(timeStr),
        String(leg.league || ''),
        String(leg.match || ''),
        String(leg.pick || ''),
        String(leg.type || ''),
        String((leg.odds || LCFG.DEFAULT_ODDS || 1.40).toFixed(2)),
        String(((leg.confidence || 0.7) * 100).toFixed(0)) + '%',
        'PENDING',
        gradeStr,
        String(leg.betId || '')
      ]);
    }

    rows.push(['ACCA STATUS:', 'PENDING', '', '', '', '', '', '', '', '', '']);
    rows.push(['', '', '', '', '', '', '', '', '', '', '']);
  }

  // Final normalization + Date safety net
  var normalized = rows.map(function(r) {
    var row = r.slice();
    while (row.length < COLS) row.push('');
    return row.slice(0, COLS).map(function(cell) {
      if (cell instanceof Date) {
        try {
          return Utilities.formatDate(cell, TIME_ZONE, 'dd/MM/yyyy');
        } catch (e) {
          return String(cell);
        }
      }
      return String(cell);
    });
  });

  sheet.getRange(1, 1, normalized.length, COLS).setValues(normalized);

  // Formatting
  sheet.getRange(1, 1, 1, COLS)
    .merge().setFontWeight('bold').setFontSize(14)
    .setBackground('#ff6f00').setFontColor('#ffffff');
  sheet.getRange(3, 1, 1, COLS)
    .merge().setFontStyle('italic').setFontColor('#666666');
  sheet.setFrozenRows(6);

  var widths = [90, 55, 70, 200, 160, 100, 55, 55, 80, 110, 280];
  for (var wi = 0; wi < widths.length; wi++) {
    sheet.setColumnWidth(wi + 1, widths[wi]);
  }

  Logger.log('[' + FUNC_NAME + '] ✅ Wrote ' + portfolios.length +
    ' leftover accas with ' + totalLegs + ' total legs');
}

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE AUDIT SHEET
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * _writeAuditSheet — Phase 3 Patched
 *
 * Changes: Utilities.formatDate everywhere (no toLocaleString/toLocaleDateString).
 * All cells String-safe before setValues. Clearer status labels.
 */
function _writeAuditSheet(ss, audit) {
  var FUNC_NAME = '_writeAuditSheet';
  var COLS = 11;
  var TIME_ZONE = Session.getScriptTimeZone();

  var sheet = ss.getSheetByName('Bet_Audit');
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet('Bet_Audit');

  var BS = (typeof BET_STATUS !== 'undefined' && BET_STATUS)
    ? BET_STATUS
    : { MAIN: 'MAIN_ACCA', LEFTOVER: 'LEFTOVER_ACCA', EXPIRED: 'EXPIRED', DROPPED: 'DROPPED' };

  var counts = {};
  var auditArr = audit || [];
  for (var ci = 0; ci < auditArr.length; ci++) {
    if (auditArr[ci] && auditArr[ci].status) {
      counts[auditArr[ci].status] = (counts[auditArr[ci].status] || 0) + 1;
    }
  }

  var rows = [];
  rows.push(['🔍 COMPLETE BET AUDIT - NOTHING DISAPPEARS', '', '', '', '', '', '', '', '', '', '']);
  rows.push(['Generated: ' + Utilities.formatDate(new Date(), TIME_ZONE, 'dd/MM/yyyy HH:mm'),
    '', '', '', '', '', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '', '', '', '', '', '']);
  rows.push([
    '✅ MAIN: ' + (counts[BS.MAIN] || 0),
    '♻️ LEFTOVER: ' + (counts[BS.LEFTOVER] || 0),
    '⏰ EXPIRED: ' + (counts[BS.EXPIRED] || 0),
    '❌ DROPPED: ' + (counts[BS.DROPPED] || 0),
    '', '', '', '', '', '', ''
  ]);
  rows.push(['', '', '', '', '', '', '', '', '', '', '']);
  rows.push(['Status', 'League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Acca', 'Note', 'BetID']);

  var icons = {};
  icons[BS.MAIN] = '✅';
  icons[BS.LEFTOVER] = '♻️';
  icons[BS.EXPIRED] = '⏰';
  icons[BS.DROPPED] = '❌';

  var order = { DROPPED: 0, EXPIRED: 1, LEFTOVER_ACCA: 2, MAIN_ACCA: 3 };
  var sorted = auditArr.slice().sort(function(a, b) {
    var oa = (order[a.status] !== undefined) ? order[a.status] : 99;
    var ob = (order[b.status] !== undefined) ? order[b.status] : 99;
    return oa - ob;
  });

  var fmtDate = function(d) {
    try { return Utilities.formatDate(d, TIME_ZONE, 'dd/MM/yyyy'); }
    catch (e) { return ''; }
  };
  var fmtTime = function(d) {
    try { return Utilities.formatDate(d, TIME_ZONE, 'HH:mm'); }
    catch (e) { return ''; }
  };

  for (var ri = 0; ri < sorted.length; ri++) {
    var bet = sorted[ri];

    var accaStr = '';
    if (bet.acca) {
      var aOdds = (typeof bet.acca.odds === 'number' && isFinite(bet.acca.odds))
        ? bet.acca.odds.toFixed(2) : '';
      accaStr = aOdds
        ? String(bet.acca.name || '') + ' (' + aOdds + 'x)'
        : String(bet.acca.name || '');
    }

    var t = (bet.time instanceof Date && !isNaN(bet.time.getTime())) ? bet.time : null;
    var timeStr = t ? fmtTime(t) : '';
    var dateStr = bet.date ? String(bet.date) : (t ? fmtDate(t) : '');

    var oddsNum = Number(bet.odds || 0);
    var oddsStr = (isFinite(oddsNum) && oddsNum > 0) ? oddsNum.toFixed(2) : '';

    var icon = icons[bet.status] || '?';

    rows.push([
      icon + ' ' + String(bet.status || ''),
      String(bet.league || ''),
      String(dateStr || ''),
      String(timeStr || ''),
      String(bet.match || ''),
      String(bet.pick || ''),
      String(bet.type || ''),
      String(oddsStr),
      String(accaStr || ''),
      String(bet.note || ''),
      String(bet.betId || '')
    ]);
  }

  // Normalize: pad to COLS, force all to String
  var normalized = rows.map(function(r) {
    var row = r.slice();
    while (row.length < COLS) row.push('');
    return row.slice(0, COLS).map(function(c) { return String(c); });
  });

  sheet.getRange(1, 1, normalized.length, COLS).setValues(normalized);

  // Formatting
  sheet.getRange(1, 1, 1, COLS).merge()
    .setFontWeight('bold').setFontSize(14)
    .setBackground('#1a237e').setFontColor('#fff');
  sheet.getRange(4, 1, 1, 4).setFontWeight('bold').setBackground('#e8eaf6');
  sheet.getRange(6, 1, 1, COLS).setFontWeight('bold').setBackground('#c5cae9');

  // Color-code rows
  var colors = {
    DROPPED: '#ffcdd2',
    LEFTOVER_ACCA: '#fff3e0',
    MAIN_ACCA: '#c8e6c9',
    EXPIRED: '#f5f5f5'
  };

  for (var r = 6; r < normalized.length; r++) {
    var statusCell = String(normalized[r][0] || '');
    for (var status in colors) {
      if (colors.hasOwnProperty(status) && statusCell.indexOf(status) !== -1) {
        sheet.getRange(r + 1, 1, 1, COLS).setBackground(colors[status]);
        break;
      }
    }
  }

  sheet.setFrozenRows(6);

  var widths = [130, 60, 90, 55, 200, 160, 100, 55, 180, 260, 280];
  for (var wi = 0; wi < widths.length; wi++) {
    sheet.setColumnWidth(wi + 1, widths[wi]);
  }

  Logger.log('[' + FUNC_NAME + '] ✅ Wrote audit for ' + auditArr.length + ' bets');
}
