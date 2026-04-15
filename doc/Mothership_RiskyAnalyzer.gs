/**
 * ======================================================================
 * FILE: Mothership_RiskyAnalyzer.gs
 * PROJECT: Ma Golide - MOTHERSHIP
 * PURPOSE: Analyze ALL games by riskiness level (not just RISKY label)
 * VERSION: 7.0 - Full Spectrum Analysis
 * 
 * KEY INSIGHT:
 * - RISKY label = games where MaGolide is uncertain (score ~57-75)
 * - HOME/AWAY label = games where MaGolide is confident (score ~0-40)
 * - This version calculates riskiness for ALL games to validate
 *   that LOW tier (HOME/AWAY predictions) follow Forebet well
 * 
 * STRATEGY BY TIER:
 * - EXTREME (75-100): Skip/Monitor - need more data
 * - HIGH (57-74): Bet AGAINST Forebet → ~92% success
 * - MEDIUM (40-56): Bet WITH Forebet → ~67% success
 * - LOW (0-39): Bet WITH Forebet (HOME/AWAY preds) → ~85%+ expected
 * ======================================================================
 */

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const RISKY_CONFIG = {
  // Tier thresholds (optimized from your data)
  THRESHOLDS: {
    EXTREME: 75,
    HIGH: 57,
    MEDIUM: 40,
    LOW: 0
  },
  
  // Strategy per tier
  STRATEGY: {
    EXTREME: 'SKIP',
    HIGH: 'AGAINST_FOREBET',
    MEDIUM: 'WITH_FOREBET',
    LOW: 'WITH_FOREBET'
  },
  
  // Analysis modes
  MODES: {
    RISKY_ONLY: 'risky_only',      // Only games labeled RISKY
    ALL_GAMES: 'all_games'          // All games with riskiness scoring
  },
  
  MIN_GAMES_FOR_STATS: 3,
  BREAKEVEN_RATE: 52.4
};


function showThresholdConfig() {
  const ui = SpreadsheetApp.getUi();
  const config = `
⚙️ CURRENT CONFIGURATION

TIER THRESHOLDS:
• EXTREME: Score ≥ ${RISKY_CONFIG.THRESHOLDS.EXTREME}
• HIGH: Score ≥ ${RISKY_CONFIG.THRESHOLDS.HIGH}
• MEDIUM: Score ≥ ${RISKY_CONFIG.THRESHOLDS.MEDIUM}
• LOW: Score < ${RISKY_CONFIG.THRESHOLDS.MEDIUM}

STRATEGY:
• EXTREME: ${RISKY_CONFIG.STRATEGY.EXTREME}
• HIGH: ${RISKY_CONFIG.STRATEGY.HIGH}
• MEDIUM: ${RISKY_CONFIG.STRATEGY.MEDIUM}
• LOW: ${RISKY_CONFIG.STRATEGY.LOW}

To modify, edit RISKY_CONFIG in the script.
  `;
  ui.alert('Configuration', config, ui.ButtonSet.OK);
}

function showRiskinessInfo() {
  const ui = SpreadsheetApp.getUi();
  const info = `
🎯 FULL SPECTRUM STRATEGY

RISKY GAMES (labeled "RISKY"):
• HIGH tier (57-74): Bet AGAINST Forebet → ~92%
• MEDIUM tier (40-56): Bet WITH Forebet → ~67%

CONFIDENT GAMES (labeled "HOME/AWAY"):
• LOW tier (0-39): Bet WITH Forebet → Expected ~85%+
• These are games where MaGolide agrees with Forebet

EXTREME tier (75+): Currently skipping - need more data.

The key insight: Riskiness score tells us WHEN to 
go against Forebet vs when to follow them!
  `;
  ui.alert('Strategy Info', info, ui.ButtonSet.OK);
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINTS
// ═══════════════════════════════════════════════════════════════════════════════

function analyzeRiskyBetsPerformance() {
  return _runAnalysis({ mode: 'risky_only', withLevels: false, dualStrategy: false });
}

function analyzeRiskyBetsWithLevels() {
  return _runAnalysis({ mode: 'risky_only', withLevels: true, dualStrategy: false });
}

function analyzeRiskyBetsDualStrategy() {
  return _runAnalysis({ mode: 'risky_only', withLevels: true, dualStrategy: true });
}

/**
 * NEW: Analyze ALL games (not just RISKY) with riskiness scoring
 * This validates the LOW tier (HOME/AWAY predictions)
 */
function analyzeAllGamesFullSpectrum() {
  // Best-effort Assayer load (safe if missing)
  let assayer = null;
  try {
    const cfg = (typeof _cfg_ === 'function') ? (_cfg_() || {}) : {};
    const dp = (() => { try { return PropertiesService.getDocumentProperties(); } catch (e) { return null; } })();

    const assayerSheetId =
      String(
        cfg.assayer_sheet_id ||
        cfg.ASSAYER_SHEET_ID ||
        (dp ? (dp.getProperty('ASSAYER_SHEET_ID') || dp.getProperty('assayer_sheet_id')) : '') ||
        ''
      ).trim();

    const loadFn =
      (typeof loadAssayerData === 'function' && loadAssayerData) ||
      (typeof loadAssayerData_ === 'function' && loadAssayerData_) ||
      null;

    if (assayerSheetId && loadFn) assayer = loadFn(assayerSheetId);
  } catch (e) {
    Logger.log('[RiskyAnalyzer] Assayer load skipped: ' + e.message);
    assayer = null;
  }

  return _runAnalysis({ mode: 'all_games', withLevels: true, dualStrategy: true, assayer });
}


// ═══════════════════════════════════════════════════════════════════════════════
// CORE ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// CORE ANALYSIS ENGINE (TWO-PASS FOR DYNAMIC TIERS)
// ═══════════════════════════════════════════════════════════════════════════════

function _runAnalysis(options) {
  const { mode, withLevels, dualStrategy, assayer } = options;
  const isAllGames = mode === 'all_games';
  const FUNC_NAME = isAllGames ? 'analyzeAllGamesFullSpectrum' : 
                    (dualStrategy ? 'analyzeRiskyBetsDualStrategy' : 
                    (withLevels ? 'analyzeRiskyBetsWithLevels' : 'analyzeRiskyBetsPerformance'));
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] Running without UI context`);
  }

  const modeLabel = isAllGames ? '🌐 FULL SPECTRUM (ALL GAMES)' : '🎯 RISKY GAMES ONLY';
  
  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  Logger.log(`║                    ${modeLabel}                    ║`);
  Logger.log('║                       VERSION 8.0 - DYNAMIC TIERS                            ║');
  Logger.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  Logger.log(`[${FUNC_NAME}] Started: ${new Date().toISOString()}`);
  Logger.log(`[${FUNC_NAME}] Mode: ${mode}`);

  ss.toast(`${modeLabel}...`, 'Risky Analyzer V8', 15);

  try {
    // 
    // STEP 1: Load Results_Temp
    // 
    Logger.log(`[${FUNC_NAME}] STEP 1: Loading Results_Temp...`);
    
    // FIX: _loadResultsTemp returns a plain map, not { resultsMap, resultStats }
    const resultsMap = _loadResultsTemp(ss) || {};
    const keyCount = Object.keys(resultsMap).length;

    if (keyCount === 0) {
      throw new Error('Results_Temp is empty. Run "Sync All Results" first.');
    }

    Logger.log(`[${FUNC_NAME}]  Results loaded: ${keyCount} lookup keys`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Load Config
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log(`[${FUNC_NAME}] STEP 2: Loading Config...`);
    const configSheet = ss.getSheetByName('Config');
    if (!configSheet) throw new Error('Config sheet not found');

    const configData = configSheet.getDataRange().getValues();
    const configHeaders = _createHeaderMapRobust(configData[0]);
    const leagueNameCol = configHeaders['league name'] ?? configHeaders['league'];
    const urlCol = configHeaders['file url'] ?? configHeaders['url'];
    const statusCol = configHeaders['status'];

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: FIRST PASS - Collect all games and calculate scores
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log(`[${FUNC_NAME}] STEP 3: FIRST PASS - Calculating riskiness scores...`);
    
    const allGames = []; // Store all game data with scores
    const scoreDistribution = [];
    let totalGames = 0;
    let totalAnalyzed = 0;

    for (let r = 1; r < configData.length; r++) {
      const row = configData[r];
      const leagueName = String(row[leagueNameCol] || '').trim();
      const fileUrl = String(row[urlCol] || '').trim();
      const status = statusCol !== undefined ? 
        String(row[statusCol] || 'active').toLowerCase().trim() : 'active';
      
      if (status !== 'active' || !fileUrl || fileUrl.includes('PASTE_') || !fileUrl.startsWith('http')) {
        continue;
      }
      
      try {
        Logger.log(`[${FUNC_NAME}]   📂 Processing: ${leagueName}`);
        const satellite = SpreadsheetApp.openByUrl(fileUrl);
        
        const analysisSheet = _findSheetByNameFuzzy(satellite, 'Analysis_Tier1');
        if (!analysisSheet) continue;
        
        const analysisData = analysisSheet.getDataRange().getValues();
        if (analysisData.length < 2) continue;
        
        const h = _createHeaderMapRobust(analysisData[0]);
        
        // Required columns
        const homeCol = h['home'] ?? h['home team'];
        const awayCol = h['away'] ?? h['away team'];
        const dateCol = h['date'];
        const magPredCol = h['magolide pred'] ?? h['pred'];
        const forebetPredCol = h['forebet pred'];
        
        // Riskiness factor columns
        const confidenceCol = h['confidence %'] ?? h['confidence'];
        const magScoreCol = h['magolide score'];
        const forebetPctCol = h['forebet %'] ?? h['forebet'];
        const varianceCol = h['variance penalty'];
        const pctDiffCol = h['pct diff'];
        const netRtgDiffCol = h['netrtg diff'];
        
        if (homeCol === undefined || awayCol === undefined || magPredCol === undefined) {
          continue;
        }
        
        for (let i = 1; i < analysisData.length; i++) {
          const gameRow = analysisData[i];
          const home = String(gameRow[homeCol] || '').trim();
          const away = String(gameRow[awayCol] || '').trim();
          
          if (!home || !away) continue;
          
          totalGames++;
          
          // Get MaGolide prediction label
          const magPredRaw = String(gameRow[magPredCol] || '').toUpperCase().trim();
          
          // Determine label category
          let labelCategory = 'OTHER';
          if (magPredRaw.includes('RISKY')) {
            labelCategory = 'RISKY';
          } else if (magPredRaw === 'HOME' || magPredRaw === '1') {
            labelCategory = 'HOME';
          } else if (magPredRaw === 'AWAY' || magPredRaw === '2') {
            labelCategory = 'AWAY';
          }
          
          // In RISKY_ONLY mode, skip non-RISKY games
          if (!isAllGames && labelCategory !== 'RISKY') {
            continue;
          }
          
          totalAnalyzed++;
          
          // Calculate riskiness SCORE (no tier yet)
          const riskinessData = {
            confidence: _safeParseFloat(gameRow[confidenceCol]),
            magScore: _safeParseFloat(gameRow[magScoreCol]),
            forebetPct: _safeParseFloat(gameRow[forebetPctCol]),
            variance: _safeParseFloat(gameRow[varianceCol]),
            pctDiff: _safeParseFloat(gameRow[pctDiffCol]),
            netRtgDiff: _safeParseFloat(gameRow[netRtgDiffCol])
          };
          
          const ctx = assayer ? { assayer, league: leagueName, source: 'Side', pickSide: null, quarter: 'Full', gender: 'All' } : null;
          const { riskinessScore, breakdown } = _calculateCalibratedRiskinessScore(riskinessData, ctx);
          
          scoreDistribution.push(riskinessScore);
          
          // Get Forebet prediction
          const forebetPredRaw = gameRow[forebetPredCol];
          const forebetPred = parseInt(forebetPredRaw, 10);
          
          const dateRaw = dateCol !== undefined ? gameRow[dateCol] : null;
          const dateStr = _formatDateForDisplay(dateRaw);
          
          // Find result
          const result = _findResultMatch(resultsMap, home, away, dateRaw);
          
          // Store game with score (but NO tier yet)
          allGames.push({
            league: leagueName,
            home,
            away,
            date: dateStr,
            dateRaw,
            magPredLabel: labelCategory,
            forebetPred,
            riskinessScore,
            riskinessData,
            breakdown,
            result
          });
        }
        
      } catch (e) {
        Logger.log(`[${FUNC_NAME}]   ❌ ERROR: ${leagueName} - ${e.message}`);
      }
    }

    Logger.log(`[${FUNC_NAME}] ✅ First pass complete: ${allGames.length} games scored`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Compute DYNAMIC thresholds from score distribution
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log(`[${FUNC_NAME}] STEP 4: Computing dynamic thresholds...`);
    
    const dynamicThresholds = _computePercentileThresholds(scoreDistribution);
    
    Logger.log(`[${FUNC_NAME}] 📊 DYNAMIC THRESHOLDS:`);
    Logger.log(`[${FUNC_NAME}]   EXTREME ≥ ${dynamicThresholds.EXTREME.toFixed(1)} (P90)`);
    Logger.log(`[${FUNC_NAME}]   HIGH    ≥ ${dynamicThresholds.HIGH.toFixed(1)} (P70)`);
    Logger.log(`[${FUNC_NAME}]   MEDIUM  ≥ ${dynamicThresholds.MEDIUM.toFixed(1)} (P40)`);
    Logger.log(`[${FUNC_NAME}]   LOW     < ${dynamicThresholds.MEDIUM.toFixed(1)}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 5: SECOND PASS - Assign tiers and calculate statistics
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log(`[${FUNC_NAME}] STEP 5: SECOND PASS - Assigning tiers and calculating stats...`);
    
    const stats = {
      totalGames,
      totalAnalyzed,
      riskyLabelCount: 0,
      homeLabelCount: 0,
      awayLabelCount: 0,
      gamesWithResults: 0,
      ties: 0,
      noResult: 0,
      
      againstForebetWins: 0,
      againstForebetLosses: 0,
      withForebetWins: 0,
      withForebetLosses: 0,
      
      dualStrategy: {
        totalBets: 0,
        wins: 0,
        losses: 0,
        skipped: 0,
        byAction: {
          'AGAINST_FOREBET': { bets: 0, wins: 0, losses: 0 },
          'WITH_FOREBET': { bets: 0, wins: 0, losses: 0 },
          'SKIP': { bets: 0, wins: 0, losses: 0 }
        }
      },
      
      byLabel: {
        'RISKY': { count: 0, withResults: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0, dualWins: 0, dualLosses: 0 },
        'HOME': { count: 0, withResults: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0, dualWins: 0, dualLosses: 0 },
        'AWAY': { count: 0, withResults: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0, dualWins: 0, dualLosses: 0 }
      },
      
      leagues: {},
      gameDetails: [],
      unmatchedGames: [],
      
      tiers: {
        'EXTREME': { count: 0, withResults: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0, dualWins: 0, dualLosses: 0 },
        'HIGH': { count: 0, withResults: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0, dualWins: 0, dualLosses: 0 },
        'MEDIUM': { count: 0, withResults: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0, dualWins: 0, dualLosses: 0 },
        'LOW': { count: 0, withResults: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0, dualWins: 0, dualLosses: 0 }
      },
      
      scoreDistribution
    };

    // Process each game with assigned tier
    for (const game of allGames) {
      // NOW assign tier using dynamic thresholds
      const riskinessTier = _assignRiskTier(game.riskinessScore, dynamicThresholds);
      
      // Count by label
      if (game.magPredLabel === 'RISKY') stats.riskyLabelCount++;
      else if (game.magPredLabel === 'HOME') stats.homeLabelCount++;
      else if (game.magPredLabel === 'AWAY') stats.awayLabelCount++;
      
      if (stats.byLabel[game.magPredLabel]) {
        stats.byLabel[game.magPredLabel].count++;
      }
      
      // Initialize league if needed
      if (!stats.leagues[game.league]) {
        stats.leagues[game.league] = {
          total: 0, analyzed: 0, withResults: 0,
          againstWins: 0, againstLosses: 0,
          withWins: 0, withLosses: 0,
          dualWins: 0, dualLosses: 0,
          tiers: {
            'EXTREME': { count: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0 },
            'HIGH': { count: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0 },
            'MEDIUM': { count: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0 },
            'LOW': { count: 0, againstWins: 0, againstLosses: 0, withWins: 0, withLosses: 0 }
          }
        };
      }
      
      stats.leagues[game.league].total++;
      stats.leagues[game.league].analyzed++;
      stats.tiers[riskinessTier].count++;
      stats.leagues[game.league].tiers[riskinessTier].count++;
      
      // Skip if no valid Forebet prediction
      if (game.forebetPred !== 1 && game.forebetPred !== 2) {
        stats.noResult++;
        continue;
      }
      
      const againstPred = game.forebetPred === 1 ? 2 : 1;
      const withPred = game.forebetPred;
      
      // Recommended action based on tier
      const recommendedAction = RISKY_CONFIG.STRATEGY[riskinessTier];
      const recommendedBet = recommendedAction === 'AGAINST_FOREBET' ? againstPred : 
                             recommendedAction === 'WITH_FOREBET' ? withPred : null;
      
      // Check if result exists
      if (!game.result || !game.result.isFinished) {
        stats.noResult++;
        if (!game.result) {
          stats.unmatchedGames.push({ 
            league: game.league, 
            home: game.home, 
            away: game.away, 
            date: game.date, 
            label: game.magPredLabel 
          });
        }
        continue;
      }
      
      stats.gamesWithResults++;
      stats.leagues[game.league].withResults++;
      stats.tiers[riskinessTier].withResults++;
      
      if (stats.byLabel[game.magPredLabel]) {
        stats.byLabel[game.magPredLabel].withResults++;
      }
      
      const actualWinner = game.result.winner;
      
      if (actualWinner === 0) {
        stats.ties++;
        continue;
      }
      
      // Calculate outcomes
      const againstWon = actualWinner === againstPred;
      const withWon = actualWinner === withPred;
      
      // Track "against" strategy
      if (againstWon) {
        stats.againstForebetWins++;
        stats.leagues[game.league].againstWins++;
        stats.tiers[riskinessTier].againstWins++;
        if (stats.byLabel[game.magPredLabel]) stats.byLabel[game.magPredLabel].againstWins++;
      } else {
        stats.againstForebetLosses++;
        stats.leagues[game.league].againstLosses++;
        stats.tiers[riskinessTier].againstLosses++;
        if (stats.byLabel[game.magPredLabel]) stats.byLabel[game.magPredLabel].againstLosses++;
      }
      
      // Track "with" strategy
      if (withWon) {
        stats.withForebetWins++;
        stats.leagues[game.league].withWins++;
        stats.tiers[riskinessTier].withWins++;
        if (stats.byLabel[game.magPredLabel]) stats.byLabel[game.magPredLabel].withWins++;
      } else {
        stats.withForebetLosses++;
        stats.leagues[game.league].withLosses++;
        stats.tiers[riskinessTier].withLosses++;
        if (stats.byLabel[game.magPredLabel]) stats.byLabel[game.magPredLabel].withLosses++;
      }
      
      // Track dual strategy
      let dualWon = null;
      if (recommendedAction !== 'SKIP') {
        stats.dualStrategy.totalBets++;
        stats.dualStrategy.byAction[recommendedAction].bets++;
        
        dualWon = (recommendedAction === 'AGAINST_FOREBET' && againstWon) ||
                  (recommendedAction === 'WITH_FOREBET' && withWon);
        
        if (dualWon) {
          stats.dualStrategy.wins++;
          stats.dualStrategy.byAction[recommendedAction].wins++;
          stats.leagues[game.league].dualWins++;
          stats.tiers[riskinessTier].dualWins++;
          if (stats.byLabel[game.magPredLabel]) stats.byLabel[game.magPredLabel].dualWins++;
        } else {
          stats.dualStrategy.losses++;
          stats.dualStrategy.byAction[recommendedAction].losses++;
          stats.leagues[game.league].dualLosses++;
          stats.tiers[riskinessTier].dualLosses++;
          if (stats.byLabel[game.magPredLabel]) stats.byLabel[game.magPredLabel].dualLosses++;
        }
      } else {
        stats.dualStrategy.skipped++;
      }
      
      // Store game detail with tier
      stats.gameDetails.push({
        league: game.league,
        home: game.home,
        away: game.away,
        date: game.date,
        magPredLabel: game.magPredLabel,
        forebetPred: game.forebetPred,
        againstPred,
        withPred,
        actualWinner,
        homeScore: game.result.homeScore,
        awayScore: game.result.awayScore,
        againstWon,
        withWon,
        riskinessScore: game.riskinessScore,
        riskinessTier,
        recommendedAction,
        recommendedBet,
        dualWon,
        riskinessData: game.riskinessData,
        breakdown: game.breakdown
      });
      
      // Logging
      const dualIcon = dualWon === true ? '✅' : (dualWon === false ? '❌' : '⏭️');
      const actionStr = recommendedAction === 'AGAINST_FOREBET' ? 'vs FB' : 
                       recommendedAction === 'WITH_FOREBET' ? 'w/ FB' : 'SKIP';
      Logger.log(`[${FUNC_NAME}]      ${dualIcon} [${riskinessTier}/${game.riskinessScore.toFixed(1)}] ${game.magPredLabel} → ${actionStr}: ${game.home} vs ${game.away}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 6: Calculate final statistics
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log(`[${FUNC_NAME}] STEP 6: Calculating final statistics...`);

    const totalDecidedAgainst = stats.againstForebetWins + stats.againstForebetLosses;
    const againstSuccessRate = totalDecidedAgainst > 0 ? 
      ((stats.againstForebetWins / totalDecidedAgainst) * 100).toFixed(2) : 'N/A';

    const totalDecidedWith = stats.withForebetWins + stats.withForebetLosses;
    const withSuccessRate = totalDecidedWith > 0 ?
      ((stats.withForebetWins / totalDecidedWith) * 100).toFixed(2) : 'N/A';

    const dualTotalDecided = stats.dualStrategy.wins + stats.dualStrategy.losses;
    const dualSuccessRate = dualTotalDecided > 0 ?
      ((stats.dualStrategy.wins / dualTotalDecided) * 100).toFixed(2) : 'N/A';

    // Tier metrics
    const tierMetrics = {};
    for (const [tier, data] of Object.entries(stats.tiers)) {
      const againstTotal = data.againstWins + data.againstLosses;
      const withTotal = data.withWins + data.withLosses;
      const dualTotal = data.dualWins + data.dualLosses;
      
      tierMetrics[tier] = {
        count: data.count,
        withResults: data.withResults,
        againstWins: data.againstWins,
        againstLosses: data.againstLosses,
        againstRate: againstTotal > 0 ? ((data.againstWins / againstTotal) * 100).toFixed(1) : 'N/A',
        withWins: data.withWins,
        withLosses: data.withLosses,
        withRate: withTotal > 0 ? ((data.withWins / withTotal) * 100).toFixed(1) : 'N/A',
        dualWins: data.dualWins,
        dualLosses: data.dualLosses,
        dualRate: dualTotal > 0 ? ((data.dualWins / dualTotal) * 100).toFixed(1) : 'N/A',
        strategy: RISKY_CONFIG.STRATEGY[tier]
      };
    }

    // Label metrics
    const labelMetrics = {};
    for (const [label, data] of Object.entries(stats.byLabel)) {
      const againstTotal = data.againstWins + data.againstLosses;
      const withTotal = data.withWins + data.withLosses;
      const dualTotal = data.dualWins + data.dualLosses;
      
      labelMetrics[label] = {
        count: data.count,
        withResults: data.withResults,
        againstWins: data.againstWins,
        againstLosses: data.againstLosses,
        againstRate: againstTotal > 0 ? ((data.againstWins / againstTotal) * 100).toFixed(1) : 'N/A',
        withWins: data.withWins,
        withLosses: data.withLosses,
        withRate: withTotal > 0 ? ((data.withWins / withTotal) * 100).toFixed(1) : 'N/A',
        dualWins: data.dualWins,
        dualLosses: data.dualLosses,
        dualRate: dualTotal > 0 ? ((data.dualWins / dualTotal) * 100).toFixed(1) : 'N/A'
      };
    }

    // Score distribution stats
    const scores = stats.scoreDistribution;
    const scoreStats = scores.length > 0 ? {
      min: Math.min(...scores).toFixed(1),
      max: Math.max(...scores).toFixed(1),
      avg: (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1),
      median: scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)]?.toFixed(1) || 'N/A'
    } : { min: 'N/A', max: 'N/A', avg: 'N/A', median: 'N/A' };

    // Log summary
    Logger.log('');
    Logger.log('╔═══════════════════════════════════════════════════════════════╗');
    Logger.log('║                    FINAL STATISTICS                           ║');
    Logger.log('╚═══════════════════════════════════════════════════════════════╝');
    Logger.log(`[${FUNC_NAME}] Total Games: ${stats.totalGames}`);
    Logger.log(`[${FUNC_NAME}] Analyzed: ${stats.totalAnalyzed} (${isAllGames ? 'ALL' : 'RISKY only'})`);
    Logger.log(`[${FUNC_NAME}] With Results: ${stats.gamesWithResults}`);
    Logger.log('');
    Logger.log(`[${FUNC_NAME}] ═══ BY TIER (DYNAMIC THRESHOLDS) ═══`);
    for (const tier of ['EXTREME', 'HIGH', 'MEDIUM', 'LOW']) {
      const m = tierMetrics[tier];
      const threshold = tier === 'LOW' ? `< ${dynamicThresholds.MEDIUM.toFixed(1)}` : 
                       `≥ ${dynamicThresholds[tier].toFixed(1)}`;
      Logger.log(`[${FUNC_NAME}] ${tier} [${threshold}]: ${m.count} games | Dual: ${m.dualRate}%`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 7: Generate report
    // ═══════════════════════════════════════════════════════════════════════════
    Logger.log(`[${FUNC_NAME}] STEP 7: Generating report...`);

    const metrics = { 
      againstSuccessRate,
      withSuccessRate,
      dualSuccessRate,
      tierMetrics,
      labelMetrics,
      scoreStats,
      dualStrategy: stats.dualStrategy,
      isAllGames,
      dynamicThresholds  // Pass dynamic thresholds to report
    };
    
    if (isAllGames) {
      _generateFullSpectrumReport(ss, stats, metrics);
    } else if (dualStrategy) {
      _generateDualStrategyReport(ss, stats, metrics);
    } else if (withLevels) {
      _generateRiskyLevelsReport(ss, stats, metrics);
    } else {
      _generateBasicReport(ss, stats, metrics);
    }

    // Summary
    const summaryText = isAllGames ? _buildFullSpectrumSummary(stats, metrics) :
                       (dualStrategy ? _buildDualStrategySummary(stats, metrics) :
                       (withLevels ? _buildLevelsSummary(stats, metrics) : _buildBasicSummary(stats, metrics)));

    Logger.log(`[${FUNC_NAME}] ✅ ANALYSIS COMPLETE`);
    ss.toast('✅ Analysis complete!', 'Risky Analyzer V8', 5);

    if (ui) {
      const title = isAllGames ? '🌐 Full Spectrum Analysis (Dynamic Tiers)' :
                   (dualStrategy ? '🎯 Dual Strategy (Dynamic)' : '📊 Analysis');
      ui.alert(title, summaryText, ui.ButtonSet.OK);
    }

    return { success: true, stats, metrics };

  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ FATAL ERROR: ${e.message}\n${e.stack}`);
    if (ui) ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
    return { success: false, error: e.message };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// CALIBRATED RISKINESS SCORING
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// CALIBRATED RISKINESS SCORING (SCORE ONLY - NO TIER ASSIGNMENT)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate riskiness score ONLY (0-100)
 * Does NOT assign tier - that's done separately with dynamic thresholds
 */
function _calculateCalibratedRiskinessScore(data, ctx) {
  const WEIGHTS = {
    magScore: 0.30,
    confidence: 0.25,
    forebetPct: 0.20,
    pctDiff: 0.10,
    netRtgDiff: 0.10,
    variance: 0.05
  };

  const RANGES = {
    magScore: { min: 0, max: 50 },
    confidence: { min: 50, max: 100 },
    forebetPct: { min: 50, max: 100 },
    pctDiff: { min: 0, max: 30 },
    netRtgDiff: { min: 0, max: 15 },
    variance: { min: 0, max: 2 }
  };

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const isBlank = (v) => v === '' || v === null || v === undefined;
  const asNum = (v) => (typeof v === 'number' ? v : parseFloat(v));
  const normLeague = (s) => String(s || '').trim().toUpperCase();

  const GRADE_RANK = { PLATINUM: 6, GOLD: 5, SILVER: 4, BRONZE: 3, ROCK: 2, CHARCOAL: 1 };
  const gradeRank = (g) => GRADE_RANK[String(g || '').toUpperCase()] || 0;

  const normalizeConfidenceDec = (v) => {
    const n = asNum(v);
    if (!isFinite(n)) return NaN;
    // Accept 0–1 or 0–100
    return n > 1 ? (n / 100) : n;
  };

  const deriveTierFromConf = (confDec) => {
    if (!isFinite(confDec)) return 'UNKNOWN';
    if (confDec >= 0.70) return 'STRONG';
    if (confDec >= 0.60) return 'MEDIUM';
    return 'EVEN';
  };

  const computeConfidenceBucketLocal = (confDec) => {
    if (!isFinite(confDec)) return null;
    if (confDec < 0.55) return '<55%';
    if (confDec <= 0.60) return '55-60%';
    if (confDec <= 0.65) return '60-65%';     // 0.601–0.65 in contract; using <= preserves intent
    if (confDec <= 0.70) return '65-70%';     // 0.651–0.70 in contract
    return '≥70%';
  };

  const edgeField = (e, snake, camel) => {
    const v = e?.[snake];
    if (!isBlank(v)) return v;
    const v2 = e?.[camel];
    if (!isBlank(v2)) return v2;
    return null;
  };

  const betMatchesEdge = (bet, edge) => {
    const edgeSource = String(edgeField(edge, 'source', 'source') || '').trim();
    if (edgeSource && String(bet.source || '').trim() !== edgeSource) return false;

    const checks = [
      ['quarter', 'quarter', 'quarter'],
      ['isWomen', 'is_women', 'isWomen'],
      ['tier', 'tier', 'tier'],
      ['side', 'side', 'side'],
      ['direction', 'direction', 'direction'],
      ['confBucket', 'conf_bucket', 'confBucket'],
      ['spreadBucket', 'spread_bucket', 'spreadBucket'],
      ['lineBucket', 'line_bucket', 'lineBucket'],
    ];

    for (const [betK, snake, camel] of checks) {
      const ev = edgeField(edge, snake, camel);
      if (isBlank(ev)) continue; // wildcard
      if (String(bet[betK] ?? '').trim() !== String(ev).trim()) return false;
    }
    return true;
  };

  const edgeSpecificity = (edge) => {
    const keys = ['quarter','is_women','tier','side','direction','conf_bucket','spread_bucket','line_bucket'];
    let n = 0;
    for (const k of keys) if (!isBlank(edge?.[k])) n++;
    // also check camelCase just in case
    const camelKeys = ['quarter','isWomen','tier','side','direction','confBucket','spreadBucket','lineBucket'];
    for (const k of camelKeys) if (!isBlank(edge?.[k])) n = Math.max(n, n); // no-op, kept intentionally minimal
    return n;
  };

  const bestEdgeForBet = (bet, edges) => {
    let best = null;
    let bestSpec = -1;
    let bestRank = -1;
    let bestLift = -Infinity;

    for (let i = 0; i < (edges || []).length; i++) {
      const e = edges[i];
      if (!betMatchesEdge(bet, e)) continue;

      const spec = edgeSpecificity(e);
      const r = gradeRank(edgeField(e, 'grade', 'grade'));
      const lift = asNum(edgeField(e, 'lift', 'lift'));
      const liftV = isFinite(lift) ? lift : -Infinity;

      if (
        spec > bestSpec ||
        (spec === bestSpec && r > bestRank) ||
        (spec === bestSpec && r === bestRank && liftV > bestLift)
      ) {
        best = e;
        bestSpec = spec;
        bestRank = r;
        bestLift = liftV;
      }
    }

    return best ? { edge: best, specificity: bestSpec, gradeRank: bestRank, lift: bestLift } : null;
  };

  const purityActionFrom = (purityRow) => {
    if (!purityRow) return { action: 'NEUTRAL', delta: 0 };

    const grade = String(purityRow.grade || purityRow.Grade || '').toUpperCase();
    const status = String(purityRow.status || purityRow.Status || '').toLowerCase();

    if (status.includes('building')) return { action: 'NEUTRAL', delta: 0 };
    if (grade === 'CHARCOAL' && status.includes('avoid')) return { action: 'BLOCK', delta: 100 };
    if (grade === 'ROCK') return { action: 'SUPPRESS', delta: 12 };
    if (grade === 'BRONZE') return { action: 'CAUTION', delta: 5 };
    if ((grade === 'PLATINUM' || grade === 'GOLD') && (status.includes('reliable') || status.includes('elite'))) {
      return { action: 'BOOST', delta: -7 };
    }
    return { action: 'NEUTRAL', delta: 0 };
  };

  const bestPurityFor = (query, purityRows) => {
    const qLeague = normLeague(query.league);
    const qSource = String(query.source || '').trim();
    const qQuarter = String(query.quarter || 'All').trim();
    const qGender = String(query.gender || 'All').trim();
    const qTier = String(query.tier || 'UNKNOWN').trim();

    let best = null;
    let bestScore = -1;

    for (const r of (purityRows || [])) {
      const lg = normLeague(r.league || r.League);
      if (!lg || lg !== qLeague) continue;

      const src = String(r.source || r.Source || '').trim();
      if (qSource && src && src !== qSource) continue;

      const quarter = String(r.quarter || r.Quarter || '').trim();
      const gender = String(r.gender || r.Gender || '').trim();
      const tier = String(r.tier || r.Tier || '').trim();

      // Quarter match: exact > Full > All (and if query is All, accept any)
      let qScore = 0;
      if (qQuarter === 'All') qScore = (quarter === 'All') ? 1 : (quarter === 'Full' ? 2 : 3);
      else qScore = (quarter === qQuarter) ? 3 : (quarter === 'Full' ? 2 : (quarter === 'All' ? 1 : 0));
      if (qScore === 0) continue;

      // Gender match: exact > All (and if query is All, accept any)
      let gScore = 0;
      if (qGender === 'All') gScore = (gender === 'All') ? 1 : 2;
      else gScore = (gender === qGender) ? 2 : (gender === 'All' ? 1 : 0);
      if (gScore === 0) continue;

      // Tier match: exact > UNKNOWN (and if query is UNKNOWN, accept any)
      let tScore = 0;
      if (qTier === 'UNKNOWN') tScore = (tier === 'UNKNOWN') ? 1 : 2;
      else tScore = (tier === qTier) ? 2 : (tier === 'UNKNOWN' ? 1 : 0);
      if (tScore === 0) continue;

      const score = qScore * 100 + gScore * 10 + tScore;
      if (score > bestScore) { bestScore = score; best = r; }
    }

    return best;
  };

  // ── Base score (unchanged) ──
  const breakdown = {};
  let weightedSum = 0;
  let totalWeight = 0;

  if (data.magScore !== null && !isNaN(data.magScore)) {
    const absScore = Math.abs(data.magScore);
    const normalized = 1 - Math.min(absScore / RANGES.magScore.max, 1);
    breakdown.magScore = { raw: data.magScore, abs: absScore, normalized: normalized.toFixed(3) };
    weightedSum += normalized * WEIGHTS.magScore;
    totalWeight += WEIGHTS.magScore;
  }

  if (data.confidence !== null && !isNaN(data.confidence)) {
    const clamped = Math.max(RANGES.confidence.min, Math.min(data.confidence, RANGES.confidence.max));
    const normalized = 1 - ((clamped - RANGES.confidence.min) / (RANGES.confidence.max - RANGES.confidence.min));
    breakdown.confidence = { raw: data.confidence, normalized: normalized.toFixed(3) };
    weightedSum += normalized * WEIGHTS.confidence;
    totalWeight += WEIGHTS.confidence;
  }

  if (data.forebetPct !== null && !isNaN(data.forebetPct)) {
    const clamped = Math.max(RANGES.forebetPct.min, Math.min(data.forebetPct, RANGES.forebetPct.max));
    const normalized = 1 - ((clamped - RANGES.forebetPct.min) / (RANGES.forebetPct.max - RANGES.forebetPct.min));
    breakdown.forebetPct = { raw: data.forebetPct, normalized: normalized.toFixed(3) };
    weightedSum += normalized * WEIGHTS.forebetPct;
    totalWeight += WEIGHTS.forebetPct;
  }

  if (data.pctDiff !== null && !isNaN(data.pctDiff)) {
    const absDiff = Math.abs(data.pctDiff);
    const normalized = 1 - Math.min(absDiff / RANGES.pctDiff.max, 1);
    breakdown.pctDiff = { raw: data.pctDiff, abs: absDiff, normalized: normalized.toFixed(3) };
    weightedSum += normalized * WEIGHTS.pctDiff;
    totalWeight += WEIGHTS.pctDiff;
  }

  if (data.netRtgDiff !== null && !isNaN(data.netRtgDiff)) {
    const absDiff = Math.abs(data.netRtgDiff);
    const normalized = 1 - Math.min(absDiff / RANGES.netRtgDiff.max, 1);
    breakdown.netRtgDiff = { raw: data.netRtgDiff, abs: absDiff, normalized: normalized.toFixed(3) };
    weightedSum += normalized * WEIGHTS.netRtgDiff;
    totalWeight += WEIGHTS.netRtgDiff;
  }

  if (data.variance !== null && !isNaN(data.variance)) {
    const normalized = Math.min(data.variance / RANGES.variance.max, 1);
    breakdown.variance = { raw: data.variance, normalized: normalized.toFixed(3) };
    weightedSum += normalized * WEIGHTS.variance;
    totalWeight += WEIGHTS.variance;
  }

  let riskinessScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 50;
  riskinessScore = clamp(riskinessScore, 0, 100);

  // ── Assayer adjustments (NEW) ──
  let assayerMeta = null;
  try {
    const assayer = ctx && ctx.assayer ? ctx.assayer : null;
    const edges = assayer?.edges || assayer?.ASSAYER_EDGES || assayer?.assayerEdges || null;
    const purityRows = assayer?.purity || assayer?.ASSAYER_LEAGUE_PURITY || assayer?.assayerPurity || null;

    const league = ctx?.league;
    const source = String(ctx?.source || 'Side');
    const confDec = isFinite(ctx?.confidenceDec) ? ctx.confidenceDec : normalizeConfidenceDec(data?.confidence);

    if (assayer && league && (edges || purityRows)) {
      const tier = String(ctx?.tier || deriveTierFromConf(confDec));
      const quarter = String(ctx?.quarter || 'Full');
      const gender = String(ctx?.gender || 'All');
      const confBucket =
        (typeof computeConfidenceBucket === 'function' ? computeConfidenceBucket(confDec) :
         typeof computeConfidenceBucket_ === 'function' ? computeConfidenceBucket_(confDec) :
         computeConfidenceBucketLocal(confDec));

      // Edge delta: either a specific pickSide, or "best-of-both" if null.
      const pickSides = ctx?.pickSide ? [String(ctx.pickSide)] : ['H', 'A'];
      let bestEdge = null;

      for (const ps of pickSides) {
        const bet = {
          league,
          source,
          side: ps,
          quarter: null,
          isWomen: null,
          tier,
          direction: null,
          confBucket,
          spreadBucket: null,
          lineBucket: null,
        };
        const m = bestEdgeForBet(bet, edges || []);
        if (!m) continue;
        if (!bestEdge || m.specificity > bestEdge.specificity ||
            (m.specificity === bestEdge.specificity && m.gradeRank > bestEdge.gradeRank) ||
            (m.specificity === bestEdge.specificity && m.gradeRank === bestEdge.gradeRank && m.lift > bestEdge.lift)) {
          bestEdge = m;
        }
      }

      // Purity delta
      const purity = bestPurityFor({ league, source, quarter, gender, tier }, purityRows || []);
      const purityEff = purityActionFrom(purity);

      const edgeDelta = bestEdge && isFinite(bestEdge.lift) ? (-bestEdge.lift * 100) : 0; // lift reduces risk
      const purityDelta = purityEff.delta;

      const adjusted = clamp(riskinessScore + edgeDelta + purityDelta, 0, 100);

      assayerMeta = {
        edge_id: bestEdge?.edge?.edge_id || bestEdge?.edge?.edgeId || null,
        edge_grade: bestEdge?.edge?.grade || null,
        edge_lift: isFinite(bestEdge?.lift) ? bestEdge.lift : null,
        purity_grade: purity?.grade || purity?.Grade || null,
        purity_status: purity?.status || purity?.Status || null,
        purity_action: purityEff.action,
        baseRisk: riskinessScore,
        edgeDelta,
        purityDelta,
        adjustedRisk: adjusted
      };

      riskinessScore = adjusted;
      breakdown.assayer = assayerMeta;
    }
  } catch (e) {
    breakdown.assayer_error = String(e && e.message ? e.message : e);
  }

  breakdown.finalScore = riskinessScore.toFixed(2);
  breakdown.totalWeight = totalWeight.toFixed(3);

  return { riskinessScore, breakdown, assayerMeta };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC TIER ASSIGNMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Assign risk tier based on score and dynamic thresholds
 * Pure function - no side effects
 */
function _assignRiskTier(score, thresholds) {
  if (score >= thresholds.EXTREME) return 'EXTREME';
  if (score >= thresholds.HIGH) return 'HIGH';
  if (score >= thresholds.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/**
 * Compute percentile-based thresholds from score distribution
 * Returns dynamic thresholds object
 */
function _computePercentileThresholds(scores) {
  if (!scores || scores.length === 0) {
    // Fallback to static defaults
    return { ...RISKY_CONFIG.THRESHOLDS };
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const n = sorted.length;

  // Percentile helper
  const percentile = (p) => {
    if (n === 0) return 0;
    const idx = Math.floor(p * (n - 1));
    return sorted[Math.max(0, Math.min(idx, n - 1))];
  };

  return {
    EXTREME: percentile(0.90),  // Top 10% riskiest
    HIGH: percentile(0.70),     // Next 20% (70th-90th)
    MEDIUM: percentile(0.40),   // Next 30% (40th-70th)
    LOW: 0                      // Bottom 40%
  };
}

/**
 * Load thresholds from Risk_Config sheet (semi-dynamic option)
 * Falls back to static config if sheet doesn't exist
 */
function _loadRiskThresholdsFromSheet(spreadsheet) {
  try {
    const sheet = spreadsheet.getSheetByName('Risk_Config');
    if (!sheet) {
      Logger.log('[_loadRiskThresholdsFromSheet] Risk_Config sheet not found, using defaults');
      return { ...RISKY_CONFIG.THRESHOLDS };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { ...RISKY_CONFIG.THRESHOLDS };

    const headers = _createHeaderMapRobust(data[0]);
    const tierCol = headers['tier'];
    const valueCol = headers['threshold'];

    if (tierCol === undefined || valueCol === undefined) {
      Logger.log('[_loadRiskThresholdsFromSheet] Missing columns, using defaults');
      return { ...RISKY_CONFIG.THRESHOLDS };
    }

    const thresholds = { ...RISKY_CONFIG.THRESHOLDS };
    for (let i = 1; i < data.length; i++) {
      const tier = String(data[i][tierCol] || '').toUpperCase().trim();
      const val = parseFloat(data[i][valueCol]);
      if (!isNaN(val) && thresholds[tier] !== undefined) {
        thresholds[tier] = val;
        Logger.log(`[_loadRiskThresholdsFromSheet] Loaded ${tier}: ${val}`);
      }
    }
    return thresholds;
  } catch (e) {
    Logger.log(`[_loadRiskThresholdsFromSheet] Error: ${e.message}, using defaults`);
    return { ...RISKY_CONFIG.THRESHOLDS };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// FULL SPECTRUM REPORT
// ═══════════════════════════════════════════════════════════════════════════════

function _generateFullSpectrumReport(spreadsheet, stats, metrics) {
  const FUNC_NAME = '_generateFullSpectrumReport';
  const NUM_COLS = 12;

  const padRow = (arr) => {
    const row = Array.isArray(arr) ? arr : [arr];
    while (row.length < NUM_COLS) row.push('');
    return row.slice(0, NUM_COLS);
  };

  let reportSheet = spreadsheet.getSheetByName('Full_Spectrum_Analysis');
  if (reportSheet) spreadsheet.deleteSheet(reportSheet);
  reportSheet = spreadsheet.insertSheet('Full_Spectrum_Analysis');

  const rows = [];

  // Header
  rows.push(padRow(['🌐 FULL SPECTRUM ANALYSIS - ALL GAMES (V7)']));
  rows.push(padRow([`Generated: ${new Date().toLocaleString()}`]));
  rows.push(padRow(['']));

  // Configuration - UPDATED FOR DYNAMIC THRESHOLDS
  rows.push(padRow(['═══ ⚙️ CONFIGURATION (DYNAMIC TIERS) ═══']));
  rows.push(padRow(['Tier', 'Score Range', 'Strategy', 'Distribution']));
  rows.push(padRow(['EXTREME', `≥ ${metrics.dynamicThresholds.EXTREME.toFixed(1)}`, RISKY_CONFIG.STRATEGY.EXTREME, 'Top 10% riskiest']));
  rows.push(padRow(['HIGH', `${metrics.dynamicThresholds.HIGH.toFixed(1)}-${(metrics.dynamicThresholds.EXTREME - 0.1).toFixed(1)}`, RISKY_CONFIG.STRATEGY.HIGH, 'P70-P90 (20%)']));
  rows.push(padRow(['MEDIUM', `${metrics.dynamicThresholds.MEDIUM.toFixed(1)}-${(metrics.dynamicThresholds.HIGH - 0.1).toFixed(1)}`, RISKY_CONFIG.STRATEGY.MEDIUM, 'P40-P70 (30%)']));
  rows.push(padRow(['LOW', `< ${metrics.dynamicThresholds.MEDIUM.toFixed(1)}`, RISKY_CONFIG.STRATEGY.LOW, 'Bottom 40%']));
  rows.push(padRow(['']));

  // Overall Stats
  rows.push(padRow(['═══ 📊 OVERALL STATISTICS ═══']));
  rows.push(padRow(['Metric', 'Value']));
  rows.push(padRow(['Total Games', stats.totalGames]));
  rows.push(padRow(['Games Analyzed', stats.totalAnalyzed]));
  rows.push(padRow(['Games with Results', stats.gamesWithResults]));
  rows.push(padRow(['']));
  rows.push(padRow(['By Original Label:']));
  rows.push(padRow(['  RISKY Games', stats.riskyLabelCount]));
  rows.push(padRow(['  HOME Games', stats.homeLabelCount]));
  rows.push(padRow(['  AWAY Games', stats.awayLabelCount]));
  rows.push(padRow(['']));

  // Strategy Comparison
  rows.push(padRow(['═══ 🆚 STRATEGY COMPARISON ═══']));
  rows.push(padRow(['Strategy', 'Wins', 'Losses', 'Total', 'Success Rate', 'vs Break-Even']));

  const againstVsBE = (parseFloat(metrics.againstSuccessRate) - RISKY_CONFIG.BREAKEVEN_RATE).toFixed(1);
  const withVsBE = (parseFloat(metrics.withSuccessRate) - RISKY_CONFIG.BREAKEVEN_RATE).toFixed(1);
  const dualVsBE = (parseFloat(metrics.dualSuccessRate) - RISKY_CONFIG.BREAKEVEN_RATE).toFixed(1);

  rows.push(padRow([
    'Always Against Forebet',
    stats.againstForebetWins,
    stats.againstForebetLosses,
    stats.againstForebetWins + stats.againstForebetLosses,
    `${metrics.againstSuccessRate}%`,
    `${parseFloat(againstVsBE) > 0 ? '+' : ''}${againstVsBE}%`
  ]));

  rows.push(padRow([
    'Always With Forebet',
    stats.withForebetWins,
    stats.withForebetLosses,
    stats.withForebetWins + stats.withForebetLosses,
    `${metrics.withSuccessRate}%`,
    `${parseFloat(withVsBE) > 0 ? '+' : ''}${withVsBE}%`
  ]));

  rows.push(padRow([
    '🎯 DUAL STRATEGY',
    stats.dualStrategy.wins,
    stats.dualStrategy.losses,
    stats.dualStrategy.totalBets,
    `${metrics.dualSuccessRate}%`,
    `${parseFloat(dualVsBE) > 0 ? '+' : ''}${dualVsBE}%`
  ]));

  rows.push(padRow(['']));

  // By Original Label
  rows.push(padRow(['═══ 📋 PERFORMANCE BY ORIGINAL LABEL ═══']));
  rows.push(padRow(['Label', 'Games', 'Results', 'Against FB', 'Against %', 'With FB', 'With %', 'Dual', 'Dual %']));

  for (const label of ['RISKY', 'HOME', 'AWAY']) {
    const m = metrics.labelMetrics[label];
    if (!m || m.count === 0) continue;

    const dualTotal = m.dualWins + m.dualLosses;
    rows.push(padRow([
      label,
      m.count,
      m.withResults,
      `${m.againstWins}W-${m.againstLosses}L`,
      `${m.againstRate}%`,
      `${m.withWins}W-${m.withLosses}L`,
      `${m.withRate}%`,
      `${m.dualWins}W-${m.dualLosses}L`,
      `${m.dualRate}%`
    ]));
  }

  rows.push(padRow(['']));

  // By Tier
  rows.push(padRow(['═══ 🎯 PERFORMANCE BY RISKINESS TIER ═══']));
  rows.push(padRow(['Tier', 'Strategy', 'Games', 'Results', 'Against FB', 'Against %', 'With FB', 'With %', 'Dual', 'Dual %']));

  const tierOrder = ['EXTREME', 'HIGH', 'MEDIUM', 'LOW'];
  for (const tier of tierOrder) {
    const m = metrics.tierMetrics[tier];
    rows.push(padRow([
      tier,
      m.strategy,
      m.count,
      m.withResults,
      `${m.againstWins}W-${m.againstLosses}L`,
      `${m.againstRate}%`,
      `${m.withWins}W-${m.withLosses}L`,
      `${m.withRate}%`,
      `${m.dualWins}W-${m.dualLosses}L`,
      `${m.dualRate}%`
    ]));
  }

  rows.push(padRow(['']));

  // Key Insights
  rows.push(padRow(['═══ 💡 KEY INSIGHTS ═══']));

  // Check if dual strategy beats alternatives
  const dualRate = parseFloat(metrics.dualSuccessRate) || 0;
  const againstRate = parseFloat(metrics.againstSuccessRate) || 0;
  const withRate = parseFloat(metrics.withSuccessRate) || 0;

  if (dualRate > againstRate && dualRate > withRate) {
    rows.push(padRow([`🏆 DUAL STRATEGY IS BEST: ${metrics.dualSuccessRate}% success!`]));
    rows.push(padRow([`   Beats "Always Against FB" by +${(dualRate - againstRate).toFixed(1)}%`]));
    rows.push(padRow([`   Beats "Always With FB" by +${(dualRate - withRate).toFixed(1)}%`]));
  } else if (againstRate > withRate) {
    rows.push(padRow([`📊 "Always Against FB" currently leading at ${metrics.againstSuccessRate}%`]));
  } else {
    rows.push(padRow([`📊 "Always With FB" currently leading at ${metrics.withSuccessRate}%`]));
  }

  rows.push(padRow(['']));

  // Validate tier strategies
  rows.push(padRow(['TIER STRATEGY VALIDATION:']));
  for (const tier of tierOrder) {
    const m = metrics.tierMetrics[tier];
    const decided = m.againstWins + m.againstLosses;
    if (decided < 2) {
      rows.push(padRow([`• ${tier}: Need more data (${decided} games)`]));
      continue;
    }

    const againstRateNum = parseFloat(m.againstRate) || 0;
    const withRateNum = parseFloat(m.withRate) || 0;
    const currentStrategy = m.strategy;

    let optimal = againstRateNum > withRateNum ? 'AGAINST_FOREBET' : 'WITH_FOREBET';
    let optimalRate = againstRateNum > withRateNum ? againstRateNum : withRateNum;

    if (currentStrategy === optimal) {
      rows.push(padRow([`✅ ${tier}: Strategy CORRECT (${currentStrategy} @ ${optimalRate}%)`]));
    } else {
      rows.push(padRow([`⚠️ ${tier}: Consider switching to ${optimal} (${optimalRate}% vs current ${currentStrategy === 'AGAINST_FOREBET' ? againstRateNum : withRateNum}%)`]));
    }
  }

  rows.push(padRow(['']));

  // Dynamic Thresholds Info
  rows.push(padRow(['═══ 📈 DYNAMIC THRESHOLD INFO ═══']));
  rows.push(padRow([`Score Range in Dataset: ${metrics.scoreRange?.min?.toFixed(1) || 'N/A'} - ${metrics.scoreRange?.max?.toFixed(1) || 'N/A'}`]));
  rows.push(padRow([`P40 (MEDIUM threshold): ${metrics.dynamicThresholds.MEDIUM.toFixed(1)}`]));
  rows.push(padRow([`P70 (HIGH threshold): ${metrics.dynamicThresholds.HIGH.toFixed(1)}`]));
  rows.push(padRow([`P90 (EXTREME threshold): ${metrics.dynamicThresholds.EXTREME.toFixed(1)}`]));
  rows.push(padRow(['']));

  // Individual Games (limited)
  if (stats.gameDetails.length > 0 && stats.gameDetails.length <= 150) {
    rows.push(padRow(['═══ INDIVIDUAL GAME RESULTS (sorted by riskiness) ═══']));
    rows.push(padRow(['League', 'Home', 'Away', 'Score', 'Label', 'Forebet', 'Action', 'Result', 'Risk Score', 'Tier']));

    const sortedGames = [...stats.gameDetails].sort((a, b) => b.riskinessScore - a.riskinessScore);

    for (const game of sortedGames) {
      const actionStr = game.recommendedAction === 'AGAINST_FOREBET' ? 'vs FB' :
                       game.recommendedAction === 'WITH_FOREBET' ? 'w/ FB' : 'SKIP';
      const resultStr = game.dualWon === true ? '✅ WIN' :
                       game.dualWon === false ? '❌ LOSS' : '⏭️ SKIP';
      
      rows.push(padRow([
        game.league,
        game.home,
        game.away,
        `${game.homeScore}-${game.awayScore}`,
        game.magPredLabel,
        game.forebetPred === 1 ? 'Home' : 'Away',
        actionStr,
        resultStr,
        game.riskinessScore.toFixed(1),
        game.riskinessTier
      ]));
    }
  }

  // Write to sheet
  if (rows.length > 0) {
    reportSheet.getRange(1, 1, rows.length, NUM_COLS).setValues(rows);
  }

  // Formatting
  reportSheet.getRange(1, 1, 1, NUM_COLS).merge()
    .setFontWeight('bold').setFontSize(16)
    .setBackground('#1565c0').setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).includes('═══')) {
      reportSheet.getRange(i + 1, 1, 1, NUM_COLS).merge()
        .setFontWeight('bold').setFontSize(12)
        .setBackground('#1976d2').setFontColor('#ffffff');
    }
  }

  // Highlight dual strategy row
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).includes('DUAL STRATEGY')) {
      reportSheet.getRange(i + 1, 1, 1, NUM_COLS)
        .setBackground('#bbdefb').setFontWeight('bold');
    }
  }

  // Color tiers and rates
  const tierColors = { 'EXTREME': '#ff6b6b', 'HIGH': '#ffa726', 'MEDIUM': '#fff176', 'LOW': '#81c784' };

  for (let i = 0; i < rows.length; i++) {
    const firstCell = rows[i][0];
    if (tierColors[firstCell]) {
      reportSheet.getRange(i + 1, 1).setBackground(tierColors[firstCell]).setFontWeight('bold');
    }

    // Color percentage cells
    for (let col = 1; col <= NUM_COLS; col++) {
      const val = String(rows[i][col - 1] || '');
      if (val.endsWith('%') && !val.includes('N/A') && !val.includes('+') && !val.includes('-')) {
        const rate = parseFloat(val.replace('%', ''));
        if (!isNaN(rate) && rate > 0) {
          const cell = reportSheet.getRange(i + 1, col);
          if (rate >= 70) cell.setBackground('#b7e1cd').setFontWeight('bold');
          else if (rate >= 55) cell.setBackground('#c8e6c9');
          else if (rate >= 45) cell.setBackground('#fff9c4');
          else cell.setBackground('#ffcdd2');
        }
      }
    }

    // Color result cells
    const resultIdx = rows[i].findIndex(v => String(v).includes('WIN') || String(v).includes('LOSS') || String(v).includes('SKIP'));
    if (resultIdx >= 0) {
      const resultVal = String(rows[i][resultIdx]);
      const cell = reportSheet.getRange(i + 1, resultIdx + 1);
      if (resultVal.includes('WIN')) cell.setBackground('#c8e6c9');
      else if (resultVal.includes('LOSS')) cell.setBackground('#ffcdd2');
      else if (resultVal.includes('SKIP')) cell.setBackground('#e0e0e0');
    }

    // Color tier column in game rows
    const tierVal = rows[i][9];
    if (tierColors[tierVal]) {
      reportSheet.getRange(i + 1, 10).setBackground(tierColors[tierVal]);
    }

    // Color label column
    const labelVal = rows[i][4];
    const labelColors = { 'RISKY': '#fff3e0', 'HOME': '#e3f2fd', 'AWAY': '#fce4ec' };
    if (labelColors[labelVal]) {
      reportSheet.getRange(i + 1, 5).setBackground(labelColors[labelVal]);
    }
  }

  reportSheet.autoResizeColumns(1, NUM_COLS);
  reportSheet.setFrozenRows(1);

  Logger.log(`[${FUNC_NAME}] ✅ Full Spectrum report generated with ${rows.length} rows`);
}


// ═══════════════════════════════════════════════════════════════════════════════
// OTHER REPORT GENERATORS (Dual Strategy, Levels, Basic)
// ═══════════════════════════════════════════════════════════════════════════════

function _generateDualStrategyReport(spreadsheet, stats, metrics) {
  const FUNC_NAME = '_generateDualStrategyReport';
  const NUM_COLS = 10;
  
  const padRow = (arr) => {
    const row = Array.isArray(arr) ? arr : [arr];
    while (row.length < NUM_COLS) row.push('');
    return row.slice(0, NUM_COLS);
  };

  let reportSheet = spreadsheet.getSheetByName('Risky_Dual_Strategy');
  if (reportSheet) spreadsheet.deleteSheet(reportSheet);
  reportSheet = spreadsheet.insertSheet('Risky_Dual_Strategy');

  const rows = [];

  rows.push(padRow(['🎯 RISKY DUAL STRATEGY ANALYSIS (V7)']));
  rows.push(padRow([`Generated: ${new Date().toLocaleString()}`]));
  rows.push(padRow(['']));

  rows.push(padRow(['═══ STRATEGY COMPARISON ═══']));
  rows.push(padRow(['Strategy', 'Wins', 'Losses', 'Success Rate']));
  rows.push(padRow(['Always Against FB', stats.againstForebetWins, stats.againstForebetLosses, `${metrics.againstSuccessRate}%`]));
  rows.push(padRow(['🎯 DUAL STRATEGY', stats.dualStrategy.wins, stats.dualStrategy.losses, `${metrics.dualSuccessRate}%`]));
  rows.push(padRow(['']));

  rows.push(padRow(['═══ BY TIER ═══']));
  rows.push(padRow(['Tier', 'Strategy', 'Games', 'Against %', 'With %', 'Dual %']));

  for (const tier of ['EXTREME', 'HIGH', 'MEDIUM', 'LOW']) {
    const m = metrics.tierMetrics[tier];
    rows.push(padRow([tier, m.strategy, m.count, `${m.againstRate}%`, `${m.withRate}%`, `${m.dualRate}%`]));
  }

  if (rows.length > 0) {
    reportSheet.getRange(1, 1, rows.length, NUM_COLS).setValues(rows);
  }

  reportSheet.getRange(1, 1, 1, NUM_COLS).merge()
    .setFontWeight('bold').setFontSize(16)
    .setBackground('#6a1b9a').setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).includes('═══')) {
      reportSheet.getRange(i + 1, 1, 1, NUM_COLS).merge()
        .setFontWeight('bold').setFontSize(12)
        .setBackground('#9c27b0').setFontColor('#ffffff');
    }
  }

  reportSheet.autoResizeColumns(1, NUM_COLS);
  Logger.log(`[${FUNC_NAME}] ✅ Dual Strategy report generated`);
}

function _generateRiskyLevelsReport(spreadsheet, stats, metrics) {
  const FUNC_NAME = '_generateRiskyLevelsReport';
  const NUM_COLS = 10;
  
  const padRow = (arr) => {
    const row = Array.isArray(arr) ? arr : [arr];
    while (row.length < NUM_COLS) row.push('');
    return row.slice(0, NUM_COLS);
  };

  let reportSheet = spreadsheet.getSheetByName('Risky_Bets_Levels');
  if (reportSheet) spreadsheet.deleteSheet(reportSheet);
  reportSheet = spreadsheet.insertSheet('Risky_Bets_Levels');

  const rows = [];

  rows.push(padRow(['📊 RISKY BETS WITH LEVELS (V7)']));
  rows.push(padRow([`Generated: ${new Date().toLocaleString()}`]));
  rows.push(padRow(['']));

  rows.push(padRow(['═══ TIER PERFORMANCE ═══']));
  rows.push(padRow(['Tier', 'Games', 'Results', 'Against FB', 'Against %', 'With FB', 'With %']));

  for (const tier of ['EXTREME', 'HIGH', 'MEDIUM', 'LOW']) {
    const m = metrics.tierMetrics[tier];
    rows.push(padRow([
      tier, m.count, m.withResults,
      `${m.againstWins}W-${m.againstLosses}L`, `${m.againstRate}%`,
      `${m.withWins}W-${m.withLosses}L`, `${m.withRate}%`
    ]));
  }

  if (rows.length > 0) {
    reportSheet.getRange(1, 1, rows.length, NUM_COLS).setValues(rows);
  }

  reportSheet.getRange(1, 1, 1, NUM_COLS).merge()
    .setFontWeight('bold').setFontSize(16)
    .setBackground('#1a73e8').setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  reportSheet.autoResizeColumns(1, NUM_COLS);
  Logger.log(`[${FUNC_NAME}] ✅ Levels report generated`);
}

function _generateBasicReport(spreadsheet, stats, metrics) {
  const FUNC_NAME = '_generateBasicReport';
  const NUM_COLS = 6;
  
  const padRow = (arr) => {
    const row = Array.isArray(arr) ? arr : [arr];
    while (row.length < NUM_COLS) row.push('');
    return row.slice(0, NUM_COLS);
  };

  let reportSheet = spreadsheet.getSheetByName('Risky_Bets_Analysis');
  if (reportSheet) spreadsheet.deleteSheet(reportSheet);
  reportSheet = spreadsheet.insertSheet('Risky_Bets_Analysis');

  const rows = [];

  rows.push(padRow(['🔍 RISKY BETS BASIC ANALYSIS (V7)']));
  rows.push(padRow([`Generated: ${new Date().toLocaleString()}`]));
  rows.push(padRow(['']));

  rows.push(padRow(['═══ RESULTS ═══']));
  rows.push(padRow(['Metric', 'Value']));
  rows.push(padRow(['RISKY Games', stats.totalAnalyzed]));
  rows.push(padRow(['With Results', stats.gamesWithResults]));
  rows.push(padRow(['Against FB Wins', stats.againstForebetWins]));
  rows.push(padRow(['Against FB Losses', stats.againstForebetLosses]));
  rows.push(padRow(['Success Rate', `${metrics.againstSuccessRate}%`]));

  if (rows.length > 0) {
    reportSheet.getRange(1, 1, rows.length, NUM_COLS).setValues(rows);
  }

  reportSheet.getRange(1, 1, 1, NUM_COLS).merge()
    .setFontWeight('bold').setFontSize(16)
    .setBackground('#1a73e8').setFontColor('#ffffff')
    .setHorizontalAlignment('center');

  reportSheet.autoResizeColumns(1, NUM_COLS);
  Logger.log(`[${FUNC_NAME}] ✅ Basic report generated`);
}


// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

function _buildFullSpectrumSummary(stats, metrics) {
  let text = '🌐 FULL SPECTRUM ANALYSIS\n\n';
  
  text += `Games Analyzed: ${stats.totalAnalyzed}\n`;
  text += `(RISKY: ${stats.riskyLabelCount}, HOME: ${stats.homeLabelCount}, AWAY: ${stats.awayLabelCount})\n\n`;
  
  text += 'STRATEGY COMPARISON:\n';
  text += `• Always Against FB: ${metrics.againstSuccessRate}%\n`;
  text += `• Always With FB: ${metrics.withSuccessRate}%\n`;
  text += `• DUAL STRATEGY: ${metrics.dualSuccessRate}%\n\n`;
  
  const dualRate = parseFloat(metrics.dualSuccessRate) || 0;
  const againstRate = parseFloat(metrics.againstSuccessRate) || 0;
  
  if (dualRate > againstRate) {
    text += `🏆 Dual Strategy wins by +${(dualRate - againstRate).toFixed(1)}%!`;
  } else {
    text += `📊 Against FB currently leads.`;
  }
  
  text += '\n\nSee Full_Spectrum_Analysis sheet.';
  
  return text;
}

function _buildDualStrategySummary(stats, metrics) {
  let text = '🎯 DUAL STRATEGY ANALYSIS\n\n';
  text += `Against FB: ${stats.againstForebetWins}W-${stats.againstForebetLosses}L (${metrics.againstSuccessRate}%)\n`;
  text += `DUAL: ${stats.dualStrategy.wins}W-${stats.dualStrategy.losses}L (${metrics.dualSuccessRate}%)\n\n`;
  text += 'See Risky_Dual_Strategy sheet.';
  return text;
}

function _buildLevelsSummary(stats, metrics) {
  let text = '📊 ANALYSIS WITH LEVELS\n\n';
  text += `RISKY Games: ${stats.totalAnalyzed}\n`;
  text += `Against FB: ${metrics.againstSuccessRate}%\n\n`;
  text += 'BY TIER:\n';
  for (const tier of ['EXTREME', 'HIGH', 'MEDIUM', 'LOW']) {
    const m = metrics.tierMetrics[tier];
    text += `• ${tier}: Against ${m.againstRate}%, With ${m.withRate}%\n`;
  }
  return text;
}

function _buildBasicSummary(stats, metrics) {
  let text = '🔍 BASIC ANALYSIS\n\n';
  text += `RISKY Games: ${stats.totalAnalyzed}\n`;
  text += `Record: ${stats.againstForebetWins}W-${stats.againstForebetLosses}L\n`;
  text += `Success Rate: ${metrics.againstSuccessRate}%`;
  return text;
}


// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function _safeParseFloat(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

function _normalizeTeamName(teamName) {
  return String(teamName || '')
    .toLowerCase().trim()
    .replace(/\bfc\b/gi, '').replace(/\bsc\b/gi, '').replace(/\bac\b/gi, '')
    .replace(/\bw$/gi, '').replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}


/**
 * ═══════════════════════════════════════════════════════════════════════════
 * _normalizeDateForKey — CONSOLIDATED PATCH (v6.2.1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Returns YYYYMMDD string for use in BetID / ResultID / segment keys.
 *
 * Fixes applied:
 *  1. Serial dates: Math.floor (not Math.round) — prevents day rollover
 *     from time fractions like 45200.75
 *  2. Serial lower bound raised to 366 — rejects time-only fractions
 *     (0.0–1.0) and tiny stray numbers without rejecting valid old dates
 *  3. Serial upper bound extended to 75000 (~year 2105)
 *  4. Serial conversion uses UTC epoch + getUTC* — immune to DST/TZ drift
 *  5. Date objects formatted via Utilities.formatDate with explicit TZ
 *  6. String parsing: DD/MM/YYYY, YYYY-MM-DD, YYYYMMDD (compact)
 *  7. NO MM/DD/YYYY fallback — eliminates silent day/month flip
 *  8. Calendar validity check — rejects impossible dates (Feb 30, etc.)
 *  9. Numeric strings ("45200.5") fall through to serial handler
 * 10. Optional tz param — pass ss.getSpreadsheetTimeZone() when available
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
// ═══════════════════════════════════════════════════════════════════════════════
// _normalizeDateForKey — Single authoritative definition
//
// Converts any date-like value (Date object, string, Sheets serial number)
// into a stable "YYYYMMDD" string key suitable for lookups and sorting.
//
// Design principles:
//   • Explicit timezone via Utilities.formatDate — no local-TZ surprises
//   • UTC-based serial conversion with Math.floor — no off-by-one from rounding
//   • Round-trip validation rejects impossible dates (Feb 30, Apr 31, etc.)
//   • Backward-compatible: callers passing only (dateValue) get script TZ
//
// @param  {Date|string|number} dateValue  The value to normalize
// @param  {string}             [tz]       IANA timezone (default: script TZ)
// @return {string}                        "YYYYMMDD" or '' on failure
// ═══════════════════════════════════════════════════════════════════════════════

function _normalizeDateForKey(dateValue, tz) {
  if (dateValue === null || dateValue === undefined || dateValue === '') return '';

  const timeZone = tz || Session.getScriptTimeZone();

  // ── Helper: zero-pad to 2 digits ─────────────────────────────────────────
  const pad2 = function (n) {
    return String(n).padStart(2, '0');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Helper: validate Y/M/D parts and return "YYYYMMDD" or ''
  //
  // Constructs a UTC Date, then checks that the components round-trip.
  // This catches impossible dates like Feb 30, Apr 31, etc. where
  // the Date constructor silently rolls forward.
  // ═══════════════════════════════════════════════════════════════════════════
  function _ymdKey(y, m, d) {
    y = +y;
    m = +m;
    d = +d;

    // Coarse range checks
    if (y < 1900 || y > 2105) return '';
    if (m < 1    || m > 12)   return '';
    if (d < 1    || d > 31)   return '';

    // Build UTC date and verify round-trip
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear()  !== y ||
        (dt.getUTCMonth() + 1) !== m ||
        dt.getUTCDate()      !== d) {
      return '';  // e.g. Feb 30 → rolled to Mar 2 → mismatch → reject
    }

    return '' + y + pad2(m) + pad2(d);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1) Date object → format in explicit timezone
  //
  //    Using Utilities.formatDate avoids the bug where
  //    getFullYear()/getDate() use the runtime's local TZ rules
  //    and produce "previous day" keys around midnight/DST boundaries.
  // ═══════════════════════════════════════════════════════════════════════════
  if (dateValue instanceof Date) {
    if (!isFinite(dateValue.getTime())) return '';
    return Utilities.formatDate(dateValue, timeZone, 'yyyyMMdd');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2) String inputs — try known formats, then fall through
  // ═══════════════════════════════════════════════════════════════════════════
  if (typeof dateValue === 'string') {
    var str = dateValue.trim();
    var parts;

    // ── DD/MM/YYYY or D/M/YYYY ──────────────────────────────────────────
    parts = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (parts) {
      var key1 = _ymdKey(parts[3], parts[2], parts[1]);
      if (key1) return key1;
    }

    // ── YYYY-MM-DD ──────────────────────────────────────────────────────
    parts = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (parts) {
      var key2 = _ymdKey(parts[1], parts[2], parts[3]);
      if (key2) return key2;
    }

    // ── YYYYMMDD (compact — already a key, but validate it) ─────────────
    parts = str.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (parts) {
      var key3 = _ymdKey(parts[1], parts[2], parts[3]);
      if (key3) return key3;
    }

    // ── Numeric string that looks like a serial date ────────────────────
    //    e.g. "45200" or "45200.75" — convert to number, fall through
    //    to the serial handler below
    if (/^\d+(\.\d+)?$/.test(str)) {
      var asNum = Number(str);
      if (isFinite(asNum) && asNum > 365 && asNum < 75000) {
        dateValue = asNum;
        // fall through to serial handler (section 3)
      } else {
        // Not a plausible serial — last resort: extract up to 8 digits
        var digits = str.replace(/\D/g, '');
        return digits.substring(0, 8);
      }
    } else {
      // Unrecognised format — extract up to 8 digits as best-effort key
      var fallbackDigits = str.replace(/\D/g, '');
      return fallbackDigits.substring(0, 8);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3) Sheets serial date number
  //
  //    Sheets epoch: 1899-12-30 (day 0)
  //    Integer part  = calendar day
  //    Fractional part = time of day (irrelevant for a date key)
  //
  //    CRITICAL: use Math.floor, NOT Math.round
  //    Math.round(45200.75 * msPerDay) rolls into the NEXT day.
  //    We want the calendar day, so strip the fraction first.
  //
  //    Lower bound 366 rejects:
  //      - time-only fractions (0.0–1.0)
  //      - stray small numbers
  //    Upper bound 75000 covers through ~year 2105.
  //
  //    Conversion uses UTC epoch + getUTC* so DST/timezone
  //    can never shift the resulting key by ±1 day.
  // ═══════════════════════════════════════════════════════════════════════════
  if (typeof dateValue === 'number' && isFinite(dateValue) &&
      dateValue > 365 && dateValue < 75000) {

    var msPerDay          = 86400000;
    var sheetsEpochUtcMs  = Date.UTC(1899, 11, 30);  // 1899-12-30 00:00 UTC

    // Strip fractional day; epsilon guards against 45200.9999999999
    var wholeDays = Math.floor(dateValue + 1e-9);

    var dt  = new Date(sheetsEpochUtcMs + wholeDays * msPerDay);
    var sy  = dt.getUTCFullYear();
    var smo = dt.getUTCMonth() + 1;
    var sd  = dt.getUTCDate();

    return '' + sy + pad2(smo) + pad2(sd);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4) Last resort — extract up to 8 digits to preserve some sort ordering
  // ═══════════════════════════════════════════════════════════════════════════
  var lastResort = String(dateValue).replace(/\D/g, '');
  return lastResort.substring(0, 8);
}

function _formatDateForDisplay(dateValue) {
  if (!dateValue) return '';
  if (dateValue instanceof Date) {
    if (isNaN(dateValue.getTime())) return '';
    return Utilities.formatDate(dateValue, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  if (typeof dateValue === 'number' && dateValue > 40000 && dateValue < 60000) {
    const msPerDay = 86400000;
    const sheetsEpoch = new Date(1899, 11, 30);
    const dateObj = new Date(sheetsEpoch.getTime() + Math.round(dateValue * msPerDay));
    return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  }
  return String(dateValue).trim();
}

function _findSheetByNameFuzzy(spreadsheet, targetName) {
  if (!spreadsheet || !targetName) return null;
  const targetLower = targetName.toLowerCase().trim();
  const sheets = spreadsheet.getSheets();
  for (const sheet of sheets) {
    if (sheet.getName().toLowerCase().trim() === targetLower) return sheet;
  }
  for (const sheet of sheets) {
    const name = sheet.getName().toLowerCase().trim();
    if (name.includes(targetLower) || targetLower.includes(name)) return sheet;
  }
  return null;
}

function _createHeaderMapRobust(headerRow) {
  const map = {};
  const aliases = {
    'league': ['league', 'competition', 'tournament', 'leaguename', 'league name'],
    'league name': ['league name', 'leaguename', 'name'],
    'file url': ['file url', 'fileurl', 'url', 'link', 'file_url'],
    'status': ['status', 'active', 'enabled'],
    'date': ['date', 'game date', 'match date', 'gamedate'],
    'home': ['home', 'home team', 'hometeam', 'home_team', 'team1'],
    'away': ['away', 'away team', 'awayteam', 'away_team', 'team2'],
    'ft score': ['ft score', 'ftscore', 'ft_score', 'final score', 'score', 'result'],
    'magolide pred': ['magolide pred', 'magolide_pred', 'pred', 'prediction', 'ma golide pred'],
    'forebet pred': ['forebet pred', 'forebet_pred', 'forebet prediction', 'fb pred', 'fbpred'],
    'confidence %': ['confidence %', 'confidence', 'conf %', 'conf'],
    'confidence': ['confidence', 'confidence %', 'conf'],
    'magolide score': ['magolide score', 'mag score', 'magscore', 'ma golide score'],
    'forebet %': ['forebet %', 'forebet', 'fb %', 'fb'],
    'forebet': ['forebet', 'forebet %', 'fb'],
    'variance penalty': ['variance penalty', 'variance', 'var penalty', 'var'],
    'pct diff': ['pct diff', 'pctdiff', 'pct_diff', '% diff', 'percent diff'],
    'netrtg diff': ['netrtg diff', 'netrtgdiff', 'net rtg diff', 'netrating diff', 'net diff']
  };

  for (let i = 0; i < headerRow.length; i++) {
    const rawHeader = String(headerRow[i] || '').toLowerCase().trim();
    if (!rawHeader) continue;
    map[rawHeader] = i;
    for (const [canonical, aliasList] of Object.entries(aliases)) {
      if (aliasList.includes(rawHeader)) map[canonical] = i;
    }
  }
  return map;
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

    // Women's markers / gender tokens
    s = s.replace(/\b(w|womens|women|women's|ladies|femenino|fem)\b/gi, ' ');

    // Common club affixes
    s = s.replace(/\b(fc|sc|ac|cf|cd|bk|bc|kc|sv|fk|sk)\b/gi, ' ');

    // Locale glue words
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

  // Space-collapsed (handles "obras sanitarias" vs "obrassanitarias")
  add(t1.replace(/\s+/g, '') + '|' + t2.replace(/\s+/g, ''));

  return keys;
}

function _findResultMatch(resultsMap, home, away, dateRaw) {
  const keys = _generateAllMatchKeys(home, away, dateRaw);
  for (const key of keys) {
    if (resultsMap[key]) return resultsMap[key];
  }
  const reversedKeys = _generateAllMatchKeys(away, home, dateRaw);
  for (const key of reversedKeys) {
    if (resultsMap[key]) return resultsMap[key];
  }
  return null;
}

