/**
 * ======================================================================
 * FILE: Mothership_Menu.gs
 * VERSION: 3.0.0
 * PURPOSE: SINGLE SOURCE OF TRUTH - Central Command Menu
 *          WITH MIC v3-merged + FOREBET-DETERMINISTIC integration
 *
 * INSTRUCTIONS:
 * 1. REPLACE your entire Mothership_Menu.gs with this file
 * 2. DELETE all other onOpen() functions from ALL other files
 * 3. Refresh your spreadsheet
 * ======================================================================
 */

// ============================================================
// SECTION 1: MAIN MENU BUILDER (THE ONLY onOpen IN YOUR PROJECT)
// ============================================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu('🚀 The Mother Command');

  // ─────────────────────────────────────────────────────────
  // QUICK ACTIONS (Top Level - Most Used)
  // ─────────────────────────────────────────────────────────
  menu.addItem('⚡ SYNC EVERYTHING', 'menuSyncEverything')
      .addItem('🏗️ BUILD ALL ACCAS', 'menuBuildAllAccas')
      .addItem('✅ CHECK ALL RESULTS', 'menuCheckAllResults')
      .addItem('📈 UPDATE DASHBOARD', 'menuUpdateDashboard')
      .addItem('🧠 RUN MIC PIPELINE', 'menuRunMICPipeline')
      .addSeparator();

  // ─────────────────────────────────────────────────────────
  // 1. SYNC CENTER
  // ─────────────────────────────────────────────────────────
  var syncMenu = ui.createMenu('🌐 Sync Center');
  syncMenu.addItem('🔄 Sync Everything (Bets & Results)', 'menuSyncEverything')
          .addSeparator()
          .addItem('📥 Sync Bets Only (All Leagues)', 'menuSyncAllLeagues')
          .addItem('🏁 Sync Results Only', 'menuSyncAllResults')
          .addItem('🎲 Sync Risky Bets Only', 'menuSyncRiskyBets')
          .addSeparator()
          .addItem('📊 View Sync Status', 'menuViewSyncStatus');
  menu.addSubMenu(syncMenu);

  // ─────────────────────────────────────────────────────────
  // 2. MAIN ACCA ENGINE
  // ─────────────────────────────────────────────────────────
  var accaMenu = ui.createMenu('🎰 Acca Engine (Main)');
  accaMenu.addItem('🏗️ Build Multi-Size Portfolio (3-12 Fold)', 'menuBuildAccumulatorPortfolio')
          .addItem('🔍 Check Acca Results', 'menuCheckAccumulatorResults')
          .addSeparator()
          .addItem('🛡️ Scan for Vulnerabilities', 'menuScanVulnerabilities')
          .addItem('🔄 Force Update Results from Sheet', 'menuForceUpdateResults');
  menu.addSubMenu(accaMenu);

  // ─────────────────────────────────────────────────────────
  // 3. LEFTOVER SYSTEM
  // ─────────────────────────────────────────────────────────
  var leftoverMenu = ui.createMenu('♻️ Leftover System');
  leftoverMenu.addItem('🧹 Process Leftover Bets', 'menuRunLeftoverProcessing')
              .addItem('🔍 Check Leftover Results', 'menuCheckLeftoverResults');
  menu.addSubMenu(leftoverMenu);

  // ─────────────────────────────────────────────────────────
  // 4. RISKY STRATEGIES
  // ─────────────────────────────────────────────────────────
  var riskyMenu = ui.createMenu('🎲 Risky Strategies');
  riskyMenu.addItem('🔮 Build Risky Accumulators', 'menuBuildRiskyAccumulators')
           .addItem('📊 View Pending Risky Bets', 'menuViewPendingRiskyBets')
           .addSeparator()
           .addItem('🔍 Check Risky Acca Results', 'menuCheckRiskyResults')
           .addItem('📈 Risky Performance Analysis', 'menuAnalyzeRiskyPerformance');
  menu.addSubMenu(riskyMenu);

  // ─────────────────────────────────────────────────────────
  // 5. 🧠 MIC - MEMORY INTELLIGENCE CENTER (v3-merged)
  // ─────────────────────────────────────────────────────────
  var micMenu = ui.createMenu('🧠 MIC Intelligence');

  // Core Operations
  micMenu.addItem('🚀 Initialize MIC System', 'menuMIC_Initialize')
         .addItem('🔄 Run Full MIC Pipeline', 'menuRunMICPipeline')
         .addSeparator();

  // Archive Operations
  micMenu.addItem('📦 Archive Bets → Historical', 'menuMIC_ArchiveBets')
         .addItem('📦 Archive Results → Historical', 'menuMIC_ArchiveResults')
         .addItem('📊 Analyze & Learn from Performance', 'menuMIC_AnalyzePerformance')
         .addSeparator();

  // Learning & Stats
  micMenu.addItem('📈 Update Segment Stats', 'menuMIC_UpdateSegmentStats')
         .addItem('💡 Generate Insights', 'menuMIC_GenerateInsights')
         .addItem('📋 View Recent Insights', 'menuMIC_ViewRecentInsights')
         .addSeparator();

  // Backtesting & Tuning (v3-merged)
  micMenu.addItem('🧪 Run Shadow Backtest', 'menuMIC_RunShadowBacktest')
         .addItem('🎛️ Auto-Tune (Recommend)', 'menuMIC_AutoTuneRecommend')
         .addItem('🎛️ Auto-Tune (Apply)', 'menuMIC_AutoTuneApply')
         .addItem('🔧 Set Ultimate Tuning Grid', 'menuMIC_SetUltimateTuningGrid')
         .addItem('🔧 Fix Missing Odds for Backtest', 'menuMIC_FixMissingOdds')
         .addSeparator();

  // Policy & Overrides
  micMenu.addItem('🔍 Filter Bets with Policy', 'menuMIC_FilterBetsWithPolicy')
         .addItem('⚙️ Show Runtime Overrides', 'menuMIC_ShowOverrides')
         .addItem('🗑️ Clear Runtime Overrides', 'menuMIC_ClearOverrides')
         .addSeparator();

  // Migration & Maintenance
  micMenu.addItem('🔧 Migrate to Scoreless ResultKey', 'menuMIC_MigratePerformanceLog');

  menu.addSubMenu(micMenu);

  // ─────────────────────────────────────────────────────────
  // 6. ANALYTICS LAB
  // ─────────────────────────────────────────────────────────
  var analysisMenu = ui.createMenu('📊 Analytics Lab');
  analysisMenu.addItem('📋 Full Bet Performance Report', 'menuAnalyzeBetPerformance')
              .addItem('🏆 League Performance Ranking', 'menuGenerateLeagueReport')
              .addSeparator()
              .addItem('🌐 Full Spectrum Analysis', 'menuFullSpectrumAnalysis')
              .addItem('🎯 SNIPER DIR Performance', 'menuSniperDirPerformance')
              .addSeparator()
              .addItem('🧠 MIC Segment Analysis', 'menuMIC_SegmentAnalysis');
  menu.addSubMenu(analysisMenu);

  // ─────────────────────────────────────────────────────────
  // 7. ADMIN & DEBUG
  // ─────────────────────────────────────────────────────────
  var adminMenu = ui.createMenu('🔧 Admin & Debug');
  adminMenu.addItem('⚙️ Setup Mothership (First Run)', 'menuSetupMothership')
           .addItem('🧠 Setup MIC (First Run)', 'menuMIC_Initialize')
           .addItem('🔄 Run Full Diagnostic', 'menuRunDiagnostic')
           .addSeparator()
           .addItem('🐞 Debug: Date Pipeline', 'menuDebugDatePipeline')
           .addItem('🐞 Debug: Accuracy Metrics', 'menuDebugAccuracyMetrics')
           .addItem('🐞 Debug: Result Matching', 'menuDebugResultMatching')
           .addItem('🐞 Debug: Leftover System', 'menuDebugLeftoverSystem')
           .addItem('🐞 Debug: MIC System', 'menuMIC_Debug')
           .addSeparator()
           .addItem('⚠️ Reset All Output Sheets', 'menuResetAllSheets')
           .addItem('🗑️ Clear Sync Temp Only', 'menuClearSyncTemp');
  menu.addSubMenu(adminMenu);

  menu.addToUi();
  console.log('✅ The Mother Command menu loaded (v3.0 + MIC v3-merged + FOREBET-DETERMINISTIC)');
}


/**
 * ════════════════════════════════════════════════════════════════
 * syncEverything — Master orchestrator (v4.4 FOREBET-DETERMINISTIC)
 *
 * Calls the PATCHED syncAllLeagues, then syncAllResults.
 * No inline sync logic — delegates entirely to the patched functions.
 * ════════════════════════════════════════════════════════════════
 */
function syncEverything() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var startTime = new Date();

  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════╗');
  Logger.log('║   syncEverything — MASTER ORCHESTRATOR v4.4         ║');
  Logger.log('╚══════════════════════════════════════════════════════╝');
  Logger.log('[syncEverything] Start: ' + startTime.toLocaleString());

  try {
    ss.toast('Step 1/2: Syncing all league bets...', '🔄 Sync Everything', 5);
  } catch (_) {}

  // ── Step 1: Sync bets from all satellites → Sync_Temp ──────────────
  // This calls the PATCHED syncAllLeagues with:
  //   • Deterministic ForebetPrediction + ForebetAction
  //   • RiskTier passthrough
  //   • Full enrichment from Tier1, Tier2, OU logs
  try {
    Logger.log('[syncEverything] ── Step 1: syncAllLeagues ──');
    syncAllLeagues();
    Logger.log('[syncEverything] ✅ syncAllLeagues completed');
  } catch (e) {
    Logger.log('[syncEverything] ❌ syncAllLeagues FAILED: ' + e.message);
    Logger.log(e.stack || '');
    // Don't throw — try to continue with results sync
  }

  // ── Step 2: Sync results from all satellites → Results_Temp ────────
  try {
    ss.toast('Step 2/2: Syncing all results...', '🔄 Sync Everything', 5);
  } catch (_) {}

  try {
    Logger.log('[syncEverything] ── Step 2: syncAllResults ──');
    if (typeof syncAllResults === 'function') {
      syncAllResults();
      Logger.log('[syncEverything] ✅ syncAllResults completed');
    } else {
      Logger.log('[syncEverything] ⚠️ syncAllResults function not found — skipping');
    }
  } catch (e) {
    Logger.log('[syncEverything] ❌ syncAllResults FAILED: ' + e.message);
    Logger.log(e.stack || '');
  }

  // ── Step 3 (optional): Dashboard update ────────────────────────────
  try {
    if (typeof updateDashboard === 'function') {
      updateDashboard();
      Logger.log('[syncEverything] ✅ Dashboard updated');
    }
  } catch (e) {
    Logger.log('[syncEverything] ⚠️ Dashboard update failed (non-fatal): ' + e.message);
  }

  var elapsed = ((new Date() - startTime) / 1000).toFixed(1);
  Logger.log('[syncEverything] ✅ Complete in ' + elapsed + 's');

  try {
    ss.toast('Sync complete! (' + elapsed + 's)', '✅ Done', 5);
  } catch (_) {}
}


function menuSyncEverything() {
  // ✅ FIX: calls syncEverything() which delegates to the
  //    PATCHED syncAllLeagues (forebet-deterministic) + syncAllResults
  safeExecute('syncEverything', 'Syncing everything (v4.4)...');
}

function menuBuildAllAccas() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🏗️ Build All Accumulators',
    'This will build:\n• Main Portfolio (3-12 fold)\n• Risky Accumulators\n• Process Leftovers\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    safeExecute('buildAccumulatorPortfolio', 'Building main portfolio...');
    safeExecute('buildRiskyAccumulators', 'Building risky accumulators...');
    safeExecute('runLeftoverProcessing', 'Processing leftovers...');
    ui.alert('✅ Complete', 'All accumulators have been built!', ui.ButtonSet.OK);
  }
}

function menuCheckAllResults() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  ss.toast('Checking ALL Portfolios...', 'Result Checker', 15);
  Logger.log('========== UNIVERSAL RESULTS CHECKER ==========');

  var resultsMap = {};
  if (typeof _loadResultsTempForGrading === 'function') {
    resultsMap = _loadResultsTempForGrading(ss);
  } else if (typeof _loadResultsTemp === 'function') {
    resultsMap = _loadResultsTemp(ss);
  } else {
    ui.alert('Error', 'Result loader function not found.', ui.ButtonSet.OK);
    return;
  }

  if (!resultsMap || Object.keys(resultsMap).length === 0) {
    ui.alert('No Results', 'No results found in Results_Temp. Run "Sync Results" first.', ui.ButtonSet.OK);
    return;
  }

  var portfolios = [
    { data: 'Acca_Portfolio', result: 'Acca_Results' },
    { data: 'Blockbuster_Accas', result: 'Blockbuster_Results' },
    { data: 'Leftover_Accas', result: 'Leftover_Results' },
    { data: 'Risky_Accas', result: 'Risky_Results' },
    { data: 'Risky_Acca_Portfolio', result: 'Risky_Dual_Results' }
  ];

  var report = ' RESULTS CHECK SUMMARY\n\n';
  var totalChecked = 0;

  for (var p = 0; p < portfolios.length; p++) {
    var pf = portfolios[p];
    var sheet = ss.getSheetByName(pf.data);
    if (!sheet || sheet.getLastRow() < 2) continue;

    var stats = _gradeGenericPortfolioInline(ss, pf.data, pf.result, resultsMap);
    if (stats) {
      report += ' ' + pf.data + ':\n    ' + stats.won + 'W - ' + stats.lost + 'L - ' + stats.pending + 'P\n';
      totalChecked++;
    }
  }

  if (totalChecked === 0) report += "No active portfolios found to grade.";

  if (typeof updateDashboard === 'function') {
    try { updateDashboard(); } catch (e) {}
  }

  ss.toast('All results checked!', 'Complete', 5);
  ui.alert('Universal Check Complete', report, ui.ButtonSet.OK);
}

function _gradeGenericPortfolioInline(ss, dataSheetName, resultSheetName, resultsMap) {
  var sheet = ss.getSheetByName(dataSheetName);
  var data = sheet.getDataRange().getValues();

  var colMatch = 3, colPick = 4, colStatus = 9, colBetId = 11;
  for (var r = 0; r < Math.min(15, data.length); r++) {
    var rowStr = data[r].map(function(c) { return String(c).toLowerCase().trim(); });
    if (rowStr.indexOf('match') >= 0 && rowStr.indexOf('status') >= 0) {
      colMatch = rowStr.indexOf('match');
      colPick = rowStr.indexOf('pick') >= 0 ? rowStr.indexOf('pick') : 4;
      colStatus = rowStr.indexOf('status');
      colBetId = rowStr.indexOf('betid') >= 0 ? rowStr.indexOf('betid') : rowStr.length - 1;
      break;
    }
  }

  var accas = [];
  var currentAcca = null;

  for (var r = 0; r < data.length; r++) {
    var row = data[r];
    var cell0 = String(row[0] || '').trim();
    var cellLast = String(row[colBetId] || '').trim();

    if ((cell0.indexOf('Fold') >= 0 || cell0.indexOf('Double') >= 0 || cell0.indexOf('Single') >= 0 || cell0.indexOf('Mixed') >= 0) && cell0.indexOf('|') >= 0) {
      if (currentAcca) accas.push(currentAcca);
      currentAcca = { id: cellLast.indexOf('_') >= 0 ? cellLast : 'ACCA_' + r, name: cell0, statusRow: -1, legsTotal: 0, won: 0, lost: 0, pending: 0 };
      continue;
    }

    if (cell0 === 'ACCA STATUS:' && currentAcca) {
      currentAcca.statusRow = r + 1;
      continue;
    }

    var match = String(row[colMatch] || '').trim();
    var pick = String(row[colPick] || '').trim();

    if (match.indexOf(' vs ') >= 0 && pick && pick !== 'Pick') {
      if (currentAcca) currentAcca.legsTotal++;

      var home = '', away = '';
      if (typeof _parseMatchString === 'function') {
        var parsed = _parseMatchString(match);
        home = parsed.home; away = parsed.away;
      } else {
        var parts = match.split(/ vs | vs\. | v | @ /i);
        if (parts.length === 2) { home = parts[0].trim(); away = parts[1].trim(); }
      }

      var result = null;
      if (home && away) {
        var keys = typeof _generateAllMatchKeys === 'function' ? _generateAllMatchKeys(home, away) : [home.toLowerCase().replace(/[^\w]/g, '') + '|' + away.toLowerCase().replace(/[^\w]/g, '')];
        for (var ki = 0; ki < keys.length; ki++) {
          if (resultsMap[keys[ki]]) { result = resultsMap[keys[ki]]; break; }
        }
      }

      var grade = 'PENDING';
      if (result && result.isFinished) {
        if (typeof _gradePickDetailed === 'function') grade = _gradePickDetailed(pick, result, home, away).grade;
        else if (typeof _gradeSinglePick === 'function') grade = _gradeSinglePick(pick, result, home, away).grade;
        else grade = 'ERROR';
      }

      if (grade === 'WON') { if (currentAcca) currentAcca.won++; }
      else if (grade === 'LOST') { if (currentAcca) currentAcca.lost++; }
      else { if (currentAcca) currentAcca.pending++; grade = 'PENDING'; }

      var statusCell = sheet.getRange(r + 1, colStatus + 1);
      statusCell.setValue(grade);
      if (grade === 'WON') statusCell.setBackground('#b7e1cd').setFontColor('#0f5132').setFontWeight('bold');
      else if (grade === 'LOST') statusCell.setBackground('#f4c7c3').setFontColor('#c62828').setFontWeight('bold');
      else if (grade === 'PENDING') statusCell.setBackground('#fff3cd').setFontColor('#856404').setFontWeight('bold');
      else statusCell.setBackground('#e0e0e0').setFontColor('#666666');
    }
  }
  if (currentAcca) accas.push(currentAcca);

  var stats = { won: 0, lost: 0, pending: 0 };

  for (var a = 0; a < accas.length; a++) {
    var acca = accas[a];
    var accaStatus = 'PENDING';
    var bg = '#fff2cc', fg = '#bf9000';

    if (acca.lost > 0) { accaStatus = 'LOST'; bg = '#f4c7c3'; fg = '#c62828'; stats.lost++; }
    else if (acca.pending === 0 && acca.won > 0 && acca.won === acca.legsTotal) { accaStatus = 'WON'; bg = '#b7e1cd'; fg = '#0f5132'; stats.won++; }
    else { stats.pending++; }

    acca.finalStatus = accaStatus;
    if (acca.statusRow > 0) sheet.getRange(acca.statusRow, 2).setValue(accaStatus).setBackground(bg).setFontColor(fg).setFontWeight('bold');
  }

  var resSheet = ss.getSheetByName(resultSheetName);
  if (!resSheet) resSheet = ss.insertSheet(resultSheetName);
  resSheet.clear();

  var headers = ['Acca ID', 'Details', 'Total Legs', 'Status', 'Won', 'Lost', 'Pending', 'Result Label'];
  resSheet.getRange(1, 1, 1, headers.length).setValues([headers]).setBackground('#38761d').setFontColor('#ffffff').setFontWeight('bold');

  var outRows = accas.map(function(a) {
    return [a.id, a.name, a.legsTotal, a.finalStatus, a.won, a.lost, a.pending,
            a.finalStatus === 'WON' ? ' WIN' : (a.finalStatus === 'LOST' ? ' LOSS' : ' Pending')];
  });
  if (outRows.length > 0) {
    resSheet.getRange(2, 1, outRows.length, headers.length).setValues(outRows);
    for (var i = 0; i < outRows.length; i++) {
      var s = outRows[i][3], c = resSheet.getRange(i + 2, 4);
      if (s === 'WON') c.setBackground('#b7e1cd').setFontColor('#0f5132').setFontWeight('bold');
      else if (s === 'LOST') c.setBackground('#f4c7c3').setFontColor('#c62828').setFontWeight('bold');
      else c.setBackground('#fff2cc').setFontColor('#bf9000').setFontWeight('bold');
    }
  }
  resSheet.autoResizeColumns(1, headers.length);
  return stats;
}

function menuUpdateDashboard() {
  safeExecute('updateDashboard', 'Updating dashboard...');
}

function menuRunMICPipeline() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🧠 Run MIC Pipeline',
    'This will run the full Memory Intelligence Center pipeline:\n\n' +
    '• Archive bets from Sync_Temp\n' +
    '• Archive results from Results_Temp\n' +
    '• Analyze performance & update learning\n' +
    '• Generate insights\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    safeExecute('runMICPipeline', 'Running MIC Pipeline...');
  }
}

// ─────────────────────────────────────────────────────────
// SYNC CENTER
// ─────────────────────────────────────────────────────────

function menuSyncAllLeagues() {
  safeExecute('syncAllLeagues', 'Syncing all league bets (v4.4 FOREBET-DETERMINISTIC)...');
}

function menuSyncAllResults() {
  safeExecute('syncAllResults', 'Syncing all results...');
}

function menuSyncRiskyBets() {
  safeExecute('syncRiskyBetsToSyncTemp', 'Syncing risky bets...');
}

function menuViewSyncStatus() {
  safeExecute('viewSyncStatus', 'Loading sync status...');
}

// ─────────────────────────────────────────────────────────
// MAIN ACCA ENGINE
// ─────────────────────────────────────────────────────────

function menuBuildAccumulatorPortfolio() {
  safeExecute('buildAccumulatorPortfolio', 'Building accumulator portfolio...');
}

function menuCheckAccumulatorResults() {
  safeExecute('checkAccumulatorResults', 'Checking accumulator results...');
}

function menuScanVulnerabilities() {
  safeExecute('scanAccaVulnerabilities', 'Scanning for vulnerabilities...');
}

function menuForceUpdateResults() {
  safeExecute('updateAccaResultsFromPortfolio', 'Force updating results...', 'forceUpdateAccaResults');
}

// ─────────────────────────────────────────────────────────
// LEFTOVER SYSTEM
// ─────────────────────────────────────────────────────────

function menuRunLeftoverProcessing() {
  safeExecute('runLeftoverProcessing', 'Processing leftover bets...');
}

function menuCheckLeftoverResults() {
  safeExecute('checkLeftoverAccumulatorResults', 'Checking leftover results...');
}

// ─────────────────────────────────────────────────────────
// RISKY STRATEGIES
// ─────────────────────────────────────────────────────────

function menuBuildRiskyAccumulators() {
  safeExecute('buildRiskyAccumulators', 'Building risky accumulators...');
}

function menuViewPendingRiskyBets() {
  safeExecute('viewPendingRiskyBets', 'Loading pending risky bets...');
}

function menuCheckRiskyResults() {
  safeExecute('checkRiskyAccaResults', 'Checking risky acca results...');
}

function menuAnalyzeRiskyPerformance() {
  safeExecute('analyzeRiskyAccaPerformance', 'Analyzing risky performance...');
}

// ─────────────────────────────────────────────────────────
// 🧠 MIC - MEMORY INTELLIGENCE CENTER (v3-merged)
// ─────────────────────────────────────────────────────────

function menuMIC_Initialize() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🧠 Initialize MIC System',
    'This will create all required MIC sheets:\n\n' +
    '• Historical_Bets_Archive\n' +
    '• Historical_Results_Archive\n' +
    '• Historical_Performance_Log\n' +
    '• Segment_Stats\n' +
    '• Historical_Insights\n' +
    '• Policy_Overrides\n' +
    '• Shadow_Backtest_Log\n' +
    '• MIC_Tuning_Log\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    safeExecute('initializeMIC', 'Initializing MIC System...');
  }
}

function menuMIC_ArchiveBets() {
  safeExecute('syncWithHistoricalArchive', 'Archiving bets from Sync_Temp...');
}

function menuMIC_ArchiveResults() {
  safeExecute('syncResultsWithHistoricalArchive', 'Archiving results from Results_Temp...');
}

function menuMIC_AnalyzePerformance() {
  safeExecute('analyzeWithHistoricalTracking', 'Analyzing with historical tracking...');
}

function menuMIC_UpdateSegmentStats() {
  safeExecute('updateSegmentStats', 'Updating segment statistics...');
}

function menuMIC_GenerateInsights() {
  safeExecute('generateHistoricalInsights', 'Generating historical insights...');
}

function menuMIC_ViewRecentInsights() {
  var ui = SpreadsheetApp.getUi();

  try {
    var insights = getRecentInsights(10);

    if (!insights || insights.length === 0) {
      ui.alert('💡 Recent Insights', 'No insights available yet.\n\nRun "Generate Insights" first.', ui.ButtonSet.OK);
      return;
    }

    var report = '💡 RECENT MIC INSIGHTS\n';
    report += '══════════════════════════════════════════════════\n\n';

    for (var i = 0; i < insights.length; i++) {
      var ins = insights[i];
      var priority = ins.Priority || 'LOW';
      var icon = priority === 'CRITICAL' ? '🔴' : (priority === 'HIGH' ? '🟠' : (priority === 'MEDIUM' ? '🟡' : '🟢'));
      report += icon + ' [' + ins.InsightType + '] ' + (ins.Segment || 'General') + '\n';
      report += '   ' + ins.Message + '\n';
      report += '   Action: ' + (ins.ActionTaken || 'None') + '\n\n';
    }

    if (report.length > 1500) {
      report = report.substring(0, 1500) + '\n\n... (Check Historical_Insights sheet for full list)';
    }

    ui.alert('💡 Recent Insights', report, ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('❌ Error', 'Could not load insights: ' + e.message, ui.ButtonSet.OK);
  }
}

function menuMIC_RunShadowBacktest() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🧪 Run Shadow Backtest (v3-merged)',
    'This will simulate the MIC policy on historical data.\n\n' +
    'v3-merged improvements:\n' +
    '• OVERALL posterior drives action (not per-arm means)\n' +
    '• Evidence guardrail: ≥3 real observations for early BLOCK\n' +
    '• Effective N from decayed observations\n' +
    '• ROI per EVENT scoring\n' +
    '• Missing-odds detection\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Running shadow backtest (v3-merged)...', '🧪 Processing', -1);

    try {
      var res = runShadowBacktest();
      if (res) {
        logShadowBacktest_(res);

        var report = '🧪 SHADOW BACKTEST RESULTS (v3-merged)\n' +
          '═══════════════════════════════════════\n\n' +
          'Events Analyzed: ' + res.eventsUsed + '\n' +
          'Policy Would Place (BET): ' + res.placedBET + '\n' +
          'Policy Would Place (CAUTION): ' + res.placedCAUTION + '\n' +
          'Policy Would Block: ' + res.blocked + '\n' +
          'Coverage: ' + (res.coverage * 100).toFixed(1) + '%\n\n' +
          'ROI if Bet All: ' + res.roiIfBetAll.toFixed(2) + ' units\n' +
          'ROI if Follow Policy: ' + res.roiIfFollowPolicy.toFixed(2) + ' units\n' +
          'Avg ROI per Placed Bet: ' + res.avgROIIfFollowPolicy.toFixed(4) + '\n' +
          'ROI per Event: ' + res.roiPerEvent.toFixed(4) + '\n' +
          'Missing Odds Wins: ' + res.missingOddsWins + '\n\n' +
          'Check Shadow_Backtest_Log for full details.';

        SpreadsheetApp.getActiveSpreadsheet().toast('Backtest complete!', '✅ Done', 5);
        ui.alert('🧪 Backtest Results', report, ui.ButtonSet.OK);
      } else {
        ui.alert('⚠️ Warning', 'No graded data available for backtest.', ui.ButtonSet.OK);
      }
    } catch (e) {
      SpreadsheetApp.getActiveSpreadsheet().toast('', '', 1);
      ui.alert('❌ Error', 'Backtest failed: ' + e.message, ui.ButtonSet.OK);
    }
  }
}

function menuMIC_AutoTuneRecommend() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🎛️ Auto-Tune MIC (Recommend Only)',
    'v3-merged grid search with:\n' +
    '• ROI per EVENT optimization\n' +
    '• MIN_COVERAGE constraint\n' +
    '• MIN_SAMPLE_SIZE + ALERT_THRESHOLD candidates\n' +
    '• Auto-expanded EARLY_BLOCK grid below prior LB\n' +
    '• Preloaded window (memory-efficient)\n\n' +
    'Recommendations logged but NOT applied.\n' +
    'May take 1-2 minutes.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Running auto-tuner (v3-merged)...', '🎛️ Processing', -1);

    try {
      var res = autoTuneMIC({ apply: false });
      SpreadsheetApp.getActiveSpreadsheet().toast('', '', 1);

      if (res && res.recommendedOverrides) {
        var ov = res.recommendedOverrides;
        var report = '🎛️ AUTO-TUNE RESULTS (Not Applied)\n' +
          '═══════════════════════════════════════\n\n' +
          'BASELINE:\n' +
          '  Avg ROI: ' + res.baseline.avgROIIfFollowPolicy.toFixed(4) + '\n' +
          '  Coverage: ' + (res.baseline.coverage * 100).toFixed(1) + '%\n' +
          '  ROI/Event: ' + res.baseline.roiPerEvent.toFixed(4) + '\n\n' +
          'RECOMMENDED:\n' +
          '  Avg ROI: ' + res.best.avgROIIfFollowPolicy.toFixed(4) + '\n' +
          '  Coverage: ' + (res.best.coverage * 100).toFixed(1) + '%\n' +
          '  ROI/Event: ' + res.best.roiPerEvent.toFixed(4) + '\n\n' +
          'RECOMMENDED OVERRIDES:\n' +
          '  Early Bet LB: ' + ov.EARLY_BET_LOWER_BOUND + '\n' +
          '  Early Block LB: ' + ov.EARLY_BLOCK_LOWER_BOUND + '\n' +
          '  Halflife Days: ' + ov.RECENCY_DECAY_HALFLIFE_DAYS + '\n' +
          '  Caution Mean: ' + ov.CAUTION_MEAN_THRESHOLD + '\n' +
          '  Min Sample Size: ' + (ov.MIN_SAMPLE_SIZE || 'default') + '\n' +
          '  Alert Threshold: ' + (ov.ALERT_WIN_RATE_THRESHOLD || 'default') + '\n\n' +
          'To apply, run "Auto-Tune (Apply)".';

        ui.alert('🎛️ Tuning Results', report, ui.ButtonSet.OK);
      } else {
        ui.alert('⚠️ Warning', 'Could not find better parameters than current settings.', ui.ButtonSet.OK);
      }
    } catch (e) {
      SpreadsheetApp.getActiveSpreadsheet().toast('', '', 1);
      ui.alert('❌ Error', 'Auto-tune failed: ' + e.message, ui.ButtonSet.OK);
    }
  }
}

function menuMIC_AutoTuneApply() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🎛️ Auto-Tune MIC (APPLY)',
    '⚠️ This will run auto-tuning AND APPLY the best settings.\n\n' +
    'The new thresholds will be stored as runtime overrides\n' +
    'and used immediately for all future policy decisions.\n\n' +
    'You can clear overrides later if needed.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    SpreadsheetApp.getActiveSpreadsheet().toast('Running auto-tuner and applying...', '🎛️ Processing', -1);

    try {
      var res = autoTuneMIC({ apply: true });
      SpreadsheetApp.getActiveSpreadsheet().toast('', '', 1);

      if (res && res.applied === 'YES') {
        var ov = res.recommendedOverrides;
        var report = '✅ AUTO-TUNE APPLIED\n' +
          '═══════════════════════════════════════\n\n' +
          'New settings are now active:\n\n' +
          '  Early Bet LB: ' + ov.EARLY_BET_LOWER_BOUND + '\n' +
          '  Early Block LB: ' + ov.EARLY_BLOCK_LOWER_BOUND + '\n' +
          '  Halflife Days: ' + ov.RECENCY_DECAY_HALFLIFE_DAYS + '\n' +
          '  Caution Mean: ' + ov.CAUTION_MEAN_THRESHOLD + '\n' +
          '  Min Sample Size: ' + (ov.MIN_SAMPLE_SIZE || 'default') + '\n' +
          '  Alert Threshold: ' + (ov.ALERT_WIN_RATE_THRESHOLD || 'default') + '\n\n' +
          'Expected improvement:\n' +
          '  Baseline ROI/Event: ' + res.baseline.roiPerEvent.toFixed(4) + '\n' +
          '  New ROI/Event: ' + res.best.roiPerEvent.toFixed(4) + '\n\n' +
          'To revert, use "Clear Runtime Overrides".';

        ui.alert('✅ Applied', report, ui.ButtonSet.OK);
      } else {
        ui.alert('ℹ️ No Changes', 'Current settings are already optimal.', ui.ButtonSet.OK);
      }
    } catch (e) {
      SpreadsheetApp.getActiveSpreadsheet().toast('', '', 1);
      ui.alert('❌ Error', 'Auto-tune failed: ' + e.message, ui.ButtonSet.OK);
    }
  }
}

// ✅ NEW: v3-merged tuning grid + cold-start defaults
function menuMIC_SetUltimateTuningGrid() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🔧 Set Ultimate Tuning Grid',
    'This will configure:\n\n' +
    '• Enable tuning\n' +
    '• Set EARLY_BLOCK_LOWER_BOUND below prior LB (~0.31)\n' +
    '  so new segments start as CAUTION, not BLOCK\n' +
    '• Expanded candidate grids for all 6 parameters\n\n' +
    'Safe to run multiple times (idempotent).\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    try {
      MIC_SetUltimateTuningGridAndColdStartDefaults();
      ui.alert('✅ Done', 'Ultimate tuning grid + cold-start defaults applied.\n\nRun "Auto-Tune (Apply)" next to find optimal settings.', ui.ButtonSet.OK);
    } catch (e) {
      ui.alert('❌ Error', 'Failed: ' + e.message, ui.ButtonSet.OK);
    }
  }
}

// ✅ NEW: Fix missing odds for backtest
function menuMIC_FixMissingOdds() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🔧 Fix Missing Odds for Backtest',
    'This sets a fallback decimal odds of 1.85 for WON rows\n' +
    'that are missing odds data.\n\n' +
    'Without this, WON bets with missing odds show ROI=0,\n' +
    'making the tuner think those bets were worthless.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    try {
      MIC_FixMissingOddsForBacktest();
      ui.alert('✅ Done', 'Backtest will now assume 1.85 decimal odds for WON rows missing odds.\n\nRun backtest again to see corrected ROI.', ui.ButtonSet.OK);
    } catch (e) {
      ui.alert('❌ Error', 'Failed: ' + e.message, ui.ButtonSet.OK);
    }
  }
}

function menuMIC_FilterBetsWithPolicy() {
  var ui = SpreadsheetApp.getUi();

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var syncTemp = ss.getSheetByName('Sync_Temp');

    if (!syncTemp || syncTemp.getLastRow() < 2) {
      ui.alert('⚠️ No Data', 'Sync_Temp is empty. Sync bets first.', ui.ButtonSet.OK);
      return;
    }

    var bets = sheetToObjects_(syncTemp);
    var result = filterBetsWithPolicy(bets);

    var report = '🔍 POLICY FILTER RESULTS\n' +
      '═══════════════════════════════════════\n\n' +
      'Total Bets Analyzed: ' + bets.length + '\n\n' +
      '✅ ALLOWED (BET + CAUTION): ' + result.allowed.length + '\n' +
      '   - Ready to BET: ' + (result.allowed.length - result.cautioned.length) + '\n' +
      '   - CAUTION (proceed carefully): ' + result.cautioned.length + '\n\n' +
      '🚫 BLOCKED: ' + result.blocked.length + '\n\n' +
      'Top Blocked Reasons:\n';

    var blockedReasons = result.blocked.slice(0, 5).map(function(b) {
      return '• ' + (b.bet.pick || b.bet.Pick) + ': ' + (b.reason || '').substring(0, 60) + '...';
    }).join('\n');

    ui.alert('🔍 Policy Filter', report + blockedReasons, ui.ButtonSet.OK);
    console.log('Policy Filter Full Results:', JSON.stringify(result, null, 2));

  } catch (e) {
    ui.alert('❌ Error', 'Policy filter failed: ' + e.message, ui.ButtonSet.OK);
  }
}

function menuMIC_ShowOverrides() {
  var ui = SpreadsheetApp.getUi();

  try {
    var overrides = getMICRuntimeOverrides();

    if (!overrides || Object.keys(overrides).length === 0) {
      ui.alert('⚙️ Runtime Overrides', 'No runtime overrides are currently set.\n\nUsing default MIC configuration.', ui.ButtonSet.OK);
      return;
    }

    var report = '⚙️ CURRENT MIC RUNTIME OVERRIDES\n';
    report += '════════════════════════════════════════\n\n';

    var keys = Object.keys(overrides);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = overrides[key];
      if (typeof val === 'object') {
        report += key + ': ' + JSON.stringify(val) + '\n';
      } else {
        report += key + ': ' + val + '\n';
      }
    }

    report += '\nThese override the default MIC_DEFAULTS.';

    ui.alert('⚙️ Runtime Overrides', report, ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('❌ Error', 'Could not load overrides: ' + e.message, ui.ButtonSet.OK);
  }
}

function menuMIC_ClearOverrides() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🗑️ Clear Runtime Overrides',
    'This will remove all runtime overrides and\nrevert to default MIC_DEFAULTS.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    try {
      clearMICRuntimeOverrides();
      ui.alert('✅ Cleared', 'Runtime overrides have been cleared.\nMIC is now using default settings.', ui.ButtonSet.OK);
    } catch (e) {
      ui.alert('❌ Error', 'Could not clear overrides: ' + e.message, ui.ButtonSet.OK);
    }
  }
}

function menuMIC_MigratePerformanceLog() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🔧 Migrate Performance Log',
    '⚠️ ONE-TIME MIGRATION\n\n' +
    'This will update the Performance Log to use\nscoreless ResultIDs for better deduplication.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    safeExecute('migratePerformanceLogToScorelessResultKey', 'Migrating performance log...');
  }
}

function menuMIC_SegmentAnalysis() {
  var ui = SpreadsheetApp.getUi();

  try {
    var stats = getAllSegmentStats_();

    if (!stats || stats.length === 0) {
      ui.alert('📊 Segment Analysis', 'No segment data available.\n\nRun "Update Segment Stats" first.', ui.ButtonSet.OK);
      return;
    }

    var activeSegments = stats.filter(function(s) { return s.IsActive === 'YES'; });
    var sorted = activeSegments.sort(function(a, b) {
      var wrA = parseFloat(String(a.WinRate_Lifetime).replace('%', '')) || 0;
      var wrB = parseFloat(String(b.WinRate_Lifetime).replace('%', '')) || 0;
      return wrB - wrA;
    });

    var report = '📊 SEGMENT ANALYSIS\n';
    report += '══════════════════════════════════════════════════\n\n';
    report += 'Total Segments: ' + stats.length + '\n';
    report += 'Active Segments: ' + activeSegments.length + '\n\n';

    report += '🏆 TOP 5 PERFORMERS:\n';
    var top5 = sorted.slice(0, 5);
    for (var i = 0; i < top5.length; i++) {
      var s = top5[i];
      report += (i + 1) + '. ' + s.League + ' | ' + s.BetType + ' | ' + s.SubType + '\n';
      report += '   Win Rate: ' + s.WinRate_Lifetime + ' | Bets: ' + s.TotalBets + ' | ROI: ' + s.TotalROI + '\n';
    }

    report += '\n⚠️ BOTTOM 5 PERFORMERS:\n';
    var bot5 = sorted.slice(-5).reverse();
    for (var j = 0; j < bot5.length; j++) {
      var b = bot5[j];
      report += (j + 1) + '. ' + b.League + ' | ' + b.BetType + ' | ' + b.SubType + '\n';
      report += '   Win Rate: ' + b.WinRate_Lifetime + ' | Bets: ' + b.TotalBets + ' | Action: ' + b.RecommendedAction + '\n';
    }

    ui.alert('📊 Segment Analysis', report, ui.ButtonSet.OK);

  } catch (e) {
    ui.alert('❌ Error', 'Segment analysis failed: ' + e.message, ui.ButtonSet.OK);
  }
}

function menuMIC_Debug() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var report = '🧠 MIC SYSTEM DEBUG (v3-merged)\n';
  report += '══════════════════════════════════════════════════\n\n';

  var micSheets = [
    'Historical_Bets_Archive',
    'Historical_Results_Archive',
    'Historical_Performance_Log',
    'Segment_Stats',
    'Historical_Insights',
    'Policy_Overrides',
    'Shadow_Backtest_Log',
    'MIC_Tuning_Log'
  ];

  report += 'SHEET STATUS:\n';
  for (var i = 0; i < micSheets.length; i++) {
    var name = micSheets[i];
    var sheet = ss.getSheetByName(name);
    if (sheet) {
      var rows = Math.max(0, sheet.getLastRow() - 1);
      report += '  ✅ ' + name + ': ' + rows + ' rows\n';
    } else {
      report += '  ❌ ' + name + ': NOT FOUND\n';
    }
  }

  report += '\nRUNTIME OVERRIDES:\n';
  try {
    var overrides = getMICRuntimeOverrides();
    var oKeys = Object.keys(overrides);
    if (oKeys.length === 0) {
      report += '  (None - using defaults)\n';
    } else {
      for (var k = 0; k < oKeys.length; k++) {
        report += '  ' + oKeys[k] + ': ' + overrides[oKeys[k]] + '\n';
      }
    }
  } catch (e) {
    report += '  Error loading: ' + e.message + '\n';
  }

  report += '\nCONFIG (with overrides):\n';
  try {
    var cfg = _cfg_();
    report += '  MIN_SAMPLE_SIZE: ' + cfg.MIN_SAMPLE_SIZE + '\n';
    report += '  ALERT_WIN_RATE_THRESHOLD: ' + cfg.ALERT_WIN_RATE_THRESHOLD + '\n';
    report += '  EARLY_BET_LOWER_BOUND: ' + cfg.EARLY_BET_LOWER_BOUND + '\n';
    report += '  EARLY_BLOCK_LOWER_BOUND: ' + cfg.EARLY_BLOCK_LOWER_BOUND + '\n';
    report += '  RECENCY_DECAY_HALFLIFE_DAYS: ' + cfg.RECENCY_DECAY_HALFLIFE_DAYS + '\n';
    report += '  CAUTION_MEAN_THRESHOLD: ' + cfg.CAUTION_MEAN_THRESHOLD + '\n';
    report += '  PRIOR_ALPHA: ' + cfg.PRIOR_ALPHA + '\n';
    report += '  PRIOR_BETA: ' + cfg.PRIOR_BETA + '\n';
  } catch (e) {
    report += '  Error: ' + e.message + '\n';
  }

  // v3-merged: show prior LB for context
  report += '\nDERIVED VALUES:\n';
  try {
    var cfg2 = _cfg_();
    var priorLB = bayesianLowerBound_(cfg2.PRIOR_ALPHA, cfg2.PRIOR_BETA, cfg2.LOWER_BOUND_ONE_SIDED_CONFIDENCE);
    report += '  Prior LB (new segment starts here): ' + (isFinite(priorLB) ? priorLB.toFixed(4) : 'N/A') + '\n';
    report += '  EARLY_BLOCK_LOWER_BOUND: ' + cfg2.EARLY_BLOCK_LOWER_BOUND + '\n';
    report += '  → New segments will ' + (cfg2.EARLY_BLOCK_LOWER_BOUND < priorLB ? 'NOT' : 'IMMEDIATELY') + ' be blocked\n';
  } catch (_) {}

  console.log(report);
  ui.alert('🧠 MIC Debug', report, ui.ButtonSet.OK);
}

// ─────────────────────────────────────────────────────────
// ANALYTICS LAB
// ─────────────────────────────────────────────────────────

function menuAnalyzeBetPerformance() {
  safeExecute('analyzeBetPerformance', 'Analyzing bet performance...');
}

function menuGenerateLeagueReport() {
  safeExecute('generateLeaguePerformanceReport', 'Generating league report...');
}

function menuFullSpectrumAnalysis() {
  safeExecute('analyzeAllGamesFullSpectrum', 'Running full spectrum analysis...');
}

function menuSniperDirPerformance() {
  safeExecute('analyzeSniperDirPerformance', 'Analyzing SNIPER DIR performance...');
}

// ─────────────────────────────────────────────────────────
// ADMIN & DEBUG
// ─────────────────────────────────────────────────────────

function menuSetupMothership() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '⚙️ Setup Mothership',
    'This will create/verify all required sheets.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    safeExecute('setupMothership', 'Setting up Mothership...');
  }
}

function menuRunDiagnostic() {
  safeExecute('runFullDiagnostic', 'Running full diagnostic...');
}

function menuDebugDatePipeline() {
  safeExecute('debugDatePipeline', 'Debugging date pipeline...');
}

function menuDebugAccuracyMetrics() {
  safeExecute('debugAccuracyMetrics', 'Debugging accuracy metrics...');
}

function menuDebugResultMatching() {
  safeExecute('debugResultMatching', 'Debugging result matching...');
}

function menuDebugLeftoverSystem() {
  safeExecute('debugLeftoverSystem', 'Debugging leftover system...');
}

function menuResetAllSheets() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '⚠️ DANGER: Reset All Sheets',
    'This will CLEAR all data from:\n• Acca_Portfolio\n• Leftover_Portfolio\n• Risky_Acca_Portfolio\n• Dashboard\n\nThis cannot be undone!\n\nAre you SURE?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    var confirm = ui.alert(
      '⚠️ Final Confirmation',
      'Click OK to confirm reset.',
      ui.ButtonSet.OK_CANCEL
    );

    if (confirm === ui.Button.OK) {
      safeExecute('resetAllOutputSheets', 'Resetting all sheets...');
    }
  }
}

function menuClearSyncTemp() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    'Clear Sync_Temp',
    'This will clear the Sync_Temp sheet only.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('Sync_Temp');
      if (sheet && sheet.getLastRow() > 1) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
        ui.alert('✅ Sync_Temp cleared successfully!');
      } else {
        ui.alert('ℹ️ Sync_Temp is already empty.');
      }
    } catch (e) {
      ui.alert('❌ Error: ' + e.message);
    }
  }
}

// ✅ NEW: Combined sync + MIC archive
function menuSyncWithMIC() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.alert(
    '🔄 Sync Everything + MIC Archive',
    'This will:\n' +
    '1. Sync all bets and results from satellites\n' +
    '2. Archive to MIC Historical storage\n' +
    '3. Update learning models\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );

  if (result === ui.Button.YES) {
    safeExecute('syncEverything', 'Syncing from satellites...');
    safeExecute('syncWithHistoricalArchive', 'Archiving bets to MIC...');
    safeExecute('syncResultsWithHistoricalArchive', 'Archiving results to MIC...');
    ui.alert('✅ Complete', 'Sync and archive complete!', ui.ButtonSet.OK);
  }
}


// ============================================================
// SECTION 3: SAFE EXECUTION HELPER
// ============================================================

function safeExecute(functionName, loadingMessage, fallbackFunction) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    ss.toast(loadingMessage, '⏳ Processing...', -1);

    var fn = this[functionName];

    if (typeof fn !== 'function' && fallbackFunction) {
      fn = this[fallbackFunction];
      functionName = fallbackFunction;
    }

    if (typeof fn !== 'function') {
      ss.toast('', '', 1);
      ui.alert(
        '❌ Function Not Found',
        'The function "' + functionName + '" was not found.\n\n' +
        'Ensure it exists in one of your script files.',
        ui.ButtonSet.OK
      );
      return;
    }

    var startTime = new Date();
    fn();
    var duration = ((new Date() - startTime) / 1000).toFixed(1);

    ss.toast('Completed in ' + duration + 's', '✅ Success', 5);

  } catch (error) {
    ss.toast('', '', 1);
    console.error('Error in ' + functionName + ':', error);

    ui.alert(
      '❌ Error Occurred',
      'Function: ' + functionName + '\n\nError: ' + error.message + '\n\n' +
      'Check Extensions > Apps Script > Executions for details.',
      ui.ButtonSet.OK
    );
  }
}


// ============================================================
// SECTION 4: FALLBACK FUNCTIONS
// ============================================================

if (typeof updateAccaResultsFromPortfolio !== 'function') {
  function updateAccaResultsFromPortfolio() {
    if (typeof forceUpdateAccaResults === 'function') forceUpdateAccaResults();
    else if (typeof checkAccumulatorResults === 'function') checkAccumulatorResults();
    else throw new Error('No result update function found');
  }
}

if (typeof analyzeSniperDirPerformance !== 'function') {
  function analyzeSniperDirPerformance() {
    var ui = SpreadsheetApp.getUi();
    if (typeof analyzeAllGamesFullSpectrum === 'function') {
      ui.alert('🎯 SNIPER DIR Analysis', 'Running Full Spectrum Analysis which includes SNIPER DIR metrics...', ui.ButtonSet.OK);
      analyzeAllGamesFullSpectrum();
    } else {
      ui.alert('ℹ️ Not Implemented', 'Use "Full Spectrum Analysis" from Analytics Lab instead.', ui.ButtonSet.OK);
    }
  }
}

if (typeof debugDatePipeline !== 'function') {
  function debugDatePipeline() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ui = SpreadsheetApp.getUi();
    var report = '📅 DATE PIPELINE DEBUG\n════════════════════════════════════════\n\n';
    var syncTemp = ss.getSheetByName('Sync_Temp');
    if (syncTemp && syncTemp.getLastRow() > 1) {
      var dates = syncTemp.getRange(2, 3, Math.min(5, syncTemp.getLastRow() - 1), 1).getValues();
      report += 'Sample dates from Sync_Temp:\n';
      for (var i = 0; i < dates.length; i++) {
        report += '  Row ' + (i + 2) + ': ' + dates[i][0] + ' (Type: ' + typeof dates[i][0] + ')\n';
      }
    }
    report += '\n✅ Check Execution Log for full details';
    console.log(report);
    ui.alert('Date Pipeline Debug', report, ui.ButtonSet.OK);
  }
}

if (typeof debugLeftoverSystem !== 'function') {
  function debugLeftoverSystem() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ui = SpreadsheetApp.getUi();
    var report = '♻️ LEFTOVER SYSTEM DEBUG\n════════════════════════════════════════\n\n';
    var leftoverSheet = ss.getSheetByName('Leftover_Portfolio');
    if (leftoverSheet) report += 'Leftover_Portfolio: ' + (leftoverSheet.getLastRow() - 1) + ' rows\n';
    else report += 'Leftover_Portfolio: NOT FOUND\n';
    report += '\n✅ Check Execution Log for full details';
    console.log(report);
    ui.alert('Leftover System Debug', report, ui.ButtonSet.OK);
  }
}


// ============================================================
// SECTION 5: UTILITY FUNCTIONS
// ============================================================

function testMenuSystem() {
  var ui = SpreadsheetApp.getUi();

  var functions = [
    'syncEverything',
    'syncAllLeagues',
    'syncAllResults',
    'buildAccumulatorPortfolio',
    'checkAccumulatorResults',
    'buildRiskyAccumulators',
    'updateDashboard',
    'setupMothership',
    'initializeMIC',
    'runMICPipeline',
    'syncWithHistoricalArchive',
    'syncResultsWithHistoricalArchive',
    'analyzeWithHistoricalTracking',
    'updateSegmentStats',
    'generateHistoricalInsights',
    'filterBetsWithPolicy',
    'runShadowBacktest',
    'autoTuneMIC',
    'MIC_ApplyTuning',
    'MIC_FixMissingOddsForBacktest',
    'MIC_SetUltimateTuningGridAndColdStartDefaults'
  ];

  var report = '🔍 FUNCTION AVAILABILITY CHECK\n';
  report += '════════════════════════════════════════\n\n';

  var found = 0, missing = 0;
  for (var i = 0; i < functions.length; i++) {
    var fn = functions[i];
    var exists = typeof this[fn] === 'function';
    report += (exists ? '✅' : '❌') + ' ' + fn + '\n';
    if (exists) found++; else missing++;
  }

  report += '\n════════════════════════════════════════';
  report += '\n✅ Found: ' + found + ' | ❌ Missing: ' + missing;

  console.log(report);
  ui.alert('Function Check', report, ui.ButtonSet.OK);
}

function getSystemStatus() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = [
    'Config', 'Sync_Temp', 'Results_Temp', 'Acca_Portfolio',
    'Leftover_Portfolio', 'Risky_Acca_Portfolio', 'Dashboard',
    'Historical_Bets_Archive', 'Historical_Results_Archive',
    'Historical_Performance_Log', 'Segment_Stats', 'Historical_Insights',
    'Shadow_Backtest_Log', 'MIC_Tuning_Log'
  ];

  var status = '📊 SYSTEM STATUS (v3.0)\n';
  status += '════════════════════════════════════════\n\n';

  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i];
    var sheet = ss.getSheetByName(name);
    if (sheet) {
      var rows = Math.max(0, sheet.getLastRow() - 1);
      status += '✅ ' + name + ': ' + rows + ' rows\n';
    } else {
      status += '❌ ' + name + ': NOT FOUND\n';
    }
  }

  return status;
}
