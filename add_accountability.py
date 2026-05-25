import re

with open("Ma_Golide_Satellites/docs/Margin_Analyzer.gs", "r") as f:
    content = f.read()

# Add writeAccountabilityToStats_ function
helper_code = """
// ═══════════════════════════════════════════════════════════════════════════════
// BET ACCOUNTABILITY - SHARED RENDERER
// ═══════════════════════════════════════════════════════════════════════════════

function writeAccountabilityToStats_(ss, reports, totalFound) {
  var sheet = ss.getSheetByName('Stats');
  if (!sheet) return;
  
  var maxCols = 10;
  var out = [];
  
  var blank = function() {
    var r = []; while (r.length < maxCols) r.push(''); return r;
  };
  
  var rowX = function(vals) {
    var r = vals.slice();
    while (r.length < maxCols) r.push('');
    return r.slice(0, maxCols);
  };
  
  out.push(rowX(['BET ACCOUNTABILITY', '', '', '', '', '', '', '', '', '']));
  out.push(rowX(['Generated:', new Date().toLocaleString(), '', '', '', '', '', '', '', '']));
  out.push(blank());
  
  var tGraded = 0, tPending = 0, tUnmatched = 0, tPushVoid = 0, tHits = 0, tMisses = 0;
  var reportKeys = Object.keys(reports);
  
  var detailsRows = [];
  detailsRows.push(['Bet Type', 'Found', 'Graded', 'Pending', 'Unmatched', 'Push/Void', 'Hits', 'Misses', 'Hit Rate', 'Warning']);
  
  for (var rk = 0; rk < reportKeys.length; rk++) {
    var rpt = reports[reportKeys[rk]];
    var pending = 0, unmatched = 0, pushVoid = 0, graded = 0;
    
    if (rpt.details) {
      rpt.details.forEach(function(det) {
        if (det.outcome.indexOf('PENDING') !== -1) pending++;
        else if (det.outcome.indexOf('UNMATCHED') !== -1) unmatched++;
        else if (det.outcome.indexOf('TIE') !== -1 || det.outcome.indexOf('PUSH') !== -1) pushVoid++;
        else if (det.outcome.indexOf('HIT') !== -1 || det.outcome.indexOf('MISS') !== -1) graded++;
      });
    }
    
    tGraded += graded;
    tPending += pending;
    tUnmatched += unmatched;
    tPushVoid += pushVoid;
    tHits += (rpt.hits || 0);
    tMisses += (rpt.misses || 0);
    
    var hitRate = (graded > 0) ? ((rpt.hits / graded) * 100).toFixed(1) + '%' : 'N/A';
    var found = rpt.found || (graded + pending + unmatched + pushVoid);
    
    var warning = '';
    if (unmatched > 0) warning = '⚠️ UNMATCHED';
    else if (pending > 0) warning = '⏳ PENDING';
    else if (found === 0) warning = '⚠️ ZERO-PICKS';
    
    detailsRows.push([
      rpt.name,
      String(found),
      String(graded),
      String(pending),
      String(unmatched),
      String(pushVoid),
      String(rpt.hits || 0),
      String(rpt.misses || 0),
      hitRate,
      warning
    ]);
  }
  
  var reconciledTotal = tGraded + tPending + tUnmatched + tPushVoid;
  var totalHitRate = (tGraded > 0) ? ((tHits / tGraded) * 100).toFixed(1) + '%' : 'N/A';
  
  out.push(rowX(['═══ RECONCILIATION ═══']));
  out.push(rowX(['Bet_Slips Total (Found):', String(totalFound)]));
  out.push(rowX(['Reconciled Total:', String(reconciledTotal)]));
  out.push(rowX(['Total Graded:', String(tGraded)]));
  out.push(rowX(['Total Pending:', String(tPending)]));
  out.push(rowX(['Total Unmatched:', String(tUnmatched)]));
  out.push(rowX(['Total Push/Void:', String(tPushVoid)]));
  out.push(rowX(['Overall Hit Rate:', totalHitRate]));
  out.push(blank());
  
  out.push(rowX(['═══ BY BET TYPE ═══']));
  for (var i = 0; i < detailsRows.length; i++) {
    out.push(rowX(detailsRows[i]));
  }
  
  // Write to columns F:O (cols 6 to 15)
  // But first clear ONLY F:O to not touch A:D
  var maxRows = Math.max(sheet.getLastRow(), out.length + 10);
  if (maxRows > 0) {
    sheet.getRange(1, 6, maxRows, 10).clearContent().setBackground(null).setFontWeight('normal').setFontColor(null);
  }
  
  sheet.getRange(1, 6, out.length, 10).setValues(out);
  
  // Formatting
  sheet.getRange(1, 6, 1, 10).setFontWeight('bold').setBackground('#4a86e8').setFontColor('white');
  
  for (var r = 0; r < out.length; r++) {
    var cell = String(out[r][0]);
    if (cell.indexOf('═══') !== -1) {
      sheet.getRange(r + 1, 6, 1, 10).setFontWeight('bold').setBackground('#d9ead3');
    }
    if (cell === 'Bet Type') {
      sheet.getRange(r + 1, 6, 1, 10).setFontWeight('bold').setBackground('#f3f3f3');
    }
  }
}
"""

if "writeAccountabilityToStats_" not in content:
    content += "\n" + helper_code

# Inject call to writeAccountabilityToStats_ into generateAccuracyReport before it writes to Accuracy_Report
call_inject = """
    // ── Update Stats Accountability Side Block ─────────────────────────────
    try {
      writeAccountabilityToStats_(ss, reports, betSlipsData.rows.length);
    } catch(e3) { Logger.log('Error writing stats accountability block: ' + e3); }
"""
if "writeAccountabilityToStats_(ss, reports, betSlipsData.rows.length);" not in content:
    content = content.replace("    // ── Write to sheet ─────────────────────────────────────────────────────", call_inject + "\n    // ── Write to sheet ─────────────────────────────────────────────────────")

with open("Ma_Golide_Satellites/docs/Margin_Analyzer.gs", "w") as f:
    f.write(content)

print("Added accountability side-block renderer.")
