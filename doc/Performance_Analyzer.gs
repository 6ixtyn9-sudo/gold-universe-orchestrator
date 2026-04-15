/**
 * ======================================================================
 * BET PERFORMANCE ANALYZER - CLEAN PROFESSIONAL VERSION
 * WHY: Track success rate of ALL synced bets against actual results
 * WHAT: Matches Sync_Temp bets to Results_Temp outcomes
 * HOW: Creates Bet_Performance sheet with graded results
 * ======================================================================
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALCULATE PERFORMANCE STATS - PATCHED WITH RISKY
 * Categories: BANKER, SNIPER MARGIN, SNIPER O/U, SNIPER DIR, RISKY
 * ═══════════════════════════════════════════════════════════════════════════
 */
function _calculatePerformanceStats(gradedBets) {
  gradedBets = gradedBets || [];

  var total = gradedBets.length;
  var upcoming = 0, noResult = 0, pending = 0, won = 0, lost = 0, push = 0;

  for (var i = 0; i < gradedBets.length; i++) {
    var grade = gradedBets[i].grade;
    if (grade === 'UPCOMING') upcoming++;
    else if (grade === 'NO RESULT' || grade === 'NO MATCH') noResult++;
    else if (grade === 'PENDING') pending++;
    else if (grade === 'WON') won++;
    else if (grade === 'LOST') lost++;
    else if (grade === 'PUSH') push++;
  }

  var finished = won + lost + push;

  var calcRate = function(w, l) {
    var g = w + l;
    return g > 0 ? ((w / g) * 100).toFixed(1) + '%' : 'N/A';
  };

  var buckets = {
    banker:       { total: 0, won: 0, lost: 0, push: 0 },
    sniperMargin: { total: 0, won: 0, lost: 0, push: 0 },
    sniperOU:     { total: 0, won: 0, lost: 0, push: 0 },
    sniperDir:    { total: 0, won: 0, lost: 0, push: 0 },
    risky:        { total: 0, won: 0, lost: 0, push: 0 }
  };

  var classify = function(bet) {
    bet = bet || {};

    var t = String(bet.betType || bet.type || bet.Type || '').toLowerCase();

    // ── RiskTier wins first (new rows) ──────────────────────────────────────
    var riskTier = String(
      bet.RiskTier || bet.riskTier || bet.risk_tier || bet['Risk Tier'] || ''
    ).toLowerCase();

    // Guard: "NOT RISKY" shouldn't match
    if (riskTier.indexOf('not risky') < 0 && riskTier.indexOf('risky') >= 0) return 'risky';

    // ── Legacy type-based (original precedence preserved) ───────────────────
    if (t.indexOf('banker') >= 0) return 'banker';
    if (t.indexOf('risky') >= 0)  return 'risky';

    var pickRaw  = String(bet.pick || bet.Pick || '');
    var pickForOU = String(bet.pickNormalized || bet.pick || bet.Pick || '');

    if (t.indexOf('high qtr') >= 0 ||
        t.indexOf('sniper high qtr') >= 0 ||
        /highest\s*scoring\s*(quarter|qtr)/i.test(pickRaw)) {
      return 'sniperDir';
    }

    if (t.indexOf('sniper') < 0 &&
        t.indexOf('tier2') < 0 &&
        t.indexOf('quarter') < 0) return null;

    if (t.indexOf('dir') >= 0) return 'sniperDir';

    // O/U detection (existing fix retained — no forced Q1-4 → sniperDir)
    var typeIndicatesOU =
      (t.indexOf('o/u') >= 0) ||
      (t.indexOf(' ou ') >= 0) ||
      (t.indexOf('ou') >= 0) ||
      (t.indexOf('totals') >= 0);

    var pickIndicatesOU = /(?:OVER|UNDER)\s*[\d.]+/i.test(pickForOU);

    if (typeIndicatesOU || pickIndicatesOU) return 'sniperOU';

    return 'sniperMargin';
  };

  for (var j = 0; j < gradedBets.length; j++) {
    var bet = gradedBets[j];
    var key = classify(bet);
    if (!key) continue;

    buckets[key].total++;
    if (bet.grade === 'WON')       buckets[key].won++;
    else if (bet.grade === 'LOST') buckets[key].lost++;
    else if (bet.grade === 'PUSH') buckets[key].push++;
  }

  var sniperTotal = buckets.sniperMargin.total + buckets.sniperOU.total + buckets.sniperDir.total;
  var sniperWon   = buckets.sniperMargin.won   + buckets.sniperOU.won   + buckets.sniperDir.won;
  var sniperLost  = buckets.sniperMargin.lost  + buckets.sniperOU.lost  + buckets.sniperDir.lost;
  var sniperPush  = buckets.sniperMargin.push  + buckets.sniperOU.push  + buckets.sniperDir.push;

  var edge    = { won: 0, lost: 0 };
  var nonEdge = { won: 0, lost: 0 };

  for (var k = 0; k < gradedBets.length; k++) {
    var b = gradedBets[k];
    if (b.grade !== 'WON' && b.grade !== 'LOST') continue;

    var hasEdge = !!(b._assayer && b._assayer.bestEdge);
    if (hasEdge) {
      if (b.grade === 'WON') edge.won++; else edge.lost++;
    } else {
      if (b.grade === 'WON') nonEdge.won++; else nonEdge.lost++;
    }
  }

  return {
    total: total,
    upcoming: upcoming,
    noResult: noResult,
    pending: pending,
    finished: finished,
    won: won,
    lost: lost,
    push: push,
    overallWinRate: calcRate(won, lost),

    bankerTotal:   buckets.banker.total,
    bankerWon:     buckets.banker.won,
    bankerLost:    buckets.banker.lost,
    bankerPush:    buckets.banker.push,
    bankerWinRate: calcRate(buckets.banker.won, buckets.banker.lost),

    sniperTotal:   sniperTotal,
    sniperWon:     sniperWon,
    sniperLost:    sniperLost,
    sniperPush:    sniperPush,
    sniperWinRate: calcRate(sniperWon, sniperLost),

    sniperMarginTotal:   buckets.sniperMargin.total,
    sniperMarginWon:     buckets.sniperMargin.won,
    sniperMarginLost:    buckets.sniperMargin.lost,
    sniperMarginPush:    buckets.sniperMargin.push,
    sniperMarginWinRate: calcRate(buckets.sniperMargin.won, buckets.sniperMargin.lost),

    sniperOUTotal:   buckets.sniperOU.total,
    sniperOUWon:     buckets.sniperOU.won,
    sniperOULost:    buckets.sniperOU.lost,
    sniperOUPush:    buckets.sniperOU.push,
    sniperOUWinRate: calcRate(buckets.sniperOU.won, buckets.sniperOU.lost),

    sniperDirTotal:   buckets.sniperDir.total,
    sniperDirWon:     buckets.sniperDir.won,
    sniperDirLost:    buckets.sniperDir.lost,
    sniperDirPush:    buckets.sniperDir.push,
    sniperDirWinRate: calcRate(buckets.sniperDir.won, buckets.sniperDir.lost),

    riskyTotal:   buckets.risky.total,
    riskyWon:     buckets.risky.won,
    riskyLost:    buckets.risky.lost,
    riskyPush:    buckets.risky.push,
    riskyWinRate: calcRate(buckets.risky.won, buckets.risky.lost),

    assayerEdgeWinRate:    calcRate(edge.won, edge.lost),
    assayerNonEdgeWinRate: calcRate(nonEdge.won, nonEdge.lost)
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WRITE PERFORMANCE REPORT - PATCHED WITH RISKY
 * 6-column summary: OVERALL | BANKERS | SNIPER MARGIN | SNIPER O/U | SNIPER DIR | RISKY
 *
 * PATCHES APPLIED:
 *   Risky detection  — Checks RiskTier field (all known aliases) first,
 *                      falls back to type/betType containing "RISKY".
 *   Alignment safety — Risky flag is computed BEFORE sort and embedded
 *                      into a combined structure that travels with each row,
 *                      eliminating the gradedBets[i] ↔ dataRows[i] alignment
 *                      assumption that breaks if either list is independently
 *                      filtered or re-sorted.
 *   Compatibility    — Uses indexOf (not includes) for older runtimes.
 *                      Checks all known RiskTier key variants.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function _writePerformanceReport(ss, gradedBets) {
  var perfSheet = _getSheet(ss, 'Bet_Performance');
  if (!perfSheet) {
    perfSheet = ss.insertSheet('Bet_Performance');
  }
  perfSheet.clear();

  var stats = _calculatePerformanceStats(gradedBets);

  // Keep 13 columns for the summary layout
  var TOTAL_COLS = 13;

  var summaryRows = [
    ['BET PERFORMANCE REPORT', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['Generated: ' + new Date().toLocaleString(), '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['OVERALL', '', 'BANKERS', '', 'SNIPER MARGIN', '', 'SNIPER O/U', '', 'SNIPER DIR', '', 'RISKY', '', ''],
    ['Total', stats.total, 'Total', stats.bankerTotal, 'Total', stats.sniperMarginTotal, 'Total', stats.sniperOUTotal, 'Total', stats.sniperDirTotal, 'Total', stats.riskyTotal, ''],
    ['Won', stats.won, 'Won', stats.bankerWon, 'Won', stats.sniperMarginWon, 'Won', stats.sniperOUWon, 'Won', stats.sniperDirWon, 'Won', stats.riskyWon, ''],
    ['Lost', stats.lost, 'Lost', stats.bankerLost, 'Lost', stats.sniperMarginLost, 'Lost', stats.sniperOULost, 'Lost', stats.sniperDirLost, 'Lost', stats.riskyLost, ''],
    ['Win Rate', stats.overallWinRate, 'Win Rate', stats.bankerWinRate, 'Win Rate', stats.sniperMarginWinRate, 'Win Rate', stats.sniperOUWinRate, 'Win Rate', stats.sniperDirWinRate, 'Win Rate', stats.riskyWinRate, ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', ''],
    // Data header row (with Assayer columns)
    ['League', 'Match', 'Pick', 'Type', 'Grade', 'Score', 'Assayer Edge', 'Lift', 'Purity', 'Purity Action', 'Details', '', '']
  ];

  perfSheet.getRange(1, 1, summaryRows.length, TOTAL_COLS).setValues(summaryRows);

  // ═══════════════════════════════════════════════════════════════
  // Helper: extract risky flag from a bet object
  //
  // Checks ALL known RiskTier key variants first (new format),
  // then falls back to type/betType/Type containing "RISKY" (legacy).
  // Returns a boolean so the flag travels with the data, not via
  // index alignment.
  // ═══════════════════════════════════════════════════════════════
  function isRiskyBet(bet) {
    if (!bet || typeof bet !== 'object') return false;

    // New format: dedicated RiskTier field (any known casing/alias)
    var riskTierRaw = '';
    if      (bet.RiskTier   !== undefined && bet.RiskTier   !== null) riskTierRaw = bet.RiskTier;
    else if (bet.riskTier   !== undefined && bet.riskTier   !== null) riskTierRaw = bet.riskTier;
    else if (bet.risk_tier  !== undefined && bet.risk_tier  !== null) riskTierRaw = bet.risk_tier;
    else if (bet.RISK_TIER  !== undefined && bet.RISK_TIER  !== null) riskTierRaw = bet.RISK_TIER;
    else if (bet.Risktier   !== undefined && bet.Risktier   !== null) riskTierRaw = bet.Risktier;
    else if (bet['Risk Tier'] !== undefined && bet['Risk Tier'] !== null) riskTierRaw = bet['Risk Tier'];

    var riskTierStr = String(riskTierRaw || '').toUpperCase();
    if (riskTierStr.indexOf('RISKY') >= 0) return true;

    // Legacy format: type/betType/Type field contains "RISKY"
    var typeRaw = '';
    if      (bet.betType !== undefined && bet.betType !== null) typeRaw = bet.betType;
    else if (bet.type    !== undefined && bet.type    !== null) typeRaw = bet.type;
    else if (bet.Type    !== undefined && bet.Type    !== null) typeRaw = bet.Type;

    var typeStr = String(typeRaw || '').toUpperCase();
    if (typeStr.indexOf('RISKY') >= 0) return true;

    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // Win-rate color helper
  // ═══════════════════════════════════════════════════════════════
  function applyWinRateColor(cell, rateStr) {
    var num = parseFloat(rateStr);
    if (isNaN(num)) return;
    if (num >= 55)      cell.setBackground('#d4edda').setFontColor('#155724');
    else if (num >= 45) cell.setBackground('#fff3cd').setFontColor('#856404');
    else                cell.setBackground('#f8d7da').setFontColor('#721c24');
  }

  // ═══════════════════════════════════════════════════════════════
  // Summary formatting
  // ═══════════════════════════════════════════════════════════════

  // Title
  perfSheet.getRange(1, 1, 1, TOTAL_COLS).merge()
    .setFontWeight('bold').setFontSize(16)
    .setBackground('#2d3436').setFontColor('#ffffff')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  perfSheet.setRowHeight(1, 40);

  // Generated
  perfSheet.getRange(2, 1, 1, TOTAL_COLS).merge()
    .setFontStyle('italic').setFontColor('#636e72').setFontSize(9)
    .setHorizontalAlignment('center');

  // Section headers (row 4)
  perfSheet.getRange(4, 1, 1, 2).setFontWeight('bold').setBackground('#dfe6e9');   // OVERALL
  perfSheet.getRange(4, 3, 1, 2).setFontWeight('bold').setBackground('#d4edda');   // BANKERS
  perfSheet.getRange(4, 5, 1, 2).setFontWeight('bold').setBackground('#e8dff5');   // SNIPER MARGIN
  perfSheet.getRange(4, 7, 1, 2).setFontWeight('bold').setBackground('#fff3cd');   // SNIPER O/U
  perfSheet.getRange(4, 9, 1, 2).setFontWeight('bold').setBackground('#f8d7da');   // SNIPER DIR
  perfSheet.getRange(4, 11, 1, 2).setFontWeight('bold').setBackground('#ffeaa7');  // RISKY

  // Stats rows (5-8)
  var statCols = [1, 3, 5, 7, 9, 11];
  for (var row = 5; row <= 8; row++) {
    for (var ci = 0; ci < statCols.length; ci++) {
      var col = statCols[ci];
      perfSheet.getRange(row, col).setFontColor('#636e72').setFontSize(10);
      perfSheet.getRange(row, col + 1).setFontWeight('bold').setHorizontalAlignment('center');
    }
  }

  // Win-rate coloring (row 8)
  applyWinRateColor(perfSheet.getRange(8, 2), stats.overallWinRate);
  applyWinRateColor(perfSheet.getRange(8, 4), stats.bankerWinRate);
  applyWinRateColor(perfSheet.getRange(8, 6), stats.sniperMarginWinRate);
  applyWinRateColor(perfSheet.getRange(8, 8), stats.sniperOUWinRate);
  applyWinRateColor(perfSheet.getRange(8, 10), stats.sniperDirWinRate);
  applyWinRateColor(perfSheet.getRange(8, 12), stats.riskyWinRate);

  // Data header row styling (row 10)
  perfSheet.getRange(10, 1, 1, 11)
    .setFontWeight('bold').setBackground('#74b9ff')
    .setFontColor('#2d3436').setHorizontalAlignment('center')
    .setBorder(true, true, true, true, false, false, '#2d3436', SpreadsheetApp.BorderStyle.SOLID);

  // ═══════════════════════════════════════════════════════════════
  // Build combined row entries BEFORE sorting
  //
  // Each entry carries { bet, rowData, isRisky, sortKey } so that
  // after sorting, the risky flag is ALWAYS attached to the correct
  // row — no index-alignment assumption needed.
  // ═══════════════════════════════════════════════════════════════

  var sortOrder = {
    'WON': 1, 'LOST': 2, 'PENDING': 3, 'UPCOMING': 4,
    'NO RESULT': 5, 'NO MATCH': 6, 'ERROR': 7
  };

  var combined = [];
  var safeBets = gradedBets || [];

  for (var bi = 0; bi < safeBets.length; bi++) {
    var bet = safeBets[bi] || {};

    var ann    = bet._assayer || null;
    var best   = (ann && ann.bestEdge)  ? ann.bestEdge  : null;
    var purity = (ann && ann.purity)    ? ann.purity    : null;

    var edgeLabel = best
      ? (String(best.symbol || '') + ' ' + String(best.grade || '')).trim()
      : '';

    var lift = (best && best.lift !== undefined) ? best.lift : '';

    var purityLabel = purity
      ? (String(purity.grade || '') + ' ' + String(purity.status || '')).trim()
      : '';

    var purityAction = purity ? (purity.motherAction || '') : '';

    var grade = bet.grade || '';

    combined.push({
      bet: bet,
      isRisky: isRiskyBet(bet),
      grade: grade,
      sortKey: sortOrder[grade] || 99,
      rowData: [
        bet.league || '',
        bet.match || '',
        bet.pick || '',
        bet.betType || '',
        grade,
        bet.actualScore || '-',
        edgeLabel,
        lift,
        purityLabel,
        purityAction,
        bet.reason || ''
      ]
    });
  }

  // Sort by grade priority (same logic as original)
  combined.sort(function(a, b) {
    return a.sortKey - b.sortKey;
  });

  // ═══════════════════════════════════════════════════════════════
  // Write data rows
  // ═══════════════════════════════════════════════════════════════

  if (combined.length > 0) {
    var dataStartRow = 11;

    // Extract just the row data for batch write
    var dataRows = [];
    for (var di = 0; di < combined.length; di++) {
      dataRows.push(combined[di].rowData);
    }

    perfSheet.getRange(dataStartRow, 1, dataRows.length, 11).setValues(dataRows);

    // ═════════════════════════════════════════════════════════════
    // Per-row highlighting
    //
    // The risky flag comes from the combined structure (not from
    // a separate array index), so it's ALWAYS correct regardless
    // of sort order.
    // ═════════════════════════════════════════════════════════════

    for (var ri = 0; ri < combined.length; ri++) {
      var rowNum    = dataStartRow + ri;
      var entry     = combined[ri];
      var rowGrade  = entry.grade;
      var rowIsRisky = entry.isRisky;

      var gradeCell = perfSheet.getRange(rowNum, 5);
      var rowRange  = perfSheet.getRange(rowNum, 1, 1, 11);

      // ── Base row color (alternating) ──
      if (ri % 2 === 1) {
        rowRange.setBackground('#f8f9fa');
      }

      // ── Risky rows override base color ──
      if (rowIsRisky) {
        rowRange.setBackground(ri % 2 === 1 ? '#fff9e6' : '#fffdf0');
      }

      // ── Grade badge colors ──
      if (rowGrade === 'WON') {
        gradeCell.setBackground('#28a745').setFontColor('#ffffff').setFontWeight('bold');
      } else if (rowGrade === 'LOST') {
        gradeCell.setBackground('#dc3545').setFontColor('#ffffff').setFontWeight('bold');
      } else if (rowGrade === 'PENDING') {
        gradeCell.setBackground('#ffc107').setFontColor('#212529').setFontWeight('bold');
      } else if (rowGrade === 'UPCOMING') {
        gradeCell.setBackground('#17a2b8').setFontColor('#ffffff').setFontWeight('bold');
      } else if (rowGrade === 'NO RESULT' || rowGrade === 'NO MATCH') {
        gradeCell.setBackground('#6c757d').setFontColor('#ffffff');
      } else if (rowGrade === 'ERROR') {
        gradeCell.setBackground('#343a40').setFontColor('#ffffff');
      }

      perfSheet.getRange(rowNum, 5).setHorizontalAlignment('center');
      perfSheet.getRange(rowNum, 6).setHorizontalAlignment('center');
    }

    // Border around all data rows
    perfSheet.getRange(dataStartRow, 1, dataRows.length, 11)
      .setBorder(true, true, true, true, true, true, '#dee2e6', SpreadsheetApp.BorderStyle.SOLID);
  }

  // ═══════════════════════════════════════════════════════════════
  // Column widths
  // ═══════════════════════════════════════════════════════════════
  perfSheet.setColumnWidth(1, 80);    // League
  perfSheet.setColumnWidth(2, 280);   // Match
  perfSheet.setColumnWidth(3, 160);   // Pick
  perfSheet.setColumnWidth(4, 130);   // Type
  perfSheet.setColumnWidth(5, 90);    // Grade
  perfSheet.setColumnWidth(6, 80);    // Score
  perfSheet.setColumnWidth(7, 120);   // Assayer Edge
  perfSheet.setColumnWidth(8, 70);    // Lift
  perfSheet.setColumnWidth(9, 160);   // Purity
  perfSheet.setColumnWidth(10, 110);  // Purity Action
  perfSheet.setColumnWidth(11, 240);  // Details

  perfSheet.setFrozenRows(10);
  perfSheet.getRange(1, 1, perfSheet.getLastRow(), TOTAL_COLS).setFontFamily('Arial');

  Logger.log('[Performance] Written ' + (combined.length) + ' bets to Bet_Performance');
}



/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUILD PERFORMANCE SUMMARY - PATCHED WITH RISKY
 * Shows all categories in UI alert
 * ═══════════════════════════════════════════════════════════════════════════
 */
function _buildPerformanceSummary(gradedBets) {
  const stats = _calculatePerformanceStats(gradedBets);

  let summary = `OVERALL: ${stats.won}W / ${stats.lost}L (${stats.overallWinRate})\n\n`;
  summary += `BANKERS: ${stats.bankerWon}W / ${stats.bankerLost}L (${stats.bankerWinRate})\n`;
  summary += `SNIPER MARGIN: ${stats.sniperMarginWon}W / ${stats.sniperMarginLost}L (${stats.sniperMarginWinRate})\n`;
  summary += `SNIPER O/U: ${stats.sniperOUWon}W / ${stats.sniperOULost}L (${stats.sniperOUWinRate})\n`;
  summary += `SNIPER DIR: ${stats.sniperDirWon}W / ${stats.sniperDirLost}L (${stats.sniperDirWinRate})\n`;
  summary += `RISKY: ${stats.riskyWon}W / ${stats.riskyLost}L (${stats.riskyWinRate})\n\n`;
  summary += `Total Bets: ${stats.total} | Graded: ${stats.finished}\n`;
  summary += `Upcoming: ${stats.upcoming} | No Result: ${stats.noResult}\n\n`;
  summary += `See Bet_Performance sheet for details.`;

  return summary;
}


/**
 * _updateDashboardWithPerformance  (Mothership_Dashboard.gs)
 *
 * Writes graded-bet performance stats into the Master_Dashboard sheet.
 *
 * BEHAVIOR:
 *  - Anchors on "PERFORMANCE" label row (not hardcoded row number)
 *  - Uses end marker "— END BET PERFORMANCE —" for bounded clearing
 *  - Creates PERFORMANCE label if missing
 *  - Clears only the bounded region between anchor and end marker
 *    (falls back to 40-row safe clear if marker not found)
 *
 * NO CHANGES from original — included for completeness alongside
 * the patched updateDashboard below.
 */
function _updateDashboardWithPerformance(ss, gradedBets) {
  var dashSheet = _getSheet(ss, 'Master_Dashboard');
  if (!dashSheet) return;

  var stats = _calculatePerformanceStats(gradedBets);

  function normLabel(s) {
    var x = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    x = x.replace(/^[^\w]+/g, '').trim();
    return x.toLowerCase();
  }

  function findRow(label) {
    var target = normLabel(label);
    var lastRow = dashSheet.getLastRow();
    if (lastRow < 1) return -1;
    var colA = dashSheet.getRange(1, 1, lastRow, 1).getValues();
    for (var r = 0; r < colA.length; r++) {
      if (normLabel(colA[r][0]) === target) return r + 1;
    }
    return -1;
  }

  // Find or create "PERFORMANCE" anchor
  var perfHeaderRow = findRow('performance');
  if (perfHeaderRow === -1) {
    var last = Math.max(1, dashSheet.getLastRow());
    dashSheet.insertRowAfter(last);
    perfHeaderRow = last + 1;
    dashSheet.getRange(perfHeaderRow, 1, 1, 2).setValues([['PERFORMANCE', '']]);
  }

  var startRow = perfHeaderRow + 1;
  var END_MARKER = '— END BET PERFORMANCE —';

  var perfData = [
    ['📈 BET PERFORMANCE', ''],
    ['Bets Analyzed', stats.total],
    ['Graded (W/L)', stats.finished],
    ['Won', stats.won],
    ['Lost', stats.lost],
    ['Overall Win Rate', stats.overallWinRate],
    ['', ''],
    ['BY CATEGORY', ''],
    ['Banker Rate', stats.bankerWinRate],
    ['Sniper Margin Rate', stats.sniperMarginWinRate],
    ['Sniper O/U Rate', stats.sniperOUWinRate],
    ['Sniper DIR Rate', stats.sniperDirWinRate],
    ['Risky Rate', stats.riskyWinRate],
    ['', ''],
    ['🧪 ASSAYER', ''],
    ['Assayer Edge Win Rate (W/L)', stats.assayerEdgeWinRate],
    ['Assayer Non-Edge Win Rate (W/L)', stats.assayerNonEdgeWinRate],
    [END_MARKER, '']
  ];

  try {
    // Clear old block: find previous end marker for bounded clear
    var lastRow = dashSheet.getLastRow();
    var clearEndRow = -1;

    if (lastRow >= startRow) {
      var colA = dashSheet.getRange(startRow, 1, lastRow - startRow + 1, 1).getValues();
      for (var i = 0; i < colA.length; i++) {
        if (String(colA[i][0] || '').trim() === END_MARKER) {
          clearEndRow = startRow + i;
          break;
        }
      }
    }

    // Clear bounded region (end marker found) or safe fallback (40 rows)
    var rowsToClear = (clearEndRow !== -1)
      ? (clearEndRow - startRow + 1)
      : Math.min(40, Math.max(0, lastRow - startRow + 1));
    if (rowsToClear > 0) {
      dashSheet.getRange(startRow, 1, rowsToClear, 2).clearContent().clearFormat();
    }

    // Write new block
    dashSheet.getRange(startRow, 1, perfData.length, 2).setValues(perfData);

    // ── Formatting (relative to startRow) ──
    // BET PERFORMANCE header
    dashSheet.getRange(startRow, 1, 1, 2)
      .setFontWeight('bold').setBackground('#2d3436').setFontColor('#ffffff');
    // BY CATEGORY header (row index 7 in perfData)
    dashSheet.getRange(startRow + 7, 1, 1, 2)
      .setFontWeight('bold').setBackground('#636e72').setFontColor('#ffffff');
    // ASSAYER header (row index 14)
    dashSheet.getRange(startRow + 14, 1, 1, 2)
      .setFontWeight('bold').setBackground('#fffdf0');

    // Stats rows (indices 1-5)
    for (var r = startRow + 1; r <= startRow + 5; r++) {
      dashSheet.getRange(r, 1).setFontColor('#636e72');
      dashSheet.getRange(r, 2).setFontWeight('bold');
    }
    // Category rows (indices 8-12)
    for (var r = startRow + 8; r <= startRow + 12; r++) {
      dashSheet.getRange(r, 1).setFontColor('#636e72');
      dashSheet.getRange(r, 2).setFontWeight('bold');
    }
    // Assayer rows (indices 15-16)
    for (var r = startRow + 15; r <= startRow + 16; r++) {
      try {
        dashSheet.getRange(r, 1).setFontColor('#636e72');
        dashSheet.getRange(r, 2).setFontWeight('bold');
      } catch (e) {}
    }

  } catch (e) {
    Logger.log('[Dashboard] Could not update performance block: ' + e.message);
  }
}


/**
 * updateDashboard  (Mothership_Dashboard.gs)
 *
 * Updates Master_Dashboard with current KPIs from Sync_Temp, Config,
 * Acca_Results, and Results_Temp.
 *
 * PATCHES APPLIED:
 *   Risky counter — Checks RiskTier column (new format) OR type containing
 *                   "RISKY" (legacy format). Prevents double-counting:
 *                   a bet counted as risky is NOT also counted as banker/sniper.
 *   Column detection — Robust header resolution: tries header map aliases first,
 *                      then scans the physical header row as fallback so RiskTier
 *                      is found regardless of map normalization behavior.
 *   All other logic — Preserved exactly (label-based writes, ensureRow,
 *                     assayer inline/fallback detection, purity ⛔ detection).
 */
function updateDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var dashSheet = (typeof getSheetInsensitive === 'function')
    ? getSheetInsensitive(ss, 'Master_Dashboard')
    : ss.getSheetByName('Master_Dashboard');

  if (!dashSheet) { Logger.log('[HiveMind] Master_Dashboard not found'); return; }

  // ═══════════════════════════════════════════════════════════════
  // Inline helpers
  // ═══════════════════════════════════════════════════════════════

  function normLabel(s) {
    var x = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    x = x.replace(/^[^\w]+/g, '').trim(); // strip leading emojis
    return x.toLowerCase();
  }

  function findRow(label) {
    var target = normLabel(label);
    var lastRow = dashSheet.getLastRow();
    if (lastRow < 1) return -1;
    var colA = dashSheet.getRange(1, 1, lastRow, 1).getValues();
    for (var r = 0; r < colA.length; r++) {
      if (normLabel(colA[r][0]) === target) return r + 1;
    }
    return -1;
  }

  function setKpi(label, value) {
    var row = findRow(label);
    if (row === -1) return false;
    try { dashSheet.getRange(row, 2).setValue(value); return true; } catch (e) { return false; }
  }

  function ensureRow(afterLabel, newLabel, defaultVal) {
    if (findRow(newLabel) !== -1) return;
    var afterRow = findRow(afterLabel);
    var lastRow = Math.max(1, dashSheet.getLastRow());
    if (afterRow !== -1) {
      dashSheet.insertRowAfter(afterRow);
      dashSheet.getRange(afterRow + 1, 1, 1, 2).setValues([[newLabel, defaultVal]]);
    } else {
      dashSheet.insertRowAfter(lastRow);
      dashSheet.getRange(lastRow + 1, 1, 1, 2).setValues([[newLabel, defaultVal]]);
    }
  }

  function safeHeaderMap(row) {
    try {
      if (typeof createHeaderMapWithAliases === 'function') return createHeaderMapWithAliases(row);
    } catch (e) {}
    if (typeof _createHeaderMap === 'function') return _createHeaderMap(row);
    // Ultimate fallback: build a basic map ourselves
    var map = {};
    for (var c = 0; c < row.length; c++) {
      var key = String(row[c] || '').trim();
      if (key) {
        map[key] = c;
        map[key.toLowerCase()] = c;
        map[key.toLowerCase().replace(/[^a-z0-9]/g, '')] = c;
      }
    }
    return map;
  }

  // ═══════════════════════════════════════════════════════════════
  // Robust column finder
  //
  // Problem: safeHeaderMap normalizes keys differently depending on
  // which helper is available (createHeaderMapWithAliases vs
  // _createHeaderMap vs inline). RiskTier could appear as:
  //   "RiskTier", "risktier", "risk_tier", "riskTier", etc.
  //
  // Solution: try multiple map keys, then fall back to scanning
  // the physical header row for any match.
  // ═══════════════════════════════════════════════════════════════

  /**
   * Finds a column index from the header map or physical header row.
   * @param {Object}   map        Header map from safeHeaderMap
   * @param {string[]} mapKeys    Keys to try in the map (in priority order)
   * @param {Array}    headerRow  The raw header row values
   * @param {string[]} rawNames   Physical header names to scan for (case-insensitive, stripped)
   * @return {number|undefined}   Column index or undefined if not found
   */
  function findCol(map, mapKeys, headerRow, rawNames) {
    // Try map keys first
    for (var k = 0; k < mapKeys.length; k++) {
      if (map[mapKeys[k]] !== undefined) return map[mapKeys[k]];
    }
    // Fall back to scanning physical header row
    if (headerRow && rawNames) {
      for (var c = 0; c < headerRow.length; c++) {
        var cellNorm = String(headerRow[c] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        for (var n = 0; n < rawNames.length; n++) {
          if (cellNorm === rawNames[n]) return c;
        }
      }
    }
    return undefined;
  }

  // ═══════════════════════════════════════════════════════════════
  // Sync stats
  // ═══════════════════════════════════════════════════════════════
  var totalBets = 0, bankers = 0, snipers = 0, riskyBets = 0;
  var assayerEdgeMatched = 0, assayerPurityBlocked = 0;

  var assayer = null;
  try {
    assayer = (typeof _getAssayerDataCached_ === 'function') ? _getAssayerDataCached_() : null;
  } catch (e) {}

  var syncSheet = (typeof getSheetInsensitive === 'function')
    ? getSheetInsensitive(ss, 'Sync_Temp')
    : ss.getSheetByName('Sync_Temp');

  if (syncSheet && syncSheet.getLastRow() > 1) {
    var syncData = syncSheet.getDataRange().getValues();
    var h = safeHeaderMap(syncData[0]);

    // ── Column resolution ──────────────────────────────────────

    var typeCol = findCol(h,
      ['type', 'Type'],
      syncData[0],
      ['type']
    );

    // ✅ PATCH: RiskTier column — robust detection
    var riskTierCol = findCol(h,
      ['risktier', 'RiskTier', 'riskTier', 'risk_tier', 'Risktier', 'RISKTIER'],
      syncData[0],
      ['risktier', 'risk_tier']
    );

    var edgeGradeCol = findCol(h,
      ['assayeredgebestgrade', 'assayer_edge_bestgrade', 'assayer_edge_grade',
       'assayerEdgeBestGrade', 'assayerEdgeGrade'],
      syncData[0],
      ['assayeredgebestgrade', 'assayeredgegrade']
    );

    var purityActionCol = findCol(h,
      ['assayerpurityaction', 'assayer_purity_action', 'assayerPurityAction'],
      syncData[0],
      ['assayerpurityaction']
    );

    var purityStatusCol = findCol(h,
      ['assayerpuritystatus', 'assayer_purity_status', 'assayerPurityStatus'],
      syncData[0],
      ['assayerpuritystatus']
    );

    var purityGradeCol = findCol(h,
      ['assayerpuritygrade', 'assayer_purity_grade', 'assayerPurityGrade'],
      syncData[0],
      ['assayerpuritygrade']
    );

    var hasInlineAssayerCols = edgeGradeCol !== undefined ||
                               purityActionCol !== undefined ||
                               purityStatusCol !== undefined ||
                               purityGradeCol !== undefined;

    // ── Counting loop ──────────────────────────────────────────

    for (var i = 1; i < syncData.length; i++) {
      if (!syncData[i][0]) continue;
      totalBets++;

      var cellType = (typeCol !== undefined)
        ? String(syncData[i][typeCol] || '').toUpperCase()
        : '';

      var cellRiskTier = (riskTierCol !== undefined)
        ? String(syncData[i][riskTierCol] || '').toUpperCase()
        : '';

      // ✅ PATCH: Accepts both new (RiskTier field) and legacy (type field)
      var isRiskyBet = (cellRiskTier.indexOf('RISKY') >= 0) ||
                       (cellType.indexOf('RISKY') >= 0);

      if (isRiskyBet) {
        riskyBets++;
      } else {
        // ✅ PATCH: Non-risky counters ONLY when confirmed non-risky
        // Prevents double-counting a RISKY_1X2 bet as both risky and its original type
        if (cellType.indexOf('BANKER') >= 0) bankers++;
        if (cellType.indexOf('SNIPER') >= 0) snipers++;
      }

      // ── Assayer stats (unchanged logic) ──
      if (hasInlineAssayerCols) {
        if (edgeGradeCol !== undefined &&
            String(syncData[i][edgeGradeCol] || '').trim()) {
          assayerEdgeMatched++;
        }

        var purityBlock = false;
        if (purityActionCol !== undefined &&
            String(syncData[i][purityActionCol] || '').toUpperCase().trim() === 'BLOCK') {
          purityBlock = true;
        }
        if (!purityBlock && purityStatusCol !== undefined &&
            String(syncData[i][purityStatusCol] || '').indexOf('⛔') >= 0) {
          purityBlock = true;
        }
        if (!purityBlock && purityGradeCol !== undefined &&
            String(syncData[i][purityGradeCol] || '').toUpperCase().trim() === 'CHARCOAL') {
          purityBlock = true;
        }
        if (purityBlock) assayerPurityBlocked++;

      } else if (assayer && typeof assayerAnnotateBetForMother_ === 'function') {
        try {
          var betObj = {};
          var hKeys = Object.keys(h);
          for (var ki = 0; ki < hKeys.length; ki++) {
            var hk = hKeys[ki];
            if (h[hk] !== undefined) betObj[hk] = syncData[i][h[hk]];
          }
          betObj.league     = betObj.league     || betObj.League;
          betObj.pick        = betObj.pick        || betObj.Pick;
          betObj.type        = betObj.type        || betObj.Type;
          betObj.match       = betObj.match       || betObj.Match;
          betObj.confidence  = betObj.confidence  || betObj.Confidence;

          var ann = assayerAnnotateBetForMother_(betObj, assayer);
          if (ann && ann.bestEdge) assayerEdgeMatched++;
          if (ann && ann.purity &&
              String(ann.purity.motherAction || '').toUpperCase() === 'BLOCK') {
            assayerPurityBlocked++;
          }
        } catch (e) {}
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // League stats
  // ═══════════════════════════════════════════════════════════════
  var totalLeagues = 0, activeLeagues = 0;

  var configSheet = (typeof getSheetInsensitive === 'function')
    ? getSheetInsensitive(ss, 'Config')
    : ss.getSheetByName('Config');

  if (configSheet && configSheet.getLastRow() > 1) {
    var cfgData = configSheet.getDataRange().getValues();
    var ch = safeHeaderMap(cfgData[0]);

    var ssidCol = findCol(ch,
      ['satellite_id', 'satelliteid', 'ssid', 'SatelliteId', 'Satellite_ID'],
      cfgData[0],
      ['satelliteid', 'satellite_id', 'ssid']
    );

    var cfgStatusCol = findCol(ch,
      ['status', 'Status'],
      cfgData[0],
      ['status']
    );

    for (var ci = 1; ci < cfgData.length; ci++) {
      var ssid = (ssidCol !== undefined) ? String(cfgData[ci][ssidCol] || '').trim() : '';
      if (!ssid || ssid.indexOf('PASTE_') >= 0) continue;
      totalLeagues++;
      var cfgStatus = (cfgStatusCol !== undefined)
        ? String(cfgData[ci][cfgStatusCol] || '').trim().toLowerCase()
        : '';
      if (cfgStatus === 'active') activeLeagues++;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Acca stats
  // ═══════════════════════════════════════════════════════════════
  var totalAccas = 0, wonAccas = 0, lostAccas = 0, pendingAccas = 0;

  var resultsSheet = (typeof getSheetInsensitive === 'function')
    ? getSheetInsensitive(ss, 'Acca_Results')
    : ss.getSheetByName('Acca_Results');

  if (resultsSheet && resultsSheet.getLastRow() > 1) {
    var rd = resultsSheet.getDataRange().getValues();
    var rh = safeHeaderMap(rd[0]);

    var rstCol = findCol(rh,
      ['status', 'Status'],
      rd[0],
      ['status']
    );

    for (var ri = 1; ri < rd.length; ri++) {
      if (!rd[ri][0]) continue;
      totalAccas++;
      var st = (rstCol !== undefined)
        ? String(rd[ri][rstCol] || '').toUpperCase().trim()
        : '';
      if (st === 'WON') wonAccas++;
      else if (st === 'LOST') lostAccas++;
      else pendingAccas++;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Results stats
  // ═══════════════════════════════════════════════════════════════
  var totalGames = 0, finishedGames = 0;

  var resultsTempSheet = (typeof getSheetInsensitive === 'function')
    ? getSheetInsensitive(ss, 'Results_Temp')
    : ss.getSheetByName('Results_Temp');

  if (resultsTempSheet && resultsTempSheet.getLastRow() > 1) {
    var rt = resultsTempSheet.getDataRange().getValues();
    totalGames = rt.length - 1;
    var rth = safeHeaderMap(rt[0]);

    var rtStatusCol = findCol(rth,
      ['status', 'Status'],
      rt[0],
      ['status']
    );

    for (var gi = 1; gi < rt.length; gi++) {
      var gSt = (rtStatusCol !== undefined)
        ? String(rt[gi][rtStatusCol] || '').toUpperCase().trim()
        : String(rt[gi][16] || '').toUpperCase().trim();   // legacy positional fallback
      if (gSt === 'FT' || gSt === 'FINAL' || gSt === 'FINISHED' || gSt === 'AET') {
        finishedGames++;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Derived KPIs
  // ═══════════════════════════════════════════════════════════════
  var completedAccas = wonAccas + lostAccas;
  var winRate = completedAccas > 0
    ? ((wonAccas / completedAccas) * 100).toFixed(1) + '%'
    : 'N/A';
  var edgeCoverage = totalBets > 0
    ? ((assayerEdgeMatched / totalBets) * 100).toFixed(1) + '%'
    : 'N/A';
  var purityBlockRate = totalBets > 0
    ? ((assayerPurityBlocked / totalBets) * 100).toFixed(1) + '%'
    : 'N/A';

  // ═══════════════════════════════════════════════════════════════
  // Ensure labels exist (creates rows if missing)
  // ═══════════════════════════════════════════════════════════════
  ensureRow('Snipers:', 'Risky Bets:', 0);
  ensureRow('Win Rate:', 'Assayer Edge Coverage:', 'N/A');
  ensureRow('Assayer Edge Coverage:', 'Purity Block Rate:', 'N/A');

  // ═══════════════════════════════════════════════════════════════
  // Write KPIs by label
  // ═══════════════════════════════════════════════════════════════
  setKpi('Total Leagues:', totalLeagues);
  setKpi('Active Leagues:', activeLeagues);
  setKpi('Last Sync:', new Date().toLocaleString());
  setKpi('Total Bets Synced:', totalBets);
  setKpi('Bankers:', bankers);
  setKpi('Snipers:', snipers);
  setKpi('Risky Bets:', riskyBets);
  setKpi('Total Games:', totalGames);
  setKpi('Finished Games:', finishedGames);
  setKpi('Total Accas Built:', totalAccas);
  setKpi('Accas Won:', wonAccas);
  setKpi('Accas Lost:', lostAccas);
  setKpi('Accas Pending:', pendingAccas);
  setKpi('Win Rate:', winRate);
  setKpi('Assayer Edge Coverage:', edgeCoverage);
  setKpi('Purity Block Rate:', purityBlockRate);

  Logger.log('[HiveMind] Dashboard updated: ' + totalBets + ' bets (' +
    bankers + ' bankers, ' + snipers + ' snipers, ' + riskyBets + ' risky)');
}



/**
 * Main function to analyze all bet performance
 * VERSION: 2.0 with enhanced logging
 */
function analyzeBetPerformance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    Logger.log('[Performance] Running without UI');
  }

  try {
    ss.toast('📊 Analyzing bet performance...', 'Performance', 10);
  } catch (e) {}

  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════╗');
  Logger.log('║              BET PERFORMANCE ANALYZER v2.0                   ║');
  Logger.log('╚══════════════════════════════════════════════════════════════╝');
  Logger.log(`[INIT] Start time: ${new Date().toLocaleString()}`);
  Logger.log('');

  try {
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.log('STEP 1: Loading results from Results_Temp');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const resultsMap = _loadResultsTempWithLogging(ss);
    const resultCount = Object.keys(resultsMap).length / 2;
    Logger.log(`✅ Loaded ${resultCount} unique games from Results_Temp`);

    if (resultCount === 0) {
      throw new Error('No results in Results_Temp. Run "Sync Results" first.');
    }

    Logger.log('');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.log('STEP 2: Grading bets from Sync_Temp');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const gradedBets = _gradeAllBetsWithLogging(ss, resultsMap);

    // Phase 2 patch: annotate graded bets with Assayer info for reporting
    try {
      const assayer = _getAssayerDataCached_();
      if (assayer) {
        for (let i = 0; i < gradedBets.length; i++) {
          gradedBets[i]._assayer = assayerAnnotateBetForMother_(gradedBets[i], assayer);
        }
        Logger.log(`[Performance] 🧪 Assayer annotated ${gradedBets.length} bets`);
      } else {
        Logger.log('[Performance] 🧪 Assayer not available (neutral)');
      }
    } catch (e) {
      Logger.log('[Performance] 🧪 Assayer annotation failed (neutral): ' + e.message);
    }

    Logger.log('');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.log('STEP 3: Writing performance report');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    _writePerformanceReport(ss, gradedBets);

    try {
      _updateDashboardWithPerformance(ss, gradedBets);
    } catch (e) {
      Logger.log(`[Dashboard] Update failed: ${e.message}`);
    }

    const summary = _buildPerformanceSummary(gradedBets);

    Logger.log('');
    Logger.log('╔══════════════════════════════════════════════════════════════╗');
    Logger.log('║              PERFORMANCE ANALYSIS COMPLETE                   ║');
    Logger.log('╚══════════════════════════════════════════════════════════════╝');

    if (ui) ui.alert('📊 Bet Performance Analysis', summary, ui.ButtonSet.OK);
    else Logger.log(summary);

  } catch (e) {
    Logger.log(`❌ ERROR: ${e.message}`);
    Logger.log(`Stack: ${e.stack}`);
    if (ui) ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}

/**
 * Load results from Results_Temp with detailed logging
 */
function _loadResultsTempWithLogging(ss) {
  const sheet = _getSheet(ss, 'Results_Temp');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('[Results_Temp] ❌ Sheet empty or missing');
    return {};
  }
  
  const data = sheet.getDataRange().getValues();
  Logger.log(`[Results_Temp] Total rows: ${data.length}`);
  Logger.log(`[Results_Temp] Headers: ${data[0].slice(0, 10).join(' | ')}`);
  
  const headers = data[0];
  const headerMap = _createHeaderMap(headers);
  Logger.log(`[Results_Temp] Mapped columns: ${JSON.stringify(headerMap)}`);
  
  const results = {};
  const leagueStats = {};
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const league = String(row[headerMap['league']] || '').trim();
    const home = String(row[headerMap['home']] || '').trim();
    const away = String(row[headerMap['away']] || '').trim();
    const dateRaw = row[headerMap['date']];
    const status = String(row[headerMap['status']] || '').toUpperCase();
    
    if (!home || !away) continue;
    
    // Track league stats
    if (!leagueStats[league]) {
      leagueStats[league] = { total: 0, finished: 0, dates: new Set() };
    }
    leagueStats[league].total++;
    leagueStats[league].dates.add(String(dateRaw || ''));
    
    // Parse quarter scores
    const quarters = {
      q1: headerMap['q1'] !== undefined ? row[headerMap['q1']] : null,
      q2: headerMap['q2'] !== undefined ? row[headerMap['q2']] : null,
      q3: headerMap['q3'] !== undefined ? row[headerMap['q3']] : null,
      q4: headerMap['q4'] !== undefined ? row[headerMap['q4']] : null
    };
    
    // Parse FT score
    const ftRaw = headerMap['ft score'] !== undefined ? row[headerMap['ft score']] : '';
    const ftStr = String(ftRaw).replace(/[–—−]/g, '-');
    const ftMatch = ftStr.match(/(\d+)\s*-\s*(\d+)/);
    const homeScore = ftMatch ? parseInt(ftMatch[1], 10) : 0;
    const awayScore = ftMatch ? parseInt(ftMatch[2], 10) : 0;
    const winner = homeScore > awayScore ? 1 : (awayScore > homeScore ? 2 : 0);
    
    const isFinished = ['FT', 'FINAL', 'FINISHED', 'AET', 'AOT'].includes(status);
    if (isFinished) {
      leagueStats[league].finished++;
    }
    
    const resultObj = {
      league,
      home,
      away,
      date: _formatDateValue(dateRaw),
      dateParsed: _parseDateString(dateRaw),
      status,
      isFinished,
      quarters,
      homeScore,
      awayScore,
      winner,
      ftScore: ftRaw
    };
    
    // Create keys in both directions
    const primaryKey = _normalizeTeamKey(home, away);
    const reversedKey = _normalizeTeamKey(away, home);
    
    results[primaryKey] = resultObj;
    
    if (primaryKey !== reversedKey) {
      results[reversedKey] = {
        ...resultObj,
        _reversed: true,
        home: away,
        away: home,
        homeScore: awayScore,
        awayScore: homeScore,
        winner: winner === 1 ? 2 : (winner === 2 ? 1 : 0),
        quarters: {
          q1: _swapQuarterScore(quarters.q1),
          q2: _swapQuarterScore(quarters.q2),
          q3: _swapQuarterScore(quarters.q3),
          q4: _swapQuarterScore(quarters.q4)
        }
      };
    }
  }
  
  // Log league breakdown
  Logger.log('');
  Logger.log('[Results_Temp] Games by league:');
  for (const [league, stats] of Object.entries(leagueStats)) {
    const dates = Array.from(stats.dates).slice(0, 3).join(', ');
    Logger.log(`   ${league}: ${stats.total} games (${stats.finished} finished) | Dates: ${dates}...`);
  }
  
  return results;
}

/**
 * Grade all bets with logging
 */
function _gradeAllBetsWithLogging(ss, resultsMap) {
  var syncSheet = _getSheet(ss, 'Sync_Temp');
  if (!syncSheet) throw new Error('Sync_Temp sheet not found');

  // ════════════════════════════════════════════════════════
  // LOCAL HELPERS (no new module)
  // ════════════════════════════════════════════════════════
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

  // Drop detection: broadened beyond 'DROPP' to include EXPIRED bets that missed slips
  var DROP_SIGNALS = ['DROPP', 'BLOCK', 'REJECT', 'FILTER', 'SKIP', 'EXPIRED'];
  var isDroppedStatus_ = function(status) {
    var s = String(status || '').toUpperCase().trim();
    for (var i = 0; i < DROP_SIGNALS.length; i++) {
      if (s.indexOf(DROP_SIGNALS[i]) >= 0) return true;
    }
    return false;
  };

  // Reason key extraction from Note column (your current Bet_Audit layout)
  var reasonKeyFromNote_ = function(note) {
    var s = String(note || '').trim();
    if (!s) return 'UNKNOWN';
    // Extract leading CODE token: "EDGE_INSUFFICIENT — some detail" → "EDGE_INSUFFICIENT"
    var m = s.match(/^([A-Z][A-Z0-9_]+)/);
    if (m && m[1]) return m[1];
    // Fallback: truncate
    return s.slice(0, 40).replace(/\s+/g, '_').toUpperCase();
  };

  // Extract REASONS[...] from proofLog if present (future-proof)
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

  /**
   * Multi-strategy result lookup with guarded fuzzy fallback.
   * Addresses criticism: date guard + both-sides ≥ 0.5 + threshold 0.80
   */
  var lookupResultByTeams_ = function(home, away, dateRaw) {
    // Strategy 1: canonical key
    try {
      var k1 = _normalizeTeamKey(home, away);
      var k2 = _normalizeTeamKey(away, home);
      var r = getFromResults_(k1) || getFromResults_(k2);
      if (r) return r;
    } catch (e) {}

    // Strategy 2: match-key variants
    try {
      var keys = (_generateAllMatchKeys(home, away) || [])
        .concat(_generateAllMatchKeys(away, home) || []);
      for (var ki = 0; ki < keys.length; ki++) {
        var r2 = getFromResults_(keys[ki]);
        if (r2) return r2;
      }
    } catch (e) {}

    // Strategy 3: existing partial matcher
    try {
      if (typeof _findPartialMatch === 'function') {
        var r3 = _findPartialMatch(home, away, resultsMap);
        if (r3) return r3;
      }
    } catch (e) {}

    // Strategy 4: fuzzy scan (GUARDED)
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
      if (parts.length !== 2) continue;

      var rHome = String(parts[0] || '').toLowerCase();
      var rAway = String(parts[1] || '').toLowerCase();

      // Compute per-side Jaccard
      var homeDirectJ = jaccard_(hT, tokenSet_(rHome));
      var awayDirectJ = jaccard_(aT, tokenSet_(rAway));
      var homeSwapJ   = jaccard_(hT, tokenSet_(rAway));
      var awaySwapJ   = jaccard_(aT, tokenSet_(rHome));

      var scoreDirect = (homeDirectJ + awayDirectJ) / 2;
      var scoreSwap   = (homeSwapJ + awaySwapJ) / 2;

      // GUARD: both individual sides must score >= 0.5
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

      // DATE GUARD: if both bet and result have dates, they must match
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

  /**
   * Write Dropped_Performance sheet.
   * Clears and rewrites each run (Bet_Audit is the source of truth).
   * RunID column provides traceability.
   */
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

    // Summary section below data
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

  // ════════════════════════════════════════════════════════
  // PART 1: Grade Sync_Temp (existing behavior preserved)
  // ════════════════════════════════════════════════════════
  var data = syncSheet.getDataRange().getValues();
  if (data.length < 2) return [];

  var headers = _createHeaderMap(data[0]);
  Logger.log('[Sync_Temp] Total bets: ' + (data.length - 1));

  var leagueCol = headers['league'];
  var dateCol   = headers['date'];
  var timeCol   = headers['time'];
  var matchCol  = headers['match'];
  var pickCol   = headers['pick'];
  var typeCol   = headers['type'];
  var oddsCol   = headers['odds'];
  var confCol   = headers['confidence'];

  if (matchCol === undefined || pickCol === undefined) {
    throw new Error('Sync_Temp missing Match/Pick columns');
  }

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var gradedBets = [];
  var stats = { total: 0, won: 0, lost: 0, pending: 0, upcoming: 0, noResult: 0, error: 0 };
  var noResultLeagues = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    var league     = leagueCol !== undefined ? String(row[leagueCol] || '').trim() : '';
    var dateRaw    = dateCol   !== undefined ? row[dateCol] : '';
    var time       = timeCol   !== undefined ? row[timeCol] : '';
    var matchStr   = matchCol  !== undefined ? String(row[matchCol] || '').trim() : '';
    var pickRaw    = pickCol   !== undefined ? String(row[pickCol] || '').trim() : '';
    var betType    = typeCol   !== undefined ? String(row[typeCol] || '').trim() : '';
    var odds       = oddsCol   !== undefined ? row[oddsCol] : '';
    var confidence = confCol   !== undefined ? row[confCol] : '';

    if (!matchStr || !pickRaw) continue;

    stats.total++;

    var dateStr = _formatDateValue(dateRaw);
    var parsed  = parseMatch_(matchStr);
    var home    = String(parsed.home || '').trim();
    var away    = String(parsed.away || '').trim();

    if (!home || !away) {
      stats.error++;
      gradedBets.push({
        league: league, date: dateStr, time: time, match: matchStr,
        home: home, away: away, pick: pickRaw, betType: betType,
        odds: odds, confidence: confidence,
        result: null, grade: 'ERROR', reason: 'Could not parse match'
      });
      continue;
    }

    var betDate = tryParseDate_(dateRaw);
    if (betDate && betDate > today) {
      stats.upcoming++;
      gradedBets.push({
        league: league, date: dateStr, time: time, match: matchStr,
        home: home, away: away, pick: pickRaw, betType: betType,
        odds: odds, confidence: confidence,
        result: null, grade: 'UPCOMING', reason: 'Game not yet played'
      });
      continue;
    }

    var result = lookupResultByTeams_(home, away, dateRaw);

    if (!result) {
      stats.noResult++;
      noResultLeagues[league] = (noResultLeagues[league] || 0) + 1;
      gradedBets.push({
        league: league, date: dateStr, time: time, match: matchStr,
        home: home, away: away, pick: pickRaw, betType: betType,
        odds: odds, confidence: confidence,
        result: null, grade: 'NO RESULT', reason: 'Game not found in results'
      });
      continue;
    }

    if (!result.isFinished) {
      stats.pending++;
      gradedBets.push({
        league: league, date: dateStr, time: time, match: matchStr,
        home: home, away: away, pick: pickRaw, betType: betType,
        odds: odds, confidence: confidence,
        result: result, grade: 'PENDING', reason: 'Status: ' + result.status
      });
      continue;
    }

    var pickClean = _sanitizePickForID_(pickRaw);
    var gradeResult = _gradePickDetailed(pickClean, result, home, away);

    if (gradeResult.grade === 'WON') stats.won++;
    else if (gradeResult.grade === 'LOST') stats.lost++;
    else if (gradeResult.grade !== 'PUSH') stats.error++;

    gradedBets.push({
      league: league, date: dateStr, time: time, match: matchStr,
      home: home, away: away,
      pick: pickRaw, pickClean: pickClean, betType: betType,
      odds: odds, confidence: confidence,
      result: result,
      grade: gradeResult.grade,
      reason: gradeResult.reason,
      actualScore: result.ftScore,
      quarterScores: result.quarters
    });
  }

  Logger.log('');
  Logger.log('[Grading Summary - Sync_Temp]');
  Logger.log('   Total: ' + stats.total);
  Logger.log('   Won: ' + stats.won);
  Logger.log('   Lost: ' + stats.lost);
  Logger.log('   Pending: ' + stats.pending);
  Logger.log('   Upcoming: ' + stats.upcoming);
  Logger.log('   No Result: ' + stats.noResult);
  Logger.log('   Error: ' + stats.error);

  if (Object.keys(noResultLeagues).length > 0) {
    Logger.log('');
    Logger.log('[NO RESULT by League]');
    var nlKeys = Object.keys(noResultLeagues);
    for (var nli = 0; nli < nlKeys.length; nli++) {
      Logger.log('   ' + (nlKeys[nli] || 'UNKNOWN') + ': ' + noResultLeagues[nlKeys[nli]]);
    }
  }

  // ════════════════════════════════════════════════════════
  // PART 2: Grade DROPPED bets from Bet_Audit
  // ════════════════════════════════════════════════════════
  try {
    var audit = _getSheet(ss, 'Bet_Audit');
    if (audit && audit.getLastRow() > 1) {
      var ad = audit.getDataRange().getValues();

      // ── SCAN for header row (Bet_Audit has title blocks above the data) ──
      var headerRow = -1;
      for (var scanR = 0; scanR < Math.min(30, ad.length); scanR++) {
        var scanRowNorm = (ad[scanR] || []).map(function(c) {
          return normHead(c);
        });
        // Header must contain at least 'status' + one of 'match'/'betid'
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
        Logger.log('[Dropped_Performance] Could not find Bet_Audit header row (scanned 30 rows)');
      } else {
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
        // Note column is the primary source of drop reasons in your current layout
        var iNote       = idx(['note','drop_reason','reason','block_reason','rejection_reason']);
        // Future-proof: discrete code columns if they exist
        var iReasonCode = idx(['drop_reason_code','reason_code','block_reason_code',
                               'primary_block_reason','primaryblockreason']);
        var iProof      = idx(['prooflog','proof_log','assayer_prooflog',
                               'assayer_proof_log']);

        Logger.log('[Bet_Audit] Header found at row ' + (headerRow + 1) +
                   ' | status=' + iStatus + ' match=' + iMatch +
                   ' pick=' + iPick + ' note=' + iNote);

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

          // ReasonKey priority:
          // 1. Explicit discrete code column (if populated)
          // 2. Parsed from proofLog REASONS[...]
          // 3. Leading CODE token from Note column
          // 4. 'UNKNOWN'
          var proofCodes = extractReasonCodesFromProofLog_(aProofLog);
          var reasonKey =
            aReasonCode ||
            (proofCodes.length ? proofCodes[0] : '') ||
            reasonKeyFromNote_(aNote) ||
            'UNKNOWN';

          var aDateStr = _formatDateValue(aDateRaw);
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

          if (!aResult.isFinished) {
            rec.grade = 'PENDING';
            rec.reason = 'Status: ' + aResult.status;
            bumpSummary_(reasonKey, rec);
            droppedRows.push(rec);
            continue;
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

          Logger.log('');
          Logger.log('[Dropped_Performance] RunID=' + RUN_ID);
          Logger.log('   Rows graded: ' + droppedRows.length);
          Logger.log('   WinRate (W/L only): ' + (totalWR * 100).toFixed(2) + '% over ' + totalWL + ' decisions');
          Logger.log('   Reason keys: ' + sKeys.join(', '));
        } else {
          Logger.log('[Dropped_Performance] No dropped rows found in Bet_Audit');
        }
      }
    }
  } catch (e) {
    Logger.log('[Dropped_Performance] Skipped: ' + (e && e.message ? e.message : e));
  }

  // Return unchanged: Sync_Temp graded array only
  return gradedBets;
}


/**
 * Helper: Format time value for display
 */
function _formatTimeValue(timeVal) {
  if (!timeVal) return '';
  
  if (timeVal instanceof Date) {
    const hours = timeVal.getHours().toString().padStart(2, '0');
    const mins = timeVal.getMinutes().toString().padStart(2, '0');
    return `${hours}:${mins}`;
  }
  
  return String(timeVal).trim();
}


/**
 * SYNC RISKY BETS TO SYNC_TEMP (UI wrapper)
 * FIX: Delegates to _syncRiskyBetsSilent so logic is not duplicated.
 */
function syncRiskyBetsToSyncTemp() {
  var FUNC_NAME = 'syncRiskyBetsToSyncTemp';
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) {}

  Logger.log('[' + FUNC_NAME + '] ======================================');
  Logger.log('[' + FUNC_NAME + '] SYNCING RISKY BETS TO SYNC_TEMP');
  Logger.log('[' + FUNC_NAME + '] ======================================');

  try { ss.toast('Syncing risky bets...', 'Risky Sync', 10); } catch (e) {}

  try {
    var res = _syncRiskyBetsSilent(ss) || { added: 0, tierCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 }, mode: 'NONE', skipped: 0 };

    if (!res.added) {
      Logger.log('[' + FUNC_NAME + '] No new risky bets to add (skipped=' + (res.skipped || 0) + ')');
      if (ui) ui.alert('No Risky Bets',
        'No new pending risky bets found.\n\n' +
        'Skipped: ' + (res.skipped || 0) + '\nMode: ' + (res.mode || 'NONE') +
        '\n\nCheck execution logs for details.',
        ui.ButtonSet.OK);
      return;
    }

    Logger.log('[' + FUNC_NAME + '] Added ' + res.added + ' risky bets (' + res.mode + ')');
    try { ss.toast('Synced ' + res.added + ' risky bets', 'Success', 5); } catch (e) {}

    if (ui) {
      ui.alert(
        'Risky Bets Synced',
        'Added ' + res.added + ' risky bets to Sync_Temp.\n\n' +
        'HIGH: ' + res.tierCounts.HIGH + '\n' +
        'MEDIUM: ' + res.tierCounts.MEDIUM + '\n' +
        'LOW: ' + res.tierCounts.LOW + '\n\n' +
        'Skipped: ' + (res.skipped || 0) + '\n' +
        'Mode: ' + res.mode,
        ui.ButtonSet.OK
      );
    }
  } catch (e) {
    Logger.log('[' + FUNC_NAME + '] ERROR: ' + e.message);
    Logger.log(e.stack || '');
    if (ui) ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}



/**
 * Satellite fallback: scans Analysis_Tier1 for rows where the magolide pred
 * column contains "RISKY". Does NOT depend on tier/strategy columns.
 * Derives strategy by comparing magolide prediction number vs forebet prediction.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @return {Array<Object>} Array of bet-like objects
 */
function _riskyFallbackSatelliteScan_(ss) {
  var FUNC = '_riskyFallbackSatelliteScan_';
  var out = [];

  try {
    var configSheet = (typeof getSheetInsensitive === 'function')
      ? getSheetInsensitive(ss, 'Config')
      : ss.getSheetByName('Config');
    if (!configSheet || configSheet.getLastRow() < 2) return out;

    var configData = configSheet.getDataRange().getValues();
    var cfgH = _createHeaderMap(configData[0]);

    // Support both ID-based and URL-based satellite access
    var ssidCol = cfgH['satellite_id'] !== undefined ? cfgH['satellite_id']
               : (cfgH['satelliteid'] !== undefined ? cfgH['satelliteid']
               : cfgH['ssid']);
    var urlCol = cfgH['file url'] !== undefined ? cfgH['file url'] : cfgH['url'];
    var leagueCol = cfgH['league'] !== undefined ? cfgH['league'] : cfgH['league name'];
    var statusCol = cfgH['status'];

    if (ssidCol === undefined && urlCol === undefined) {
      Logger.log('[' + FUNC + '] Config missing satellite_id and url columns');
      return out;
    }

    var processed = {};

    for (var i = 1; i < configData.length; i++) {
      var ssid = ssidCol !== undefined ? String(configData[i][ssidCol] || '').trim() : '';
      var fileUrl = urlCol !== undefined ? String(configData[i][urlCol] || '').trim() : '';
      var league = leagueCol !== undefined ? String(configData[i][leagueCol] || '').trim() : '';
      var cfgStatus = statusCol !== undefined ? String(configData[i][statusCol] || 'active').toLowerCase().trim() : 'active';

      if (cfgStatus !== 'active') continue;

      var satKey = ssid || fileUrl;
      if (!satKey || processed[satKey]) continue;
      if (satKey.indexOf('PASTE_') >= 0) continue;
      processed[satKey] = true;

      try {
        var satellite;
        if (ssid && ssid.length > 10 && ssid.indexOf('http') < 0) {
          satellite = SpreadsheetApp.openById(ssid);
        } else if (fileUrl && fileUrl.indexOf('http') === 0) {
          satellite = SpreadsheetApp.openByUrl(fileUrl);
        } else {
          continue;
        }

        var analysisSheet = satellite.getSheetByName('Analysis_Tier1');
        if (!analysisSheet || analysisSheet.getLastRow() < 2) {
          Logger.log('[' + FUNC + ']   ' + (league || satKey) + ': No Analysis_Tier1 or empty');
          continue;
        }

        var data = analysisSheet.getDataRange().getValues();
        var h = _createHeaderMap(data[0]);

        var aHomeCol = h['home'] !== undefined ? h['home'] : h['home team'];
        var aAwayCol = h['away'] !== undefined ? h['away'] : h['away team'];
        var aDateCol = h['date'];
        var aTimeCol = h['time'] !== undefined ? h['time'] : h['kickoff'];
        var aOddsCol = h['odds'];
        var aConfCol = h['confidence'] !== undefined ? h['confidence']
                     : (h['confidence %'] !== undefined ? h['confidence %'] : h['conf']);

        // KEY: look for "magolide pred" / "pred" column (contains "RISKY")
        var aMagPredCol = h['magolide pred'] !== undefined ? h['magolide pred']
                        : (h['pred'] !== undefined ? h['pred']
                        : (h['pick'] !== undefined ? h['pick'] : h['prediction']));

        // Forebet pred column (1 or 2)
        var aFbPredCol = h['forebet pred'] !== undefined ? h['forebet pred']
                       : (h['fb pred'] !== undefined ? h['fb pred']
                       : (h['forebetpred'] !== undefined ? h['forebetpred'] : h['fbpred']));

        if (aHomeCol === undefined || aAwayCol === undefined || aMagPredCol === undefined) {
          Logger.log('[' + FUNC + ']   ' + (league || satKey) + ': Missing home/away/magPred columns. Headers: ' + JSON.stringify(h));
          continue;
        }

        var found = 0;

        for (var j = 1; j < data.length; j++) {
          var row = data[j];
          var home = String(row[aHomeCol] || '').trim();
          var away = String(row[aAwayCol] || '').trim();
          if (!home || !away) continue;

          // FIX: Check if magPred contains "RISKY" — the CORRECT indicator
          var magPredRaw = String(row[aMagPredCol] || '').toUpperCase().trim();
          if (magPredRaw.indexOf('RISKY') < 0) continue;

          // Need forebetPred to derive pick
          var forebetPred = aFbPredCol !== undefined ? parseInt(row[aFbPredCol], 10) : NaN;
          if (forebetPred !== 1 && forebetPred !== 2) continue;

          // Extract magolide prediction number (if present) to determine strategy
          var magNum = parseInt(magPredRaw.replace(/[^0-9]/g, ''), 10);
          var strategy = '';
          var tier = 'MEDIUM';

          if (!isNaN(magNum) && (magNum === 1 || magNum === 2)) {
            if (magNum !== forebetPred) {
              strategy = 'against';
              tier = 'HIGH';
            } else {
              strategy = 'with';
              tier = 'LOW';
            }
          } else {
            // Can't determine — default to against (most common risky)
            strategy = 'against';
            tier = 'MEDIUM';
          }

          var strategyLabel = (strategy === 'against') ? 'vs FB' : 'w FB';

          // Derive gradable pick
          var pick = '';
          if (strategy === 'against') {
            pick = (forebetPred === 1) ? (away + ' Win') : (home + ' Win');
          } else {
            pick = (forebetPred === 1) ? (home + ' Win') : (away + ' Win');
          }

          var dateRaw = aDateCol !== undefined ? row[aDateCol] : '';
          var timeRaw = aTimeCol !== undefined ? row[aTimeCol] : '';
          var odds = aOddsCol !== undefined ? row[aOddsCol] : '';
          var conf = aConfCol !== undefined ? row[aConfCol] : '';

          out.push({
            league: league,
            home: home,
            away: away,
            match: home + ' vs ' + away,
            date: dateRaw,
            time: timeRaw,
            forebetPred: forebetPred,
            pick: pick,
            type: ('RISKY ' + tier + ' ' + strategyLabel).replace(/\s+/g, ' ').trim(),
            tier: tier,
            strategy: strategy,
            odds: odds,
            confidence: conf,
            recommendedAction: ''
          });

          found++;
        }

        Logger.log('[' + FUNC + ']   ' + (league || satKey) + ': ' + found + ' risky bets found');

      } catch (satErr) {
        Logger.log('[' + FUNC + ']   ❌ ' + (league || satKey) + ': ' + satErr.message);
      }
    }
  } catch (e) {
    Logger.log('[' + FUNC + '] FATAL: ' + e.message);
  }

  return out;
}



/**
 * Load Results_Temp into a keyed lookup map.
 * PATCHED: normalizeForKey moved outside loop, try-catch per row,
 *          safe ftScore column resolution that excludes quarter columns,
 *          always returns a valid object.
 */
function _loadResultsTemp(ss) {
  var FUNC_NAME = '_loadResultsTemp';

  var sheet = ss.getSheetByName('Results_Temp');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('[' + FUNC_NAME + '] Results_Temp empty or missing');
    return {};
  }

  var data    = sheet.getDataRange().getValues();
  var headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });

  /**
   * Safe column finder — avoids quarter-score headers for FT score
   */
  var findCol = function(aliases, excludePatterns) {
    excludePatterns = excludePatterns || [];

    var isExcluded = function(hdr) {
      for (var e = 0; e < excludePatterns.length; e++) {
        if (excludePatterns[e].test(hdr)) return true;
      }
      return false;
    };

    // Exact match
    for (var a = 0; a < aliases.length; a++) {
      var alias = String(aliases[a]).toLowerCase();
      var idx   = headers.indexOf(alias);
      if (idx >= 0 && !isExcluded(headers[idx])) return idx;
    }

    // Partial match
    for (var i = 0; i < headers.length; i++) {
      for (var a2 = 0; a2 < aliases.length; a2++) {
        if (headers[i].indexOf(String(aliases[a2]).toLowerCase()) >= 0 && !isExcluded(headers[i])) {
          return i;
        }
      }
    }
    return -1;
  };

  var quarterExclusion = [/\bq[1-4]\b/i];

  var cols = {
    league:  findCol(['league', 'competition']),
    home:    findCol(['home', 'home team', 'hometeam']),
    away:    findCol(['away', 'away team', 'awayteam']),
    date:    findCol(['date', 'game date']),
    status:  findCol(['status', 'game status']),
    ftScore: findCol(['ft score', 'ftscore', 'final score', 'full time', 'ft', 'final'], quarterExclusion),
    q1:      findCol(['q1', 'quarter 1', 'quarter1', 'q1 score']),
    q2:      findCol(['q2', 'quarter 2', 'quarter2', 'q2 score']),
    q3:      findCol(['q3', 'quarter 3', 'quarter3', 'q3 score']),
    q4:      findCol(['q4', 'quarter 4', 'quarter4', 'q4 score']),
    ot:      findCol(['ot', 'overtime'])
  };

  if (cols.home < 0 || cols.away < 0) {
    Logger.log('[' + FUNC_NAME + '] Missing Home/Away columns');
    return {};
  }

  var FINISHED_STATUSES = ['FT', 'FINAL', 'FINISHED', 'AET', 'AOT', 'OT',
                           'COMPLETE', 'COMPLETED', 'ENDED', 'FULL TIME'];

  /* ── helper moved OUTSIDE the loop ── */
  var normalizeForKey = function(str) {
    return String(str || '').toLowerCase().trim().replace(/[^\w]/g, '');
  };

  var results   = {};
  var gameCount = 0;

  for (var i = 1; i < data.length; i++) {
    try {
      var row  = data[i];
      var home = String(row[cols.home] || '').trim();
      var away = String(row[cols.away] || '').trim();
      if (!home || !away) continue;
      gameCount++;

      var league  = cols.league >= 0 ? String(row[cols.league] || '').trim() : '';
      var dateRaw = cols.date   >= 0 ? row[cols.date] : null;
      var status  = cols.status >= 0 ? String(row[cols.status] || '').toUpperCase().trim() : '';
      var ftRaw   = cols.ftScore >= 0 ? row[cols.ftScore] : '';

      // Parse FT score
      var ftStr   = String(ftRaw).replace(/[–—−]/g, '-').replace(/\s+/g, '');
      var ftMatch = ftStr.match(/(\d+)\s*[-:]\s*(\d+)/);
      var homeScore = ftMatch ? parseInt(ftMatch[1], 10) : null;
      var awayScore = ftMatch ? parseInt(ftMatch[2], 10) : null;

      var winner = null;
      if (homeScore !== null && awayScore !== null) {
        winner = homeScore > awayScore ? 1 : (awayScore > homeScore ? 2 : 0);
      }

      var statusFinished = FINISHED_STATUSES.indexOf(status) >= 0;
      var scoresValid    = homeScore !== null && awayScore !== null;
      var isFinished     = statusFinished || scoresValid;

      var quarters = {
        q1: cols.q1 >= 0 ? row[cols.q1] : null,
        q2: cols.q2 >= 0 ? row[cols.q2] : null,
        q3: cols.q3 >= 0 ? row[cols.q3] : null,
        q4: cols.q4 >= 0 ? row[cols.q4] : null,
        ot: cols.ot >= 0 ? row[cols.ot] : null
      };

      // Format date safely
      var dateFormatted = '';
      if (dateRaw) {
        if (dateRaw instanceof Date) {
          try {
            dateFormatted = Utilities.formatDate(dateRaw, Session.getScriptTimeZone(), 'yyyy-MM-dd');
          } catch (de) {
            dateFormatted = String(dateRaw);
          }
        } else {
          dateFormatted = String(dateRaw);
        }
      }

      var resultObj = {
        rowIndex:   i,
        league:     league,
        home:       home,
        away:       away,
        date:       dateFormatted,
        status:     status,
        isFinished: isFinished,
        quarters:   quarters,
        homeScore:  homeScore,
        awayScore:  awayScore,
        winner:     winner,
        ftScore:    ftRaw,
        _reversed:  false
      };

      // Primary keys
      var primaryKey  = normalizeForKey(home) + '|' + normalizeForKey(away);
      var reversedKey = normalizeForKey(away) + '|' + normalizeForKey(home);

      results[primaryKey] = resultObj;

      var altKey1 = home.toLowerCase().trim() + '|' + away.toLowerCase().trim();
      if (!results[altKey1]) results[altKey1] = resultObj;

      // Reversed result
      if (primaryKey !== reversedKey) {
        var reversedResult = {
          rowIndex:   i,
          league:     league,
          home:       away,
          away:       home,
          date:       dateFormatted,
          status:     status,
          isFinished: isFinished,
          quarters:   {
            q1: (typeof _swapQuarterScore === 'function') ? _swapQuarterScore(quarters.q1) : quarters.q1,
            q2: (typeof _swapQuarterScore === 'function') ? _swapQuarterScore(quarters.q2) : quarters.q2,
            q3: (typeof _swapQuarterScore === 'function') ? _swapQuarterScore(quarters.q3) : quarters.q3,
            q4: (typeof _swapQuarterScore === 'function') ? _swapQuarterScore(quarters.q4) : quarters.q4,
            ot: (typeof _swapQuarterScore === 'function') ? _swapQuarterScore(quarters.ot) : quarters.ot
          },
          homeScore:  awayScore,
          awayScore:  homeScore,
          winner:     winner === 1 ? 2 : (winner === 2 ? 1 : winner),
          ftScore:    ftRaw,
          _reversed:  true
        };

        results[reversedKey] = reversedResult;

        var altKey2 = away.toLowerCase().trim() + '|' + home.toLowerCase().trim();
        if (!results[altKey2]) results[altKey2] = reversedResult;
      }

    } catch (rowErr) {
      Logger.log('[' + FUNC_NAME + '] ⚠ Row ' + i + ' skipped: ' + (rowErr.message || rowErr));
    }
  }

  Logger.log('[' + FUNC_NAME + '] Loaded ' + gameCount + ' games -> ' + Object.keys(results).length + ' lookup keys');
  return results;
}

/**
 * Helper: Swap a quarter score from "21-15" to "15-21"
 */
function _swapQuarterScore(qScore) {
  if (!qScore) return null;
  const str = String(qScore).replace(/[–—−]/g, '-').replace(/\s/g, '');
  const parts = str.split('-');
  if (parts.length !== 2) return qScore;
  return `${parts[1]}-${parts[0]}`;
}

/**
 * IMPROVED: Normalize match key - consistent format regardless of input order
 */
function _normalizeMatchKey(home, away) {
  const normalize = (str) => {
    return String(str || '')
      .toLowerCase()
      .replace(/\s+w$/i, ' w')  // Keep W suffix consistent
      .replace(/[^\w\s]/g, '')   // Remove punctuation
      .replace(/\s+/g, ' ')      // Normalize spaces
      .trim();
  };
  
  return `${normalize(home)}|${normalize(away)}`;
}

/**
 * Normalize team names for matching
 */
function _normalizeTeamKey(team1, team2) {
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

/**
 * Grade all bets from Sync_Temp against results
 * FIXED: Distinguishes future games from missing results
 */
function _gradeAllBets(ss, resultsMap) {
  const syncSheet = _getSheet(ss, 'Sync_Temp');
  if (!syncSheet) {
    throw new Error('Sync_Temp sheet not found');
  }
  
  const data = syncSheet.getDataRange().getValues();
  if (data.length < 2) {
    return [];
  }
  
  const headers = _createHeaderMap(data[0]);
  Logger.log(`[Sync_Temp] Headers: ${Object.keys(headers).join(', ')}`);
  
  const leagueCol = headers['league'];
  const dateCol = headers['date'];
  const timeCol = headers['time'];
  const matchCol = headers['match'];
  const pickCol = headers['pick'];
  const typeCol = headers['type'];
  const oddsCol = headers['odds'];
  const confCol = headers['confidence'];
  
  if (matchCol === undefined || pickCol === undefined) {
    throw new Error('Sync_Temp missing Match/Pick columns');
  }
  
  // Get today's date at midnight for comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const gradedBets = [];
  let totalBets = 0, matchedBets = 0, unmatchedBets = 0, finishedBets = 0, futureBets = 0;
  
  Logger.log('');
  Logger.log('Grading all bets:');
  Logger.log('─────────────────────────────────────────────────────────────────');
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const league = leagueCol !== undefined ? String(row[leagueCol] || '').trim() : '';
    const dateRaw = dateCol !== undefined ? row[dateCol] : '';
    const time = timeCol !== undefined ? row[timeCol] : '';
    const matchStr = matchCol !== undefined ? String(row[matchCol] || '').trim() : '';
    const pick = pickCol !== undefined ? String(row[pickCol] || '').trim() : '';
    const betType = typeCol !== undefined ? String(row[typeCol] || '').trim() : '';
    const odds = oddsCol !== undefined ? row[oddsCol] : '';
    const confidence = confCol !== undefined ? row[confCol] : '';
    
    if (!matchStr || !pick) continue;
    if (!matchStr.toLowerCase().includes(' vs ')) continue;
    
    totalBets++;
    
    const dateStr = _formatDateValue(dateRaw);
    const { home, away } = _parseMatchStringForPerf(matchStr);
    
    if (!home || !away) {
      unmatchedBets++;
      gradedBets.push({
        league, date: dateStr, time, match: matchStr, home, away,
        pick, betType, odds, confidence,
        result: null, grade: 'ERROR', reason: 'Could not parse match'
      });
      continue;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // CHECK IF BET IS FOR A FUTURE GAME
    // ═══════════════════════════════════════════════════════════════
    const betDate = _parseDateString(dateRaw);
    if (betDate && betDate > today) {
      futureBets++;
      gradedBets.push({
        league, date: dateStr, time, match: matchStr, home, away,
        pick, betType, odds, confidence,
        result: null, grade: 'UPCOMING', reason: 'Game not yet played'
      });
      continue;
    }
    
    // Try to find result
    const key1 = _normalizeTeamKey(home, away);
    const key2 = _normalizeTeamKey(away, home);
    
    let result = resultsMap[key1] || resultsMap[key2];
    
    // If not found, try partial matching
    if (!result) {
      result = _findPartialMatch(home, away, resultsMap);
    }
    
    if (!result) {
      unmatchedBets++;
      gradedBets.push({
        league, date: dateStr, time, match: matchStr, home, away,
        pick, betType, odds, confidence,
        result: null, grade: 'NO RESULT', reason: 'Game not found in results'
      });
      continue;
    }
    
    matchedBets++;
    
    // Check if game is finished
    if (!result.isFinished) {
      gradedBets.push({
        league, date: dateStr, time, match: matchStr, home, away,
        pick, betType, odds, confidence,
        result, grade: 'PENDING', reason: `Status: ${result.status}`
      });
      continue;
    }
    
    finishedBets++;
    
    // Grade the pick
    const gradeResult = _gradePickDetailed(pick, result, home, away);
    
    gradedBets.push({
      league, date: dateStr, time, match: matchStr, home, away,
      pick, betType, odds, confidence,
      result, 
      grade: gradeResult.grade,
      reason: gradeResult.reason,
      actualScore: result.ftScore,
      quarterScores: result.quarters
    });
  }
  
  Logger.log('');
  Logger.log(`GRADING SUMMARY:`);
  Logger.log(`   Total: ${totalBets}`);
  Logger.log(`   Matched: ${matchedBets}`);
  Logger.log(`   Finished: ${finishedBets}`);
  Logger.log(`   Future: ${futureBets}`);
  Logger.log(`   Unmatched: ${unmatchedBets}`);
  
  return gradedBets;
}



/**
 * Parse match string for performance analysis
 */
function _parseMatchStringForPerf(matchStr) {
  const str = String(matchStr || '');
  const vsPatterns = [' vs ', ' vs. ', ' v ', ' @ '];
  
  for (const vs of vsPatterns) {
    if (str.toLowerCase().includes(vs.toLowerCase())) {
      const parts = str.split(new RegExp(vs, 'i'));
      if (parts.length === 2) {
        return { home: parts[0].trim(), away: parts[1].trim() };
      }
    }
  }
  return { home: '', away: '' };
}
/**
 * FIXED: Stricter token matching - requires MULTIPLE significant words to match
 * Prevents false positives like "Maccabi X" matching "Maccabi Y"
 */
function _findPartialMatch(home, away, resultsMap) {
  const normalize = (str) => String(str).toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+w$/i, '')  // Remove trailing W for women's teams
    .trim();
  
  const getTokens = (str) => {
    const normalized = normalize(str);
    // Get words with 3+ characters, excluding common words
    const commonWords = ['the', 'and', 'city', 'united', 'team', 'club'];
    return normalized.split(/\s+/)
      .filter(w => w.length > 2 && !commonWords.includes(w));
  };
  
  const homeTokens = getTokens(home);
  const awayTokens = getTokens(away);
  
  Logger.log(`      [Fuzzy] Looking for: "${home}" vs "${away}"`);
  Logger.log(`      [Fuzzy] Home tokens: ${homeTokens.join(', ')}`);
  Logger.log(`      [Fuzzy] Away tokens: ${awayTokens.join(', ')}`);
  
  for (const [key, res] of Object.entries(resultsMap)) {
    if (res._reversed) continue;
    
    const resHomeTokens = getTokens(res.home);
    const resAwayTokens = getTokens(res.away);
    
    // Count matching tokens for home team
    const homeMatchCount = homeTokens.filter(t => resHomeTokens.includes(t)).length;
    const homeMatchRatio = homeTokens.length > 0 ? homeMatchCount / homeTokens.length : 0;
    
    // Count matching tokens for away team
    const awayMatchCount = awayTokens.filter(t => resAwayTokens.includes(t)).length;
    const awayMatchRatio = awayTokens.length > 0 ? awayMatchCount / awayTokens.length : 0;
    
    // STRICT: Require at least 50% of tokens to match for BOTH teams
    // OR require the LAST token (usually the distinctive name) to match
    const homeLastMatch = homeTokens.length > 0 && resHomeTokens.length > 0 &&
                          homeTokens[homeTokens.length - 1] === resHomeTokens[resHomeTokens.length - 1];
    const awayLastMatch = awayTokens.length > 0 && resAwayTokens.length > 0 &&
                          awayTokens[awayTokens.length - 1] === resAwayTokens[resAwayTokens.length - 1];
    
    const homeMatch = homeMatchRatio >= 0.5 || homeLastMatch;
    const awayMatch = awayMatchRatio >= 0.5 || awayLastMatch;
    
    // Additional check: Prevent matching if key distinctive words DON'T match
    // e.g., "Ramat Gan" should NOT match "Petah Tikva"
    if (homeMatch && awayMatch) {
      // Verify it's not a false positive by checking if distinctive words conflict
      const homeConflict = homeTokens.some(t => 
        t.length > 4 && resHomeTokens.length > 0 && 
        !resHomeTokens.includes(t) && 
        !resHomeTokens.some(rt => rt.includes(t) || t.includes(rt))
      );
      const awayConflict = awayTokens.some(t => 
        t.length > 4 && resAwayTokens.length > 0 && 
        !resAwayTokens.includes(t) && 
        !resAwayTokens.some(rt => rt.includes(t) || t.includes(rt))
      );
      
      if (homeConflict || awayConflict) {
        continue; // Skip this match, likely a false positive
      }
      
      Logger.log(`      [Fuzzy] ✅ MATCH: "${res.home}" vs "${res.away}"`);
      return res;
    }
  }
  
  Logger.log(`      [Fuzzy] ❌ No match found`);
  return null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PERFORMANCE_ANALYZER.gs - PATCHED FOR SNIPER DIR
 * Handles grading of bets including SNIPER DIR O/U picks
 * ═══════════════════════════════════════════════════════════════════════════
 */
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * _gradePickDetailed — CONSOLIDATED PATCH
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Grades a single pick against a finished result.
 *
 * Supported pick formats:
 *   SNIPER DIR O/U : "Q4 UNDER 56.2", "Q1 OVER 58.9", "Q3 O 52", "Q2 U 48.5"
 *   BANKER / ML    : "Lakers Win", "Home Win", "Away ML", "moneyline"
 *   SNIPER margin  : "Q4: A +5.0", "Q1: H -3.5" → graded on QUARTER WINNER
 *   Legacy quarter : "Q1: H", "Q2: A", "Q3: Home", "Q4: Away"
 *   Bare codes     : "1", "2", "home", "away"
 *   Team name      : "lakers", "celtics" (fallback)
 *
 * Fixes applied:
 *  1. Unicode dashes (en-dash, em-dash, minus sign) → plain hyphen
 *  2. Quarter punctuation: "Q4: UNDER" / "Q4 - UNDER" → "Q4 UNDER"
 *  3. homeAwayFlag validated; derived from pick text if invalid/missing
 *  4. O/U shorthand tokens: "O"/"U" accepted alongside "OVER"/"UNDER"
 *  5. O/U push (total === line) → LOST (no PUSH in grade enum)
 *  6. Quarter margin picks grade on QUARTER WINNER (spread ignored)
 *  7. Tied quarters → LOST (neither side "wins the quarter")
 *  8. Word-boundary matching on "win"/"ml"/"moneyline" prevents false hits
 *  9. winner field handles both number (1/2) and string ("1"/"2")
 * 10. Self-contained — no external _gradeSinglePick dependency
 *
 * @param {string}  pickStr        - The pick string
 * @param {Object}  result         - { homeScore, awayScore, winner, quarters, home, away, isFinished }
 * @param {string}  originalHome   - Original home team name from bet data
 * @param {string}  originalAway   - Original away team name from bet data
 * @param {string}  [homeAwayFlag] - 'HOME'|'AWAY'|'NEUTRAL' (optional; derived if invalid)
 * @returns {{ grade: 'WON'|'LOST'|'PENDING'|'ERROR', reason: string }}
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
function _gradePickDetailed(pickStr, result, originalHome, originalAway, homeAwayFlag) {
  const FUNC_NAME = '_gradePickDetailed';

  try {
    // ═════════════════════════════════════════════════════════════════════
    // PRE-CLEAN: normalize unicode + quarter punctuation (from 6.1)
    // ═════════════════════════════════════════════════════════════════════

    // Normalize ALL unicode dash variants → plain hyphen
    // U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
    // U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar,
    // U+2212 minus sign
    let cleanPick = String(pickStr || '')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .trim();

    // "Q4: UNDER 56.2" or "Q4 - UNDER 56.2" → "Q4 UNDER 56.2"
    // Removes colon or hyphen between Q-number and the rest
    cleanPick = cleanPick.replace(/\bQ([1-4])\s*[:\-]\s*/ig, 'Q$1 ');

    const pick      = cleanPick.toLowerCase().trim();
    const pickUpper = cleanPick.toUpperCase().trim();

    // ═════════════════════════════════════════════════════════════════════
    // VALIDATE INPUTS
    // ═════════════════════════════════════════════════════════════════════
    if (!result) {
      return { grade: 'ERROR', reason: 'Missing result object' };
    }

    const {
      homeScore, awayScore, winner,
      quarters, home, away, isFinished
    } = result;

    if (!isFinished) {
      return { grade: 'PENDING', reason: 'Game not finished' };
    }

    // ═════════════════════════════════════════════════════════════════════
    // VALIDATE / DERIVE homeAwayFlag (from 6.1)
    //
    // If caller passes garbage or nothing, derive from pick text.
    // This is used as LAST-RESORT tiebreaker for ambiguous ML picks.
    // ═════════════════════════════════════════════════════════════════════
    const VALID_FLAGS = ['HOME', 'AWAY', 'NEUTRAL'];
    let flag = String(homeAwayFlag || '').toUpperCase().trim();

    if (VALID_FLAGS.indexOf(flag) < 0) {
      const up       = pickUpper;
      const homeStr  = originalHome ? String(originalHome).toUpperCase() : '';
      const awayStr  = originalAway ? String(originalAway).toUpperCase() : '';

      if      (homeStr && up.includes(homeStr))  flag = 'HOME';
      else if (awayStr && up.includes(awayStr))  flag = 'AWAY';
      else if (/\bHOME\b/.test(up))              flag = 'HOME';
      else if (/\bAWAY\b/.test(up))              flag = 'AWAY';
      else                                       flag = 'NEUTRAL';

      // Warn only if caller actually passed something invalid (not just omitted)
      if (homeAwayFlag) {
        Logger.log(
          `[${FUNC_NAME}] ⚠️ Invalid HomeAwayFlag "${homeAwayFlag}" ` +
          `→ derived "${flag}" for pick "${cleanPick}"`
        );
      }
    }

    // ═════════════════════════════════════════════════════════════════════
    // TEAM NAME HELPERS
    // ═════════════════════════════════════════════════════════════════════
    const normalizeName = (str) =>
      String(str || '')
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const homeNorm = normalizeName(home || originalHome);
    const awayNorm = normalizeName(away || originalAway);

    // Extract the last "meaningful" word (≥3 chars) as the team identifier.
    // e.g. "los angeles lakers" → "lakers"
    const getMainWord = (str) => {
      const words = String(str || '').split(' ').filter(w => w.length > 2);
      return words.length > 0 ? words[words.length - 1] : String(str || '');
    };

    const homeWord = getMainWord(homeNorm);
    const awayWord = getMainWord(awayNorm);

    // ═════════════════════════════════════════════════════════════════════
    // WINNER HELPER
    //
    // winner can be number (1/2) or string ("1"/"2") depending on
    // which result-fetcher populated it. Handle both.
    // Falls back to score comparison if winner field is missing.
    // ═════════════════════════════════════════════════════════════════════
    const getWinnerSide = () => {
      const w = (typeof winner === 'string') ? parseInt(winner, 10) : winner;
      if (w === 1) return 'HOME';
      if (w === 2) return 'AWAY';

      // Fallback: infer from final score
      if (typeof homeScore === 'number' && typeof awayScore === 'number') {
        if (homeScore > awayScore) return 'HOME';
        if (awayScore > homeScore) return 'AWAY';
      }
      return null; // draw or unknown
    };

    // ═════════════════════════════════════════════════════════════════════
    // QUARTER SCORE PARSER
    //
    // Handles: "25-22", "25 - 22", "25–22" (already normalized to "25-22")
    // Returns: { ok, homeQ, awayQ } or { ok:false, grade, reason }
    // ═════════════════════════════════════════════════════════════════════
    const parseQuarter = (qNum) => {
      const qKey = `q${qNum}`;
      const qRaw = quarters ? quarters[qKey] : null;

      if (qRaw === null || qRaw === undefined || qRaw === '') {
        return {
          ok: false,
          grade: 'PENDING',
          reason: `Q${qNum} score not available`
        };
      }

      const qStr = String(qRaw)
        .replace(/[–—−\u2010-\u2015\u2212]/g, '-')
        .replace(/\s+/g, '');

      const m = qStr.match(/^(\d+)-(\d+)$/);
      if (!m) {
        return {
          ok: false,
          grade: 'ERROR',
          reason: `Q${qNum} score format invalid: "${qRaw}"`
        };
      }

      return {
        ok: true,
        homeQ: parseInt(m[1], 10),
        awayQ: parseInt(m[2], 10)
      };
    };


    // ═══════════════════════════════════════════════════════════════════
    // ▐█▌ SECTION 1: SNIPER DIR O/U
    // ▐█▌ "Q4 UNDER 56.2", "Q1 OVER 58.9", "Q3 O 52", "Q2 U 48.5"
    // ═══════════════════════════════════════════════════════════════════
    {
      const ouMatch = pickUpper.match(
        /\bQ([1-4])\s+(OVER|UNDER|O|U)\s+([0-9]+(?:\.[0-9]+)?)\b/
      );

      if (ouMatch) {
        const qNum     = ouMatch[1];
        const dirToken = ouMatch[2].toUpperCase();
        const line     = parseFloat(ouMatch[3]);

        // Normalize shorthand O/U → full word
        const direction = (dirToken === 'O') ? 'OVER'
                        : (dirToken === 'U') ? 'UNDER'
                        : dirToken;

        const q = parseQuarter(qNum);
        if (!q.ok) return { grade: q.grade, reason: q.reason };

        const totalQ = q.homeQ + q.awayQ;

        // ── OVER ────────────────────────────────────────────────────
        if (direction === 'OVER') {
          if (totalQ === line) {
            return {
              grade: 'LOST',
              reason: `Q${qNum}: ${q.homeQ}+${q.awayQ}=${totalQ} ` +
                      `equals line ${line} (push → LOST)`
            };
          }
          const won = totalQ > line;
          return {
            grade: won ? 'WON' : 'LOST',
            reason: `Q${qNum}: ${q.homeQ}+${q.awayQ}=${totalQ} ` +
                    `vs line ${line} (OVER) ${won ? '✓' : '✗'}`
          };
        }

        // ── UNDER ───────────────────────────────────────────────────
        if (direction === 'UNDER') {
          if (totalQ === line) {
            return {
              grade: 'LOST',
              reason: `Q${qNum}: ${q.homeQ}+${q.awayQ}=${totalQ} ` +
                      `equals line ${line} (push → LOST)`
            };
          }
          const won = totalQ < line;
          return {
            grade: won ? 'WON' : 'LOST',
            reason: `Q${qNum}: ${q.homeQ}+${q.awayQ}=${totalQ} ` +
                    `vs line ${line} (UNDER) ${won ? '✓' : '✗'}`
          };
        }

        return { grade: 'ERROR', reason: `Unknown O/U direction: ${direction}` };
      }
    }


    // ═══════════════════════════════════════════════════════════════════
    // ▐█▌ SECTION 2: BANKER / MONEYLINE
    // ▐█▌ "Lakers Win", "Home Win", "Away ML", "moneyline"
    // ▐█▌
    // ▐█▌ Uses word boundaries to prevent false-positives like
    // ▐█▌ "Windham" matching "win"
    // ═══════════════════════════════════════════════════════════════════
    if (/\b(win|ml|moneyline)\b/i.test(cleanPick)) {
      let pickedHome = false;
      let pickedAway = false;

      // Priority 1: team name in pick text
      if (homeNorm && (pick.includes(homeNorm) ||
          (homeWord && pick.includes(homeWord)))) {
        pickedHome = true;
      } else if (awayNorm && (pick.includes(awayNorm) ||
                 (awayWord && pick.includes(awayWord)))) {
        pickedAway = true;
      }

      // Priority 2: explicit "home" / "away" keyword
      if (!pickedHome && !pickedAway) {
        if (/\bhome\b/i.test(cleanPick))      pickedHome = true;
        else if (/\baway\b/i.test(cleanPick)) pickedAway = true;
      }

      // Priority 3: derived homeAwayFlag (last resort)
      if (!pickedHome && !pickedAway) {
        if (flag === 'HOME')      pickedHome = true;
        else if (flag === 'AWAY') pickedAway = true;
      }

      // Priority 4: word-by-word fuzzy match on remaining pick text
      if (!pickedHome && !pickedAway) {
        const pickWords = pick
          .replace(/\b(win|ml|moneyline)\b/gi, '')
          .trim()
          .split(/\s+/)
          .filter(w => w.length > 2);

        for (const word of pickWords) {
          if ((homeNorm && homeNorm.includes(word)) || homeWord === word) {
            pickedHome = true;
            break;
          }
          if ((awayNorm && awayNorm.includes(word)) || awayWord === word) {
            pickedAway = true;
            break;
          }
        }
      }

      const winnerSide = getWinnerSide();

      if (pickedHome) {
        const won = winnerSide === 'HOME';
        return {
          grade: won ? 'WON' : 'LOST',
          reason: `FT: ${homeScore}-${awayScore}, ` +
                  `Home ${won ? 'wins ✓' : 'loses ✗'}`
        };
      }
      if (pickedAway) {
        const won = winnerSide === 'AWAY';
        return {
          grade: won ? 'WON' : 'LOST',
          reason: `FT: ${homeScore}-${awayScore}, ` +
                  `Away ${won ? 'wins ✓' : 'loses ✗'}`
        };
      }

      return { grade: 'ERROR', reason: 'Could not determine picked team' };
    }


    // ═══════════════════════════════════════════════════════════════════
    // ▐█▌ SECTION 3: SNIPER QUARTER MARGIN (moneyline grading)
    // ▐█▌ "Q4: A +5.0", "Q1: H -3.5", "Q2 H +2"
    // ▐█▌
    // ▐█▌ The numeric spread is DISPLAYED but NOT used for grading.
    // ▐█▌ Grading is purely: did the picked side win the quarter?
    // ▐█▌ Tied quarters → LOST (neither side wins)
    // ═══════════════════════════════════════════════════════════════════
    {
      const marginMatch = pick.match(
        /\bq([1-4])\s*[:\-]?\s*([ha])\s*([+-]?\d+(?:\.\d*)?)/i
      );

      if (marginMatch) {
        const qNum   = marginMatch[1];
        const side   = marginMatch[2].toLowerCase();  // 'h' or 'a'
        const spread = parseFloat(marginMatch[3]);     // kept for display only

        const q = parseQuarter(qNum);
        if (!q.ok) return { grade: q.grade, reason: q.reason };

        // ── Grade on QUARTER WINNER (moneyline), not spread ─────
        if (side === 'h') {
          if (q.homeQ === q.awayQ) {
            return {
              grade: 'LOST',
              reason: `Q${qNum}: ${q.homeQ}-${q.awayQ} tied ` +
                      `(Home picked, spread ${spread}) ✗`
            };
          }
          const won = q.homeQ > q.awayQ;
          return {
            grade: won ? 'WON' : 'LOST',
            reason: `Q${qNum}: ${q.homeQ}-${q.awayQ}, ` +
                    `Home ${won ? 'wins quarter ✓' : 'loses quarter ✗'} ` +
                    `(spread ${spread})`
          };
        }

        if (side === 'a') {
          if (q.homeQ === q.awayQ) {
            return {
              grade: 'LOST',
              reason: `Q${qNum}: ${q.homeQ}-${q.awayQ} tied ` +
                      `(Away picked, spread ${spread}) ✗`
            };
          }
          const won = q.awayQ > q.homeQ;
          return {
            grade: won ? 'WON' : 'LOST',
            reason: `Q${qNum}: ${q.homeQ}-${q.awayQ}, ` +
                    `Away ${won ? 'wins quarter ✓' : 'loses quarter ✗'} ` +
                    `(spread ${spread})`
          };
        }

        return { grade: 'ERROR', reason: `Invalid side: ${side}` };
      }
    }


    // ═══════════════════════════════════════════════════════════════════
    // ▐█▌ SECTION 4: LEGACY QUARTER FORMAT
    // ▐█▌ "Q1: H", "Q2: A", "Q3: Home", "Q4: Away", or team name
    // ▐█▌
    // ▐█▌ Tied quarters → LOST
    // ═══════════════════════════════════════════════════════════════════
    {
      const qMatch = pick.match(/\bq([1-4])\s*[:\-]?\s*(.+)/i);

      if (qMatch) {
        const qNum   = qMatch[1];
        const signal = qMatch[2].trim().toLowerCase();

        const q = parseQuarter(qNum);
        if (!q.ok) return { grade: q.grade, reason: q.reason };

        // ── Determine which side was picked ─────────────────────
        let pickedHome = false;
        let pickedAway = false;

        // Explicit H/A codes
        if (/^h\b/.test(signal) || signal.includes('home') ||
            signal.startsWith('h ') || signal.startsWith('h+') ||
            signal.startsWith('h-')) {
          pickedHome = true;
        } else if (/^a\b/.test(signal) || signal.includes('away') ||
                   signal.startsWith('a ') || signal.startsWith('a+') ||
                   signal.startsWith('a-')) {
          pickedAway = true;
        }

        // Team name in signal
        if (!pickedHome && !pickedAway) {
          if (homeWord && (signal.includes(homeWord) ||
              (homeNorm && signal.includes(homeNorm)))) {
            pickedHome = true;
          } else if (awayWord && (signal.includes(awayWord) ||
                     (awayNorm && signal.includes(awayNorm)))) {
            pickedAway = true;
          }
        }

        // ── Grade ───────────────────────────────────────────────
        if (pickedHome) {
          if (q.homeQ === q.awayQ) {
            return {
              grade: 'LOST',
              reason: `Q${qNum}: ${q.homeQ}-${q.awayQ} tied (Home picked) ✗`
            };
          }
          const won = q.homeQ > q.awayQ;
          return {
            grade: won ? 'WON' : 'LOST',
            reason: `Q${qNum}: ${q.homeQ}-${q.awayQ}, ` +
                    `Home ${won ? 'wins ✓' : 'loses ✗'}`
          };
        }

        if (pickedAway) {
          if (q.homeQ === q.awayQ) {
            return {
              grade: 'LOST',
              reason: `Q${qNum}: ${q.homeQ}-${q.awayQ} tied (Away picked) ✗`
            };
          }
          const won = q.awayQ > q.homeQ;
          return {
            grade: won ? 'WON' : 'LOST',
            reason: `Q${qNum}: ${q.homeQ}-${q.awayQ}, ` +
                    `Away ${won ? 'wins ✓' : 'loses ✗'}`
          };
        }

        return {
          grade: 'ERROR',
          reason: `Could not parse Q${qNum} pick: "${signal}"`
        };
      }
    }


    // ═══════════════════════════════════════════════════════════════════
    // ▐█▌ SECTION 5: BARE CODES & TEAM NAME FALLBACK
    // ▐█▌ "1", "2", "home", "away", or just "lakers"
    // ═══════════════════════════════════════════════════════════════════
    {
      const winnerSide = getWinnerSide();

      // Exact codes
      if (pick === '1' || pick === 'home') {
        const won = winnerSide === 'HOME';
        return {
          grade: won ? 'WON' : 'LOST',
          reason: `FT: ${homeScore}-${awayScore}, ` +
                  `Home ${won ? 'wins ✓' : 'loses ✗'}`
        };
      }
      if (pick === '2' || pick === 'away') {
        const won = winnerSide === 'AWAY';
        return {
          grade: won ? 'WON' : 'LOST',
          reason: `FT: ${homeScore}-${awayScore}, ` +
                  `Away ${won ? 'wins ✓' : 'loses ✗'}`
        };
      }

      // Team name anywhere in pick
      if ((homeWord && pick.includes(homeWord)) ||
          (homeNorm && pick.includes(homeNorm))) {
        const won = winnerSide === 'HOME';
        return {
          grade: won ? 'WON' : 'LOST',
          reason: `FT: ${homeScore}-${awayScore} ${won ? '✓' : '✗'}`
        };
      }
      if ((awayWord && pick.includes(awayWord)) ||
          (awayNorm && pick.includes(awayNorm))) {
        const won = winnerSide === 'AWAY';
        return {
          grade: won ? 'WON' : 'LOST',
          reason: `FT: ${homeScore}-${awayScore} ${won ? '✓' : '✗'}`
        };
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // Nothing matched
    // ═══════════════════════════════════════════════════════════════════
    return { grade: 'ERROR', reason: `Unknown pick format: "${cleanPick}"` };

  } catch (e) {
    Logger.log(
      `[${FUNC_NAME}] ❌ Error grading pick "${pickStr}": ` +
      `${e && e.message ? e.message : e}`
    );
    return {
      grade: 'ERROR',
      reason: `Grading error: ${e && e.message ? e.message : e}`
    };
  }
}



/**
 * Helper: Get sheet case-insensitive
 */
function _getSheet(ss, name) {
  if (!ss || !name) return null;
  const lower = name.toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === lower) return sheets[i];
  }
  return null;
}

/**
 * Helper: Create header map
 */
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
    'home': ['home', 'home team', 'team1'],
    'away': ['away', 'away team', 'team2'],
    'status': ['status', 'game status', 'match status'],
    'ft score': ['ft score', 'ftscore', 'final score', 'score'],
    'q1': ['q1', 'quarter1', 'quarter 1', '1q'],
    'q2': ['q2', 'quarter2', 'quarter 2', '2q'],
    'q3': ['q3', 'quarter3', 'quarter 3', '3q'],
    'q4': ['q4', 'quarter4', 'quarter 4', '4q']
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

function runFullDiagnostic() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = [];
  
  report.push('═══════════════════════════════════════════════════════════');
  report.push('MA GOLIDE MOTHERSHIP - SYSTEM DIAGNOSTIC');
  report.push('Run Date: ' + new Date().toISOString());
  report.push('═══════════════════════════════════════════════════════════');
  
  // Check all expected sheets
  const expectedSheets = ['Config', 'Sync_Temp', 'Results_Temp', 'Acca_Portfolio', 'Acca_Results', 'Master_Dashboard', 'Bet_Performance'];
  
  report.push('\n📋 SHEET STATUS:');
  expectedSheets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      const headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
      report.push(`  ✅ ${name}: ${lastRow} rows, ${lastCol} cols`);
      report.push(`     Headers: ${JSON.stringify(headers)}`);
    } else {
      report.push(`  ❌ ${name}: NOT FOUND`);
    }
  });
  
  // Check Config data
  report.push('\n📊 CONFIG LEAGUES:');
  const configSheet = ss.getSheetByName('Config');
  if (configSheet && configSheet.getLastRow() > 1) {
    const configData = configSheet.getDataRange().getValues();
    for (let i = 1; i < Math.min(configData.length, 6); i++) {
      report.push(`  Row ${i}: ${JSON.stringify(configData[i].slice(0, 5))}`);
    }
    report.push(`  ... Total: ${configData.length - 1} leagues`);
  }
  
  // Check for function existence
  report.push('\n🔧 FUNCTION CHECK:');
  const functionsToCheck = [
    'setupMothership', 'syncAllLeagues', 'syncAllResults', 'syncEverything',
    'buildAccumulatorPortfolio', 'checkAccumulatorResults', 'analyzeBetPerformance',
    'updateDashboard', '_getSheet', '_createHeaderMap', '_normalizeMatchKey',
    '_loadBets', '_filterBets', '_gradePick', '_loadResultsTempForGrading'
  ];
  
  functionsToCheck.forEach(fname => {
    try {
      const exists = typeof eval(fname) === 'function';
      report.push(`  ${exists ? '✅' : '❌'} ${fname}`);
    } catch (e) {
      report.push(`  ❌ ${fname} (${e.message})`);
    }
  });
  
  // Output report
  const fullReport = report.join('\n');
  Logger.log(fullReport);
  
  return fullReport;
}
