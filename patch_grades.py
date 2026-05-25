import re
import sys

with open("Ma_Golide_Satellites/docs/Margin_Analyzer.gs", "r") as f:
    content = f.read()

# We want to replace `if (!game) return;` with a detail push.
detail_push = """{
      result.details.push({
        league: bet.league || '-', date: bet.date, time: bet.time, match: bet.match, pick: bet.pick,
        type: bet.type || result.name, odds: bet.odds || '-', confidence: bet.confidence, ev: bet.ev || '-', tier: bet.tier,
        actualResult: '-', actualScore: '-', actualWinner: '-', outcome: '⚠️ UNMATCHED — no result data found'
      });
      return;
    }"""

content = re.sub(r'if \(!game\) return;', 'if (!game) ' + detail_push, content)

# For pending/parse failures like `if (!qMatch) return;` or `if (!qScore) return;` or `if (!predictedSide) return;`
pending_push = """{
      result.details.push({
        league: bet.league || '-', date: bet.date, time: bet.time, match: bet.match, pick: bet.pick,
        type: bet.type || result.name, odds: bet.odds || '-', confidence: bet.confidence, ev: bet.ev || '-', tier: bet.tier,
        actualResult: '-', actualScore: '-', actualWinner: '-', outcome: '⏳ PENDING'
      });
      return;
    }"""

# List of returns we know about
returns = [
    r'if \(!qMatch\) return;',
    r'if \(!predictedSide\) return;',
    r'if \(!qScore\) return;',
    r'if \(!actualScore\) return;',
    r'if \(isNaN\(actualMargin\)\) return;',
    r'if \(!periodMatch\) return;',
    r'if \(!predictedType\) return;',
    r'if \(!fhHome \|\| !fhAway\) return;',
    r'if \(!ftHome \|\| !ftAway\) return;',
    r'if \(isNaN\(ftHome\) \|\| isNaN\(ftAway\)\) return;',
    r'if \(isNaN\(ftHome\) \|\| isNaN\(ftAway\) \|\| isNaN\(target\)\) return;',
    r'if \(!highestQ\) return;',
    r'if \(isNaN\(fhHome\) \|\| isNaN\(fhAway\)\) return;'
]

for ret in returns:
    content = re.sub(ret, ret.replace("\\", "").replace(";", " ") + pending_push, content)

with open("Ma_Golide_Satellites/docs/Margin_Analyzer.gs", "w") as f:
    f.write(content)

print("Patched grade functions.")
