import re
import sys

with open("Ma_Golide_Satellites/docs/Margin_Analyzer.gs", "r") as f:
    content = f.read()

pending_push = """{
      result.details.push({
        league: bet.league || '-', date: bet.date, time: bet.time, match: bet.match, pick: bet.pick,
        type: bet.type || result.name, odds: bet.odds || '-', confidence: bet.confidence, ev: bet.ev || '-', tier: bet.tier,
        actualResult: '-', actualScore: '-', actualWinner: '-', outcome: '⏳ PENDING'
      });
      return;
    }"""

returns = [
    r'if \(!qMatch \|\| !direction \|\| !isFinite\(line\)\) return;',
    r'if \(!predicted\) return;',
    r'if \(!dirMatch\) return;'
]

for ret in returns:
    content = re.sub(ret, ret.replace("\\", "").replace(";", " ") + pending_push, content)

with open("Ma_Golide_Satellites/docs/Margin_Analyzer.gs", "w") as f:
    f.write(content)

print("Patched remaining grade functions.")
