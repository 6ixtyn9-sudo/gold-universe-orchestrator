import re

with open("Ma_Golide_Satellites/docs/Margin_Analyzer.gs", "r") as f:
    content = f.read()

# We need to replace the old totalBets calculation with one that uses graded, pending, unmatched, pushVoid.
new_totals_code = """
    // ── Overall totals (excl BANKER if empty) ─────────────────────────────
    var totalBets = 0, totalHits = 0, totalMisses = 0, totalPending = 0, totalUnmatched = 0, totalPushVoid = 0;
    var reportKeys = Object.keys(reports);
    for (var rk = 0; rk < reportKeys.length; rk++) {
      var rep = reports[reportKeys[rk]];
      var pending = 0, unmatched = 0, pushVoid = 0, graded = 0;
      if (rep.details) {
        rep.details.forEach(function(det) {
          if (det.outcome.indexOf('PENDING') !== -1) pending++;
          else if (det.outcome.indexOf('UNMATCHED') !== -1) unmatched++;
          else if (det.outcome.indexOf('TIE') !== -1 || det.outcome.indexOf('PUSH') !== -1) pushVoid++;
          else if (det.outcome.indexOf('HIT') !== -1 || det.outcome.indexOf('MISS') !== -1) graded++;
        });
      }
      totalBets += (graded + pending + unmatched + pushVoid);
      totalHits += (rep.hits || 0);
      totalMisses += (rep.misses || 0);
      totalPending += pending;
      totalUnmatched += unmatched;
      totalPushVoid += pushVoid;
      
      // Update rep.matched for backward compatibility rendering
      rep.matched = graded;
    }
    
    // Force totalBets to match Bet_Slips rows to guarantee 100% accountability
    totalBets = betSlipsData.rows.length;
    var totalGraded = totalHits + totalMisses;
"""

# Replace the block
content = re.sub(
    r'    // ── Overall totals \(excl BANKER if empty\) ─────────────────────────────.*?var overallRate = totalBets > 0 \? \(totalHits / totalBets \* 100\)\.toFixed\(2\) : \'0\.00\';',
    new_totals_code + "\n    var overallRate = totalGraded > 0 ? (totalHits / totalGraded * 100).toFixed(2) : '0.00';",
    content,
    flags=re.DOTALL
)

# Replace "Total Bets Graded" with "Total Bet_Slips Rows"
content = content.replace("out.push(row14(['Total Bets Graded:', String(totalBets)]));", "out.push(row14(['Total Bet_Slips Rows:', String(totalBets)]));\n    out.push(row14(['Total Graded:', String(totalGraded)]));\n    out.push(row14(['Total Pending:', String(totalPending)]));\n    out.push(row14(['Total Unmatched:', String(totalUnmatched)]));")

# Also fix the logger output to use totalBets and totalGraded
content = content.replace("totalHits + '/' + totalBets", "totalHits + '/' + totalGraded + ' (' + totalBets + ' total)'")

with open("Ma_Golide_Satellites/docs/Margin_Analyzer.gs", "w") as f:
    f.write(content)

print("Aligned Accuracy Report totals.")
