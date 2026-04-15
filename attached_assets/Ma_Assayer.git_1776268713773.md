This file is a merged representation of the entire codebase, combined into a single document by Repomix.
The content has been processed where comments have been removed, empty lines have been removed, line numbers have been added, content has been formatted for parsing in markdown style, content has been compressed (code blocks are separated by ⋮---- delimiter), security check has been disabled.

# File Summary

## Purpose
This file contains a packed representation of the entire repository's contents.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.

## File Format
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  a. A header with the file path (## File: path/to/file)
  b. The full contents of the file in a code block

## Usage Guidelines
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.

## Notes
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Code comments have been removed from supported file types
- Empty lines have been removed from all files
- Line numbers have been added to the beginning of each line
- Content has been formatted for parsing in markdown style
- Content has been compressed - code blocks are separated by ⋮---- delimiter
- Security check has been disabled - content may contain sensitive information
- Files are sorted by Git change count (files with more changes are at the bottom)

# Directory Structure
```
docs/
  ColResolver_ColumnMatching.gs
  Config_ConfigurationAndConstants.gs
  ConfigLedger_Reader.gs
  Discovery_Edge.gs
  Flagger_FlagsSourceSheets.gs
  Log_LoggingSystem.gs
  Main_Orchestrator.gs
  Output_Writers.gs
  Parser_DataParsing.gs
  Stats_StatsCalculations.gs
  Utils_UtilityFunctions.gs
README.md
```

# Files

## File: docs/ColResolver_ColumnMatching.gs
```
/******************************************************************************
 * MA ASSAYER — Complete Production Module
 * 
 * "Testing the purity of predictions - separating Gold from Charcoal"
 * 
 * COMPLETE ROBUST IMPLEMENTATION
 * 
 * ARCHITECTURE:
 * ├── M1_Output_          Sheet Writers
 * ├── M2_Main_            Controller/Orchestrator
 * ├── M3_Flagger_         Apply Flags to Source
 * ├── M4_Discovery_       Edge Discovery Engine
 * ├── M5_Config_          Configuration & Constants
 * ├── M6_ColResolver_     Fuzzy Column Matching (case-insensitive)
 * ├── M7_Parser_          Data Parsing
 * ├── M8_Stats_           Statistical Calculations
 * ├── M9_Utils_           Utility Functions
 * └── M10_Log_            Logging System
 ******************************************************************************/
 
// ============================================================================
// MODULE: ColResolver_ — Case-Insensitive Fuzzy Column Matching
// ============================================================================

const ColResolver_ = {
  log: null,
  
  /**
   * Initialize module
   */
  init() {
    this.log = Log_.module("COL_RESOLVE");
  },
  
  /**
   * Normalize string for comparison - CASE INSENSITIVE
   */
  normalize(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .toLowerCase()
      .trim()
      .replace(/[\s_\-\.\/\\]+/g, " ")
      .replace(/[^a-z0-9% ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  },
  
  /**
   * Calculate Levenshtein distance
   */
  levenshtein(a, b) {
    if (a === b) return 0;
    if (!a || !a.length) return b ? b.length : 0;
    if (!b || !b.length) return a.length;
    
    const matrix = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  },
  
  /**
   * Calculate string similarity (0 to 1)
   */
  similarity(s1, s2) {
    const n1 = this.normalize(s1);
    const n2 = this.normalize(s2);
    
    // Exact match
    if (n1 === n2) return 1.0;
    
    // Empty strings
    if (!n1 || !n2) return 0;
    
    // One contains the other completely
    if (n1.includes(n2) || n2.includes(n1)) {
      const ratio = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
      return 0.85 + (ratio * 0.15);
    }
    
    // Word-based matching
    const words1 = n1.split(" ").filter(w => w.length > 0);
    const words2 = n2.split(" ").filter(w => w.length > 0);
    
    if (words1.length > 0 && words2.length > 0) {
      // Check if all words from shorter are in longer
      const shorter = words1.length <= words2.length ? words1 : words2;
      const longer = words1.length <= words2.length ? words2 : words1;
      
      const matchedWords = shorter.filter(sw => 
        longer.some(lw => lw.includes(sw) || sw.includes(lw) || this.levenshtein(sw, lw) <= 1)
      );
      
      const wordMatchRatio = matchedWords.length / shorter.length;
      if (wordMatchRatio >= 0.8) {
        return 0.75 + (wordMatchRatio * 0.15);
      }
    }
    
    // Levenshtein-based similarity
    const maxLen = Math.max(n1.length, n2.length);
    const distance = this.levenshtein(n1, n2);
    const similarity = 1 - (distance / maxLen);
    
    return similarity;
  },
  
  /**
   * Resolve columns from header row using aliases
   */
  resolve(headerRow, aliasMap, sheetType) {
    if (!this.log) this.init();
    
    const resolved = {};
    const missing = [];
    const found = [];
    const usedIndices = new Set();
    
    this.log.info(`Resolving columns for ${sheetType}`);
    this.log.debug(`Header row has ${headerRow.length} columns`);
    
    // Normalize and index all headers
    const normalizedHeaders = headerRow.map((h, i) => ({
      original: h,
      normalized: this.normalize(h),
      index: i
    }));
    
    // Log non-empty headers
    const nonEmpty = normalizedHeaders
      .filter(h => h.original && String(h.original).trim())
      .map(h => `"${h.original}"`);
    this.log.debug(`Headers found: ${nonEmpty.slice(0, 15).join(", ")}${nonEmpty.length > 15 ? "..." : ""}`);
    
    // Match each canonical column
    for (const [canonical, aliases] of Object.entries(aliasMap)) {
      let bestMatch = null;
      let bestScore = 0;
      let matchType = "";
      let matchedAlias = "";
      
      // Check each header against each alias
      for (const header of normalizedHeaders) {
        if (!header.normalized || usedIndices.has(header.index)) continue;
        
        for (const alias of aliases) {
          const normalizedAlias = this.normalize(alias);
          
          // Exact match (highest priority)
          if (header.normalized === normalizedAlias) {
            bestMatch = header;
            bestScore = 1.0;
            matchType = "exact";
            matchedAlias = alias;
            break;
          }
          
          // Calculate similarity for fuzzy matching
          const sim = this.similarity(header.normalized, normalizedAlias);
          
          if (sim > bestScore && sim >= Config_.thresholds.minSimilarity) {
            bestMatch = header;
            bestScore = sim;
            matchType = sim >= Config_.thresholds.highSimilarity ? "strong" : "fuzzy";
            matchedAlias = alias;
          }
        }
        
        // Early exit if exact match found
        if (bestScore === 1.0) break;
      }
      
      // Record result
      if (bestMatch && bestScore >= Config_.thresholds.minSimilarity) {
        resolved[canonical] = bestMatch.index;
        usedIndices.add(bestMatch.index);
        
        found.push({
          canonical,
          matched: bestMatch.original,
          normalized: bestMatch.normalized,
          index: bestMatch.index,
          score: bestScore,
          matchType,
          matchedAlias
        });
      } else {
        missing.push(canonical);
      }
    }
    
    // Log resolution results
    this.log.info(`Column resolution for ${sheetType}: ${found.length} found, ${missing.length} missing`);
    
    found.forEach(f => {
      const icon = f.matchType === "exact" ? "✅" : 
                   f.matchType === "strong" ? "🔶" : "🔷";
      this.log.debug(`  ${icon} ${f.canonical} → "${f.matched}" [col ${f.index + 1}] (${f.matchType}, ${(f.score * 100).toFixed(0)}%)`);
    });
    
    if (missing.length > 0) {
      this.log.warn(`Missing columns for ${sheetType}: ${missing.join(", ")}`);
    }
    
    return { resolved, missing, found };
  },
  
  /**
   * Validate critical columns exist
   */
  validateCritical(resolved, criticalColumns, sheetType) {
    if (!this.log) this.init();
    
    const missing = criticalColumns.filter(c => resolved[c] === undefined);
    
    if (missing.length > 0) {
      this.log.error(`CRITICAL: Missing required columns in ${sheetType}: ${missing.join(", ")}`);
      return { valid: false, missing };
    }
    
    this.log.success(`All ${criticalColumns.length} critical columns found for ${sheetType}`);
    return { valid: true, missing: [] };
  },
  
  /**
   * Get column index safely
   */
  getIndex(resolved, colName) {
    return resolved.hasOwnProperty(colName) ? resolved[colName] : -1;
  },
  
  /**
   * Check if column exists
   */
  hasColumn(resolved, colName) {
    return resolved.hasOwnProperty(colName) && resolved[colName] >= 0;
  }
};
```

## File: docs/Config_ConfigurationAndConstants.gs
```
/******************************************************************************
 * MA ASSAYER — Complete Production Module
 * 
 * "Testing the purity of predictions - separating Gold from Charcoal"
 * 
 * COMPLETE ROBUST IMPLEMENTATION
 * 
 * ARCHITECTURE:
 * ├── M1_Output_          Sheet Writers
 * ├── M2_Main_            Controller/Orchestrator
 * ├── M3_Flagger_         Apply Flags to Source
 * ├── M4_Discovery_       Edge Discovery Engine
 * ├── M5_Config_          Configuration & Constants
 * ├── M6_ColResolver_     Fuzzy Column Matching (case-insensitive)
 * ├── M7_Parser_          Data Parsing
 * ├── M8_Stats_           Statistical Calculations
 * ├── M9_Utils_           Utility Functions
 * └── M10_Log_            Logging System
 ******************************************************************************/

// ============================================================================
// MODULE: Config_ — Configuration & Constants (v4.3.0 — Type-Segmented Totals)
// ============================================================================

const Config_ = {
  version: "4.3.0",                    // ◆ PATCH: version bump
  name: "Ma Assayer",
  buildDate: "2025-06-28",             // ◆ PATCH: build date

  // Sheet names
  sheets: {
    side: "Side",
    totals: "Totals",
    vault: "MA_Vault",
    discovery: "MA_Discovery",
    leagueAssay: "MA_LeagueAssay",
    exclusion: "MA_Exclusion",
    config: "MA_Config",
    charts: "MA_Charts",
    logs: "MA_Logs",
    quarterAnalysis: "MA_QuarterAnalysis",
    summary: "MA_Summary",
    teamAssay: "MA_TeamAssay",
    matchupAssay: "MA_MatchupAssay",
    assayerEdges: "ASSAYER_EDGES",
    assayerLeaguePurity: "ASSAYER_LEAGUE_PURITY"
  },

  // Mother Contract — Output Sheets + Schema (additive only)
  // Satellite machine contracts (Ma_Golide_Satellites — Contract_Enforcer)
  satelliteContract: {
    forensicCore17: [
      "Prediction_Record_ID", "Universal_Game_ID", "Config_Version", "Timestamp_UTC",
      "League", "Date", "Home", "Away", "Market", "Period", "Pick_Code", "Pick_Text",
      "Confidence_Pct", "Confidence_Prob", "Tier_Code", "EV", "Edge_Score"
    ],
    betSlips23: [
      "Bet_Record_ID", "Universal_Game_ID", "Source_Prediction_Record_ID",
      "League", "Date", "Home", "Away", "Market", "Period", "Selection_Side", "Selection_Line",
      "Selection_Team", "Selection_Text", "Odds", "Confidence_Pct", "Confidence_Prob", "EV",
      "Tier_Code", "Tier_Display", "Config_Version_T1", "Config_Version_T2", "Config_Version_Acc", "Source_Module"
    ]
  },

  motherContract: {
    EDGE_SHEET_NAME: "ASSAYER_EDGES",
    LEAGUE_PURITY_SHEET: "ASSAYER_LEAGUE_PURITY",

    EDGE_COLUMNS: [
      "edge_id", "source", "pattern", "discovered", "updated_at",
      "quarter", "is_women", "tier", "side", "direction",
      "conf_bucket", "spread_bucket", "line_bucket",
      "type_key",                                                // ◆ PATCH: added
      "filters_json",
      "n", "wins", "losses", "win_rate", "lower_bound", "upper_bound", "lift",
      "grade", "symbol", "reliable", "sample_size"
    ],

    LEAGUE_COLUMNS: [
      "league", "quarter", "source", "gender", "tier", "type_key",
      "n", "win_rate", "grade", "status",
      "dominant_stamp", "stamp_purity",
      "updated_at"
    ]
  },

  // ◆ PATCH: Canonical totals type keys (derived in Discovery_._getTotalsTypeKey)
  // Reference only — the normalization logic lives in Discovery_.
  totalsTypeKeys: [
    "SNIPER_OU",        // Plain Sniper O/U
    "SNIPER_OU_DIR",    // Sniper O/U DIR
    "SNIPER_OU_STAR",   // Sniper O/U STAR
    "OU",               // Generic O/U (no "Sniper" prefix)
    "OU_DIR",           // Generic O/U DIR
    "OU_STAR",          // Generic O/U STAR
    "OTHER",            // Recognized type that doesn't match O/U patterns
    "UNKNOWN"           // Missing / empty type
  ],

  // Column aliases
  sideColumnAliases: {
    league: [
      "league", "lg", "lge", "leag", "leauge", "legue", "comp", "competition",
      "sport league", "sportleague", "conference", "division", "tour"
    ],
    date: [
      "date", "dt", "dte", "game date", "gamedate", "match date", "event date",
      "play date", "playdate", "bet date", "betdate", "event"
    ],
    time: [
      "time", "tm", "start time", "starttime", "game time", "kickoff",
      "tip off", "tipoff", "start", "event time"
    ],
    match: [
      "match", "game", "matchup", "teams", "mch", "mtch", "fixture", "vs",
      "event", "contest", "bout", "meeting", "pairing", "matchup teams"
    ],
    pick: [
      "pick", "selection", "bet", "play", "pck", "wager", "side pick",
      "team pick", "teampick", "chosen", "choice", "prediction", "pred"
    ],
    type: [
      "type", "typ", "bet type", "bettype", "category", "market type",
      "market", "bet market", "wager type", "play type"
    ],
    confidence: [
      "confidence", "conf", "conf%", "confpct", "confidence%", "cnf", "cnf%",
      "confidence_pct", "confidence pct",
      "prob", "probability", "likelihood", "certainty", "edge%", "model conf",
      "model confidence", "predicted prob", "win prob", "win probability"
    ],
    tier: [
      "tier", "tr", "tier level", "strength", "tierlevel", "rating",
      "tier_code", "tier display", "tier_display",
      "grade tier", "quality", "star", "stars", "rank", "level", "class"
    ],
    quarter: [
      "quarter", "qtr", "q", "qrtr", "period", "half", "quater", "quartr",
      "per", "prd", "segment", "section", "part", "phase"
    ],
    actual: [
      "actual", "act", "result score", "score", "actl",
      "actual score", "final score", "actual result", "real score"
    ],
    side: [
      "side", "sd", "h/a", "home away", "homeaway", "team side", "home/away",
      "location", "venue", "home or away", "h or a"
    ],
    outcome: [
      "outcome", "result", "res", "win/loss", "winloss", "w/l", "hit",
      "otcome", "outcom", "status", "graded result", "grade", "graded",
      "final result", "bet result", "wager result", "decision", "verdict"
    ],
    odds: [
      "odds", "price", "line odds", "decimal odds", "american odds",
      "moneyline", "ml", "payout", "juice", "vig"
    ],
    units: [
      "units", "unit", "stake", "bet size", "betsize", "wager size",
      "risk", "amount", "size"
    ],
    ev: [
      "ev", "ev%", "expected value", "expectedvalue", "edge", "value",
      "expected", "roi", "return"
    ],
    notes: [
      "notes", "note", "comments", "comment", "memo", "remarks", "info"
    ],
    home: [
      "home", "hm", "home team", "hometeam", "h team", "team 1", "team1",
      "host", "home side", "homeside"
    ],
    away: [
      "away", "aw", "away team", "awayteam", "a team", "visitor", "team 2",
      "team2", "visiting", "road", "road team", "roadteam", "guest"
    ],
    config_stamp: [
      "config_stamp", "configstamp", "cfg_stamp", "stamp", "stamp_id"
    ]
  },

  totalsColumnAliases: {
    date: [
      "date", "dt", "dte", "game date", "gamedate", "event date",
      "play date", "playdate", "bet date", "match date"
    ],
    league: [
      "league", "lg", "lge", "leag", "leauge", "comp", "competition",
      "sport league", "conference", "division"
    ],
    home: [
      "home", "hm", "home team", "hometeam", "h team", "team 1", "team1",
      "host", "home side", "homeside"
    ],
    away: [
      "away", "aw", "away team", "awayteam", "a team", "visitor", "team 2",
      "team2", "visiting", "road", "road team", "roadteam", "guest"
    ],
    match: [
      "match", "game", "matchup", "teams", "fixture", "vs", "event",
      "contest", "pairing"
    ],
    quarter: [
      "quarter", "qtr", "q", "qrtr", "period", "quater", "quartr",
      "per", "prd", "segment", "half"
    ],
    direction: [
      "direction", "dir", "over/under", "overunder", "o/u", "ou", "bet dir",
      "over under", "over or under", "o or u", "side", "pick direction"
    ],
    line: [
      "line", "ln", "total", "total line", "number", "lne", "points",
      "closing line", "game total", "gametotal", "projected total",
      "total points", "totalpoints", "target", "mark"
    ],
    actual: [
      "actual", "act", "final", "score", "actl", "actual total",
      "final total", "real total", "combined score", "combinedscore",
      "total score", "totalscore", "actual score"
    ],
    result: [
      "result", "res", "outcome", "win/loss", "winloss", "hit", "rslt",
      "status", "graded result", "grade", "graded", "final result",
      "bet result", "decision", "w/l"
    ],
    diff: [
      "diff", "difference", "margin", "dif", "dfference", "delta",
      "variance", "spread", "gap", "deviation"
    ],
    confidence: [
      "confidence", "conf", "conf%", "confpct", "cnf", "cnf%", "prob",
      "probability", "likelihood", "certainty", "model conf", "win prob"
    ],
    ev: [
      "ev", "ev%", "evpct", "expected value", "expectedvalue", "edge",
      "value", "expected", "roi"
    ],
    tier: [
      "tier", "tr", "tier level", "strength", "rating", "grade tier",
      "quality", "star", "rank", "level"
    ],
    type: [
      "type", "typ", "bet type", "bettype", "market type", "market",
      "category", "wager type"
    ],
    odds: [
      "odds", "price", "line odds", "decimal odds", "juice", "vig"
    ],
    units: [
      "units", "unit", "stake", "bet size", "risk", "amount"
    ],
    notes: [
      "notes", "note", "comments", "comment", "memo", "remarks"
    ],
    config_stamp: [
      "config_stamp", "configstamp", "cfg_stamp", "stamp", "stamp_id"
    ]
  },

  // Statistical thresholds
  thresholds: {
    minN: 10,
    minNReliable: 30,
    minNPlatinum: 50,
    minNGold: 25,
    wilsonZ: 1.645,
    wilsonZ90: 1.645,
    wilsonZ95: 1.96,
    liftThreshold: 0.03,
    minEdgeLift: 0.05,
    maxEdgeLift: 0.25,
    minSimilarity: 0.65,
    highSimilarity: 0.85,
    minNTeam: 25,
    minNTeamReliable: 40,
    minNTeamGold: 40,
    minNTeamPlatinum: 60,
    minNMatchup: 5,
    minNMatchupReliable: 30,
    minNMatchupGold: 30,
    minNMatchupPlatinum: 45,
    wilsonLowerBoundGate: 0                 
  },

// Purity grades
  grades: {
    PLATINUM: { min: 0.85, symbol: "⬡",  name: "Platinum", color: "#E5E4E2", bgColor: "#1a1a2e" },
    GOLD:     { min: 0.72, symbol: "Au",  name: "Gold",     color: "#FFD700", bgColor: "#2d2d0d" },
    SILVER:   { min: 0.62, symbol: "Ag",  name: "Silver",   color: "#C0C0C0", bgColor: "#2d2d2d" },
    BRONZE:   { min: 0.55, symbol: "Cu",  name: "Bronze",   color: "#CD7F32", bgColor: "#2d1f0d" },
    ROCK:     { min: 0.50, symbol: "ite", name: "Rock",     color: "#808080", bgColor: "#1a1a1a" },
    CHARCOAL: { min: 0.00, symbol: "🜃",  name: "Charcoal", color: "#363636", bgColor: "#0d0d0d" }
  },

  toxicLeagues: ["UNKNOWN"],
  eliteLeagues: ["UNKNOWN"],
  toxicTeams: [],
  eliteTeams: [],
  toxicMatchups: [],
  eliteMatchups: [],
  teamAliases: {},

  // Spread buckets
  spreadBuckets: [
    { name: "<3",      min: 0,    max: 2.99, label: "Tight (<3)" },
    { name: "3-4",     min: 3,    max: 4,    label: "Close (3-4)" },
    { name: "4.5-5.5", min: 4.5,  max: 5.5,  label: "Medium (4.5-5.5)" },
    { name: "5.5-6",   min: 5.5,  max: 6,    label: "Standard (5.5-6)" },
    { name: "6-7",     min: 6,    max: 7,    label: "Wide (6-7)" },
    { name: ">7",      min: 7.01, max: 100,  label: "Blowout (>7)" }
  ],

  // Line / total buckets
  lineBuckets: [
    { name: "<35",   min: 0,     max: 34.99, label: "Very Low (<35)" },
    { name: "35-40", min: 35,    max: 40,    label: "Low (35-40)" },
    { name: "40-50", min: 40.01, max: 50,    label: "Below Avg (40-50)" },
    { name: "50-60", min: 50.01, max: 60,    label: "Average (50-60)" },
    { name: "60-70", min: 60.01, max: 70,    label: "Above Avg (60-70)" },
    { name: ">70",   min: 70.01, max: 200,   label: "High (>70)" }
  ],

  // Confidence buckets
  confBuckets: [
    { name: "<55%",   min: 0,     max: 0.549, label: "Low (<55%)" },
    { name: "55-60%", min: 0.55,  max: 0.60,  label: "Moderate (55-60%)" },
    { name: "60-65%", min: 0.601, max: 0.65,  label: "Good (60-65%)" },
    { name: "65-70%", min: 0.651, max: 0.70,  label: "Strong (65-70%)" },
    { name: "≥70%",   min: 0.701, max: 1.0,   label: "Elite (≥70%)" }
  ],

  // Tier mappings
  tierMappings: {
    strong: ["strong", "★", "★★★", "high", "s", "3", "elite", "top", "a", "best"],
    medium: ["medium", "●", "★★", "med", "m", "2", "standard", "avg", "b", "mid"],
    weak:   ["weak", "○", "★", "low", "w", "1", "minimal", "c", "bottom", "low"]
  },

  // Outcome mappings
  outcomeMappings: {
    win:  ["✅", "hit", "w", "win", "1", "won", "winner", "y", "yes", "correct", "right", "covered", "cashed"],
    loss: ["❌", "miss", "l", "loss", "0", "lost", "loser", "n", "no", "incorrect", "wrong", "failed"],
    push: ["even", "p", "push", "tie", "draw", "e", "void", "cancel", "cancelled", "refund", "no action", "na"]
  },

  // Colors
  colors: {
    header:     "#1a1a2e",
    headerText: "#FFD700",
    gold:       "#FFD700",
    silver:     "#C0C0C0",
    bronze:     "#CD7F32",
    platinum:   "#E5E4E2",
    success:    "#28a745",
    warning:    "#ffc107",
    danger:     "#dc3545",
    info:       "#17a2b8",
    dark:       "#343a40",
    light:      "#f8f9fa"
  },

  // Report settings
  report: {
    maxEdgesToShow:   20,
    maxLeaguesToShow: 15,
    maxToxicToShow:   10,
    dateFormat:       "yyyy-MM-dd HH:mm:ss"
  }
};

// ============================================================================
// PHASE 3 PATCH 5 + 5B: CONFIG HARDENING - ASSAYER INTEGRATION
// ============================================================================

/**
 * ConfigManager_Assayer - Assayer-specific configuration management
 * Integrates with Satellite Config Managers for state lineage
 */
const ConfigManager_Assayer = {
  
  // --------------------------------------------------------------------------
  // loadAssayerConfig - Load Assayer configuration with Config Ledger integration
  // --------------------------------------------------------------------------
  loadAssayerConfig() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Load base configuration from Config_ object
    const baseConfig = JSON.parse(JSON.stringify(Config_));
    
    // Try to load enhanced config from satellite config sheets
    try {
      const satelliteConfig = this.loadSatelliteConfigs(ss);
      if (satelliteConfig) {
        Object.assign(baseConfig, satelliteConfig);
      }
    } catch (err) {
      Logger.log('[ConfigManager_Assayer] Satellite config load failed: ' + err.message);
    }
    
    // Validate configuration
    if (this.validateAssayerConfig(baseConfig)) {
      return baseConfig;
    } else {
      Logger.log('[ConfigManager_Assayer] Using fallback configuration due to validation failure');
      return Config_;
    }
  },
  
  // --------------------------------------------------------------------------
  // loadSatelliteConfigs - Load configuration from satellite config sheets
  // --------------------------------------------------------------------------
  loadSatelliteConfigs(ss) {
    const enhancedConfig = {};
    
    // Load Tier1 configuration
    const tier1Sheet = ss.getSheetByName("Config_Tier1");
    if (tier1Sheet) {
      const tier1Data = tier1Sheet.getDataRange().getValues();
      const tier1Config = {};
      
      for (let i = 1; i < tier1Data.length; i++) {
        const row = tier1Data[i];
        if (row[0]) { // config_key
          tier1Config[String(row[0]).trim()] = this.parseConfigValue(row[1]);
        }
      }
      
      // Apply to Assayer config
      enhancedConfig.tier1 = tier1Config;
      enhancedConfig.tierThresholds = {
        strong: tier1Config.TIER_STRONG_MIN || 0.65,
        medium: tier1Config.TIER_MEDIUM_MIN || 0.55,
        weak: tier1Config.TIER_WEAK_MIN || 0.45
      };
      enhancedConfig.confidenceThresholds = {
        min: tier1Config.CONF_MIN || 0.60,
        elite: tier1Config.CONF_ELITE || 0.85
      };
    }
    
    // Load Tier2 configuration
    const tier2Sheet = ss.getSheetByName("Config_Tier2");
    if (tier2Sheet) {
      const tier2Data = tier2Sheet.getDataRange().getValues();
      const tier2Config = {};
      
      for (let i = 1; i < tier2Data.length; i++) {
        const row = tier2Data[i];
        if (row[0]) { // config_key
          tier2Config[String(row[0]).trim()] = this.parseConfigValue(row[1]);
        }
      }
      
      // Apply to Assayer config
      enhancedConfig.tier2 = tier2Config;
      enhancedConfig.spreadBuckets = tier2Config.SPREAD_BUCKETS || Config_.spreadBuckets;
      enhancedConfig.lineBuckets = tier2Config.LINE_BUCKETS || Config_.lineBuckets;
      enhancedConfig.confBuckets = tier2Config.CONF_BUCKETS || Config_.confBuckets;
    }
    
    return enhancedConfig;
  },
  
  // --------------------------------------------------------------------------
  // parseConfigValue - Parse configuration value from sheet
  // --------------------------------------------------------------------------
  parseConfigValue(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    
    const str = String(value).trim();
    
    // Boolean values
    if (str.toLowerCase() === "true") return true;
    if (str.toLowerCase() === "false") return false;
    
    // JSON values
    if (str.startsWith("[") || str.startsWith("{")) {
      try {
        return JSON.parse(str);
      } catch (e) {
        Logger.log('[ConfigManager_Assayer] Failed to parse JSON value: ' + str);
        return str;
      }
    }
    
    // Numeric values
    const num = parseFloat(str);
    if (!isNaN(num)) {
      return num;
    }
    
    // String values
    return str;
  },
  
  // --------------------------------------------------------------------------
  // validateAssayerConfig - Validate Assayer configuration
  // --------------------------------------------------------------------------
  validateAssayerConfig(config) {
    try {
      // Check required fields
      const required = ['version', 'name', 'sheets'];
      for (const field of required) {
        if (!config[field]) {
          Logger.log('[ConfigManager_Assayer] Missing required field: ' + field);
          return false;
        }
      }
      
      // Validate tier thresholds
      if (config.tierThresholds) {
        const thresholds = config.tierThresholds;
        if (thresholds.strong <= thresholds.medium ||
            thresholds.medium <= thresholds.weak) {
          Logger.log('[ConfigManager_Assayer] Invalid tier thresholds: must be strictly decreasing');
          return false;
        }
      }
      
      // Validate confidence thresholds
      if (config.confidenceThresholds) {
        const conf = config.confidenceThresholds;
        if (conf.min <= 0 || conf.min >= 1 ||
            conf.elite <= 0 || conf.elite >= 1 ||
            conf.elite <= conf.min) {
          Logger.log('[ConfigManager_Assayer] Invalid confidence thresholds');
          return false;
        }
      }
      
      // Validate bucket arrays
      const bucketArrays = ['spreadBuckets', 'lineBuckets', 'confBuckets'];
      for (const bucketType of bucketArrays) {
        if (config[bucketType] && Array.isArray(config[bucketType])) {
          const buckets = config[bucketType];
          if (buckets.length < 2) {
            Logger.log('[ConfigManager_Assayer] ' + bucketType + ' must have at least 2 elements');
            return false;
          }
          
          // Check if sorted
          for (let i = 1; i < buckets.length; i++) {
            if (buckets[i] <= buckets[i-1]) {
              Logger.log('[ConfigManager_Assayer] ' + bucketType + ' must be sorted in ascending order');
              return false;
            }
          }
        }
      }
      
      return true;
    } catch (err) {
      Logger.log('[ConfigManager_Assayer] Config validation failed: ' + err.message);
      return false;
    }
  },
  
  // --------------------------------------------------------------------------
  // getAssayerConfigWithFallback - Get config with tolerant fallback
  // --------------------------------------------------------------------------
  getAssayerConfigWithFallback() {
    try {
      return this.loadAssayerConfig();
    } catch (err) {
      Logger.log('[ConfigManager_Assayer] Using fallback config due to error: ' + err.message);
      return Config_;
    }
  },
  
  // --------------------------------------------------------------------------
  // updateAssayerFromSatellite - Update Assayer config from satellite changes
  // --------------------------------------------------------------------------
  updateAssayerFromSatellite() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const newConfig = this.loadAssayerConfig();
    
    // Update global Config_ object
    Object.assign(Config_, newConfig);
    
    Logger.log('[ConfigManager_Assayer] Updated Assayer config from satellite sheets');
    return newConfig;
  }
};

/**
 * tolerantAssayerParser_ - Assayer parser with tolerant matching for legacy data
 * Integrates with tolerant matching from Phase 3
 */
function tolerantAssayerParser_(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  const headers = data[0];
  const rows = [];
  
  // Use ContractEnforcer header mapping with tolerant fallback
  let headerMap;
  if (typeof createCanonicalHeaderMap_ !== 'undefined') {
    // Determine contract type based on sheet name
    let contract;
    if (sheetName.includes('Tier1') || sheetName.includes('Tier2') || sheetName.includes('OU_Log')) {
      contract = FORENSIC_LOGS_CONTRACT;
    } else if (sheetName === 'Bet_Slips') {
      contract = BET_SLIPS_CONTRACT;
    } else if (sheetName === 'ResultsClean') {
      contract = RESULTSCLEAN_CONTRACT;
    } else {
      // Use tolerant matching for unknown sheets
      headerMap = tolerantHeaderMatch_(headers, headers);
    }
    
    if (contract) {
      headerMap = createCanonicalHeaderMap_(contract, headers);
    }
  } else {
    headerMap = tolerantHeaderMatch_(headers, headers);
  }
  
  Logger.log('[tolerantAssayerParser_] Sheet: ' + sheetName + ', Headers mapped: ' + Object.keys(headerMap).length);
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;
    
    const parsedRow = {};
    
    // Map columns using header map
    Object.keys(headerMap).forEach(function(canonical) {
      const colIdx = headerMap[canonical];
      if (colIdx >= 0 && colIdx < row.length) {
        parsedRow[canonical] = row[colIdx];
      }
    });
    
    // Apply tolerant data cleaning
    const cleanedRow = tolerantDataCleaning_(parsedRow);
    
    // Validate row has essential fields
    if (cleanedRow.league && cleanedRow.team) {
      rows.push(cleanedRow);
    }
  }
  
  Logger.log('[tolerantAssayerParser_] Parsed ' + rows.length + ' rows from ' + sheetName);
  return rows;
}

/**
 * validateConfigState_ - Assayer wrapper for config validation
 * @param {Object} config - Configuration object
 * @param {string} tier - Configuration tier
 * @returns {boolean} True if valid
 */
function validateConfigState_(config, tier) {
  if (typeof ConfigManager_Assayer !== 'undefined') {
    return ConfigManager_Assayer.validateAssayerConfig(config);
  }
  
  // Fallback validation
  return config && config.version && config.name;
}
```

## File: docs/ConfigLedger_Reader.gs
```
/******************************************************************************
 * CONFIG LEDGER READER — Assayer Module
 * Repo: Ma_Assayer
 *
 * Paste BEFORE MODULE 02 (or immediately after MODULE 05 Config) so Parser
 * and Stats can call ConfigLedger_Reader.
 ******************************************************************************/

var ConfigLedger_Reader = {

  _cache: null,
  _satelliteId: null,
  _log: null,

  init: function (satelliteSpreadsheetId) {
    this._satelliteId = satelliteSpreadsheetId || null;
    this._cache = null;
    this._log = (typeof Log_ !== "undefined") ? Log_.module("CFG_LEDGER") : {
      info: function (m) { console.log(m); },
      warn: function (m) { console.warn(m); },
      error: function (m) { console.error(m); }
    };
    this._log.info(
      "ConfigLedger_Reader initialised. Source: " + (this._satelliteId || "same sheet")
    );
  },

  resolveStamp: function (bet) {
    if (!bet) {
      return bet;
    }
    var rawStamp = bet.config_stamp || bet.configStamp || null;
    if (!rawStamp) {
      bet.stampId = null;
      bet.configVersion = null;
      bet.configBuiltAt = null;
      bet.configMeta = null;
      return bet;
    }
    var meta = this._lookup(rawStamp);
    bet.stampId = rawStamp;
    bet.configVersion = meta ? meta.version : null;
    bet.configBuiltAt = meta ? meta.built_at : null;
    bet.configMeta = meta || null;
    return bet;
  },

  tagSlice: function (sliceStats, bets) {
    if (!sliceStats || !Array.isArray(bets) || bets.length === 0) {
      return sliceStats;
    }
    var counts = {};
    var i;
    for (i = 0; i < bets.length; i++) {
      var b = bets[i];
      var sid = b.stampId || "__UNSTAMPED__";
      counts[sid] = (counts[sid] || 0) + 1;
    }
    var dominant = null;
    var maxCount = 0;
    var sid2;
    for (sid2 in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, sid2)) {
        var cnt = counts[sid2];
        if (cnt > maxCount) {
          maxCount = cnt;
          dominant = sid2;
        }
      }
    }
    var meta = dominant && dominant !== "__UNSTAMPED__" ? this._lookup(dominant) : null;
    var total = bets.length;
    sliceStats.dominantStampId = dominant !== "__UNSTAMPED__" ? dominant : null;
    sliceStats.dominantVersion = meta ? meta.version : null;
    sliceStats.stampMix = counts;
    sliceStats.stampPurity = dominant ? (maxCount / total) : 0;
    return sliceStats;
  },

  getAll: function () {
    this._ensureLoaded();
    return this._cache ? Array.from(this._cache.values()) : [];
  },

  getStampMeta: function (stampId) {
    return this._lookup(stampId);
  },

  summariseStamps: function (allBets) {
    if (!Array.isArray(allBets)) {
      return {};
    }
    var counts = {};
    var j;
    for (j = 0; j < allBets.length; j++) {
      var sid0 = allBets[j].stampId || "__UNSTAMPED__";
      counts[sid0] = (counts[sid0] || 0) + 1;
    }
    var total = allBets.length;
    var rows = [];
    var sid3;
    for (sid3 in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, sid3)) {
        var cnt0 = counts[sid3];
        var meta0 = (sid3 !== "__UNSTAMPED__") ? (this._lookup(sid3) || {}) : {};
        rows.push({
          stampId: sid3,
          version: meta0.version || "unknown",
          builtAt: meta0.built_at || "unknown",
          count: cnt0,
          pct: total > 0 ? (cnt0 / total) : 0
        });
      }
    }
    rows.sort(function (a, b) {
      return b.count - a.count;
    });
    return { total: total, rows: rows, uniqueStamps: rows.length };
  },

  _lookup: function (stampId) {
    this._ensureLoaded();
    return (this._cache && this._cache.has(stampId)) ? this._cache.get(stampId) : null;
  },

  _ensureLoaded: function () {
    if (this._cache !== null) {
      return;
    }
    this._cache = new Map();
    try {
      var ss = this._satelliteId
        ? SpreadsheetApp.openById(this._satelliteId)
        : SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName("Config_Ledger");
      if (!sheet) {
        if (this._log) {
          this._log.warn("Config_Ledger sheet not found — stamps will be null");
        }
        return;
      }
      var data = sheet.getDataRange().getValues();
      if (data.length < 2) {
        return;
      }
      var headers = data[0].map(function (h) {
        return String(h).trim().toLowerCase().replace(/\s+/g, "_");
      });
      var r;
      for (r = 1; r < data.length; r++) {
        var row = data[r];
        var obj = {};
        var c;
        for (c = 0; c < headers.length; c++) {
          obj[headers[c]] = row[c];
        }
        var stampId = String(obj.stamp_id || "").trim();
        if (stampId) {
          this._cache.set(stampId, obj);
        }
      }
      if (this._log) {
        this._log.info("Config_Ledger loaded: " + this._cache.size + " stamp(s)");
      }
    } catch (err) {
      if (this._log) {
        this._log.warn("Config_Ledger load failed: " + err.message);
      }
    }
  }
};

// =====================================================================
// FIX: Prevent duplicate ColResolver_ declaration
// Apps Script loads files alphabetically, so we need conditional check
// =====================================================================
if (typeof ColResolver_ === 'undefined') {
  // Only define if not already present from Assayer modules
  const ColResolver_ = {
    // (the full ColResolver_ object from Assayer is already loaded)
    // We just need the existence check to prevent duplicate declaration
  };
}

/**
 * DYNAMIC TIMEOUT HANDLER - Adjusts timeout based on satellite game count
 * Prevents timeouts when accessing hundreds of satellites with different league sizes
 */
ConfigLedger_Reader.getSatelliteTimeout = function(satelliteId) {
  // Default timeouts for different game counts
  const timeouts = {
    '3': 15000,    // Small leagues (3 games)
    '7': 25000,    // Medium leagues (7 games) 
    '9': 35000,    // Large leagues (9 games)
    '14': 45000,   // Very large leagues (14 games)
    'default': 30000  // Default for unknown sizes
  };
  
  try {
    if (!satelliteId) return timeouts.default;
    
    // Try to detect game count by accessing satellite briefly
    const ss = SpreadsheetApp.openById(satelliteId);
    const resultsSheet = ss.getSheetByName('ResultsClean') || ss.getSheetByName('Results');
    if (resultsSheet) {
      const gameCount = resultsSheet.getLastRow() - 1;
      if (gameCount <= 3) return timeouts['3'];
      if (gameCount <= 7) return timeouts['7'];
      if (gameCount <= 9) return timeouts['9'];
      if (gameCount <= 14) return timeouts['14'];
    }
    
    return timeouts.default;
  } catch (e) {
    // If we can't detect, use conservative default
    return timeouts.default;
  }
};
```

## File: docs/Discovery_Edge.gs
```
// ============================================================================
// MODULE: Discovery_ — Edge Discovery Engine (v4.3.0 — Type-Segmented Totals
//                       + Contextual Baselines)
//
// WHAT CHANGED (v4.3.0):
//   1. _normalizeType / _getTotalsTypeKey — canonical derivation-type field
//   2. Totals discovery loops nest INSIDE typeKey so every Totals edge carries
//      criteria.typeKey.  This prevents DIR edges from blessing STAR bets.
//   3. Baselines are CONTEXTUAL: deeper scans compare against their parent
//      slice, not the global pool.  Prevents "fake lift" from riding a
//      strong parent category.
//   4. Filter gate: Totals edges without criteria.typeKey are dropped.
//   5. matchesCriteria auto-computes typeKey on untagged bets (safety net
//      for Flagger_ callers that haven't run through Discovery first).
//   6. Side discovery baselines also made contextual at depth ≥ 2.
// ============================================================================

const Discovery_ = {
  log: null,

  init() {
    this.log = Log_.module("DISCOVERY");
  },

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  _clone(obj) {
    if (typeof Utils_ !== "undefined" && Utils_.deepClone) {
      return Utils_.deepClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
  },

  /**
   * ◆ PATCH: Normalise a raw type string to upper-case, single-spaced.
   */
  _normalizeType(raw) {
    return String(raw || "").trim().toUpperCase().replace(/\s+/g, " ");
  },

  /**
   * ◆ PATCH: Derive a canonical, stable typeKey for any totals bet.
   *
   * Maps the messy universe of type strings to a small canonical set:
   *   SNIPER_OU  |  SNIPER_OU_DIR  |  SNIPER_OU_STAR
   *   OU         |  OU_DIR         |  OU_STAR
   *   OTHER      |  UNKNOWN
   *
   * This is the field that goes into edge criteria and prevents
   * cross-derivation leakage.
   */
  _getTotalsTypeKey(bet) {
    if (!bet) return "UNKNOWN";
    if (bet.typeKey) return bet.typeKey;          // already computed

    const t = this._normalizeType(bet.type);
    if (!t) return "UNKNOWN";

    // Detect "Sniper O/U" family
    const hasSniper = t.includes("SNIPER");
    const hasOU     = t.includes("O/U")  || t.includes("OU")  ||
                      t.includes("OVER/UNDER") || t.includes("OVER UNDER") ||
                      t.includes("TOTAL");

    if (hasSniper && hasOU) {
      if (t.includes("DIR"))  return "SNIPER_OU_DIR";
      if (t.includes("STAR")) return "SNIPER_OU_STAR";
      return "SNIPER_OU";
    }

    if (hasOU) {
      if (t.includes("DIR"))  return "OU_DIR";
      if (t.includes("STAR")) return "OU_STAR";
      return "OU";
    }

    return "OTHER";
  },

  // ---------------------------------------------------------------------------
  // Edge creation
  // ---------------------------------------------------------------------------

  createEdge(source, id, name, bets, stats, baseline, criteria = {}) {
    const lowerBound = Stats_.wilsonLowerBound(stats.wins, stats.decisive);
    const upperBound = Stats_.wilsonUpperBound(stats.wins, stats.decisive);
    const lift       = stats.winRate - baseline.winRate;
    const liftPct    = baseline.winRate > 0 ? (lift / baseline.winRate) * 100 : 0;
    const gradeInfo  = Stats_.getGradeInfo(stats.winRate, stats.decisive);

    return {
      id: id.replace(/\s+/g, "_").replace(/[^A-Z0-9_]/gi, "").toUpperCase(),
      source,
      name,
      description: `${name} (${source})`,
      criteria: this._clone(criteria),
      n: stats.decisive,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      winRatePct: Stats_.pct(stats.winRate),
      lift,
      liftPct,
      liftDisplay: Stats_.lift(lift),
      lowerBound,
      upperBound,
      confidenceInterval: `${Stats_.pct(lowerBound)} - ${Stats_.pct(upperBound)}`,
      grade: gradeInfo.grade,
      gradeSymbol: gradeInfo.symbol,
      gradeName: gradeInfo.name,
      reliable: stats.decisive >= Config_.thresholds.minNReliable,
      sampleSize: stats.decisive >= Config_.thresholds.minNPlatinum ? "Large" :
                  stats.decisive >= Config_.thresholds.minNReliable ? "Medium" : "Small",
      autoDiscovered: true,
      discoveredAt: new Date().toISOString()
    };
  },

  // ---------------------------------------------------------------------------
  // Attribute scanner (unchanged API — baseline meaning is now contextual)
  // ---------------------------------------------------------------------------

  scanAttribute(bets, source, attrName, values, getter, baseline, parentCriteria = {}) {
    const edges = [];
    const t = Config_.thresholds;

    for (const val of values) {
      if (val === null || val === undefined) continue;

      const filtered = bets.filter(b => getter(b) === val);
      if (filtered.length < t.minN) continue;

      const stats = Stats_.calcBasic(filtered);
      if (stats.decisive < t.minN) continue;

      const lift = stats.winRate - baseline.winRate;

      if (lift >= t.liftThreshold) {
        const criteria  = { ...parentCriteria, [attrName]: val };
        const sortedKeys = Object.keys(criteria).sort();
        const idParts   = [source];
        const nameParts = [];
        for (const k of sortedKeys) {
          const v = criteria[k];
          idParts.push(`${k}_${String(v).replace(/[^A-Z0-9]/gi, "")}`);
          nameParts.push(`${k}=${v}`);
        }

        edges.push(this.createEdge(
          source,
          idParts.join("_"),
          nameParts.join(" + "),
          filtered,
          stats,
          baseline,
          criteria
        ));
      }
    }

    return edges;
  },

  // ---------------------------------------------------------------------------
  // Main discovery orchestrator
  // ---------------------------------------------------------------------------

  discoverAll(sideBets, totalsBets, globalStats = null) {
    if (!this.log) this.init();
    Log_.section("Discovering Edges");

    const discovered = [];
    const t = Config_.thresholds;

    const discoveryStartTime = Date.now();
    const MAX_DISCOVERY_MS   = 5 * 60 * 1000;
    let   timeoutWarningLogged = false;

    const isApproachingTimeout = () => {
      if (Date.now() - discoveryStartTime > MAX_DISCOVERY_MS) {
        if (!timeoutWarningLogged) {
          this.log.warn("Approaching execution time limit, completing discovery early");
          timeoutWarningLogged = true;
        }
        return true;
      }
      return false;
    };

    // ========================================================================
    //  SIDE DISCOVERY  (contextual baselines at depth ≥ 2)
    // ========================================================================
    if (sideBets.length > 0 && !isApproachingTimeout()) {
      this.log.info(`Scanning ${sideBets.length} side bets for edges`);
      const sideBaseline = Stats_.calcBasic(sideBets);

      const quarterValues      = [1, 2, 3, 4];
      const sideValues         = ["H", "A"];
      const tierValues         = ["STRONG", "MEDIUM", "WEAK"];
      const spreadBucketValues = Config_.spreadBuckets.map(b => b.name);
      const confBucketValues   = Config_.confBuckets.map(b => b.name);
      const boolValues         = [true, false];

      // Pre-build maps
      const sideByQuarter = new Map();
      for (let q = 1; q <= 4; q++) {
        sideByQuarter.set(q, sideBets.filter(b => b.quarter === q));
      }

      const sideByQuarterSide = new Map();
      for (let q = 1; q <= 4; q++) {
        for (const side of sideValues) {
          sideByQuarterSide.set(`${q}_${side}`,
            sideBets.filter(b => b.quarter === q && b.side === side));
        }
      }

      // ---- Single Attribute (global baseline) ----
      discovered.push(...this.scanAttribute(
        sideBets, "Side", "quarter", quarterValues, b => b.quarter, sideBaseline));
      discovered.push(...this.scanAttribute(
        sideBets, "Side", "side", sideValues, b => b.side, sideBaseline));
      discovered.push(...this.scanAttribute(
        sideBets, "Side", "tier", tierValues, b => b.tier, sideBaseline));
      discovered.push(...this.scanAttribute(
        sideBets, "Side", "spreadBucket", spreadBucketValues, b => b.spreadBucket, sideBaseline));
      discovered.push(...this.scanAttribute(
        sideBets, "Side", "confBucket", confBucketValues, b => b.confBucket, sideBaseline));
      discovered.push(...this.scanAttribute(
        sideBets, "Side", "isWomen", boolValues, b => b.isWomen, sideBaseline));

      // Matchup-based (Side only)
      const minNMatchup = t.minNMatchup ?? 20;
      const highVolumeMatchups = [...new Set(sideBets.map(b => b.matchupKey).filter(Boolean))]
        .filter(mk => sideBets.filter(b => b.matchupKey === mk).length >= minNMatchup);
      discovered.push(...this.scanAttribute(
        sideBets, "Side", "matchupKey", highVolumeMatchups, b => b.matchupKey, sideBaseline));

      // ---- Two-Attribute: Quarter + X  ◆ PATCH: contextual baseline ----
      for (let q = 1; q <= 4; q++) {
        if (isApproachingTimeout()) break;

        const qBets = sideByQuarter.get(q);
        if (!qBets || qBets.length < t.minN) continue;

        const qBaseline = Stats_.calcBasic(qBets);        // ◆ contextual
        const qCriteria = { quarter: q };

        discovered.push(...this.scanAttribute(
          qBets, "Side", "side", sideValues, b => b.side, qBaseline, qCriteria));
        discovered.push(...this.scanAttribute(
          qBets, "Side", "spreadBucket", spreadBucketValues, b => b.spreadBucket, qBaseline, qCriteria));
        discovered.push(...this.scanAttribute(
          qBets, "Side", "tier", ["STRONG", "MEDIUM"], b => b.tier, qBaseline, qCriteria));
        discovered.push(...this.scanAttribute(
          qBets, "Side", "confBucket", confBucketValues, b => b.confBucket, qBaseline, qCriteria));
        discovered.push(...this.scanAttribute(
          qBets, "Side", "isWomen", boolValues, b => b.isWomen, qBaseline, qCriteria));
      }

      // ---- Three-Attribute: Q + Side + X  ◆ PATCH: contextual baseline ----
      for (let q = 1; q <= 4; q++) {
        if (isApproachingTimeout()) break;

        for (const side of sideValues) {
          if (isApproachingTimeout()) break;

          const key     = `${q}_${side}`;
          const qsBets  = sideByQuarterSide.get(key);
          if (!qsBets || qsBets.length < t.minN) continue;

          const qsBaseline = Stats_.calcBasic(qsBets);    // ◆ contextual
          const criteria   = { quarter: q, side: side };

          discovered.push(...this.scanAttribute(
            qsBets, "Side", "spreadBucket", spreadBucketValues,
            b => b.spreadBucket, qsBaseline, criteria));
          discovered.push(...this.scanAttribute(
            qsBets, "Side", "isWomen", boolValues,
            b => b.isWomen, qsBaseline, criteria));
          discovered.push(...this.scanAttribute(
            qsBets, "Side", "confBucket", confBucketValues,
            b => b.confBucket, qsBaseline, criteria));
          discovered.push(...this.scanAttribute(
            qsBets, "Side", "tier", tierValues,
            b => b.tier, qsBaseline, criteria));
        }
      }

      this.log.info(`Side discovery found ${discovered.length} raw edges`);
    }

    // ========================================================================
    //  TOTALS DISCOVERY  ◆ PATCH: TYPE-SEGMENTED + CONTEXTUAL BASELINES
    // ========================================================================
    const totalsStartIdx = discovered.length;

    if (totalsBets.length > 0 && !isApproachingTimeout()) {
      this.log.info(`Scanning ${totalsBets.length} totals bets for edges`);

      // ----- Step 1: stamp canonical typeKey on every totals bet -----
      for (const b of totalsBets) {
        b.typeKey = this._getTotalsTypeKey(b);
      }

      const totalsBaseline = Stats_.calcBasic(totalsBets);

      const quarterValues    = [1, 2, 3, 4];
      const directionValues  = ["Over", "Under"];
      const tierValues       = ["STRONG", "MEDIUM", "WEAK"];
      const lineBucketValues = Config_.lineBuckets.map(b => b.name);
      const confBucketValues = Config_.confBuckets.map(b => b.name);
      const boolValues       = [true, false];

      // ----- Step 2: build typeValues (types with ≥ minN samples) -----
      const typeCounts = {};
      for (const b of totalsBets) {
        typeCounts[b.typeKey] = (typeCounts[b.typeKey] || 0) + 1;
      }
      const typeValues = Object.keys(typeCounts).filter(k => typeCounts[k] >= t.minN);

      this.log.info(`Totals type distribution: ${JSON.stringify(typeCounts)}`);
      this.log.info(`Types with sufficient samples (>=${t.minN}): ${typeValues.join(", ") || "none"}`);

      // ----- Step 3: typeKey-only scan (global baseline) -----
      // Finds which derivation types are overall better / worse than the pool
      discovered.push(...this.scanAttribute(
        totalsBets, "Totals", "typeKey", typeValues,
        b => b.typeKey, totalsBaseline
      ));

      // ----- Step 4: type-segmented discovery -----
      for (const typ of typeValues) {
        if (isApproachingTimeout()) break;

        const typedBets = totalsBets.filter(b => b.typeKey === typ);
        if (typedBets.length < t.minN) continue;

        const typeBaseline = Stats_.calcBasic(typedBets);
        const typeCriteria = { typeKey: typ };

        // ---- 2-attr: TypeKey + X  (baseline = type slice) ----
        discovered.push(...this.scanAttribute(
          typedBets, "Totals", "quarter", quarterValues,
          b => b.quarter, typeBaseline, typeCriteria));
        discovered.push(...this.scanAttribute(
          typedBets, "Totals", "direction", directionValues,
          b => b.direction, typeBaseline, typeCriteria));
        discovered.push(...this.scanAttribute(
          typedBets, "Totals", "tier", tierValues,
          b => b.tier, typeBaseline, typeCriteria));
        discovered.push(...this.scanAttribute(
          typedBets, "Totals", "lineBucket", lineBucketValues,
          b => b.lineBucket, typeBaseline, typeCriteria));
        discovered.push(...this.scanAttribute(
          typedBets, "Totals", "confBucket", confBucketValues,
          b => b.confBucket, typeBaseline, typeCriteria));
        discovered.push(...this.scanAttribute(
          typedBets, "Totals", "isWomen", boolValues,
          b => b.isWomen, typeBaseline, typeCriteria));

        // ---- 3-attr: TypeKey + Quarter + X ----
        for (let q = 1; q <= 4; q++) {
          if (isApproachingTimeout()) break;

          const tqBets = typedBets.filter(b => b.quarter === q);
          if (tqBets.length < t.minN) continue;

          const tqBaseline = Stats_.calcBasic(tqBets);     // ◆ contextual
          const tqCriteria = { typeKey: typ, quarter: q };

          discovered.push(...this.scanAttribute(
            tqBets, "Totals", "direction", directionValues,
            b => b.direction, tqBaseline, tqCriteria));
          discovered.push(...this.scanAttribute(
            tqBets, "Totals", "lineBucket", lineBucketValues,
            b => b.lineBucket, tqBaseline, tqCriteria));
          discovered.push(...this.scanAttribute(
            tqBets, "Totals", "tier", tierValues,
            b => b.tier, tqBaseline, tqCriteria));
          discovered.push(...this.scanAttribute(
            tqBets, "Totals", "confBucket", confBucketValues,
            b => b.confBucket, tqBaseline, tqCriteria));
          discovered.push(...this.scanAttribute(
            tqBets, "Totals", "isWomen", boolValues,
            b => b.isWomen, tqBaseline, tqCriteria));
        }

        // ---- 4-attr: TypeKey + Quarter + Direction + X ----
        for (let q = 1; q <= 4; q++) {
          if (isApproachingTimeout()) break;

          for (const dir of directionValues) {
            if (isApproachingTimeout()) break;

            const tqdBets = typedBets.filter(b => b.quarter === q && b.direction === dir);
            if (tqdBets.length < t.minN) continue;

            const tqdBaseline = Stats_.calcBasic(tqdBets); // ◆ contextual
            const tqdCriteria = { typeKey: typ, quarter: q, direction: dir };

            discovered.push(...this.scanAttribute(
              tqdBets, "Totals", "lineBucket", lineBucketValues,
              b => b.lineBucket, tqdBaseline, tqdCriteria));
            discovered.push(...this.scanAttribute(
              tqdBets, "Totals", "isWomen", boolValues,
              b => b.isWomen, tqdBaseline, tqdCriteria));
            discovered.push(...this.scanAttribute(
              tqdBets, "Totals", "confBucket", confBucketValues,
              b => b.confBucket, tqdBaseline, tqdCriteria));
            discovered.push(...this.scanAttribute(
              tqdBets, "Totals", "tier", tierValues,
              b => b.tier, tqdBaseline, tqdCriteria));
          }
        }
      }

      this.log.info(`Totals discovery found ${discovered.length - totalsStartIdx} raw edges`);
    }

    // ========================================================================
    //  FILTER & DEDUPLICATE  ◆ PATCH: typeKey gate + Wilson gate
    // ========================================================================
    const maxLift   = t.maxEdgeLift || 0.25;
    const wilsonGate = t.wilsonLowerBoundGate || 0;

    const filtered = discovered.filter(e =>
      e.n >= t.minN &&
      e.lift >= t.liftThreshold &&
      e.lift <= maxLift &&
      e.lowerBound >= wilsonGate &&                                // ◆ PATCH
      (e.source !== "Totals" || (e.criteria && e.criteria.typeKey)) // ◆ PATCH
    );

    // Deduplicate by ID (keep largest sample)
    const uniqueMap = {};
    filtered.forEach(e => {
      if (!uniqueMap[e.id] || e.n > uniqueMap[e.id].n) {
        uniqueMap[e.id] = e;
      }
    });

    const unique = Object.values(uniqueMap);

    // Sort: grade descending, then lift descending
    const gradeOrder = {
      PLATINUM: 6, GOLD: 5, SILVER: 4, BRONZE: 3, ROCK: 2, CHARCOAL: 1
    };

    unique.sort((a, b) => {
      const gradeCompare = (gradeOrder[b.grade] || 0) - (gradeOrder[a.grade] || 0);
      if (gradeCompare !== 0) return gradeCompare;
      return b.lift - a.lift;
    });

    // ---- Logging ----
    const elapsedMs = Date.now() - discoveryStartTime;
    this.log.info(
      `Discovery complete: ${unique.length} unique edges from ${discovered.length} raw (${elapsedMs}ms)`
    );

    const gradeCounts = {};
    unique.forEach(e => { gradeCounts[e.grade] = (gradeCounts[e.grade] || 0) + 1; });
    this.log.info("Edge grade distribution:", gradeCounts);

    // ◆ PATCH: log type-segmented Totals breakdown
    const totalsByType = {};
    unique.filter(e => e.source === "Totals").forEach(e => {
      const tk = (e.criteria && e.criteria.typeKey) || "NONE";
      totalsByType[tk] = (totalsByType[tk] || 0) + 1;
    });
    if (Object.keys(totalsByType).length > 0) {
      this.log.info("Totals edges by typeKey:", totalsByType);
    }

    const topTier = unique.filter(e => e.grade === "GOLD" || e.grade === "PLATINUM");
    this.log.info(`Gold/Platinum edges: ${topTier.length}`);

    if (timeoutWarningLogged) {
      this.log.warn("Discovery was truncated due to time constraints — results may be incomplete");
    }

    Log_.sectionEnd("Discovering Edges");

    return unique;
  },

  // ---------------------------------------------------------------------------
  // Edge matching (used by Flagger_)
  // ---------------------------------------------------------------------------

  /**
   * ◆ PATCH: auto-computes typeKey on the fly for Totals bets that don't
   * have it yet (safety net for callers outside the discovery pipeline).
   */
    matchesCriteria(bet, edge) {
    if (!edge || !edge.criteria || typeof edge.criteria !== "object" || Object.keys(edge.criteria).length === 0) {
      return false;
    }
    if (!bet || typeof bet !== "object") {
      return false;
    }

    var norm = function(x) {
      if (x === null || x === undefined) return x;
      if (typeof x === "boolean") return x;
      if (typeof x === "number") return isFinite(x) ? x : null;

      var s = String(x).trim();
      if (s === "") return "";

      if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
        var n = parseFloat(s);
        return isFinite(n) ? n : null;
      }
      return s.toUpperCase();
    };

    var criteriaEntries = Object.entries(edge.criteria);
    for (var i = 0; i < criteriaEntries.length; i++) {
      var key = criteriaEntries[i][0];
      var expected = criteriaEntries[i][1];
      var actual = bet[key];

      // Auto-derive typeKey for untagged Totals bets
      if (key === "typeKey" && (actual === undefined || actual === null)) {
        actual = this._getTotalsTypeKey(bet);
      }

      if (actual === undefined || actual === null) return false;
      if (norm(actual) !== norm(expected)) return false;
    }

    return true;
  },

  /**
   * ◆ PATCH: pre-compute typeKey once before iterating edges for efficiency.
   */
  findMatchingEdges(bet, edges) {
    // Stamp typeKey if needed so matchesCriteria doesn't recompute per-edge
    if (bet.source === "Totals" && !bet.typeKey) {
      bet.typeKey = this._getTotalsTypeKey(bet);
    }

    const matches = edges.filter(e =>
      e.source === bet.source && this.matchesCriteria(bet, e)
    );

    const gradeOrder = {
      PLATINUM: 6, GOLD: 5, SILVER: 4, BRONZE: 3, ROCK: 2, CHARCOAL: 1
    };
    matches.sort((a, b) => (gradeOrder[b.grade] || 0) - (gradeOrder[a.grade] || 0));

    return matches;
  },

  getBestEdge(bet, edges) {
    const matches = this.findMatchingEdges(bet, edges);
    return matches.length > 0 ? matches[0] : null;
  },

  // ---------------------------------------------------------------------------
  // Query helpers (unchanged)
  // ---------------------------------------------------------------------------

  getTopEdges(edges, grade = null, limit = 10) {
    let filtered = edges;

    if (grade) {
      if (Array.isArray(grade)) {
        filtered = edges.filter(e => grade.includes(e.grade));
      } else {
        filtered = edges.filter(e => e.grade === grade);
      }
    }

    return filtered.slice(0, limit);
  },

  getEdgesBySource(edges, source) {
    return edges.filter(e => e.source === source);
  },

  groupByGrade(edges) {
    const groups = {
      PLATINUM: [], GOLD: [], SILVER: [], BRONZE: [], ROCK: [], CHARCOAL: []
    };

    edges.forEach(e => {
      if (groups[e.grade]) {
        groups[e.grade].push(e);
      }
    });

    return groups;
  },

  getSummary(edges) {
    const byGrade  = this.groupByGrade(edges);
    const bySource = {
      Side:   edges.filter(e => e.source === "Side").length,
      Totals: edges.filter(e => e.source === "Totals").length
    };

    const avgLift = edges.length > 0
      ? edges.reduce((sum, e) => sum + e.lift, 0) / edges.length
      : 0;

    const avgN = edges.length > 0
      ? edges.reduce((sum, e) => sum + e.n, 0) / edges.length
      : 0;

    return {
      total: edges.length,
      byGrade: {
        PLATINUM:  byGrade.PLATINUM.length,
        GOLD:      byGrade.GOLD.length,
        SILVER:    byGrade.SILVER.length,
        BRONZE:    byGrade.BRONZE.length,
        ROCK:      byGrade.ROCK.length,
        CHARCOAL:  byGrade.CHARCOAL.length
      },
      bySource,
      avgLift: Math.round(avgLift * 10000) / 10000,
      avgN:    Math.round(avgN)
    };
  }
};
```

## File: docs/Flagger_FlagsSourceSheets.gs
```
/******************************************************************************
 * MA ASSAYER — Complete Production Module
 * 
 * "Testing the purity of predictions - separating Gold from Charcoal"
 * 
 * COMPLETE ROBUST IMPLEMENTATION
 * 
 * ARCHITECTURE:
 * ├── M1_Output_          Sheet Writers
 * ├── M2_Main_            Controller/Orchestrator
 * ├── M3_Flagger_         Apply Flags to Source
 * ├── M4_Discovery_       Edge Discovery Engine
 * ├── M5_Config_          Configuration & Constants
 * ├── M6_ColResolver_     Fuzzy Column Matching (case-insensitive)
 * ├── M7_Parser_          Data Parsing
 * ├── M8_Stats_           Statistical Calculations
 * ├── M9_Utils_           Utility Functions
 * └── M10_Log_            Logging System
 ******************************************************************************/
 
// ============================================================================
// MODULE: Flagger_ — Apply Flags to Source Sheets
// ============================================================================

const Flagger_ = {
  log: null,

  GRADE_ORDER: ["CHARCOAL", "ROCK", "BRONZE", "SILVER", "GOLD", "PLATINUM"],

  init() {
    this.log = Log_.module("FLAGGER");
  },

  applyFlags(ss, edges, leagueAssay, teamAssay, matchupAssay) {
    if (leagueAssay === undefined) leagueAssay = {};
    if (teamAssay === undefined) teamAssay = {};
    if (matchupAssay === undefined) matchupAssay = {};
    if (!this.log) this.init();
    Log_.section("Applying Flags");

    const sideEdges = edges.filter(e => e.source === "Side");
    const totalsEdges = edges.filter(e => e.source === "Totals");

    this.log.info(`Processing ${sideEdges.length} side edges, ${totalsEdges.length} totals edges`);

    const sideResult = this.flagSheet(ss, Config_.sheets.side, sideEdges, leagueAssay, "side", teamAssay, matchupAssay);
    const totalsResult = this.flagSheet(ss, Config_.sheets.totals, totalsEdges, leagueAssay, "totals", teamAssay, matchupAssay);

    const summary = {
      side: sideResult,
      totals: totalsResult,
      totalFlagged: (sideResult ? sideResult.flagged : 0) + (totalsResult ? totalsResult.flagged : 0),
      totalRows: (sideResult ? sideResult.total : 0) + (totalsResult ? totalsResult.total : 0)
    };

    this.log.success(`Flagging complete: ${summary.totalFlagged}/${summary.totalRows} rows flagged`);
    Log_.sectionEnd("Applying Flags");

    return summary;
  },

  _buildEdgeIndex(edges) {
    const index = new Map();

    for (const edge of edges) {
      if (!edge.criteria || typeof edge.criteria !== "object") continue;

      const keys = Object.keys(edge.criteria);
      if (keys.length === 0) continue;

      const firstKey = keys.sort()[0];
      const firstVal = edge.criteria[firstKey];
      const indexKey = `${firstKey}:${firstVal}`;

      if (!index.has(indexKey)) {
        index.set(indexKey, []);
      }
      index.get(indexKey).push(edge);
    }

    return index;
  },

  flagSheet(ss, sheetName, edges, leagueAssay, type, teamAssay, matchupAssay) {
    if (teamAssay === undefined) teamAssay = {};
    if (matchupAssay === undefined) matchupAssay = {};
    if (!this.log) this.init();

    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      this.log.warn(`Sheet not found: ${sheetName}`);
      return { success: false, error: "Sheet not found" };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      this.log.warn(`No data in sheet: ${sheetName}`);
      return { success: false, error: "No data", total: 0, flagged: 0 };
    }

    const headers = data[0];

    const flagCol = this.findOrCreateColumn(sheet, headers,
      ["ma_edgeflags", "maassayer", "ma flag", "edge flag", "flags"], "MA_EdgeFlags");
    const gradeCol = this.findOrCreateColumn(sheet, headers,
      ["ma_grade", "purity", "purity grade"], "MA_Grade");
    const statusCol = this.findOrCreateColumn(sheet, headers,
      ["ma_status", "edge status"], "MA_Status");

    const aliases = type === "side" ? Config_.sideColumnAliases : Config_.totalsColumnAliases;
    ColResolver_.init();
    const { resolved } = ColResolver_.resolve(headers, aliases, sheetName);

    const edgeIndex = this._buildEdgeIndex(edges);

    const outFlags = [];
    const outGrades = [];
    const outStatuses = [];

    let flaggedCount = 0;
    let toxicCount = 0;
    let highQualityCount = 0;

    const PROGRESS_CHUNK = 500;
    const processingStartTime = Date.now();
    const MAX_PROCESSING_MS = 5 * 60 * 1000;
    let timeoutReached = false;

    for (let i = 1; i < data.length; i++) {
      if ((i - 1) % PROGRESS_CHUNK === 0 && i > 1) {
        const elapsed = Date.now() - processingStartTime;
        this.log.info(`${sheetName}: Processed ${i - 1}/${data.length - 1} rows (${elapsed}ms)`);

        if (elapsed > MAX_PROCESSING_MS) {
          this.log.warn(`${sheetName}: Timeout approaching after ${i - 1} rows, completing early`);
          timeoutReached = true;
          break;
        }
      }

      const row = data[i];

      const bet = this.parseRowForMatching(row, resolved, type);

      const result = this.evaluateRow(bet, edges, leagueAssay, edgeIndex, teamAssay, matchupAssay);

      if (result.matchedEdges.length > 0) flaggedCount++;
      if (result.isToxic) toxicCount++;
      if (result.bestGrade === "GOLD" || result.bestGrade === "PLATINUM") highQualityCount++;

      outFlags.push([result.matchedEdges.join(" | ") || ""]);
      outGrades.push([this.formatGrade(result.bestGrade)]);
      outStatuses.push([result.status]);
    }

    if (outFlags.length > 0) {
      sheet.getRange(2, flagCol, outFlags.length, 1).setValues(outFlags);
      sheet.getRange(2, gradeCol, outGrades.length, 1).setValues(outGrades);
      sheet.getRange(2, statusCol, outStatuses.length, 1).setValues(outStatuses);
    }

    const resultMsg = timeoutReached ? " (truncated due to timeout)" : "";
    this.log.success(`${sheetName}: ${flaggedCount}/${outFlags.length} flagged, ` +
                     `${toxicCount} toxic, ${highQualityCount} high-quality${resultMsg}`);

    return {
      success: true,
      total: outFlags.length,
      flagged: flaggedCount,
      toxic: toxicCount,
      highQuality: highQualityCount,
      truncated: timeoutReached
    };
  },

  evaluateRow(bet, edges, leagueAssay, edgeIndex, teamAssay, matchupAssay) {
    if (edgeIndex === undefined || edgeIndex === null) edgeIndex = null;
    if (teamAssay === undefined || teamAssay === null) teamAssay = null;
    if (matchupAssay === undefined || matchupAssay === null) matchupAssay = null;

    const matchedEdges = [];
    let bestGrade = "CHARCOAL";
    let status = "—";
    let isToxic = false;
    let bestEdge = null;

    const league = (bet && bet.league) ? String(bet.league).trim().toUpperCase() : "";
    const betSource = (bet && bet.source) ? bet.source : ((bet && bet.side) ? "Side" : ((bet && bet.direction) ? "Totals" : null));
    const gender = (bet && bet.isWomen) ? "W" : "M";
    const tier = (bet && bet.tier) ? String(bet.tier).trim().toUpperCase() : "UNKNOWN";
    const quarterVal = (bet && typeof bet.quarter === "number" && isFinite(bet.quarter)) ? bet.quarter : null;

      const tryAssayKeys = () => {
    if (!league || !betSource) return null;

    const keys = [];

    // v4.3.0: derive typeKey for Totals bets
    let betTypeKey = "";
    if (betSource === "Totals" && bet) {
      if (bet.typeKey) {
        betTypeKey = bet.typeKey;
      } else if (typeof Discovery_ !== "undefined" && Discovery_._getTotalsTypeKey) {
        betTypeKey = Discovery_._getTotalsTypeKey(bet);
      } else if (typeof Parser_ !== "undefined" && Parser_._deriveTotalsTypeKey) {
        betTypeKey = Parser_._deriveTotalsTypeKey(bet);
      }
    }

    // v4.3.0: typeKey-specific keys first (Totals only, most precise)
    if (betTypeKey) {
      if (quarterVal != null) keys.push(`${league}_Q${quarterVal}_${betSource}_${gender}_${tier}_${betTypeKey}`);
      keys.push(`${league}_${betSource}_${gender}_${tier}_${betTypeKey}`);
    }

    // Existing keys (aggregate, backward-compatible)
    if (quarterVal != null) keys.push(`${league}_Q${quarterVal}_${betSource}_${gender}_${tier}`);
    keys.push(`${league}_${betSource}_${gender}_${tier}`);

    if (quarterVal != null) keys.push(`${league}_Q${quarterVal}_${betSource}_${gender}_UNKNOWN`);
    keys.push(`${league}_${betSource}_${gender}_UNKNOWN`);

    if (quarterVal != null) keys.push(`${league}_Q${quarterVal}_${betSource}`);
    keys.push(`${league}_${betSource}`);

    for (const k of keys) {
      if (leagueAssay && leagueAssay[k]) return leagueAssay[k];
    }

    const entries = Object.values(leagueAssay || {}).filter(l => l && l.league === league);
    if (entries.length === 0) return null;

    const best =
      entries.find(l => l.source === betSource && l.quarter === quarterVal && l.gender === gender && l.tier === tier && l.typeKey === betTypeKey) ||
      entries.find(l => l.source === betSource && l.quarter === quarterVal && l.gender === gender && l.tier === tier) ||
      entries.find(l => l.source === betSource && l.quarter == null && l.gender === gender && l.tier === tier) ||
      entries.find(l => l.source === betSource && l.quarter === quarterVal) ||
      entries.find(l => l.source === betSource && l.quarter == null) ||
      entries.find(l => l.source === betSource) ||
      entries[0];

    return best || null;
  };

    const leagueInfo = league ? tryAssayKeys() : null;

    const isKnownToxicLeague =
      league && Array.isArray(Config_.toxicLeagues) ? Config_.toxicLeagues.includes(league) : false;

    const isAssayToxicLeague =
      !!(leagueInfo && (leagueInfo.isToxic || leagueInfo.grade === "CHARCOAL"));

    const leagueBlocks = isKnownToxicLeague || isAssayToxicLeague;

    const backedTeam = (bet && bet.backedTeam) ? String(bet.backedTeam).trim().toUpperCase() : null;
    const matchupKey = (bet && bet.matchupKey) ? String(bet.matchupKey).trim().toUpperCase() : null;

    const teamKeyFn = (team, q) => (q == null ? team : `${team}__Q${q}`);
    const matchupKeyQFn = (mk, q) => (q == null ? mk : `${mk}__Q${q}`);

    let teamInfo = null;
    if (betSource === "Side" && backedTeam && teamAssay) {
      if (quarterVal != null && teamAssay[teamKeyFn(backedTeam, quarterVal)]) {
        teamInfo = teamAssay[teamKeyFn(backedTeam, quarterVal)];
      } else if (teamAssay[teamKeyFn(backedTeam, null)]) {
        teamInfo = teamAssay[teamKeyFn(backedTeam, null)];
      }
    }

    let matchupInfo = null;
    if (betSource === "Side" && matchupKey && matchupAssay) {
      if (quarterVal != null && matchupAssay[matchupKeyQFn(matchupKey, quarterVal)]) {
        matchupInfo = matchupAssay[matchupKeyQFn(matchupKey, quarterVal)];
      } else if (matchupAssay[matchupKeyQFn(matchupKey, null)]) {
        matchupInfo = matchupAssay[matchupKeyQFn(matchupKey, null)];
      }
    }

    const teamBlocks = !!(teamInfo && (teamInfo.isToxic || teamInfo.grade === "CHARCOAL"));
    const teamOverridesLeague = !!(teamInfo && (teamInfo.isElite || teamInfo.grade === "GOLD" || teamInfo.grade === "PLATINUM"));

    const matchupBlocks = !!(matchupInfo && (matchupInfo.isToxic || matchupInfo.grade === "CHARCOAL"));
    const matchupOverridesLeague = !!(matchupInfo && (matchupInfo.isElite || matchupInfo.grade === "GOLD" || matchupInfo.grade === "PLATINUM"));

    if (matchupBlocks) {
      matchedEdges.push("⛔TOXIC_MATCHUP");
      bestGrade = "CHARCOAL";
      isToxic = true;
      const qLab = (matchupInfo && matchupInfo.quarterLabel) ? ` (${matchupInfo.quarterLabel})` : "";
      const mBacked = (matchupInfo && matchupInfo.backedTeam) ? matchupInfo.backedTeam : (backedTeam || "?");
      const mOpp = (matchupInfo && matchupInfo.opponentTeam) ? matchupInfo.opponentTeam : ((bet && bet.opponentTeam) ? bet.opponentTeam : "?");
      status = `⛔ Toxic Matchup: ${mBacked} vs ${mOpp}${qLab}`;

    } else if (teamBlocks) {
      matchedEdges.push("⛔TOXIC_TEAM");
      bestGrade = "CHARCOAL";
      isToxic = true;
      const tqLab = (teamInfo && teamInfo.quarterLabel) ? ` (${teamInfo.quarterLabel})` : "";
      status = `⛔ Toxic Team: ${backedTeam}${tqLab}`;

    } else if (leagueBlocks && !(teamOverridesLeague || matchupOverridesLeague)) {
      matchedEdges.push("⛔TOXIC_LEAGUE");
      bestGrade = "CHARCOAL";
      isToxic = true;
      const qPart = quarterVal == null ? "" : (quarterVal === 0 ? " Full" : ` Q${quarterVal}`);
      status = `⛔ Toxic (${betSource || "?"} ${gender} ${tier}${qPart})`;

    } else {
      if (leagueBlocks && (teamOverridesLeague || matchupOverridesLeague)) {
        matchedEdges.push("⚠️TOXIC_LEAGUE_OVERRIDDEN");
      }

      if (matchupInfo && matchupOverridesLeague) {
        matchedEdges.push(`💠MATCHUP_${matchupInfo.grade}`);

        if (this.GRADE_ORDER.indexOf(matchupInfo.grade) > this.GRADE_ORDER.indexOf(bestGrade)) {
          bestGrade = matchupInfo.grade;
        }

        const mSym = matchupInfo.gradeSymbol || matchupInfo.grade;
        const mBacked2 = matchupInfo.backedTeam || backedTeam || "?";
        const mOpp2 = matchupInfo.opponentTeam || ((bet && bet.opponentTeam) ? bet.opponentTeam : "?");
        const mQLab = matchupInfo.quarterLabel || "All";
        status = `💠 ${mSym} ${mBacked2} vs ${mOpp2} (${mQLab})`;

      } else if (teamInfo && teamOverridesLeague) {
        matchedEdges.push(`💎TEAM_${teamInfo.grade}`);

        if (this.GRADE_ORDER.indexOf(teamInfo.grade) > this.GRADE_ORDER.indexOf(bestGrade)) {
          bestGrade = teamInfo.grade;
        }

        const tSym = teamInfo.gradeSymbol || teamInfo.grade;
        const tQLab = teamInfo.quarterLabel || "All";
        status = `💎 ${tSym} ${backedTeam} (${tQLab})`;

      } else if (leagueInfo && (leagueInfo.grade === "GOLD" || leagueInfo.grade === "PLATINUM")) {
        const symbol = leagueInfo.gradeSymbol || leagueInfo.grade;
        const qLabel = leagueInfo.quarter == null ? "All" : (leagueInfo.quarter === 0 ? "Full" : `Q${leagueInfo.quarter}`);
        status = `🏆 ${symbol} ${leagueInfo.source || betSource} ${leagueInfo.gender || gender} ${leagueInfo.tier || tier} ${qLabel}`;
      }
    }

    if (!isToxic) {
      let candidateEdges = edges;

      if (edgeIndex && edgeIndex.size > 0) {
        const candidateSet = new Set();
        const betEntries = Object.entries(bet || {});
        for (let ei = 0; ei < betEntries.length; ei++) {
          const bKey = betEntries[ei][0];
          const bVal = betEntries[ei][1];
          if (bVal == null) continue;
          const indexed = edgeIndex.get(`${bKey}:${bVal}`);
          if (indexed) {
            for (let ix = 0; ix < indexed.length; ix++) {
              candidateSet.add(indexed[ix]);
            }
          }
        }
        if (candidateSet.size > 0) candidateEdges = Array.from(candidateSet);
      }

      for (let ce = 0; ce < candidateEdges.length; ce++) {
        const edge = candidateEdges[ce];
        if (this.matchesCriteria(bet, edge.criteria)) {
          matchedEdges.push(edge.id);

          if (this.GRADE_ORDER.indexOf(edge.grade) > this.GRADE_ORDER.indexOf(bestGrade)) {
            bestGrade = edge.grade;
            bestEdge = edge;
          }

          const symbol = edge.gradeSymbol || edge.grade;
          if (edge.grade === "PLATINUM" || edge.grade === "GOLD") {
            status = `✨ ${symbol} ${this.truncate(edge.name, 20)}`;
          } else if (edge.grade === "SILVER" && status.indexOf("✨") === -1) {
            status = `🥈 ${this.truncate(edge.name, 20)}`;
          }
        }
      }

      if (matchedEdges.length > 0 && status === "—") {
        status = `${matchedEdges.length} edge(s) matched`;
      }
    }

    const isSystemMarker = (x) => /^⛔|^⚠️|^💎|^💠/.test(String(x || ""));
    const edgeCount = matchedEdges.filter(e => !isSystemMarker(e)).length;

    return {
      matchedEdges: matchedEdges,
      bestGrade: bestGrade,
      bestEdge: bestEdge,
      status: status,
      isToxic: isToxic,
      edgeCount: edgeCount
    };
  },

  // =========================================================================
  // v4.3.0 PATCH: typeKey fallback for when Discovery_ is unavailable
  // =========================================================================

  _getTotalsTypeKeyFallback(bet) {
    if (!bet) return "UNKNOWN";
    if (bet.typeKey) return bet.typeKey;

    const raw = String(bet.type || "").trim().toUpperCase().replace(/\s+/g, " ");
    if (!raw) return "UNKNOWN";

    const hasSniper = raw.indexOf("SNIPER") !== -1;
    const hasOU = raw.indexOf("O/U") !== -1 ||
                  raw.indexOf("OU") !== -1 ||
                  raw.indexOf("OVER/UNDER") !== -1 ||
                  raw.indexOf("OVER UNDER") !== -1 ||
                  raw.indexOf("TOTAL") !== -1;

    if (hasSniper && hasOU) {
      if (raw.indexOf("DIR") !== -1) return "SNIPER_OU_DIR";
      if (raw.indexOf("STAR") !== -1) return "SNIPER_OU_STAR";
      return "SNIPER_OU";
    }

    if (hasOU) {
      if (raw.indexOf("DIR") !== -1) return "OU_DIR";
      if (raw.indexOf("STAR") !== -1) return "OU_STAR";
      return "OU";
    }

    return "OTHER";
  },

  // =========================================================================
  // v4.3.0 PATCH: matchesCriteria auto-derives typeKey
  // =========================================================================

    matchesCriteria(bet, criteria) {
    if (!criteria || typeof criteria !== "object" || Object.keys(criteria).length === 0) return false;
    if (!bet || typeof bet !== "object") return false;

    var norm = function(x) {
      if (x === null || x === undefined) return x;
      if (typeof x === "boolean") return x;
      if (typeof x === "number") return isFinite(x) ? x : null;

      var s = String(x).trim();
      if (s === "") return "";

      if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
        var n = parseFloat(s);
        return isFinite(n) ? n : null;
      }
      return s.toUpperCase();
    };

    var criteriaEntries = Object.entries(criteria);
    for (var i = 0; i < criteriaEntries.length; i++) {
      var key = criteriaEntries[i][0];
      var expected = criteriaEntries[i][1];
      var actual = bet[key];

      // v4.3.0: auto-derive typeKey if missing on the bet
      if (key === "typeKey" && (actual === undefined || actual === null)) {
        if (typeof Discovery_ !== "undefined" && Discovery_._getTotalsTypeKey) {
          actual = Discovery_._getTotalsTypeKey(bet);
        } else {
          actual = this._getTotalsTypeKeyFallback(bet);
        }
      }

      if (actual === undefined || actual === null) return false;
      if (norm(actual) !== norm(expected)) return false;
    }

    return true;
  },

    flagBet(bet, edges, leagueAssay, teamAssay, matchupAssay) {
    var safeEdges = Array.isArray(edges) ? edges : [];
    var edgeIndex = this._buildEdgeIndex(safeEdges);

    return this.evaluateRow(
      bet,
      safeEdges,
      leagueAssay || {},
      edgeIndex,
      teamAssay || null,
      matchupAssay || null
    );
  },

  // =========================================================================
  // v4.3.0 PATCH: parseRowForMatching adds source + type + typeKey for totals
  // =========================================================================

  parseRowForMatching(row, resolved, type) {
    const self = this;

    const getValue = (key, defaultVal) => {
      if (defaultVal === undefined) defaultVal = "";
      if (typeof Parser_ !== "undefined" && Parser_.getValue) {
        return Parser_.getValue(row, resolved, key, defaultVal);
      }
      const idx = resolved[key];
      return (idx !== undefined && idx >= 0 && idx < row.length) ? row[idx] : defaultVal;
    };

    const pick = getValue("pick", "");
    const league = String(getValue("league", "")).trim().toUpperCase();
    const match = String(getValue("match", ""));
    const confRaw = getValue("confidence");

    const conf = (typeof Parser_ !== "undefined" && Parser_.parseConfidence)
      ? Parser_.parseConfidence(confRaw)
      : self._parseConfidenceFallback(confRaw);

    const tierRaw = getValue("tier");
    const tier = (typeof Parser_ !== "undefined" && Parser_.parseTier)
      ? Parser_.parseTier(tierRaw)
      : self._parseTierFallback(tierRaw);

    const quarterRaw = getValue("quarter");
    const quarter = (typeof Parser_ !== "undefined" && Parser_.parseQuarter)
      ? Parser_.parseQuarter(quarterRaw)
      : self._parseQuarterFallback(quarterRaw);

    const isWomen = (typeof Parser_ !== "undefined" && Parser_.isWomenLeague)
      ? Parser_.isWomenLeague(league, match)
      : self._isWomenFallback(league, match);

    const confBucket = (typeof Parser_ !== "undefined" && Parser_.getConfBucket)
      ? Parser_.getConfBucket(conf)
      : self._getConfBucketFallback(conf);

    // v4.3.0: include source so evaluateRow can derive betSource
    const base = {
      source: type === "side" ? "Side" : "Totals",
      league: league,
      isWomen: isWomen,
      confBucket: confBucket,
      tier: tier,
      quarter: quarter
    };

    if (type === "side") {
      const spread = (typeof Parser_ !== "undefined" && Parser_.parseSpread)
        ? Parser_.parseSpread(pick)
        : self._parseSpreadFallback(pick);

      const side = (typeof Parser_ !== "undefined" && Parser_.parseSide)
        ? Parser_.parseSide(pick, getValue("side"))
        : self._parseSideFallback(pick, getValue("side"));

      const spreadBucket = (typeof Parser_ !== "undefined" && Parser_.getSpreadBucket)
        ? Parser_.getSpreadBucket(spread)
        : self._getSpreadBucketFallback(spread);

      base.side = side;
      base.spreadBucket = spreadBucket;

      const norm = (s) => {
        if (typeof Parser_ !== "undefined" && Parser_.normalizeTeamName) {
          return Parser_.normalizeTeamName(s);
        }
        return s ? String(s).trim().toUpperCase() : null;
      };

      let home = norm(getValue("home", ""));
      let away = norm(getValue("away", ""));

      if ((!home || !away) && (typeof Parser_ !== "undefined" && Parser_.extractTeamsFromMatch)) {
        const parsed = Parser_.extractTeamsFromMatch(match);
        home = home || parsed.home;
        away = away || parsed.away;
      }

      let backedTeam = null;
      if (typeof Parser_ !== "undefined" && Parser_.deriveBackedTeam) {
        backedTeam = Parser_.deriveBackedTeam({ side: side, home: home, away: away, pick: pick, match: match });
      } else {
        backedTeam = (side === "H") ? home : ((side === "A") ? away : null);
      }

      let opponentTeam = null;
      if (backedTeam && home && away) {
        opponentTeam = (backedTeam === home) ? away : ((backedTeam === away) ? home : null);
      }

      const matchupKey = (backedTeam && opponentTeam) ? `${backedTeam}__VS__${opponentTeam}` : null;

      base.backedTeam = backedTeam || null;
      base.opponentTeam = opponentTeam || null;
      base.matchupKey = matchupKey || null;

    } else {
      // totals
      const lineRaw = getValue("line");
      const line = (typeof Parser_ !== "undefined" && Parser_.parseLine)
        ? Parser_.parseLine(lineRaw)
        : self._parseLineFallback(lineRaw);

      const direction = (typeof Parser_ !== "undefined" && Parser_.parseDirection)
        ? Parser_.parseDirection(getValue("direction"))
        : self._parseDirectionFallback(getValue("direction"));

      const lineBucket = (typeof Parser_ !== "undefined" && Parser_.getLineBucket)
        ? Parser_.getLineBucket(line)
        : self._getLineBucketFallback(line);

      base.direction = direction;
      base.lineBucket = lineBucket;

      // v4.3.0: read raw type and derive canonical typeKey
      const typeRaw = getValue("type", "");
      base.type = String(typeRaw || "");

      if (typeof Discovery_ !== "undefined" && Discovery_._getTotalsTypeKey) {
        base.typeKey = Discovery_._getTotalsTypeKey(base);
      } else if (typeof Parser_ !== "undefined" && Parser_._deriveTotalsTypeKey) {
        base.typeKey = Parser_._deriveTotalsTypeKey(base);
      } else {
        base.typeKey = self._getTotalsTypeKeyFallback(base);
      }
    }

    return base;
  },

  findOrCreateColumn(sheet, headers, aliases, defaultName) {
    const normalizedAliases = aliases.map(a => a.toLowerCase().replace(/[^a-z0-9]/g, ""));

    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i]).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normalizedAliases.some(a => h.includes(a) || a.includes(h))) {
        return i + 1;
      }
    }

    const newCol = headers.length + 1;
    sheet.getRange(1, newCol).setValue(defaultName).setFontWeight("bold");
    return newCol;
  },

  formatGrade(grade) {
    const symbols = {
      PLATINUM: "💎",
      GOLD: "🥇",
      SILVER: "🥈",
      BRONZE: "🥉",
      ROCK: "🪨",
      CHARCOAL: "💩"
    };

    const symbol = symbols[grade] || "";
    return `${symbol} ${grade}`;
  },

  truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    return str.substring(0, maxLen - 1) + "…";
  },

  // =========================================================================
  // FALLBACK PARSERS
  // =========================================================================

  _parseConfidenceFallback(val) {
    if (val === null || val === undefined) return null;
    const str = String(val).replace("%", "").trim();
    const num = parseFloat(str);
    return isNaN(num) ? null : (num > 1 ? num / 100 : num);
  },

  _parseTierFallback(val) {
    if (!val) return null;
    const upper = String(val).toUpperCase().trim();
    if (upper.includes("STRONG") || upper === "S") return "STRONG";
    if (upper.includes("MED") || upper === "M") return "MEDIUM";
    if (upper.includes("WEAK") || upper === "W") return "WEAK";
    return null;
  },

  _parseQuarterFallback(val) {
    if (val === null || val === undefined) return null;
    const str = String(val).replace(/[Qq]/g, "").trim();
    const num = parseInt(str, 10);
    return (num >= 1 && num <= 4) ? num : null;
  },

  _isWomenFallback(league, match) {
    const combined = `${league} ${match}`.toUpperCase();
    return /\bW\b|WOMEN|WBB|WNBA|WCBB/.test(combined);
  },

  _getConfBucketFallback(conf) {
    if (conf === null || conf === undefined) return null;
    const buckets = Config_.confBuckets || [
      { name: "ELITE", min: 0.70, max: 1.00 },
      { name: "HIGH", min: 0.60, max: 0.70 },
      { name: "MEDIUM", min: 0.55, max: 0.60 },
      { name: "LOW", min: 0, max: 0.55 }
    ];
    for (const b of buckets) {
      if (conf >= b.min && conf < b.max) return b.name;
    }
    return buckets[buckets.length - 1] ? buckets[buckets.length - 1].name : null;
  },

  _parseSpreadFallback(pick) {
    if (!pick) return null;
    const m = String(pick).match(/[+-]?\d+\.?\d*/);
    return m ? parseFloat(m[0]) : null;
  },

  _parseSideFallback(pick, sideCol) {
    const pickStr = String(pick).toUpperCase();
    if (pickStr.includes("HOME") || pickStr.startsWith("H")) return "H";
    if (pickStr.includes("AWAY") || pickStr.startsWith("A")) return "A";

    if (sideCol) {
      const sideStr = String(sideCol).toUpperCase().trim();
      if (sideStr.includes("HOME") || sideStr === "H") return "H";
      if (sideStr.includes("AWAY") || sideStr === "A") return "A";
    }
    return null;
  },

  _getSpreadBucketFallback(spread) {
    if (spread === null || spread === undefined) return null;
    const abs = Math.abs(spread);
    const buckets = Config_.spreadBuckets || [
      { name: "TINY", min: 0, max: 3.5 },
      { name: "SMALL", min: 3.5, max: 7.5 },
      { name: "MEDIUM", min: 7.5, max: 12.5 },
      { name: "LARGE", min: 12.5, max: 999 }
    ];
    for (const b of buckets) {
      if (abs >= b.min && abs < b.max) return b.name;
    }
    return null;
  },

  _parseLineFallback(val) {
    if (val === null || val === undefined) return null;
    const num = parseFloat(String(val).replace(/[^\d.]/g, ""));
    return isNaN(num) ? null : num;
  },

  _parseDirectionFallback(val) {
    if (!val) return null;
    const str = String(val).toLowerCase().trim();
    if (str.includes("over") || str === "o") return "Over";
    if (str.includes("under") || str === "u") return "Under";
    return null;
  },

  _getLineBucketFallback(line) {
    if (line === null || line === undefined) return null;
    const buckets = Config_.lineBuckets || [
      { name: "LOW", min: 0, max: 140 },
      { name: "MEDIUM", min: 140, max: 160 },
      { name: "HIGH", min: 160, max: 999 }
    ];
    for (const b of buckets) {
      if (line >= b.min && line < b.max) return b.name;
    }
    return null;
  },

  // =========================================================================
  // UTILITY METHODS
  // =========================================================================

  previewFlags(ss, sheetName, edges, leagueAssay, type) {
    if (!this.log) this.init();

    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { error: "Sheet not found" };

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { error: "No data", total: 0 };

    const headers = data[0];
    const aliases = type === "side" ? Config_.sideColumnAliases : Config_.totalsColumnAliases;
    ColResolver_.init();
    const { resolved } = ColResolver_.resolve(headers, aliases, sheetName);

    const edgeIndex = this._buildEdgeIndex(edges);

    const gradeCount = {};
    let flagged = 0;
    let toxic = 0;

    for (let i = 1; i < data.length; i++) {
      const bet = this.parseRowForMatching(data[i], resolved, type);
      const result = this.evaluateRow(bet, edges, leagueAssay, edgeIndex);

      if (result.matchedEdges.length > 0) flagged++;
      if (result.isToxic) toxic++;

      gradeCount[result.bestGrade] = (gradeCount[result.bestGrade] || 0) + 1;
    }

    return {
      total: data.length - 1,
      flagged: flagged,
      toxic: toxic,
      byGrade: gradeCount
    };
  },

  clearFlags(ss, sheetName) {
    if (!this.log) this.init();

    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const flagCols = ["ma_edgeflags", "ma_grade", "ma_status"];

    for (let i = 0; i < headers.length; i++) {
      const h = String(headers[i]).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (flagCols.some(f => h.includes(f.replace(/_/g, "")))) {
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          sheet.getRange(2, i + 1, lastRow - 1, 1).clearContent();
        }
      }
    }

    this.log.info(`Cleared flags from ${sheetName}`);
  },

  getRowsMatchingEdge(ss, sheetName, edge, type) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];

    const headers = data[0];
    const aliases = type === "side" ? Config_.sideColumnAliases : Config_.totalsColumnAliases;
    ColResolver_.init();
    const { resolved } = ColResolver_.resolve(headers, aliases, sheetName);

    const matches = [];
    for (let i = 1; i < data.length; i++) {
      const bet = this.parseRowForMatching(data[i], resolved, type);
      if (this.matchesCriteria(bet, edge.criteria)) {
        matches.push(i + 1);
      }
    }

    return matches;
  }
};
```

## File: docs/Log_LoggingSystem.gs
```
/******************************************************************************
 * MA ASSAYER — Complete Production Module
 * 
 * "Testing the purity of predictions - separating Gold from Charcoal"
 * 
 * COMPLETE ROBUST IMPLEMENTATION
 * 
 * ARCHITECTURE:
 * ├── M1_Output_          Sheet Writers
 * ├── M2_Main_            Controller/Orchestrator
 * ├── M3_Flagger_         Apply Flags to Source
 * ├── M4_Discovery_       Edge Discovery Engine
 * ├── M5_Config_          Configuration & Constants
 * ├── M6_ColResolver_     Fuzzy Column Matching (case-insensitive)
 * ├── M7_Parser_          Data Parsing
 * ├── M8_Stats_           Statistical Calculations
 * ├── M9_Utils_           Utility Functions
 * └── M10_Log_            Logging System
 ******************************************************************************/
 /******************************************************************************
 * MODULE: Log_ — Comprehensive Logging System
 ******************************************************************************/

const Log_ = {
  entries: [],
  startTime: null,
  sessionId: null,

  /**
   * Initialize logging session
   */
  init() {
    this.entries = [];
    this.startTime = new Date();
    this.sessionId = Utils_.generateId("SESSION");

    this.info("═══════════════════════════════════════════════════════════════");
    this.info(`⚗️ Ma Assayer v${Config_.version} — Session Started`);
    this.info(`Session ID: ${this.sessionId}`);
    this.info(`Timestamp: ${this.startTime.toISOString()}`);
    this.info(`Build: ${Config_.buildDate}`);
    this.info("═══════════════════════════════════════════════════════════════");
  },

  /**
   * Internal log method
   */
  _log(level, module, message, data = null) {
    const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
    const entry = {
      timestamp,
      level,
      module,
      message,
      data,
      sessionId: this.sessionId
    };
    this.entries.push(entry);

    // Console output
    const prefix = `[${timestamp}] [${level.padEnd(7)}] [${module.padEnd(12)}]`;
    const dataStr = data ? ` | ${JSON.stringify(data).substring(0, 150)}` : "";
    console.log(`${prefix} ${message}${dataStr}`);
  },

  /**
   * Log levels
   */
  info(message, data = null) {
    this._log("INFO", "SYSTEM", message, data);
  },
  warn(message, data = null) {
    this._log("WARN", "SYSTEM", message, data);
  },

  error(message, data = null) {
    this._log("ERROR", "SYSTEM", message, data);
  },

  debug(message, data = null) {
    this._log("DEBUG", "SYSTEM", message, data);
  },

  success(message, data = null) {
    this._log("SUCCESS", "SYSTEM", message, data);
  },

  /**
   * Create module-specific logger
   */
  module(moduleName) {
    const self = this;
    return {
      info: (msg, data) => self._log("INFO", moduleName, msg, data),
      warn: (msg, data) => self._log("WARN", moduleName, msg, data),
      error: (msg, data) => self._log("ERROR", moduleName, msg, data),
      debug: (msg, data) => self._log("DEBUG", moduleName, msg, data),
      success: (msg, data) => self._log("SUCCESS", moduleName, msg, data),
      trace: (msg, data) => self._log("TRACE", moduleName, msg, data)
    };
  },

  /**
   * Section markers
   */
  section(title) {
    const line = "─".repeat(Math.max(0, 55 - title.length));
    this.info(`┌─── ${title} ${line}┐`);
  },
  sectionEnd(title) {
    const line = "─".repeat(Math.max(0, 46 - title.length));
    this.info(`└─── ${title} Complete ${line}┘`);
  },

  /**
   * Progress indicator
   */
  progress(current, total, message = "") {
    const pct = Math.round((current / total) * 100);
    const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
    this._log("PROG", "SYSTEM", `[${bar}] ${pct}% (${current}/${total}) ${message}`, null);
  },

  /**
   * Generate session summary
   */
  summary() {
    const elapsed = ((new Date() - this.startTime) / 1000).toFixed(2);
    const warnings = this.entries.filter(e => e.level === "WARN").length;
    const errors = this.entries.filter(e => e.level === "ERROR").length;
    const successes = this.entries.filter(e => e.level === "SUCCESS").length;

    this.info("═══════════════════════════════════════════════════════════════");
    this.info(`Session Complete — ${this.sessionId}`);
    this.info(`Elapsed Time: ${elapsed}s`);
    this.info(`Log Entries: ${this.entries.length}`);
    this.info(`Successes: ${successes} | Warnings: ${warnings} | Errors: ${errors}`);
    this.info("═══════════════════════════════════════════════════════════════");

    return { 
      elapsed, 
      warnings, 
      errors, 
      successes, 
      totalEntries: this.entries.length,
      sessionId: this.sessionId
    };
  },

  /**
   * Write logs to sheet
   */
  writeToSheet(ss) {
    const log = this.module("LOG_WRITER");

    try {
      let sheet = ss.getSheetByName(Config_.sheets.logs);
      if (!sheet) {
        sheet = ss.insertSheet(Config_.sheets.logs);
        log.info("Created logs sheet");
      }
      
      // Manage log rotation - keep last 1000 entries
      const existing = sheet.getLastRow();
      if (existing > 1500) {
        // PATCH: Fixed to delete (existing - 1000) rows to keep ~1000 entries (was existing - 500)
        sheet.deleteRows(2, existing - 1000);
        log.info("Rotated old log entries");
      }
      
      // Set headers if needed
      const headers = ["Timestamp", "Level", "Module", "Message", "Data", "Session"];
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.getRange(1, 1, 1, headers.length)
          .setFontWeight("bold")
          .setBackground(Config_.colors.header)
          .setFontColor(Config_.colors.headerText);
        sheet.setFrozenRows(1);
      }
      
      // Build rows from entries
      const rows = this.entries.map(e => [
        e.timestamp,
        e.level,
        e.module,
        e.message,
        e.data ? JSON.stringify(e.data).substring(0, 500) : "",
        e.sessionId || ""
      ]);
      
      // PATCH: Early return if no entries to write
      if (rows.length === 0) {
        log.info("No log entries to write");
        return;
      }
      
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
      
      // PATCH: Batch color-coding by building a 2D backgrounds array instead of per-row setBackground
      const defaultColor = "#ffffff";
      const backgrounds = [];
      let hasNonDefault = false;
      
      for (let i = 0; i < this.entries.length; i++) {
        const level = this.entries[i].level;
        let color = defaultColor;
        if (level === "ERROR") {
          color = "#ffcccc";
          hasNonDefault = true;
        } else if (level === "WARN") {
          color = "#fff3cd";
          hasNonDefault = true;
        } else if (level === "SUCCESS") {
          color = "#d4edda";
          hasNonDefault = true;
        }
        // Create a row of colors (one per column)
        const rowColors = [];
        for (let c = 0; c < headers.length; c++) {
          rowColors.push(color);
        }
        backgrounds.push(rowColors);
      }
      
      // Only apply backgrounds if there are non-default colors to set
      if (hasNonDefault) {
        sheet.getRange(startRow, 1, rows.length, headers.length).setBackgrounds(backgrounds);
      }
      
      log.success(`Wrote ${rows.length} log entries to sheet`);
      
    } catch (err) {
      console.error("Failed to write logs to sheet:", err);
    }
  },

  /**
   * Get logs by level
   */
  getByLevel(level) {
    return this.entries.filter(e => e.level === level);
  },

  /**
   * Get logs by module
   */
  getByModule(module) {
    return this.entries.filter(e => e.module === module);
  },

  /**
   * Clear logs
   */
  clear() {
    this.entries = [];
  }
};
```

## File: docs/Main_Orchestrator.gs
```
/******************************************************************************
 * MA ASSAYER — Complete Production Module
 * 
 * "Testing the purity of predictions - separating Gold from Charcoal"
 * 
 * COMPLETE ROBUST IMPLEMENTATION
 * 
 * ARCHITECTURE:
 * ├── M1_Output_          Sheet Writers
 * ├── M2_Main_            Controller/Orchestrator
 * ├── M3_Flagger_         Apply Flags to Source
 * ├── M4_Discovery_       Edge Discovery Engine
 * ├── M5_Config_          Configuration & Constants
 * ├── M6_ColResolver_     Fuzzy Column Matching (case-insensitive)
 * ├── M7_Parser_          Data Parsing
 * ├── M8_Stats_           Statistical Calculations
 * ├── M9_Utils_           Utility Functions
 * └── M10_Log_            Logging System
 ******************************************************************************/
 
// ============================================================================
// MODULE: Main_ — Orchestrator
// ============================================================================

const Main_ = {
  
  /**
   * Run the full assay process
   */
  runAssay() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Initialize
  Log_.init();
  ConfigLedger_Reader.init(/* optional: "SATELLITE_SPREADSHEET_ID" */);
  Config_.sheets.side = "Side"; // Ensure defaults
  Config_.sheets.totals = "Totals";
  
  try {
    // 2. Parse Data
    const sideData = Parser_.parseSideSheet(ss);
    const totalsData = Parser_.parseTotalsSheet(ss);
    
    const allBets = [...sideData.bets, ...totalsData.bets];
    
    // Apply 48-hour abandonment rule (Phase 5 Safety)
    allBets = applyAbandonmentRule_(allBets);
    
    if (allBets.length === 0) {
      Log_.error("No valid bets found in Side or Totals sheets.");
      Log_.writeToSheet(ss);
      return;
    }
    
    // 3. Statistical Analysis
    Log_.section("Running Statistics");
    const globalStats = Stats_.calcBasic(allBets);
    const sideStats = Stats_.calcBasic(sideData.bets);
    const totalsStats = Stats_.calcBasic(totalsData.bets);
    
    // 4. League Assay
    const leagueAssay = Stats_.assayLeagues(allBets, globalStats);

    // =========================================================
    // PATCH: Team assay + Matchup assay (Side only)
    // =========================================================
    const teamAssay = Stats_.assayTeams(sideData.bets, globalStats);
    const matchupAssay = Stats_.assayMatchups(sideData.bets, globalStats);
    
    // 5. Edge Discovery (Using patched Discovery_)
    const edges = Discovery_.discoverAll(sideData.bets, totalsData.bets);
    
    // 6. Exclusion Analysis
    const exclusionImpact = Stats_.calcExclusionImpact(allBets, globalStats);
    
    // 7. Write Outputs
    Output_.writeVault(ss, globalStats, sideStats, totalsStats, leagueAssay, edges, teamAssay, matchupAssay);
    Output_.writeLeagueAssay(ss, leagueAssay, globalStats);
    Output_.writeDiscoveredEdges(ss, edges, globalStats);
    Output_.writeExclusionImpact(ss, exclusionImpact, globalStats);

    // PATCH (optional): write Team + Matchup assay tabs if present
    if (Output_.writeTeamAssay) Output_.writeTeamAssay(ss, teamAssay);
    if (Output_.writeMatchupAssay) Output_.writeMatchupAssay(ss, matchupAssay);

    // ── MOTHER CONTRACT OUTPUT (additive only) ──
    Output_.writeAssayerEdges(ss, edges);
    Output_.writeAssayerLeaguePurity(ss, leagueAssay);

    // 8. Apply Flags Back to Source (PATCH: pass assays)
    Flagger_.applyFlags(ss, edges, leagueAssay, teamAssay, matchupAssay);
    
    // 9. Generate Summary
    const logSummary = Log_.summary();
    Output_.writeSummary(ss, globalStats, sideStats, totalsStats, leagueAssay, edges, logSummary);
    
    // 10. Finish
    Log_.writeToSheet(ss);
    SpreadsheetApp.getUi().alert("Assay Complete! Check the 'MA_Vault' tab.");
    
  } catch (err) {
    Log_.error(`CRITICAL FAILURE: ${err.message}`, err.stack);
    Log_.writeToSheet(ss);
    SpreadsheetApp.getUi().alert(`Error: ${err.message}`);
  }
},
  
  /**
   * Run just the flagger (useful if manual edits made to edges)
   */
   runFlaggerOnly() {
   const ss = SpreadsheetApp.getActiveSpreadsheet();
   Log_.init();
   ConfigLedger_Reader.init(/* optional: "SATELLITE_SPREADSHEET_ID" */);
  
   try {
     const sideData = Parser_.parseSideSheet(ss);
     const totalsData = Parser_.parseTotalsSheet(ss);
     const allBets = [...sideData.bets, ...totalsData.bets];
    
     // Re-run minimal stats needed for flagging
     const globalStats = Stats_.calcBasic(allBets);
     const leagueAssay = Stats_.assayLeagues(allBets, globalStats);

     // PATCH: team + matchup assays for flagger-only mode
     const teamAssay = Stats_.assayTeams(sideData.bets, globalStats);
     const matchupAssay = Stats_.assayMatchups(sideData.bets, globalStats);

     const edges = Discovery_.discoverAll(sideData.bets, totalsData.bets);
    
     // PATCH: pass assays
     Flagger_.applyFlags(ss, edges, leagueAssay, teamAssay, matchupAssay);

     // ── MOTHER CONTRACT OUTPUT (additive only) ──
     Output_.writeAssayerEdges(ss, edges);
     Output_.writeAssayerLeaguePurity(ss, leagueAssay);

     Log_.writeToSheet(ss);
     SpreadsheetApp.getUi().alert("Flags Re-Applied Successfully.");
    
   } catch (err) {
     Log_.error(`FLAGGER FAILED: ${err.message}`);
     Log_.writeToSheet(ss);
   }
 }
};

/**
 * setupAssayerSheets - Create required sheets for Assayer operation
 */
function setupAssayerSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  const requiredSheets = [
    // Core betting sheets (23-column contract compliance)
    { name: 'Bet_Slips', headers: ['bet_id', 'league', 'event_date', 'event_time', 'match', 'team', 'opponent', 'side_total', 'line', 'odds', 'implied_prob', 'confidence_pct', 'tier_code', 'tier_display', 'ev', 'kelly_pct', 'status', 'result', 'payout', 'placed_at', 'settled_at', 'config_stamp', 'source', 'gender', 'quarter', 'season', 'created_at'] },
    { name: 'ResultsClean', headers: ['result_id', 'event_date', 'league', 'team', 'opponent', 'side_total', 'line', 'actual_result', 'settled_at', 'status', 'payout', 'config_stamp', 'source', 'season', 'quarter', 'created_at'] },
    
    // Prediction logs (17-column forensic logs)
    { name: 'Tier1_Predictions', headers: ['log_id', 'timestamp', 'league', 'event_id', 'team', 'opponent', 'side_total', 'line', 'prediction', 'confidence', 'tier', 'ev', 'status', 'result', 'config_stamp', 'source', 'notes'] },
    { name: 'Tier2_Log', headers: ['log_id', 'timestamp', 'league', 'event_id', 'team', 'opponent', 'side_total', 'line', 'prediction', 'confidence', 'tier', 'ev', 'status', 'result', 'config_stamp', 'source', 'notes'] },
    { name: 'OU_Log', headers: ['log_id', 'timestamp', 'league', 'event_id', 'team', 'opponent', 'side_total', 'line', 'prediction', 'confidence', 'tier', 'ev', 'status', 'result', 'config_stamp', 'source', 'notes'] },
    
    // Accuracy and reporting sheets
    { name: 'Accuracy_Report', headers: ['Generated', 'Total_Bets_Graded', 'Total_Hits', 'Total_Misses', 'Overall_Hit_Rate'] },
    { name: 'Tier2_Accuracy', headers: ['Metric', 'Value'] },
    { name: 'OU_Accuracy', headers: ['Metric', 'Value'] },
    
    // Configuration sheets (Config_Ledger system)
    { name: 'Config_Ledger', headers: ['config_key', 'config_value', 'description', 'last_updated', 'dominant_stamp', 'stamp_purity'] },
    { name: 'Config_Tier1', headers: ['config_key', 'config_value', 'description', 'last_updated'] },
    { name: 'Config_Tier2', headers: ['config_key', 'config_value', 'description', 'last_updated'] },
    { name: 'Config_Accumulator', headers: ['config_key', 'config_value', 'description', 'last_updated'] },
    
    // Satellite management
    { name: 'Satellite_Identity', headers: ['satellite_id', 'spreadsheet_url', 'satellite_name', 'status', 'last_sync', 'config_version', 'notes'] },
    
    // Analysis and assay sheets
    { name: 'Assayer_Log', headers: ['Timestamp', 'Level', 'Message'] },
    { name: 'League_Assay', headers: ['League', 'Total_Bets', 'Win_Rate', 'Avg_Odds', 'Purity', 'Grade'] },
    { name: 'Team_Assay', headers: ['Team', 'Total_Bets', 'Win_Rate', 'Avg_Odds', 'Purity', 'Grade'] },
    { name: 'Edges', headers: ['Date', 'League', 'Home', 'Away', 'Pick', 'Edge_Type', 'Edge_Value', 'Confidence'] },
    
    // Stats and performance sheets
    { name: 'Stats', headers: ['Metric', 'Value', 'Description'] },
    { name: 'Standings', headers: ['Team', 'League', 'Played', 'Won', 'Lost', 'Points'] },
    { name: 'Sheet_Inventory', headers: ['sheet_name', 'sheet_type', 'row_count', 'last_updated', 'status'] },
    
    // Raw data sheets
    { name: 'ResultsRaw', headers: ['Date', 'League', 'Home', 'Away', 'Score', 'Result'] },
    { name: 'Raw', headers: ['Date', 'League', 'Home', 'Away', 'Pick', 'Type', 'Odds', 'Result'] },
    
    // Tier2 analysis sheets
    { name: 'TeamQuarterStats_Tier2', headers: ['Team', 'League', 'Quarter', 'Games', 'Wins', 'Losses', 'Win_Rate'] },
    { name: 'LeagueQuarterO_U_Stats', headers: ['League', 'Quarter', 'Over_Hits', 'Over_Misses', 'Under_Hits', 'Under_Misses', 'Total_Games'] },
    
    // Legacy sheets (backward compatibility)
    { name: 'Side', headers: ['Date', 'League', 'Home', 'Away', 'Pick', 'Side', 'Odds', 'Result', 'Outcome', 'Notes'] },
    { name: 'Totals', headers: ['Date', 'League', 'Home', 'Away', 'Pick', 'Line', 'Odds', 'Result', 'Outcome', 'Notes'] },
    
    // Upcoming and analysis sheets
    { name: 'UpcomingClean', headers: ['Date', 'League', 'Home', 'Away', 'Pick', 'Type', 'Odds', 'Status'] },
    { name: 'UpcomingRaw', headers: ['Date', 'League', 'Home', 'Away', 'Time', 'Status'] }
  ];
  
  requiredSheets.forEach(({ name, headers }) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
            .setFontWeight('bold')
            .setBackground('#f0f0f0');
      Logger.log(`Created sheet: ${name}`);
    } else {
      Logger.log(`Sheet already exists: ${name}`);
    }
  });
  
  SpreadsheetApp.getUi().alert('Assayer sheets setup complete!');
  Logger.log('Assayer sheets setup completed');
}

/**
 * Standard Apps Script Entry Points
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Assayer')
    .addItem('Setup Sheets', 'setupAssayerSheets')
    .addSeparator()
    .addItem('Run Full Assay', 'runAssay')
    .addSeparator()
    .addItem('Refresh Flags Only', 'runFlagger')
    .addItem('Clear Logs', 'clearLogs')
    .addToUi();
}

function runAssay() { Main_.runAssay(); }
function runFlagger() { Main_.runFlaggerOnly(); }
function clearLogs() { 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(Config_.sheets.logs);
  if (sheet) sheet.clear();
}
```

## File: docs/Output_Writers.gs
```
/******************************************************************************
 * MA ASSAYER — Complete Production Module
 * 
 * "Testing the purity of predictions - separating Gold from Charcoal"
 * 
 * COMPLETE ROBUST IMPLEMENTATION
 * 
 * ARCHITECTURE:
 * ├── M1_Output_          Sheet Writers
 * ├── M2_Main_            Controller/Orchestrator
 * ├── M3_Flagger_         Apply Flags to Source
 * ├── M4_Discovery_       Edge Discovery Engine
 * ├── M5_Config_          Configuration & Constants
 * ├── M6_ColResolver_     Fuzzy Column Matching (case-insensitive)
 * ├── M7_Parser_          Data Parsing
 * ├── M8_Stats_           Statistical Calculations
 * ├── M9_Utils_           Utility Functions
 * └── M10_Log_            Logging System
 ******************************************************************************/

// ============================================================================
// MODULE: Output_ — Sheet Writers
// ============================================================================

const Output_ = {
  log: null,
  
  /**
   * Initialize module
   */
  init() {
    this.log = Log_.module("OUTPUT");
  },
  
  /**
   * Get or create sheet
   */
  getOrCreateSheet(ss, name) {
    if (!this.log) this.init();
    
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      this.log.info(`Created sheet: ${name}`);
    }
    return sheet;
  },
  
  /**
   * Clear and format header row
   */
  formatHeader(sheet, headers, options = {}) {
    const {
      bgColor = Config_.colors.header,
      textColor = Config_.colors.headerText,
      freezeRows = 1
    } = options;
    
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold")
      .setBackground(bgColor)
      .setFontColor(textColor);
    
    if (freezeRows > 0) {
      sheet.setFrozenRows(freezeRows);
    }
    
    return sheet;
  },
  
  /**
   * Auto-resize columns
   */
  autoResize(sheet, startCol = 1, numCols = null) {
    const cols = numCols || sheet.getLastColumn();
    if (cols > 0) {
      sheet.autoResizeColumns(startCol, cols);
    }
  },
  
// ============================================================================
// ROBUST: Output_.writeVault
// - Adds Source column to Top/Low-performing tables
// - Nuanced actions: ⛔ AVOID for Charcoal, ⚠️ REVIEW for predefined toxic only
// - Clear status labels distinguishing config-based vs performance-based flags
// - 7 columns with proper padding
// ============================================================================
/**
 * Write the MA_Vault sheet with Quarter and Tier columns in tables
 */
writeVault(ss, globalStats, sideStats, totalsStats, leagueAssay, edges, teamAssay, matchupAssay) {
  if (teamAssay === undefined) teamAssay = {};
  if (matchupAssay === undefined) matchupAssay = {};
  if (!this.log) this.init();
  Log_.section("Writing Vault");

  const sheet = this.getOrCreateSheet(ss, Config_.sheets.vault);
  sheet.clear();

  const now = Utils_.formatDate(new Date(), "yyyy-MM-dd HH:mm:ss");

  const safeGlobalWR =
    (globalStats && typeof globalStats.winRate === "number" && isFinite(globalStats.winRate)) ? globalStats.winRate : 0;
  const safeSideWR =
    (sideStats && typeof sideStats.winRate === "number" && isFinite(sideStats.winRate)) ? sideStats.winRate : 0;
  const safeTotalsWR =
    (totalsStats && typeof totalsStats.winRate === "number" && isFinite(totalsStats.winRate)) ? totalsStats.winRate : 0;
  const safePct = (v) => (typeof v === "number" && isFinite(v)) ? Stats_.pct(v) : "N/A";

  const globalGrade = Stats_.getGradeInfo(safeGlobalWR, globalStats ? globalStats.decisive || 0 : 0);

  const MAX_COLS = 10;
  const data = [];

  // Title
  data.push([`⚗️ MA ASSAYER VAULT — v${Config_.version}`, "", "", "", "", "", "", "", "", now]);
  data.push([""]);
  data.push(["═══════════════════════════════════════════════════════════════════"]);
  data.push(["📊 PURITY ASSESSMENT"]);
  data.push([""]);

  // Stats
  data.push(["Metric", "SIDE", "TOTALS", "COMBINED", "Grade", "Status"]);
  data.push(["Bets Assayed", sideStats ? sideStats.decisive || 0 : 0, totalsStats ? totalsStats.decisive || 0 : 0, globalStats ? globalStats.decisive || 0 : 0, "", ""]);
  data.push(["Wins", sideStats ? sideStats.wins || 0 : 0, totalsStats ? totalsStats.wins || 0 : 0, globalStats ? globalStats.wins || 0 : 0, "", ""]);
  data.push(["Losses", sideStats ? sideStats.losses || 0 : 0, totalsStats ? totalsStats.losses || 0 : 0, globalStats ? globalStats.losses || 0 : 0, "", ""]);
  data.push([
    "Win Rate",
    safePct(safeSideWR),
    safePct(safeTotalsWR),
    safePct(safeGlobalWR),
    `${globalGrade.symbol} ${globalGrade.name}`,
    (globalStats ? globalStats.decisive || 0 : 0) >= Config_.thresholds.minNReliable ? "✅ Reliable" : "📊 Building"
  ]);

  data.push([""]);
  data.push(["═══════════════════════════════════════════════════════════════════"]);
  data.push(["🔍 TOP DISCOVERED EDGES (Gold+)"]);
  data.push([""]);
  data.push(["Pattern", "Source", "Type", "N", "Win Rate", "Lift", "Grade"]);

  const topEdges = (Array.isArray(edges) ? edges : [])
    .filter(e => e.grade === "GOLD" || e.grade === "PLATINUM")
    .slice(0, Config_.report.maxEdgesToShow);

  if (topEdges.length === 0) {
    data.push(["No Gold/Platinum edges discovered yet"]);
  } else {
    topEdges.forEach(e => {
      // ◆ PATCH: Force display type for Side edges (display-only; does not mutate criteria)
      const typeKey =
        (e.source === "Side")
          ? "SNIPER_MARGIN"
          : ((e.criteria && e.criteria.typeKey) ? e.criteria.typeKey : "");

      data.push([e.name, e.source, typeKey, e.n, e.winRatePct, e.liftDisplay, `${e.gradeSymbol} ${e.grade}`]);
    });
  }

  // ── LEAGUES: TOP ──
  data.push([""]);
  data.push(["═══════════════════════════════════════════════════════════════════"]);
  data.push(["🏆 TOP LEAGUES BY PURITY (All-Quarter)"]);
  data.push([""]);
  data.push(["League", "Quarter", "Source", "Gender", "Tier", "Type", "N", "Win Rate", "Grade", "Status"]);

  const combos = Object.values(leagueAssay || {});
  const topCombos = combos
    .filter(l => (l ? l.quarter == null : false) && ((l ? l.decisive || 0 : 0) >= 5))
    .sort((a, b) => (b.shrunkRate || 0) - (a.shrunkRate || 0))
    .slice(0, Config_.report.maxLeaguesToShow);

  topCombos.forEach(l => {
    let status = "📊 Building";
    if (l.isToxic) status = "⚠️ Toxic";
    else if (l.isReliable) status = "✅ Reliable";
    else if (l.isElite) status = "🌟 Elite";

    data.push([
      l.league || "",
      l.quarterLabel || "All",
      l.source || "",
      l.gender || (l.isWomen ? "W" : "M"),
      l.tier || "UNKNOWN",
      l.typeKey || "",
      l.decisive || 0,
      Stats_.pct(l.shrunkRate || 0),
      `${l.gradeSymbol || ""} ${l.grade || ""}`.trim(),
      status
    ]);
  });

  // ── LEAGUES: LOW ──
  data.push([""]);
  data.push(["═══════════════════════════════════════════════════════════════════"]);
  data.push(["⛏️ LOW PERFORMING COMBINATIONS (All-Quarter)"]);
  data.push([""]);

  const lowCombos = combos
    .filter(l => (l ? l.quarter == null : false) && (l.grade === "CHARCOAL" || l.isToxic))
    .sort((a, b) => (a.shrunkRate || 0) - (b.shrunkRate || 0))
    .slice(0, Config_.report.maxToxicToShow);

  if (lowCombos.length === 0) {
    data.push(["No low-performing combinations identified"]);
  } else {
    data.push(["League", "Quarter", "Source", "Gender", "Tier", "Type", "N", "Win Rate", "Grade", "Action"]);
    lowCombos.forEach(l => {
      const action =
        l.grade === "CHARCOAL"
          ? "⛔ AVOID"
          : (l.isToxic ? "⚠️ REVIEW (Predefined)" : "⚠️ REVIEW");

      data.push([
        l.league || "",
        l.quarterLabel || "All",
        l.source || "",
        l.gender || (l.isWomen ? "W" : "M"),
        l.tier || "UNKNOWN",
        l.typeKey || "",
        l.decisive || 0,
        Stats_.pct(l.shrunkRate || 0),
        `${l.gradeSymbol || ""} ${l.grade || ""}`.trim(),
        action
      ]);
    });
  }

  // ── TEAMS: PLATINUM / GOLD ──
  const allTeams = Object.values(teamAssay || {});
  const allQuarterTeams = allTeams.filter(t => t.quarter == null);

  data.push([""]);
  data.push(["═══════════════════════════════════════════════════════════════════"]);
  data.push(["💎 TOP PLATINUM & GOLD TEAMS (All-Quarter, Side)"]);
  data.push([""]);
  data.push(["Team", "N", "Shrunk WR", "Lift", "Grade", "Status", "Leagues"]);

  const topTeams = allQuarterTeams
    .filter(t => t.grade === "PLATINUM" || t.grade === "GOLD")
    .sort((a, b) => (b.shrunkRate || 0) - (a.shrunkRate || 0))
    .slice(0, 12);

  if (topTeams.length === 0) {
    data.push(["No Platinum/Gold teams yet"]);
  } else {
    topTeams.forEach(t => {
      const status = t.isElite ? "🌟 Elite" : (t.isReliable ? "✅ Reliable" : "📊 Building");
      data.push([
        t.team || "",
        t.decisive || 0,
        Stats_.pct(t.shrunkRate || 0),
        Stats_.lift(t.lift || 0),
        `${t.gradeSymbol || ""} ${t.grade || ""}`.trim(),
        status,
        Array.isArray(t.leagues) ? t.leagues.slice(0, 4).join(", ") : ""
      ]);
    });
  }

  // ── TEAMS: CHARCOAL / TOXIC ──
  data.push([""]);
  data.push(["═══════════════════════════════════════════════════════════════════"]);
  data.push(["⛔ CHARCOAL TEAMS TO AVOID (All-Quarter, Side)"]);
  data.push([""]);

  const charcoalTeams = allQuarterTeams
    .filter(t => t.grade === "CHARCOAL" || t.isToxic)
    .sort((a, b) => (a.shrunkRate || 0) - (b.shrunkRate || 0))
    .slice(0, 12);

  if (charcoalTeams.length === 0) {
    data.push(["No Charcoal teams identified"]);
  } else {
    data.push(["Team", "N", "Shrunk WR", "Lift", "Grade", "Action", "Leagues"]);
    charcoalTeams.forEach(t => {
      const action = t.isToxic ? "⚠️ REVIEW (Config)" : "⛔ AVOID";
      data.push([
        t.team || "",
        t.decisive || 0,
        Stats_.pct(t.shrunkRate || 0),
        Stats_.lift(t.lift || 0),
        `${t.gradeSymbol || ""} ${t.grade || ""}`.trim(),
        action,
        Array.isArray(t.leagues) ? t.leagues.slice(0, 4).join(", ") : ""
      ]);
    });
  }

  // ── MATCHUP COUNT ──
  const matchupCount = Object.keys(matchupAssay || {}).length;
  if (matchupCount > 0) {
    data.push([""]);
    data.push(["═══════════════════════════════════════════════════════════════════"]);
    data.push([`💠 ${matchupCount} Matchups analyzed (see MA_MatchupAssay tab)`]);
  }

  // ── FOOTER ──
  data.push([""]);
  data.push(["═══════════════════════════════════════════════════════════════════"]);
  data.push([`"Ma Assayer tests the purity — trust only the Gold"`]);

  const paddedData = data.map(row => {
    const r = Array.isArray(row) ? row : [row];
    if (r.length === MAX_COLS) return r;
    if (r.length < MAX_COLS) return r.concat(Array(MAX_COLS - r.length).fill(""));
    return r.slice(0, MAX_COLS);
  });

  sheet.getRange(1, 1, paddedData.length, MAX_COLS).setValues(paddedData);

  sheet.getRange("A1").setFontSize(16).setFontWeight("bold");
  sheet.setFrozenRows(1);

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 90);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 80);
  sheet.setColumnWidth(5, 120);
  sheet.setColumnWidth(6, 140);
  sheet.setColumnWidth(7, 70);
  sheet.setColumnWidth(8, 110);
  sheet.setColumnWidth(9, 140);
  sheet.setColumnWidth(10, 180);

  this.log.success("Vault written successfully (with team sections)");
  Log_.sectionEnd("Writing Vault");
},


 // ============================================================================
// PATCHED: Output_.writeLeagueAssay  — shows quarter column
// ============================================================================

/**
 * Write league assay sheet with Tier column
 * @param {Spreadsheet} ss - Target spreadsheet
 * @param {Object} leagueAssay - League stats keyed by league/source/gender/tier/quarter
 * @param {Object} globalStats - Global statistics (unused but kept for API)
 */
writeLeagueAssay(ss, leagueAssay, globalStats) {
  if (!this.log) this.init();
  Log_.section("Writing League Assay");

  const sheet = this.getOrCreateSheet(ss, Config_.sheets.leagueAssay);

  const headers = [
    "League", "Quarter", "Source", "Gender", "Tier", "Type",
    "N", "Wins", "Losses",
    "Raw WR", "Shrunk WR", "Lower Bound", "Upper Bound",
    "Lift", "Grade", "Symbol",
    "Reliable", "Toxic", "Elite"
  ];

  this.formatHeader(sheet, headers);

  const data = Object.values(leagueAssay || {})
    .sort((a, b) => {
      const leagueCompare = (a.league || "").localeCompare(b.league || "");
      if (leagueCompare !== 0) return leagueCompare;

      const qa = (a.quarter == null ? -2 : a.quarter);
      const qb = (b.quarter == null ? -2 : b.quarter);
      if (qa !== qb) return qa - qb;

      const sa = a.source || "";
      const sb = b.source || "";
      if (sa !== sb) return sa.localeCompare(sb);

      const ga = a.gender || (a.isWomen ? "W" : "M");
      const gb = b.gender || (b.isWomen ? "W" : "M");
      if (ga !== gb) return ga.localeCompare(gb);

      const ta = a.tier || "UNKNOWN";
      const tb = b.tier || "UNKNOWN";
      if (ta !== tb) return ta.localeCompare(tb);

      const tka = a.typeKey || "";
      const tkb = b.typeKey || "";
      if (tka !== tkb) return tka.localeCompare(tkb);

      return (b.shrunkRate || 0) - (a.shrunkRate || 0);
    })
    .map(l => {
      const qLabel =
        l.quarter == null ? "All" : (l.quarter === 0 ? "Full" : `Q${l.quarter}`);

      const gender = l.gender || (l.isWomen ? "W" : "M");

      return [
        l.league || "",
        qLabel,
        l.source || "",
        gender,
        l.tier || "UNKNOWN",
        l.typeKey || "",
        l.decisive || 0,
        l.wins || 0,
        l.losses || 0,
        Stats_.pct(l.winRate || 0),
        Stats_.pct(l.shrunkRate || 0),
        Stats_.pct(l.lowerBound || 0),
        Stats_.pct(l.upperBound || 0),
        Stats_.lift(l.lift || 0),
        l.grade || "",
        l.gradeSymbol || "",
        l.isReliable ? "✅" : `${Math.round((l.reliability || 0) * 100)}%`,
        l.isToxic ? "⛔" : "",
        l.isElite ? "🌟" : ""
      ];
    });

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  }

  this.autoResize(sheet);
  this.applyGradeFormatting(sheet, 15, data.length + 1);

  this.log.success(`League assay written: ${data.length} combinations`);
  Log_.sectionEnd("Writing League Assay");
},

  
  /**
   * Write discovered edges sheet
   */
  writeDiscoveredEdges(ss, edges, globalStats) {
    if (!this.log) this.init();
    Log_.section("Writing Discovered Edges");
    
    const sheet = this.getOrCreateSheet(ss, Config_.sheets.discovery);
    
    const headers = [
      "Edge ID", "Source", "Pattern", "N", "Wins", "Losses",
      "Win Rate", "Lower Bound", "Upper Bound", "Lift", "Lift %",
      "Grade", "Symbol", "Reliable", "Sample Size", "Discovered"
    ];
    
    this.formatHeader(sheet, headers, { bgColor: "#FFD700", textColor: "#000000" });
    
    const data = edges.map(e => [
      e.id,
      e.source,
      e.name,
      e.n,
      e.wins,
      e.losses,
      e.winRatePct,
      Stats_.pct(e.lowerBound),
      Stats_.pct(e.upperBound),
      e.liftDisplay,
      e.liftPct.toFixed(1) + "%",
      e.grade,
      e.gradeSymbol,
      e.reliable ? "✅" : "⚠️",
      e.sampleSize,
      e.discoveredAt ? e.discoveredAt.split("T")[0] : ""
    ]);
    
    if (data.length > 0) {
      sheet.getRange(2, 1, data.length, headers.length).setValues(data);
    }
    
    this.autoResize(sheet);
    this.applyGradeFormatting(sheet, 12, data.length + 1);
    
    this.log.success(`Discovered edges written: ${edges.length}`);
    Log_.sectionEnd("Writing Discovered Edges");
  },
  
  // ============================================================================
// ROBUST: Output_.writeExclusionImpact
// - Includes Source column with Combined + per-source rows
// - Shows baseline context for each source
// - Clear explanation of source-specific deltas
// - Extended header with Current N for sample size context
// ============================================================================
writeExclusionImpact(ss, impact, globalStats) {
  if (!this.log) this.init();
  Log_.section("Writing Exclusion Impact");

  const sheet = this.getOrCreateSheet(ss, Config_.sheets.exclusion);

  const headers = [
    "League",
    "Source",
    "Δ Win Rate",
    "Remaining N",
    "Rate Without",
    "Baseline Rate",
    "Current Rate",
    "Current N",
    "Recommendation",
    "Priority",
    "Toxic"
  ];

  this.formatHeader(sheet, headers, { bgColor: "#36454F" });

  const rows = Array.isArray(impact) ? impact : [];
  const maxRows = Config_.report?.maxExclusionRows || 80;

  const displayRows = rows.slice(0, maxRows);

  const data = displayRows.map(i => [
    i.league || "",
    i.source || "Combined",
    i.deltaPct || "",
    i.remainingBets ?? "",
    i.rateWithoutPct || "",
    i.baselineRatePct || "",
    i.currentRate || "",
    i.currentN ?? "",
    i.action || "",
    i.priority ?? "",
    i.isToxic ? "⛔" : ""
  ]);

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EXPLANATION SECTION
  // ─────────────────────────────────────────────────────────────────────────
  const explanationStart = data.length + 4;
  const globalWR = (globalStats && typeof globalStats.winRate === "number" && isFinite(globalStats.winRate))
    ? Stats_.pct(globalStats.winRate)
    : "N/A";

  const explanation = [
    ["INTERPRETATION:"],
    ["This table shows how excluding each league affects win rate, computed separately for:"],
    ["  • Combined — All bets together (baseline = global win rate)"],
    ["  • Side — Side bets only (baseline = Side-only win rate)"],
    ["  • Totals — Totals bets only (baseline = Totals-only win rate)"],
    [""],
    ["Δ Win Rate is computed against the relevant baseline for that row's source."],
    ["Positive Δ = Excluding this league IMPROVES that source's win rate."],
    ["Negative Δ = Excluding this league HURTS that source's win rate."],
    [""],
    ["RECOMMENDATIONS:"],
    ["⛏️ EXCLUDE — Consider removing this league for this source (Δ > +2%)"],
    ["✅ KEEP — This league contributes positively to this source (Δ < -2%)"],
    ["➖ NEUTRAL — Minimal impact either way (|Δ| ≤ 2%)"],
    [""],
    ["REFERENCE:"],
    ["Global Combined Baseline:", globalWR]
  ];

  const explanationData = explanation.map(e => {
    if (!Array.isArray(e)) return [e, ""];
    if (e.length === 1) return [e[0], ""];
    return e;
  });

  sheet.getRange(explanationStart, 1, explanationData.length, 2).setValues(explanationData);

  this.autoResize(sheet);

  this.log.success(`Exclusion impact written: ${rows.length} league+source combos`);
  Log_.sectionEnd("Writing Exclusion Impact");
},
  
/**
 * Write quarter analysis sheet with Tier column
 */
writeQuarterAnalysis(ss, sideBets, totalsBets, globalStats) {
  if (!this.log) this.init();
  Log_.section("Writing Quarter Analysis");

  const sheet = this.getOrCreateSheet(ss, Config_.sheets.quarterAnalysis);

  const headers = [
    "Quarter", "Tier", "Source", "N", "Wins", "Losses", "Win Rate",
    "Lift", "Grade", "Symbol"
  ];

  this.formatHeader(sheet, headers);

  const data = [];

  const pushRows = (sourceLabel, bets) => {
    const qStats = Stats_.analyzeByQuarter(bets, globalStats);
    Object.values(qStats).forEach(q => {
      const safeLift = (typeof q.lift === "number" && isFinite(q.lift)) ? q.lift : 0;
      data.push([
        q.label,
        q.tier || "UNKNOWN",
        sourceLabel,
        q.decisive || 0,
        q.wins || 0,
        q.losses || 0,
        Stats_.pct(q.shrunkRate || 0),
        Stats_.lift(safeLift),
        q.grade || "",
        q.gradeSymbol || ""
      ]);
    });
  };

  pushRows("Side", Array.isArray(sideBets) ? sideBets : []);
  pushRows("Totals", Array.isArray(totalsBets) ? totalsBets : []);

  if (data.length === 0) {
    data.push(["No sufficient data for quarter+tier analysis", "", "", "", "", "", "", "", "", ""]);
  }

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);

  this.autoResize(sheet);

  this.log.success(`Quarter analysis written: ${data.length} entries`);
  Log_.sectionEnd("Writing Quarter Analysis");
},
  
 // ============================================================================
// ROBUST: Output_.writeSummary
// - Case-insensitive source matching for robust counting
// - Only counts all-quarter rows to avoid per-quarter duplicates
// - Splits low-performing counts by source with fallback for unknown
// ============================================================================
/**
 * Write summary sheet with updated labels reflecting tier/quarter granularity
 */
writeSummary(ss, globalStats, sideStats, totalsStats, leagueAssay, edges, logSummary) {
  if (!this.log) this.init();
  Log_.section("Writing Summary");

  const sheet = this.getOrCreateSheet(ss, Config_.sheets.summary);
  sheet.clear();

  const combos = Object.values(leagueAssay || {});
  const allQuarterCombos = combos.filter(l => l?.quarter == null);

  const goldEdges = (Array.isArray(edges) ? edges : []).filter(e => e.grade === "GOLD" || e.grade === "PLATINUM");
  const goldCombos = allQuarterCombos.filter(l => l.grade === "GOLD" || l.grade === "PLATINUM");
  const toxicCombos = allQuarterCombos.filter(l => l.grade === "CHARCOAL" || l.isToxic);

  const uniqueLeagues = new Set(allQuarterCombos.map(l => l.league).filter(Boolean)).size;
  const uniqueAllQuarterKeys = allQuarterCombos.length;

  const data = [
    [`⚗️ MA ASSAYER SUMMARY — v${Config_.version}`],
    [`Generated: ${Utils_.formatDate(new Date(), "yyyy-MM-dd HH:mm:ss")}`],
    [""],
    ["═══════════════════════════════════════════════════════════"],
    ["OVERALL PERFORMANCE"],
    [""],
    ["Metric", "Value"],
    ["Total Bets Analyzed", globalStats?.total || 0],
    ["Decisive Bets", globalStats?.decisive || 0],
    ["Wins", globalStats?.wins || 0],
    ["Losses", globalStats?.losses || 0],
    ["Pushes", globalStats?.pushes || 0],
    ["Win Rate", Stats_.pct(globalStats?.winRate || 0)],
    ["Grade", `${Stats_.getGradeSymbol(globalStats?.winRate || 0)} ${Stats_.getGrade(globalStats?.winRate || 0, globalStats?.decisive || 0)}`],
    [""],
    ["═══════════════════════════════════════════════════════════"],
    ["BY SOURCE"],
    [""],
    ["Source", "N", "Win Rate", "Grade"],
    ["Side", sideStats?.decisive || 0, Stats_.pct(sideStats?.winRate || 0), Stats_.getGrade(sideStats?.winRate || 0, sideStats?.decisive || 0)],
    ["Totals", totalsStats?.decisive || 0, Stats_.pct(totalsStats?.winRate || 0), Stats_.getGrade(totalsStats?.winRate || 0, totalsStats?.decisive || 0)],
    [""],
    ["═══════════════════════════════════════════════════════════"],
    ["DISCOVERY SUMMARY"],
    [""],
    ["Total Edges Discovered", Array.isArray(edges) ? edges.length : 0],
    ["Gold/Platinum Edges", goldEdges.length],
    ["Unique Leagues (All-Quarter)", uniqueLeagues],
    ["All-Quarter Combos (League+Source+Gender+Tier)", uniqueAllQuarterKeys],
    ["Gold/Platinum Combos (All-Quarter)", goldCombos.length],
    ["Low-performing/Toxic Combos (All-Quarter)", toxicCombos.length],
    [""],
    ["═══════════════════════════════════════════════════════════"],
    ["EXECUTION STATS"],
    [""],
    ["Elapsed Time", `${logSummary?.elapsed || 0}s`],
    ["Warnings", logSummary?.warnings || 0],
    ["Errors", logSummary?.errors || 0],
    ["Session ID", logSummary?.sessionId || "N/A"]
  ];

  const formattedData = data.map(row => {
    if (row.length === 1) return [row[0], "", "", ""];
    if (row.length === 2) return [row[0], row[1], "", ""];
    return row;
  });

  sheet.getRange(1, 1, formattedData.length, 4).setValues(formattedData);
  sheet.getRange("A1").setFontSize(14).setFontWeight("bold");

  this.autoResize(sheet);

  this.log.success("Summary written");
  Log_.sectionEnd("Writing Summary");
},

// =======================================================
// PATCH: Output_.writeTeamAssay
// =======================================================
writeTeamAssay(ss, teamAssay) {
  if (!this.log) this.init();
  Log_.section("Writing Team Assay");

  const sheetName =
    (Config_.sheets && Config_.sheets.teamAssay) ? Config_.sheets.teamAssay : "MA_TeamAssay";

  const sheet = this.getOrCreateSheet(ss, sheetName);

  const headers = [
    "Team", "Quarter", "N", "Wins", "Losses",
    "Shrunk WR", "Lift", "Grade", "Toxic", "Elite", "Leagues"
  ];

  this.formatHeader(sheet, headers);

  const rows = Object.entries(teamAssay || {}).map(([k, v]) => {
    const isQuarterKey = k.includes("__Q");
    const team = isQuarterKey ? k.split("__Q")[0] : (v.team || k);
    const quarter = v.quarterLabel || (isQuarterKey ? `Q${k.split("__Q")[1]}` : "All");

    return [
      team,
      quarter,
      v.decisive || 0,
      v.wins || 0,
      v.losses || 0,
      Stats_.pct(v.shrunkRate || 0),
      Stats_.lift(v.lift || 0),
      `${v.gradeSymbol || ""} ${v.grade || ""}`.trim(),
      v.isToxic ? "⛔" : "",
      v.isElite ? "💎" : "",
      Array.isArray(v.leagues) ? v.leagues.join(", ") : ""
    ];
  });

  // Sort: Elite first, then Toxic, then by Shrunk WR (desc)
  rows.sort((a, b) => {
    const eliteA = a[9] ? 1 : 0, eliteB = b[9] ? 1 : 0;
    if (eliteB !== eliteA) return eliteB - eliteA;

    const toxicA = a[8] ? 1 : 0, toxicB = b[8] ? 1 : 0;
    if (toxicB !== toxicA) return toxicB - toxicA;

    const wrA = parseFloat(String(a[5]).replace("%", "")) || 0;
    const wrB = parseFloat(String(b[5]).replace("%", "")) || 0;
    return wrB - wrA;
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  this.autoResize(sheet);
  this.log.success(`Team assay written: ${rows.length} rows`);
  Log_.sectionEnd("Writing Team Assay");
},

// =======================================================
// PATCH: Output_.writeMatchupAssay (Team × Opponent)
// =======================================================
writeMatchupAssay(ss, matchupAssay) {
  if (!this.log) this.init();
  Log_.section("Writing Matchup Assay");

  const sheetName =
    (Config_.sheets && Config_.sheets.matchupAssay) ? Config_.sheets.matchupAssay : "MA_MatchupAssay";

  const sheet = this.getOrCreateSheet(ss, sheetName);

  const headers = [
    "Backed", "Opponent", "Quarter",
    "N", "Wins", "Losses",
    "Shrunk WR", "Lift", "Grade", "Toxic", "Elite", "Leagues"
  ];

  this.formatHeader(sheet, headers);

  const rows = Object.entries(matchupAssay || {}).map(([k, v]) => {
    const isQuarterKey = k.includes("__Q");
    const baseKey = isQuarterKey ? k.split("__Q")[0] : (v.matchupKey || k);

    const parts = String(baseKey || "").split("__VS__");
    const backed = v.backedTeam || parts[0] || "";
    const opp = v.opponentTeam || parts[1] || "";

    const quarter = v.quarterLabel || (isQuarterKey ? `Q${k.split("__Q")[1]}` : "All");

    return [
      backed,
      opp,
      quarter,
      v.decisive || 0,
      v.wins || 0,
      v.losses || 0,
      Stats_.pct(v.shrunkRate || 0),
      Stats_.lift(v.lift || 0),
      `${v.gradeSymbol || ""} ${v.grade || ""}`.trim(),
      v.isToxic ? "⛔" : "",
      v.isElite ? "💎" : "",
      Array.isArray(v.leagues) ? v.leagues.join(", ") : ""
    ];
  });

  // Sort: Elite first, then Toxic, then by Shrunk WR (desc)
  rows.sort((a, b) => {
    const eliteA = a[10] ? 1 : 0, eliteB = b[10] ? 1 : 0;
    if (eliteB !== eliteA) return eliteB - eliteA;

    const toxicA = a[9] ? 1 : 0, toxicB = b[9] ? 1 : 0;
    if (toxicB !== toxicA) return toxicB - toxicA;

    const wrA = parseFloat(String(a[6]).replace("%", "")) || 0;
    const wrB = parseFloat(String(b[6]).replace("%", "")) || 0;
    return wrB - wrA;
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  this.autoResize(sheet);
  this.log.success(`Matchup assay written: ${rows.length} rows`);
  Log_.sectionEnd("Writing Matchup Assay");
},

  // ============================================================================
  // MOTHER CONTRACT: ASSAYER_EDGES
  // One row per discovered edge, dimensions broken into explicit columns
  // All rates/lift stored as decimals (0–1 scale)
  // filters_json = escape hatch for future variables
  // ============================================================================
  writeAssayerEdges(ss, edges) {
    if (!this.log) this.init();
    Log_.section("Writing ASSAYER_EDGES (Mother contract)");

    const sheet = this.getOrCreateSheet(ss, Config_.sheets.assayerEdges);
    const headers = Config_.motherContract.EDGE_COLUMNS;

    this.formatHeader(sheet, headers, {
      bgColor: "#0d2b4e",
      textColor: "#ffffff"
    });

    const now = new Date().toISOString();
    const rows = [];

    (edges || []).forEach(e => {
      const crit = e.criteria || {};

      const quarterStr = crit.quarter != null ? ("Q" + crit.quarter) : null;
      const isWomen = crit.isWomen != null ? crit.isWomen : null;

      rows.push([
        e.id,                                                        // edge_id
        e.source,                                                    // source
        e.name,                                                      // pattern
        e.discoveredAt ? e.discoveredAt.split("T")[0] : now.split("T")[0], // discovered
        now,                                                         // updated_at

        quarterStr,                                                  // quarter
        isWomen,                                                     // is_women
        crit.tier         || null,                                   // tier
        crit.side         || null,                                   // side
        crit.direction    || null,                                   // direction
        crit.confBucket   || null,                                   // conf_bucket
        crit.spreadBucket || null,                                   // spread_bucket
        crit.lineBucket   || null,                                   // line_bucket

        // ◆ PATCH v4.3.0: display-only SNIPER_MARGIN for Side edges (do not mutate criteria)
        (e.source === "Side" ? "SNIPER_MARGIN" : (crit.typeKey || null)), // type_key  ◆ PATCH v4.3.0

        JSON.stringify(crit),                                        // filters_json

        e.n,                                                         // n
        e.wins,                                                      // wins
        e.losses,                                                    // losses
        e.winRate,                                                   // win_rate
        e.lowerBound,                                                // lower_bound
        e.upperBound,                                                // upper_bound
        e.lift,                                                      // lift

        e.grade,                                                     // grade
        e.gradeSymbol,                                               // symbol
        e.reliable,                                                  // reliable
        e.sampleSize                                                 // sample_size
      ]);
    });

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

      sheet.getRange(2, 1, rows.length, 1).setNumberFormat("@");    // edge_id col
      sheet.getRange(2, 15, rows.length, 1).setNumberFormat("@");   // filters_json col (was 14, now 15)
    }

    this.autoResize(sheet);

    this.log.success("ASSAYER_EDGES written: " + rows.length + " edges");
    Log_.sectionEnd("Writing ASSAYER_EDGES");
  },

  // ============================================================================
  // MOTHER CONTRACT: ASSAYER_LEAGUE_PURITY
  // One row per league/quarter/source/gender/tier combination
  // win_rate = shrunkRate (Bayesian adjusted), decimal 0–1
  // ============================================================================
  writeAssayerLeaguePurity(ss, leagueAssay) {
    if (!this.log) this.init();
    Log_.section("Writing ASSAYER_LEAGUE_PURITY (Mother contract)");

    const sheet = this.getOrCreateSheet(ss, Config_.sheets.assayerLeaguePurity);
    const headers = Config_.motherContract.LEAGUE_COLUMNS;

    this.formatHeader(sheet, headers, {
      bgColor: "#1a3c5e",
      textColor: "#ffffff"
    });

    const now = new Date().toISOString();
    const rows = [];

    Object.values(leagueAssay || {}).forEach(l => {
      // Quarter label: null→"All", 0→"Full", 1–4→"Q1"…"Q4"
      const qLabel = l.quarter == null ? "All"
                   : l.quarter === 0   ? "Full"
                   : ("Q" + l.quarter);

      // Status derived from grade + flags (priority order)
      let status = "📊 Building";
      if (l.grade === "CHARCOAL" || l.isToxic) {
        status = "⛔ Avoid";
      } else if (l.isElite) {
        status = "🌟 Elite";
      } else if (l.isReliable) {
        status = "✅ Reliable";
      }

      rows.push([
        l.league || "",                                  // league
        qLabel,                                          // quarter
        l.source || "",                                  // source  (Side|Totals)
        l.gender || (l.isWomen ? "W" : "M"),             // gender  (M|W)
        l.tier   || "UNKNOWN",                           // tier    (EVEN|MEDIUM|STRONG|UNKNOWN)
        l.typeKey || "",
        l.decisive || 0,                                 // n       (int)
        l.shrunkRate != null ? l.shrunkRate               // win_rate (decimal 0–1, Bayesian)
                             : (l.winRate || 0),
        l.grade  || "",                                  // grade   (PLATINUM…CHARCOAL)
        status,                                          // status  (display string)
        l.dominantStampId || "",                         // dominant_stamp (Config Ledger)
        l.stampPurity != null
          ? (l.stampPurity * 100).toFixed(1) + "%"
          : "",                                          // stamp_purity
        now                                              // updated_at (ISO timestamp)
      ]);
    });

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }

    this.autoResize(sheet);

    this.log.success("ASSAYER_LEAGUE_PURITY written: " + rows.length + " rows");
    Log_.sectionEnd("Writing ASSAYER_LEAGUE_PURITY");
  },

  /**
   * Apply conditional formatting for grades
   */
  applyGradeFormatting(sheet, gradeColumn, numRows) {
    try {
      const range = sheet.getRange(2, gradeColumn, numRows - 1, 1);
      
      // This is a simplified version - full conditional formatting rules
      // would require more complex ConditionalFormatRuleBuilder usage
      
    } catch (err) {
      // Conditional formatting is not critical
    }
  }
};
```

## File: docs/Parser_DataParsing.gs
```
/******************************************************************************
 * MA ASSAYER — Complete Production Module
 * 
 * "Testing the purity of predictions - separating Gold from Charcoal"
 * 
 * COMPLETE ROBUST IMPLEMENTATION
 * 
 * ARCHITECTURE:
 * ├── M1_Output_          Sheet Writers
 * ├── M2_Main_            Controller/Orchestrator
 * ├── M3_Flagger_         Apply Flags to Source
 * ├── M4_Discovery_       Edge Discovery Engine
 * ├── M5_Config_          Configuration & Constants
 * ├── M6_ColResolver_     Fuzzy Column Matching (case-insensitive)
 * ├── M7_Parser_          Data Parsing
 * ├── M8_Stats_           Statistical Calculations
 * ├── M9_Utils_           Utility Functions
 * └── M10_Log_            Logging System
 ******************************************************************************/
 
// ============================================================================
// MODULE: Parser_ — Data Parsing
// ============================================================================
const Parser_ = {
  log: null,

  init() {
    this.log = Log_.module("PARSER");
  },

  parseOutcome(val) {
    if (val === null || val === undefined || val === "") return null;

    const s = String(val).toUpperCase().trim();

    const winPatterns = Config_.outcomeMappings.win;
    for (const pattern of winPatterns) {
      if (s === pattern.toUpperCase() || s.includes(pattern.toUpperCase())) {
        return 1;
      }
    }

    const lossPatterns = Config_.outcomeMappings.loss;
    for (const pattern of lossPatterns) {
      if (s === pattern.toUpperCase() || s.includes(pattern.toUpperCase())) {
        return 0;
      }
    }

    const pushPatterns = Config_.outcomeMappings.push;
    for (const pattern of pushPatterns) {
      if (s === pattern.toUpperCase() || s.includes(pattern.toUpperCase())) {
        return -1;
      }
    }

    if (s === "1" || s === "1.0") return 1;
    if (s === "0" || s === "0.0") return 0;
    if (s === "-1" || s === "0.5") return -1;

    return null;
  },

  parseConfidence(val) {
    if (val === null || val === undefined || val === "") return null;

    if (typeof val === "number") {
      return val > 1 ? val / 100 : val;
    }

    let str = String(val).trim();
    str = str.replace(/[%\s,]/g, "");

    const num = parseFloat(str);
    if (isNaN(num)) return null;

    return num > 1 ? num / 100 : num;
  },

  parseTier(val) {
    if (val === null || val === undefined || val === "") return "EVEN";

    const t = String(val).toUpperCase().trim();

    for (const pattern of Config_.tierMappings.strong) {
      if (t === pattern.toUpperCase() || t.includes(pattern.toUpperCase())) {
        return "STRONG";
      }
    }

    for (const pattern of Config_.tierMappings.medium) {
      if (t === pattern.toUpperCase() || t.includes(pattern.toUpperCase())) {
        return "MEDIUM";
      }
    }

    for (const pattern of Config_.tierMappings.weak) {
      if (t === pattern.toUpperCase() || t.includes(pattern.toUpperCase())) {
        return "WEAK";
      }
    }

    return "EVEN";
  },

  parseQuarter(val) {
    if (val === null || val === undefined || val === "") return null;

    const str = String(val).toUpperCase().trim();

    const qMatch = str.match(/Q\s*([1-4])/);
    if (qMatch) return parseInt(qMatch[1], 10);

    const numMatch = str.match(/^([1-4])$/);
    if (numMatch) return parseInt(numMatch[1], 10);

    const pMatch = str.match(/P\s*([1-3])/);
    if (pMatch) return parseInt(pMatch[1], 10);

    if (str.includes("1H") || str.includes("FIRST") || str.includes("1ST HALF")) return 1;
    if (str.includes("2H") || str.includes("SECOND") || str.includes("2ND HALF")) return 3;

    if (str.includes("FULL") || str.includes("GAME") || str.includes("FG")) return 0;

    const num = parseInt(str, 10);
    if (!isNaN(num) && num >= 0 && num <= 4) return num;

    return null;
  },

    parseSide(pick, sideCol) {
  var rawPick = String(pick || "");
  var rawSide = String(sideCol || "");

  // ── LOSSY sanitizer ──
  // Aggressively strip ALL metadata noise so regex only sees structural tokens.
  // Addresses critique: bare percentages, brackets, spread digits, sniper tags.
  function clean(x) {
    return String(x || "")
      .toUpperCase()
      .replace(/[−–—]/g, "-")           // normalize dashes
      .replace(/[●•·]/g, " ")           // bullets
      .replace(/\([^)]*\)/g, " ")       // parentheticals: "(63%)", "(SNIPER)"
      .replace(/\[[^\]]*\]/g, " ")      // bracketed metadata: "[Q1]", "[LOCK]"
      .replace(/\d+\.?\d*\s*%/g, " ")   // bare percentages: "63%", "72.5%"
      .replace(/[+-]\s*\d+\.?\d*/g, " ") // spread/margin tokens: "+5.0", "-3.5"
      .replace(/\b\d{3,}\b/g, " ")      // odds-like numbers: "110", "-150"
      .replace(/\s+/g, " ")
      .trim();
  }

  var p = clean(rawPick);
  var s = clean(rawSide);

  // STRICT regex: captures H or A only when it appears as a standalone token.
  // After clean(), spread digits are already gone, so "Q1: H +5.0" becomes "Q1: H"
  // and this regex safely matches the H.
  var STRICT_RE = /(?:^|[\s:,;])(H|A)(?:\s|$|[,;:])/;

  // --- 1) Derive from PICK (source of truth) ---
  var pickSide = null;

  var mPick = p.match(STRICT_RE);
  if (mPick) {
    pickSide = mPick[1];
  }

  // Word-boundary fallback for explicit labels only (no single-char ambiguity)
  if (!pickSide) {
    if (/\bHOME\b/.test(p))                          pickSide = "H";
    else if (/\b(?:AWAY|ROAD|VISITOR)\b/.test(p))    pickSide = "A";
  }

  // NOTE: parseBetSide() deliberately NOT called here.
  // Critique addressed: its looser patterns can mis-detect H/A in edge formats
  // that the strict extractor would correctly drop.

  // --- 2) Derive from sideCol (fallback only) ---
  var colSide = null;

  var mCol = s.match(STRICT_RE);
  if (mCol) {
    colSide = mCol[1];
  }

  // Legacy exact-match mappings (only if strict token not found)
  if (!colSide) {
    if (s === "H" || s === "HOME" || s === "HM")                                        colSide = "H";
    else if (s === "A" || s === "AWAY" || s === "AW" || s === "V" || s === "VISITOR" || s === "ROAD") colSide = "A";
  }

  // --- 3) Contradiction guard ---
  if (pickSide && colSide && pickSide !== colSide) {
    if (this.log && typeof this.log.warn === "function") {
      this.log.warn(
        "Side contradiction: pick implies " + pickSide +
        " but sideCol says " + colSide + ". Using pick.",
        { pick: rawPick, sideCol: rawSide }
      );
    }
    return pickSide;
  }

  return pickSide || colSide || null;
},

  parseSpread(pick) {
    if (!pick) return null;

    const str = String(pick)
      .replace(/−/g, "-")
      .replace(/–/g, "-")
      .replace(/—/g, "-");

    const match = str.match(/[+-]?\s*(\d+\.?\d*)/);
    if (match) {
      return Math.abs(parseFloat(match[1]));
    }

    return null;
  },

  parseDirection(val) {
    if (!val) return null;

    const s = String(val).toUpperCase().trim();

    if (s === "O" || s === "OVER" || s.startsWith("OV") || s.includes("OVER")) return "Over";
    if (s === "U" || s === "UNDER" || s.startsWith("UN") || s.includes("UNDER")) return "Under";

    return null;
  },

  parseLine(val) {
    if (val === null || val === undefined || val === "") return null;

    const str = String(val).replace(/[^0-9.\-]/g, "");
    const num = parseFloat(str);

    return isNaN(num) ? null : num;
  },

  parseOdds(val) {
    if (val === null || val === undefined || val === "") return null;

    const str = String(val).trim();
    const num = parseFloat(str.replace(/[^0-9.\-+]/g, ""));

    if (isNaN(num)) return null;

    if (str.includes("+") || str.includes("-")) {
      if (num > 0) {
        return (num / 100) + 1;
      } else {
        return (100 / Math.abs(num)) + 1;
      }
    }

    return num;
  },

  isWomenLeague(league, match) {
    const l = String(league || "").toUpperCase();
    const m = String(match || "").toLowerCase();

    if (l.endsWith("W") && l.length > 1 && !l.endsWith("MW")) return true;
    if (l.includes("WOMEN") || l.includes("WNBA") || l.includes("WBB") || l.includes("LPGA")) return true;
    if (m.includes("women") || m.includes(" w ") || m.includes("(w)") || m.includes("ladies")) return true;
    if (l.match(/W$/)) return true;

    return false;
  },

  getSpreadBucket(spread) {
    if (spread === null || spread === undefined) return null;

    for (const b of Config_.spreadBuckets) {
      if (spread >= b.min && spread <= b.max) return b.name;
    }
    return null;
  },

  getLineBucket(line) {
    if (line === null || line === undefined) return null;

    for (const b of Config_.lineBuckets) {
      if (line >= b.min && line <= b.max) return b.name;
    }
    return null;
  },

  getConfBucket(conf) {
    if (conf === null || conf === undefined) return null;

    for (const b of Config_.confBuckets) {
      if (conf >= b.min && conf <= b.max) return b.name;
    }
    return null;
  },

  getValue(row, colMap, colName, defaultVal = null) {
    if (!colMap || !colMap.hasOwnProperty(colName)) return defaultVal;

    const idx = colMap[colName];
    if (idx === undefined || idx === null || idx < 0 || idx >= row.length) {
      return defaultVal;
    }

    const val = row[idx];
    return (val === "" || val === null || val === undefined) ? defaultVal : val;
  },

  // =========================================================================
  // v4.3.0 PATCH: Canonical typeKey derivation for totals bets
  // =========================================================================

  _deriveTotalsTypeKey(bet) {
    if (!bet) return "UNKNOWN";
    if (bet.typeKey) return bet.typeKey;

    const raw = String(bet.type || "").trim().toUpperCase().replace(/\s+/g, " ");
    if (!raw) return "UNKNOWN";

    const hasSniper = raw.indexOf("SNIPER") !== -1;
    const hasOU = raw.indexOf("O/U") !== -1 ||
                  raw.indexOf("OU") !== -1 ||
                  raw.indexOf("OVER/UNDER") !== -1 ||
                  raw.indexOf("OVER UNDER") !== -1 ||
                  raw.indexOf("TOTAL") !== -1;

    if (hasSniper && hasOU) {
      if (raw.indexOf("DIR") !== -1) return "SNIPER_OU_DIR";
      if (raw.indexOf("STAR") !== -1) return "SNIPER_OU_STAR";
      return "SNIPER_OU";
    }

    if (hasOU) {
      if (raw.indexOf("DIR") !== -1) return "OU_DIR";
      if (raw.indexOf("STAR") !== -1) return "OU_STAR";
      return "OU";
    }

    return "OTHER";
  },

  // =========================================================================
  // Team extraction + normalization helpers
  // =========================================================================

  parseBetSide(pick) {
    if (!pick) return null;
    const p = String(pick).trim();
    if (!p) return null;

    let m = p.match(/:\s*(H|A)\b/i);
    if (m) return m[1].toUpperCase();

    m = p.match(/\b(H|A)\b(?=\s*[+-]?\d)/i);
    if (m) return m[1].toUpperCase();

    if (/\bHOME\b/i.test(p)) return "H";
    if (/\bAWAY\b/i.test(p)) return "A";

    return null;
  },

  normalizeTeamName(name) {
    if (name == null) return null;
    let s = String(name).trim();
    if (!s) return null;

    s = s.replace(/\([^)]*\)/g, " ");

    s = s.replace(/\b[QP][1-4]\b/gi, " ")
         .replace(/\b[1-4][HQ]\b/gi, " ")
         .replace(/\b(?:1st|2nd|3rd|4th)\s*(?:Half|Qtr|Quarter|Period)?\b/gi, " ")
         .replace(/\b(?:HALF|FULL|QUARTER|PERIOD|QTR)\b/gi, " ");

    s = s.replace(/[•·@–—]/g, " ")
         .replace(/[^\w\s&.-]/g, " ")
         .replace(/\s+/g, " ")
         .trim()
         .toUpperCase();

    if (!s) return null;

    const BLOCKLIST = [
      "H", "A", "V", "VS",
      "HOME", "AWAY", "HM", "AW",
      "OVER", "UNDER", "TOTAL", "TOTALS",
      "DRAW", "TIE", "PUSH",
      "Q", "Q H", "Q A",
      "Q1", "Q2", "Q3", "Q4",
      "1H", "2H", "1Q", "2Q", "3Q", "4Q"
    ];
    if (s.length < 3 || BLOCKLIST.includes(s)) return null;

    const aliasMap =
      (typeof Config_ !== "undefined" && Config_.teamAliases)
        ? Config_.teamAliases : null;
    if (aliasMap && aliasMap[s]) return String(aliasMap[s]).trim().toUpperCase();

    return s;
  },

  extractTeamsFromMatch(match) {
    if (!match) return { home: null, away: null };
    const s = String(match).trim().replace(/\s+/g, " ");
    if (!s) return { home: null, away: null };

    let m = s.match(/^(.*?)\s+(?:@|at)\s+(.*)$/i);
    if (m) {
      return {
        away: this.normalizeTeamName(m[1]),
        home: this.normalizeTeamName(m[2])
      };
    }

    m = s.match(/^(.*?)\s+(?:vs\.?|v\.?)\s+(.*)$/i);
    if (m) {
      return {
        home: this.normalizeTeamName(m[1]),
        away: this.normalizeTeamName(m[2])
      };
    }

    m = s.match(/^(.*?)\s+-\s+(.*)$/);
    if (m) {
      return {
        home: this.normalizeTeamName(m[1]),
        away: this.normalizeTeamName(m[2])
      };
    }

    return { home: null, away: null };
  },

  extractTeamFromPick(pick) {
    if (!pick) return null;
    let s = String(pick).trim();
    if (!s) return null;

    s = s.replace(/\b[QP][1-4]\b/gi, " ")
         .replace(/\b[1-4][HQ]\b/gi, " ")
         .replace(/\b(?:1st|2nd|3rd|4th)\s*(?:Half|Qtr|Quarter|Period)?\b/gi, " ")
         .replace(/\b(?:HALF|FULL|QUARTER|PERIOD|QTR)\b/gi, " ");

    s = s.replace(/^\s*:\s*/, "");
    s = s.replace(/^(HOME|AWAY|H|A)\b/i, "").trim();
    s = s.split(/[+-]\s*\d/)[0].trim();
    s = s.replace(/\d+(\.\d+)?/g, " ").replace(/\s+/g, " ").trim();

    return this.normalizeTeamName(s);
  },

  deriveBackedTeam(opts) {
    const side = opts.side;
    const home = opts.home;
    const away = opts.away;
    const pick = opts.pick;
    const match = opts.match;

    const betSide = this.parseBetSide(pick) || side;

    if (!betSide || (betSide !== "H" && betSide !== "A")) {
      return this.extractTeamFromPick(pick);
    }

    let h = home || null;
    let a = away || null;

    if ((!h || !a) && match) {
      const parsed = this.extractTeamsFromMatch(match);
      h = h || parsed.home;
      a = a || parsed.away;
    }

    if (betSide === "H" && h) return h;
    if (betSide === "A" && a) return a;

    return this.extractTeamFromPick(pick);
  },

  deriveOpponentTeam(opts) {
    const side = opts.side;
    const home = opts.home;
    const away = opts.away;
    const pick = opts.pick;
    const match = opts.match;

    const betSide = this.parseBetSide(pick) || side;

    if (!betSide || (betSide !== "H" && betSide !== "A")) return null;

    let h = home || null;
    let a = away || null;

    if ((!h || !a) && match) {
      const parsed = this.extractTeamsFromMatch(match);
      h = h || parsed.home;
      a = a || parsed.away;
    }

    if (betSide === "H" && a) return a;
    if (betSide === "A" && h) return h;

    return null;
  },

  enrichSideBetWithTeams_(bet, row, resolved) {
    try {
      const match = bet.match || String(this.getValue(row, resolved, "match", "") || "");
      const pick = bet.pick || String(this.getValue(row, resolved, "pick", "") || "");

      const homeCol = this.getValue(row, resolved, "home", "");
      const awayCol = this.getValue(row, resolved, "away", "");

      let home = this.normalizeTeamName(homeCol);
      let away = this.normalizeTeamName(awayCol);

      if (!home || !away) {
        const parsed = this.extractTeamsFromMatch(match);
        home = home || parsed.home;
        away = away || parsed.away;
      }

      const backedTeam = this.deriveBackedTeam({
        side: bet.side,
        home: home,
        away: away,
        pick: pick,
        match: match
      });

      let opponentTeam = null;
      if (backedTeam && home && away) {
        opponentTeam = (backedTeam === home) ? away : ((backedTeam === away) ? home : null);
      }

      const matchupKey = (backedTeam && opponentTeam) ? `${backedTeam}__VS__${opponentTeam}` : null;

      bet.home = home || "";
      bet.away = away || "";
      bet.backedTeam = backedTeam || null;
      bet.opponentTeam = opponentTeam || null;
      bet.matchupKey = matchupKey || null;

    } catch (e) {
      bet.backedTeam = bet.backedTeam || null;
      bet.opponentTeam = bet.opponentTeam || null;
      bet.matchupKey = bet.matchupKey || null;
    }

    return bet;
  },

  parseScore(raw) {
    if (raw === null || raw === undefined || raw === "") return null;

    var s = String(raw)
      .trim()
      .toUpperCase()
      .replace(/[−–—]/g, "-")
      .replace(/\s+/g, " ");

    if (!s) return null;

    // (A) Labeled: "HOME:22 AWAY:20", "H 22 A 20", "H=22, A=20"
    var hLab = s.match(/\bH(?:OME)?\b\s*[:=]?\s*(\d{1,4})\b/);
    var aLab = s.match(/\bA(?:WAY)?\b\s*[:=]?\s*(\d{1,4})\b/);
    if (hLab && aLab) {
      var home = parseInt(hLab[1], 10);
      var away = parseInt(aLab[1], 10);
      if (isFinite(home) && isFinite(away)) {
        return {
          home: home,
          away: away,
          winner: home === away ? "T" : (home > away ? "H" : "A"),
          marker: null,
          markerContradiction: false,
          raw: s
        };
      }
    }

    // (B) Trailing marker: "22-20H" or "22 - 20 A"
    // POSITIONAL: first number = Home score, second = Away score
    // Marker is metadata only — we log contradictions but do NOT swap
    var mTrail = s.match(/\b(\d{1,4})\s*-\s*(\d{1,4})\s*([HA])\b/);
    if (mTrail) {
      var homeT = parseInt(mTrail[1], 10);
      var awayT = parseInt(mTrail[2], 10);
      var marker = mTrail[3];
      if (isFinite(homeT) && isFinite(awayT)) {
        var winnerFromScores = homeT === awayT ? "T" : (homeT > awayT ? "H" : "A");
        var contradiction = (winnerFromScores !== "T" && marker !== winnerFromScores);

        if (contradiction && this.log && typeof this.log.warn === "function") {
          this.log.warn(
            "Score marker contradiction: positional winner is " + winnerFromScores +
            " but marker says " + marker + ". Keeping positional order.",
            { raw: String(raw) }
          );
        }

        return {
          home: homeT,
          away: awayT,
          winner: winnerFromScores,
          marker: marker,
          markerContradiction: contradiction,
          raw: s
        };
      }
    }

    // (C) Plain "N-N" — assume home-away order
    var mPlain = s.match(/\b(\d{1,4})\s*-\s*(\d{1,4})\b/);
    if (mPlain) {
      var homeP = parseInt(mPlain[1], 10);
      var awayP = parseInt(mPlain[2], 10);
      if (isFinite(homeP) && isFinite(awayP)) {
        return {
          home: homeP,
          away: awayP,
          winner: homeP === awayP ? "T" : (homeP > awayP ? "H" : "A"),
          marker: null,
          markerContradiction: false,
          raw: s
        };
      }
    }

    return null;
  },

    parseSpreadSigned(pick) {
    if (!pick) return null;

    var s = String(pick)
      .toUpperCase()
      .replace(/[−–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();

    if (!s) return null;

    // Pick'em
    if (/\bPK\b|\bPICK\b|\bPICKEM\b/.test(s)) return 0;

    // If we can detect H/A, prefer the signed number closest to that marker
    var side = (typeof this.parseBetSide === "function") ? this.parseBetSide(s) : null;

    if (side === "H" || side === "A") {
      var idx = s.indexOf(side);
      if (idx >= 0) {
        var window = s.slice(idx, idx + 20);
        var mNear = window.match(/([+-])\s*(\d+(?:\.\d+)?)/);
        if (mNear) {
          var val = parseFloat(mNear[1] + mNear[2]);
          if (isFinite(val)) return val;
        }
      }
    }

    // Fallback: first plausible signed number (skip odds-like values >60)
    var re = /([+-])\s*(\d+(?:\.\d+)?)/g;
    var m = null;
    while ((m = re.exec(s)) !== null) {
      var fallbackVal = parseFloat(m[1] + m[2]);
      if (!isFinite(fallbackVal)) continue;
      if (Math.abs(fallbackVal) > 60) continue;
      return fallbackVal;
    }

    return null;
  },


    gradeSideFromScore(scoreVal, pick, sideCol) {
  var side = this.parseSide(pick, sideCol);
  if (side !== "H" && side !== "A") return null;

  var score = this.parseScore(scoreVal);
  if (!score || !isFinite(score.home) || !isFinite(score.away)) return null;

  // ── PURE OUTRIGHT (1X2) ──
  // HIT (1)  = backed side scores strictly more
  // MISS (0) = backed side does NOT win (includes ties/draws)
  // No PUSH semantics. No spread math. Ever.
  if (side === "H") {
    return (score.home > score.away) ? 1 : 0;
  } else {
    return (score.away > score.home) ? 1 : 0;
  }
},

  
  // =========================================================================
  // Sheet parsers
  // =========================================================================

  parseSideSheet(ss) {
  if (!this.log) this.init();
  Log_.section("Parsing Side Sheet");

  var sheet = ss.getSheetByName(Config_.sheets.side);
  if (!sheet) {
    this.log.warn("Side sheet not found");
    Log_.sectionEnd("Parsing Side Sheet");
    return { bets: [], columns: null, errors: ["Sheet not found"], stats: {} };
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    this.log.warn("Side sheet has no data rows");
    Log_.sectionEnd("Parsing Side Sheet");
    return { bets: [], columns: null, errors: ["No data rows"], stats: {} };
  }

  this.log.info(
    "Side sheet has " + (data.length - 1) + " data rows, " + data[0].length + " columns"
  );

  ColResolver_.init();
  var resolveResult = ColResolver_.resolve(data[0], Config_.sideColumnAliases, "Side");
  var resolved = resolveResult.resolved;

  var criticalCols = ["league"];
  var validation = ColResolver_.validateCritical(resolved, criticalCols, "Side");

  if (!validation.valid) {
    this.log.error("Cannot parse Side sheet - missing: " + validation.missing.join(", "));
    Log_.sectionEnd("Parsing Side Sheet");
    return {
      bets: [],
      columns: resolved,
      errors: ["Missing critical columns: " + validation.missing.join(", ")],
      stats: {}
    };
  }

  var hasOutcomeCol = (resolved && resolved.outcome !== undefined && resolved.outcome !== null);
  var hasActualCol  = (resolved && resolved.actual  !== undefined && resolved.actual  !== null);

  if (!hasOutcomeCol && !hasActualCol) {
    this.log.error("Side sheet has neither 'outcome' nor 'actual' column — cannot grade bets");
    Log_.sectionEnd("Parsing Side Sheet");
    return {
      bets: [],
      columns: resolved,
      errors: ["Missing both outcome and actual columns"],
      stats: {}
    };
  }

  if (hasActualCol) {
    this.log.info("Actual/score column found — will cross-validate outcomes against scores");
  }

  var bets = [];
  var parseErrors = [];
  var stats = {
    total: 0,
    parsed: 0,
    skippedNoOutcome: 0,
    skippedNoLeague: 0,
    skippedEmpty: 0,
    parseErrors: 0,
    crossValidated: 0,
    outcomeDisagreements: 0
  };

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowNum = i + 1;
    stats.total++;

    try {
      // ── Skip empty rows ──
      if (row.every(function(cell) {
        return cell === "" || cell === null || cell === undefined;
      })) {
        stats.skippedEmpty++;
        continue;
      }

      // ── League (critical) ──
      var leagueRaw = this.getValue(row, resolved, "league");
      if (!leagueRaw || String(leagueRaw).trim() === "") {
        stats.skippedNoLeague++;
        continue;
      }
      var league = String(leagueRaw).trim().toUpperCase();

      // ── Raw fields ──
      var pick       = String(this.getValue(row, resolved, "pick", "")       || "");
      var match      = String(this.getValue(row, resolved, "match", "")      || "");
      var type       = String(this.getValue(row, resolved, "type", "")       || "");
      var dateVal    = this.getValue(row, resolved, "date");
      var confRaw    = this.getValue(row, resolved, "confidence");
      var conf       = this.parseConfidence(confRaw);
      var tierRaw    = this.getValue(row, resolved, "tier");
      var quarterRaw = this.getValue(row, resolved, "quarter");
      var sideRaw    = this.getValue(row, resolved, "side");
      var oddsRaw    = this.getValue(row, resolved, "odds");
      var unitsRaw   = this.getValue(row, resolved, "units");
      var evRaw      = this.getValue(row, resolved, "ev");

      // ════════════════════════════════════════════════════════════════════
      // OUTCOME RESOLUTION — Pure Outright (1X2) enforcement
      //
      // Priority:
      //   1. COMPUTED from score (strict 1X2; ties = LOSS; no spread math)
      //   2. RECORDED from outcome column (fallback when no score available)
      //
      // When both exist, computed wins. Disagreements are flagged for audit.
      // Purity guarantee only holds when score data is present.
      // ════════════════════════════════════════════════════════════════════

      var outcomeRaw      = hasOutcomeCol ? this.getValue(row, resolved, "outcome") : null;
      var recordedOutcome = hasOutcomeCol ? this.parseOutcome(outcomeRaw)            : null;

      var actualRaw       = hasActualCol ? this.getValue(row, resolved, "actual") : null;
      var computedOutcome = null;

      if (hasActualCol &&
          actualRaw !== null && actualRaw !== undefined &&
          String(actualRaw).trim() !== "") {
        computedOutcome = this.gradeSideFromScore(actualRaw, pick, sideRaw);
      }

      var outcome         = null;
      var outcomeSource   = null;
      var outcomeMismatch = false;

      if (computedOutcome !== null) {
        // Score-derived 1X2 is the source of truth
        outcome       = computedOutcome;
        outcomeSource = "COMPUTED";

        if (recordedOutcome !== null) {
          stats.crossValidated++;

          if (recordedOutcome !== computedOutcome) {
            outcomeMismatch = true;
            stats.outcomeDisagreements++;

            // Labels: recorded can be HIT/MISS/PUSH (may carry handicap semantics);
            // computed is always HIT or MISS (1X2 has no push).
            var recLabel  = recordedOutcome === 1 ? "HIT"
                          : (recordedOutcome === 0 ? "MISS" : "PUSH");
            var compLabel = computedOutcome === 1 ? "HIT" : "MISS";

            if (this.log && typeof this.log.warn === "function") {
              this.log.warn(
                "Row " + rowNum + " outcome mismatch (Pure Outright enforced): " +
                "recorded=" + recLabel + " computed=" + compLabel +
                " — using COMPUTED",
                {
                  pick: pick,
                  actual: String(actualRaw || ""),
                  outcomeRaw: String(outcomeRaw || "")
                }
              );
            }
          }
        }

      } else if (recordedOutcome !== null) {
        // No score to compute from — must fall back (purity unverifiable)
        outcome       = recordedOutcome;
        outcomeSource = "RECORDED";

      }

      if (outcome === null) {
        stats.skippedNoOutcome++;
        continue;
      }

      // ── Derived fields ──
      var spreadAbs  = this.parseSpread(pick);
      var sideParsed = this.parseSide(pick, sideRaw);

      // ── Build bet object ──
      var bet = {
        source:        "Side",
        rowIndex:      rowNum,
        league:        league,
        date:          dateVal,
        match:         match,
        pick:          pick,
        type:          type,
        confidence:    conf,
        confBucket:    this.getConfBucket(conf),
        tier:          this.parseTier(tierRaw),
        quarter:       this.parseQuarter(quarterRaw),
        side:          sideParsed,
        sideParsed:    sideParsed,   // explicit audit field for troubleshooting
        spread:        spreadAbs,
        spreadBucket:  this.getSpreadBucket(spreadAbs),
        odds:          this.parseOdds(oddsRaw),
        units:         Utils_.toNumber(unitsRaw, 1),
        ev:            this.parseConfidence(evRaw),

        result:        outcome,

        // ── Observability fields (audit only, not used for grading) ──
        outcomeSource:   outcomeSource,
        outcomeRecorded: recordedOutcome,
        outcomeComputed: computedOutcome,
        outcomeMismatch: outcomeMismatch,
        actualScore:     (actualRaw === null || actualRaw === undefined) ? null : actualRaw,

        isWomen: this.isWomenLeague(league, match),
        isToxic: Config_.toxicLeagues.includes(league),
        isElite: Config_.eliteLeagues.includes(league)
      };

      this.enrichSideBetWithTeams_(bet, row, resolved);

      var stampRawSide = this.getValue(row, resolved, "config_stamp", "");
      bet.config_stamp = stampRawSide !== "" && stampRawSide != null ? String(stampRawSide).trim() : "";
      ConfigLedger_Reader.resolveStamp(bet);

      bets.push(bet);
      stats.parsed++;

    } catch (err) {
      stats.parseErrors++;
      parseErrors.push("Row " + rowNum + ": " + err.message);
    }
  }

  // ── Summary logging ──
  this.log.info("Parsed " + stats.parsed + " valid bets from Side sheet");
  this.log.info(
    "Skipped: " + stats.skippedNoLeague + " no league, " +
    stats.skippedNoOutcome + " no outcome, " +
    stats.skippedEmpty + " empty"
  );

  if (hasActualCol) {
    this.log.info(
      "Cross-validated: " + stats.crossValidated +
      " | Disagreements: " + stats.outcomeDisagreements
    );
  }

  if (stats.outcomeDisagreements > 0) {
    this.log.warn(
      "⚠️ " + stats.outcomeDisagreements +
      " rows where recorded outcome disagrees with strict 1X2 score check. " +
      "Pure Outright enforced."
    );
  }

  if (parseErrors.length > 0) {
    this.log.warn("Parse errors: " + parseErrors.length, parseErrors.slice(0, 5));
  }

  Log_.sectionEnd("Parsing Side Sheet");

  return { bets: bets, columns: resolved, errors: parseErrors, stats: stats };
},

  parseTotalsSheet(ss) {
    if (!this.log) this.init();
    Log_.section("Parsing Totals Sheet");

    const sheet = ss.getSheetByName(Config_.sheets.totals);
    if (!sheet) {
      this.log.warn("Totals sheet not found");
      Log_.sectionEnd("Parsing Totals Sheet");
      return { bets: [], columns: null, errors: ["Sheet not found"], stats: {} };
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      this.log.warn("Totals sheet has no data rows");
      Log_.sectionEnd("Parsing Totals Sheet");
      return { bets: [], columns: null, errors: ["No data rows"], stats: {} };
    }

    this.log.info(`Totals sheet has ${data.length - 1} data rows, ${data[0].length} columns`);

    ColResolver_.init();
    const { resolved, missing, found } = ColResolver_.resolve(
      data[0],
      Config_.totalsColumnAliases,
      "Totals"
    );

    const criticalCols = ["league", "result"];
    const validation = ColResolver_.validateCritical(resolved, criticalCols, "Totals");

    if (!validation.valid) {
      this.log.error(`Cannot parse Totals sheet - missing: ${validation.missing.join(", ")}`);
      Log_.sectionEnd("Parsing Totals Sheet");
      return {
        bets: [],
        columns: resolved,
        errors: [`Missing critical columns: ${validation.missing.join(", ")}`],
        stats: {}
      };
    }

    const bets = [];
    const parseErrors = [];
    const stats = {
      total: 0,
      parsed: 0,
      skippedNoOutcome: 0,
      skippedNoLeague: 0,
      skippedEmpty: 0,
      parseErrors: 0
    };

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 1;
      stats.total++;

      try {
        if (row.every(cell => cell === "" || cell === null || cell === undefined)) {
          stats.skippedEmpty++;
          continue;
        }

        const leagueRaw = this.getValue(row, resolved, "league");
        if (!leagueRaw || String(leagueRaw).trim() === "") {
          stats.skippedNoLeague++;
          continue;
        }
        const league = String(leagueRaw).trim().toUpperCase();

        const outcomeRaw = this.getValue(row, resolved, "result");
        const outcome = this.parseOutcome(outcomeRaw);

        if (outcome === null) {
          stats.skippedNoOutcome++;
          continue;
        }

        const home = String(this.getValue(row, resolved, "home", "") || "");
        const away = String(this.getValue(row, resolved, "away", "") || "");
        const matchRaw = this.getValue(row, resolved, "match");
        const match = matchRaw ? String(matchRaw) : (home && away ? `${home} vs ${away}` : "");
        const dateVal = this.getValue(row, resolved, "date");
        const confRaw = this.getValue(row, resolved, "confidence");
        const conf = this.parseConfidence(confRaw);
        const lineRaw = this.getValue(row, resolved, "line");
        const line = this.parseLine(lineRaw);
        const dirRaw = this.getValue(row, resolved, "direction");
        const actualRaw = this.getValue(row, resolved, "actual");
        const diffRaw = this.getValue(row, resolved, "diff");
        const tierRaw = this.getValue(row, resolved, "tier");
        const quarterRaw = this.getValue(row, resolved, "quarter");
        const typeRaw = this.getValue(row, resolved, "type");
        const oddsRaw = this.getValue(row, resolved, "odds");
        const unitsRaw = this.getValue(row, resolved, "units");
        const evRaw = this.getValue(row, resolved, "ev");

        const bet = {
          source: "Totals",
          rowIndex: rowNum,
          league: league,
          date: dateVal,
          match: match,
          home: home,
          away: away,
          direction: this.parseDirection(dirRaw),
          line: line,
          lineBucket: this.getLineBucket(line),
          actual: this.parseLine(actualRaw),
          diff: Utils_.toNumber(diffRaw, null),
          type: String(typeRaw || ""),
          confidence: conf,
          confBucket: this.getConfBucket(conf),
          tier: this.parseTier(tierRaw),
          quarter: this.parseQuarter(quarterRaw),
          odds: this.parseOdds(oddsRaw),
          units: Utils_.toNumber(unitsRaw, 1),
          ev: this.parseConfidence(evRaw),
          result: outcome,
          isWomen: this.isWomenLeague(league, match),
          isToxic: Config_.toxicLeagues.includes(league),
          isElite: Config_.eliteLeagues.includes(league)
        };

        // v4.3.0: stamp canonical typeKey at parse time
        bet.typeKey = this._deriveTotalsTypeKey(bet);

        const stampRawTot = this.getValue(row, resolved, "config_stamp", "");
        bet.config_stamp = stampRawTot !== "" && stampRawTot != null ? String(stampRawTot).trim() : "";
        ConfigLedger_Reader.resolveStamp(bet);

        bets.push(bet);
        stats.parsed++;

      } catch (err) {
        stats.parseErrors++;
        parseErrors.push(`Row ${rowNum}: ${err.message}`);
      }
    }

    this.log.info(`Parsed ${stats.parsed} valid bets from Totals sheet`);
    this.log.info(`Skipped: ${stats.skippedNoLeague} no league, ${stats.skippedNoOutcome} no outcome, ${stats.skippedEmpty} empty`);

    // v4.3.0: log typeKey distribution
    if (bets.length > 0) {
      const typeKeyDist = {};
      for (let j = 0; j < bets.length; j++) {
        const tk = bets[j].typeKey;
        typeKeyDist[tk] = (typeKeyDist[tk] || 0) + 1;
      }
      this.log.info(`Totals typeKey distribution: ${JSON.stringify(typeKeyDist)}`);
    }

    if (parseErrors.length > 0) {
      this.log.warn(`Parse errors: ${parseErrors.length}`, parseErrors.slice(0, 5));
    }

    Log_.sectionEnd("Parsing Totals Sheet");

    return { bets: bets, columns: resolved, errors: parseErrors, stats: stats };
  }
};

function auditSideOutcomes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(Config_.sheets.side);
  if (!sheet) {
    Logger.log("Side sheet not found.");
    return [];
  }

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    Logger.log("No data rows.");
    return [];
  }

  ColResolver_.init();
  var resolveResult = ColResolver_.resolve(data[0], Config_.sideColumnAliases, "Side");
  var resolved = resolveResult.resolved;

  if (!resolved || resolved.actual === undefined || resolved.actual === null) {
    Logger.log("ERROR: No 'actual' / 'score' column resolved for Side sheet.");
    Logger.log("Ensure Config_.sideColumnAliases.actual is configured.");
    return [];
  }

  var hasOutcomeCol = (resolved.outcome !== undefined && resolved.outcome !== null);

  var mismatches = [];
  var checked    = 0;
  var skipped    = 0;
  var matched    = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];

    var pick    = String(Parser_.getValue(row, resolved, "pick", "")  || "");
    var actual  = Parser_.getValue(row, resolved, "actual", "");
    var sideCol = String(Parser_.getValue(row, resolved, "side", "")  || "");

    if (!pick || actual === "" || actual === null || actual === undefined) {
      skipped++;
      continue;
    }

    // Strict side extraction (lossy clean + STRICT regex)
    var sideParsed = Parser_.parseSide(pick, sideCol);
    if (sideParsed !== "H" && sideParsed !== "A") {
      skipped++;
      continue;
    }

    // Grade using PURE OUTRIGHT (1X2): tie = LOSS, no spread math
    var calculated = Parser_.gradeSideFromScore(actual, pick, sideCol);

    if (calculated === null) {
      skipped++;
      continue;
    }

    if (!hasOutcomeCol) {
      // Can compute but nothing to compare against — just count
      checked++;
      continue;
    }

    var outcomeRaw = Parser_.getValue(row, resolved, "outcome", "");
    var recorded   = Parser_.parseOutcome(outcomeRaw);

    if (recorded === null) {
      skipped++;
      continue;
    }

    checked++;

    if (calculated === recorded) {
      matched++;
    } else {
      // Recorded may carry handicap semantics (HIT/MISS/PUSH).
      // Computed is strict 1X2 (HIT or MISS only — no push exists).
      var recLabel = recorded === 1 ? "HIT"
                   : (recorded === 0 ? "MISS" : "PUSH");
      var calLabel = calculated === 1 ? "HIT" : "MISS";

      mismatches.push({
        row:         i + 1,
        pick:        pick,
        actual:      String(actual),
        sideCol:     sideCol,
        sideParsed:  sideParsed,
        recorded:    recLabel,
        calculated:  calLabel,
        outcomeRaw:  String(outcomeRaw || "")
      });
    }
  }

  // ── Report ──
  Logger.log("===== SIDE OUTCOME AUDIT (PURE OUTRIGHT 1X2; TIE = LOSS) =====");
  Logger.log(
    "Checked: " + checked + " | Matched: " + matched +
    " | Mismatches: " + mismatches.length + " | Skipped: " + skipped
  );

  if (checked > 0 && mismatches.length === 0) {
    Logger.log(
      "✅ All " + checked +
      " outcomes match strict 1X2 outright-win logic. Source data is clean."
    );
  }

  if (mismatches.length > 0) {
    var errorRate = ((mismatches.length / checked) * 100).toFixed(1);
    Logger.log("ERROR RATE: " + errorRate + "%");
    Logger.log("");
    Logger.log("Mismatches (first 25):");

    for (var k = 0; k < Math.min(25, mismatches.length); k++) {
      var m = mismatches[k];
      Logger.log(
        "  Row " + m.row +
        ": " + m.pick +
        " | Side: " + m.sideParsed +
        " | Score: " + m.actual +
        " | Recorded: " + m.recorded + " (" + m.outcomeRaw + ")" +
        " | 1X2 check: " + m.calculated
      );
    }
  }

  return mismatches;
}

// ============================================================================
// PHASE 5 SAFETY: 48-HOUR ABANDONMENT RULE (MINIMAL IMPLEMENTATION)
// ============================================================================

/**
 * applyAbandonmentRule_ - 48-Hour Abandonment Rule (Phase 5 Safety)
 * If a game has a scheduled completion time and 48+ hours have passed with no result → mark as ABANDONED
 * This prevents ghost games from staying in "pending" forever.
 * @param {Array} bets - Array of bet objects
 * @returns {Array} Updated bets array
 */
function applyAbandonmentRule_(bets) {
  const now = new Date();
  const ABANDON_HOURS = 48;
  
  return bets.map(bet => {
    if (!bet || bet.result === 0 || bet.result === 1) {
      return bet; // already has result → leave as-is
    }
    
    // Look for completion/scheduled end time (common column names)
    const completionTime = bet.completionTime || bet.scheduledEnd || bet.endTime || bet.gameEndTime;
    if (!completionTime) return bet;
    
    const endDate = new Date(completionTime);
    if (isNaN(endDate.getTime())) return bet;
    
    const hoursSinceEnd = (now - endDate) / (1000 * 60 * 60);
    
    if (hoursSinceEnd > ABANDON_HOURS) {
      bet.result = "ABANDONED";
      bet.outcome = "ABANDONED";
      bet.notes = (bet.notes || "") + " | Auto-abandoned after 48h";
      Logger.log(`Game abandoned: ${bet.home} vs ${bet.away} (${bet.date})`);
    }
    
    return bet;
  });
}
```

## File: docs/Stats_StatsCalculations.gs
```
/******************************************************************************
 * MA ASSAYER — Complete Production Module
 * 
 * "Testing the purity of predictions - separating Gold from Charcoal"
 * 
 * COMPLETE ROBUST IMPLEMENTATION
 * 
 * ARCHITECTURE:
 * ├── M1_Output_          Sheet Writers
 * ├── M2_Main_            Controller/Orchestrator
 * ├── M3_Flagger_         Apply Flags to Source
 * ├── M4_Discovery_       Edge Discovery Engine
 * ├── M5_Config_          Configuration & Constants
 * ├── M6_ColResolver_     Fuzzy Column Matching (case-insensitive)
 * ├── M7_Parser_          Data Parsing
 * ├── M8_Stats_           Statistical Calculations
 * ├── M9_Utils_           Utility Functions
 * └── M10_Log_            Logging System
 ******************************************************************************/

/******************************************************************************
 * MA ASSAYER — Module 8: Stats_ — Statistical Calculations
 * 
 * PATCHED: assayLeagues now includes v4.3.0 typeKey segmentation
 ******************************************************************************/

const Stats_ = {
  log: null,
  
  /**
   * Initialize module
   */
  init() {
    this.log = Log_.module("STATS");
  },
  
  /**
   * Calculate basic win/loss statistics
   */
  calcBasic(bets) {
    if (!Array.isArray(bets) || bets.length === 0) {
      return {
        total: 0,
        decisive: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        winRate: 0,
        lossRate: 0
      };
    }
    
    const decisive = bets.filter(b => b.result === 0 || b.result === 1);
    const wins = decisive.filter(b => b.result === 1).length;
    const losses = decisive.length - wins;
    const pushes = bets.filter(b => b.result === -1).length;
    
    return {
      total: bets.length,
      decisive: decisive.length,
      wins,
      losses,
      pushes,
      winRate: decisive.length > 0 ? wins / decisive.length : 0,
      lossRate: decisive.length > 0 ? losses / decisive.length : 0
    };
  },
  
  /**
   * Wilson score lower bound (confidence interval)
   */
  wilsonLowerBound(wins, n, z = Config_.thresholds.wilsonZ) {
    if (n === 0) return 0;
    
    const p = wins / n;
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denominator;
    const halfWidth = (z * Math.sqrt((p * (1 - p) / n) + (z2 / (4 * n * n)))) / denominator;
    
    return Math.max(0, center - halfWidth);
  },
  
  /**
   * Wilson score upper bound
   */
  wilsonUpperBound(wins, n, z = Config_.thresholds.wilsonZ) {
    if (n === 0) return 0;
    
    const p = wins / n;
    const z2 = z * z;
    const denominator = 1 + z2 / n;
    const center = (p + z2 / (2 * n)) / denominator;
    const halfWidth = (z * Math.sqrt((p * (1 - p) / n) + (z2 / (4 * n * n)))) / denominator;
    
    return Math.min(1, center + halfWidth);
  },
  
  /**
   * Bayesian shrinkage with Jeffrey's prior
   */
  shrunkWinRate(wins, n, priorStrength = 1) {
    if (n === 0) return 0.5;
    return (wins + 0.5 * priorStrength) / (n + priorStrength);
  },
  
  /**
   * Calculate standard error
   */
  standardError(p, n) {
    if (n === 0) return 0;
    return Math.sqrt((p * (1 - p)) / n);
  },
  
  /**
   * Calculate z-score for hypothesis testing
   */
  zScore(observed, expected, n) {
    if (n === 0) return 0;
    const se = this.standardError(expected, n);
    if (se === 0) return 0;
    return (observed - expected) / se;
  },
  
  /**
   * Get purity grade based on win rate and sample size
   */
  getGrade(winRate, n) {
    const g = Config_.grades;
    const t = Config_.thresholds;
    
    if (winRate >= g.PLATINUM.min && n >= t.minNPlatinum) return "PLATINUM";
    if (winRate >= g.GOLD.min && n >= t.minNGold) return "GOLD";
    if (winRate >= g.GOLD.min && n >= t.minN) return "GOLD";
    if (winRate >= g.SILVER.min) return "SILVER";
    if (winRate >= g.BRONZE.min) return "BRONZE";
    if (winRate >= g.ROCK.min) return "ROCK";
    
    return "CHARCOAL";
  },
  
  /**
   * Get grade symbol
   */
  getGradeSymbol(winRate) {
    const g = Config_.grades;
    
    if (winRate >= g.PLATINUM.min) return g.PLATINUM.symbol;
    if (winRate >= g.GOLD.min) return g.GOLD.symbol;
    if (winRate >= g.SILVER.min) return g.SILVER.symbol;
    if (winRate >= g.BRONZE.min) return g.BRONZE.symbol;
    if (winRate >= g.ROCK.min) return g.ROCK.symbol;
    return g.CHARCOAL.symbol;
  },
  
  /**
   * Get grade info object
   */
  getGradeInfo(winRate, n) {
    const grade = this.getGrade(winRate, n);
    const gradeConfig = Config_.grades[grade];
    
    return {
      grade,
      symbol: gradeConfig.symbol,
      name: gradeConfig.name,
      color: gradeConfig.color,
      bgColor: gradeConfig.bgColor
    };
  },
  
  /**
   * Group array by key function
   */
  groupBy(arr, keyFn) {
    const map = {};
    
    if (!Array.isArray(arr)) return map;
    
    arr.forEach(item => {
      const key = typeof keyFn === "function" ? keyFn(item) : item[keyFn];
      if (key === null || key === undefined || key === "") return;
      
      if (!map[key]) map[key] = [];
      map[key].push(item);
    });
    
    return map;
  },
  
  /**
   * Format percentage
   */
  pct(val, decimals = 1) {
    if (val === null || val === undefined || isNaN(val)) return "N/A";
    return (val * 100).toFixed(decimals) + "%";
  },
  
  /**
   * Format lift with sign
   */
  lift(val, decimals = 1) {
    if (val === null || val === undefined || isNaN(val)) return "N/A";
    const prefix = val >= 0 ? "+" : "";
    return prefix + (val * 100).toFixed(decimals) + "%";
  },
  
  /**
   * Calculate ROI
   */
  calcROI(wins, losses, avgOdds = -110) {
    if (wins + losses === 0) return 0;
    
    let profitPerWin, lossPerLoss;
    if (avgOdds > 0) {
      profitPerWin = avgOdds / 100;
      lossPerLoss = 1;
    } else {
      profitPerWin = 100 / Math.abs(avgOdds);
      lossPerLoss = 1;
    }
    
    const totalProfit = (wins * profitPerWin) - (losses * lossPerLoss);
    const totalRisked = wins + losses;
    
    return totalProfit / totalRisked;
  },

  // ==========================================================================
  // PATCHED v4.3.0: assayLeagues — League + Source + Gender + Tier + Quarter
  //                                 + per-typeKey sub-slices (Totals only)
  //
  // Keys in the returned object:
  //   `${league}_${source}_${gender}_${tier}`                -> all quarters, all typeKeys
  //   `${league}_Q${q}_${source}_${gender}_${tier}`          -> specific quarter, all typeKeys
  //   `${league}_${source}_${gender}_${tier}_${typeKey}`     -> all quarters, specific typeKey
  //   `${league}_Q${q}_${source}_${gender}_${tier}_${typeKey}` -> specific quarter + typeKey
  // ==========================================================================
  assayLeagues(bets, globalStats) {
  if (!this.log) this.init();
  Log_.section("Assaying Leagues (Tier + Quarter)");

  const leagueStats = {};
  const allBets = Array.isArray(bets) ? bets : [];

  const safeGlobalWR =
    (globalStats && typeof globalStats.winRate === "number" && isFinite(globalStats.winRate))
      ? globalStats.winRate
      : 0;

  const normTier = (t) => {
    const v = (t == null || t === "") ? "UNKNOWN" : String(t);
    return v.trim().toUpperCase() || "UNKNOWN";
  };

  const normSource = (s) => {
    const v = (s == null || s === "") ? "" : String(s);
    return v.trim();
  };

  const genderOf = (b) => (b && b.isWomen) ? "W" : "M";

  // ── v4.3.1: Resolve typeKey from bet — checks .typeKey then falls back to .type ──
  const resolveTypeKey = (b) => {
    if (!b) return null;
    const raw = b.typeKey || b.type;
    if (!raw) return null;
    const v = String(raw).trim().toUpperCase().replace(/\s+/g, "_");
    if (!v || v === "UNKNOWN") return null;
    return v;
  };

  const computeStats = (sliceBets, league, source, gender, tier, quarter, typeKey) => {
    if (quarter === undefined) quarter = null;
    if (typeKey === undefined) typeKey = "";
    if (!Array.isArray(sliceBets) || sliceBets.length < Config_.thresholds.minN) return null;

    const basic = this.calcBasic(sliceBets);
    if (basic.decisive < Config_.thresholds.minN) return null;

    const shrunk = this.shrunkWinRate(basic.wins, basic.decisive);
    const lowerBound = this.wilsonLowerBound(basic.wins, basic.decisive);
    const upperBound = this.wilsonUpperBound(basic.wins, basic.decisive);
    const lift = shrunk - safeGlobalWR;

    const reliability = Math.min(1, basic.decisive / Config_.thresholds.minNReliable);
    const gradeInfo = this.getGradeInfo(shrunk, basic.decisive);

    const quarterLabel =
      quarter == null ? "All" : (quarter === 0 ? "Full" : `Q${quarter}`);

    // v4.3.1: Always label aggregate rows "ALL", never blank
    const displayTypeKey = typeKey || "ALL";

    return {
      league: league,
      source: source,
      gender: gender,
      tier: tier,
      typeKey: displayTypeKey,
      quarter: quarter,
      quarterLabel: quarterLabel,

      total: basic.total,
      decisive: basic.decisive,
      wins: basic.wins,
      losses: basic.losses,
      pushes: basic.pushes,
      winRate: basic.winRate,
      lossRate: basic.lossRate,
      shrunkRate: shrunk,
      lowerBound: lowerBound,
      upperBound: upperBound,
      confidenceInterval: `${this.pct(lowerBound)} - ${this.pct(upperBound)}`,

      lift: lift,
      liftPct: safeGlobalWR > 0 ? (lift / safeGlobalWR) * 100 : 0,

      grade: gradeInfo.grade,
      gradeSymbol: gradeInfo.symbol,
      gradeName: gradeInfo.name,

      reliability: reliability,
      isReliable: reliability >= 1,

      isWomen: gender === "W",
      isToxic: Array.isArray(Config_.toxicLeagues) ? Config_.toxicLeagues.includes(league) : false,
      isElite: Array.isArray(Config_.eliteLeagues) ? Config_.eliteLeagues.includes(league) : false,

      quarters: [].concat(new Set(sliceBets.map(b => b.quarter).filter(q => q != null))).sort((a, b) => a - b),
      dateRange: this.getDateRange(sliceBets)
    };
  };

  // Helper: process a slice at both all-quarter and per-quarter levels
  const processSlice = (sliceBets, league, source, gender, tier, typeKey) => {
    if (typeKey === undefined) typeKey = "";

    const tkSuffix = typeKey ? ("_" + typeKey) : "";

    // All-quarters
    const overall = computeStats(sliceBets, league, source, gender, tier, null, typeKey);
    if (overall) {
      ConfigLedger_Reader.tagSlice(overall, sliceBets);
      leagueStats[`${league}_${source}_${gender}_${tier}${tkSuffix}`] = overall;
    }

    // Per-quarter
    const byQuarter = this.groupBy(sliceBets, b => (b.quarter == null ? null : Number(b.quarter)));
    for (const qKey of Object.keys(byQuarter)) {
      const qBets = byQuarter[qKey];
      const qNum = Number(qKey);
      if (!Number.isFinite(qNum) || qNum < 0 || qNum > 4) continue;
      if (!Array.isArray(qBets) || qBets.length < Config_.thresholds.minN) continue;

      const qStats = computeStats(qBets, league, source, gender, tier, qNum, typeKey);
      if (qStats) {
        ConfigLedger_Reader.tagSlice(qStats, qBets);
        leagueStats[`${league}_Q${qNum}_${source}_${gender}_${tier}${tkSuffix}`] = qStats;
      }
    }
  };

  const byLeague = this.groupBy(allBets, b => (b && b.league) ? String(b.league).trim().toUpperCase() : null);

  for (const league of Object.keys(byLeague)) {
    const leagueBets = byLeague[league];
    if (!Array.isArray(leagueBets) || leagueBets.length < Config_.thresholds.minN) continue;

    const bySource = this.groupBy(leagueBets, b => normSource(b.source) || "UNKNOWN_SOURCE");

    for (const source of Object.keys(bySource)) {
      const sourceBets = bySource[source];

      const byGender = this.groupBy(sourceBets, b => genderOf(b));

      for (const gender of Object.keys(byGender)) {
        const genderBets = byGender[gender];

        const byTier = this.groupBy(genderBets, b => normTier(b.tier));

        for (const tier of Object.keys(byTier)) {
          const tierBets = byTier[tier];

          // ── Aggregate entry (all typeKeys combined) ──
          processSlice(tierBets, league, source, gender, tier, "");

          // ── v4.3.2: Per-typeKey sub-slices — ONLY when 2+ distinct types exist ──
          // Uses resolveTypeKey which checks b.typeKey THEN b.type
          const byTypeKey = this.groupBy(tierBets, b => resolveTypeKey(b));
          const distinctTypeKeys = Object.keys(byTypeKey).filter(tk =>
            tk && tk !== "null" && tk !== "undefined"
          );

          if (distinctTypeKeys.length >= 2) {
            for (const tk of distinctTypeKeys) {
              const tkBets = byTypeKey[tk];
              if (!Array.isArray(tkBets) || tkBets.length < Config_.thresholds.minN) continue;

              processSlice(tkBets, league, source, gender, tier, tk);
            }
          }
        }
      }
    }
  }

  this.log.info(`Assayed ${Object.keys(leagueStats).length} league/source/gender/tier/quarter combinations`);

  const gradeCount = {};
  Object.values(leagueStats).forEach(l => {
    gradeCount[l.grade] = (gradeCount[l.grade] || 0) + 1;
  });
  this.log.info("Grade distribution:", gradeCount);

  // v4.3.1: log typeKey breakdown for all sources
  const typeKeyCount = {};
  Object.values(leagueStats).forEach(l => {
    if (l.typeKey && l.typeKey !== "ALL") {
      const label = `${l.source}:${l.typeKey}`;
      typeKeyCount[label] = (typeKeyCount[label] || 0) + 1;
    }
  });
  if (Object.keys(typeKeyCount).length > 0) {
    this.log.info("Assay entries by source:typeKey:", typeKeyCount);
  }

  Log_.sectionEnd("Assaying Leagues (Tier + Quarter)");
  return leagueStats;
},

  /**
   * Get date range from bets
   */
  getDateRange(bets) {
    const dates = bets
      .map(b => b.date)
      .filter(d => d)
      .map(d => new Date(d))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a - b);
    
    if (dates.length === 0) return { start: null, end: null };
    
    return {
      start: dates[0],
      end: dates[dates.length - 1]
    };
  },

  // ==========================================================================
  // ROBUST: Stats_.calcExclusionImpact
  // ==========================================================================
  calcExclusionImpact(bets, globalStats) {
    if (!this.log) this.init();
    Log_.section("Calculating Exclusion Impact");

    const impact = [];
    const allBets = Array.isArray(bets) ? bets : [];

    if (allBets.length === 0) {
      this.log.info("No bets to analyze for exclusion impact");
      Log_.sectionEnd("Calculating Exclusion Impact");
      return impact;
    }

    const toxicList = Array.isArray(Config_.toxicLeagues) ? Config_.toxicLeagues : [];
    const isToxicLeague = (league) => toxicList.includes(league);

    const isDecisive = (b) => b && (b.result === 0 || b.result === 1);
    const normalizeSource = (s) => (s || "").trim().toLowerCase();
    const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    const decisiveBets = allBets.filter(isDecisive);
    const leagues = [...new Set(decisiveBets.map(b => b.league).filter(Boolean))];
    const rawSources = [...new Set(decisiveBets.map(b => normalizeSource(b.source)).filter(Boolean))];

    const globalBaseline = this.calcBasic(decisiveBets);
    const baselineBySource = {};
    const betsBySource = {};

    rawSources.forEach(src => {
      const srcBets = decisiveBets.filter(b => normalizeSource(b.source) === src);
      betsBySource[src] = srcBets;
      baselineBySource[src] = this.calcBasic(srcBets);
    });

    const betsByLeague = {};
    leagues.forEach(league => {
      betsByLeague[league] = decisiveBets.filter(b => b.league === league);
    });

    const calcImpactRow = (sliceName, sliceBets, baseline, league) => {
      const withoutLeague = sliceBets.filter(b => b.league !== league);
      if (withoutLeague.length < 50) return null;

      const winsWithout = withoutLeague.filter(b => b.result === 1).length;
      const rateWithout = winsWithout / withoutLeague.length;

      const safeBaseline = (typeof baseline.winRate === "number" && isFinite(baseline.winRate))
        ? baseline.winRate
        : 0;
      const delta = rateWithout - safeBaseline;

      let action = "➖ NEUTRAL";
      let priority = 0;

      if (delta > 0.02) {
        action = "⛏️ EXCLUDE";
        priority = Math.round(delta * 100);
      } else if (delta < -0.02) {
        action = "✅ KEEP";
        priority = Math.round(Math.abs(delta) * 100);
      }

      const leagueBets = sliceBets.filter(b => b.league === league);
      const currentStats = this.calcBasic(leagueBets);

      return {
        league,
        source: sliceName,
        deltaWinRate: delta,
        deltaPct: this.lift(delta),
        remainingBets: withoutLeague.length,
        rateWithout,
        rateWithoutPct: this.pct(rateWithout),
        baselineRate: safeBaseline,
        baselineRatePct: this.pct(safeBaseline),
        action,
        priority,
        isToxic: isToxicLeague(league),
        currentRate: this.pct(currentStats.winRate || 0),
        currentN: leagueBets.length
      };
    };

    for (const league of leagues) {
      const combinedRow = calcImpactRow("Combined", decisiveBets, globalBaseline, league);
      if (combinedRow) impact.push(combinedRow);

      for (const src of rawSources) {
        const srcBets = betsBySource[src];
        const srcBaseline = baselineBySource[src] || { winRate: 0 };
        const displaySource = capitalize(src);

        const srcRow = calcImpactRow(displaySource, srcBets, srcBaseline, league);
        if (srcRow) impact.push(srcRow);
      }
    }

    impact.sort((a, b) => (b.deltaWinRate || 0) - (a.deltaWinRate || 0));

    const excludeCount = impact.filter(i => (i.action || "").includes("EXCLUDE")).length;
    const keepCount = impact.filter(i => (i.action || "").includes("KEEP")).length;
    const neutralCount = impact.length - excludeCount - keepCount;

    this.log.info(`Calculated exclusion impact for ${impact.length} league+source rows`);
    this.log.info(`Recommendations: ${excludeCount} exclude, ${keepCount} keep, ${neutralCount} neutral`);

    Log_.sectionEnd("Calculating Exclusion Impact");
    return impact;
  },
  
  /**
   * Calculate quarter-by-quarter analysis, now segmented by tier
   */
  analyzeByQuarter(bets, globalStats) {
    if (!this.log) this.init();

    const allBets = Array.isArray(bets) ? bets : [];
    const safeGlobalWR =
      (globalStats && typeof globalStats.winRate === "number" && isFinite(globalStats.winRate))
        ? globalStats.winRate
        : 0;

    const normTier = (t) => {
      const v = (t == null || t === "") ? "UNKNOWN" : String(t);
      return v.trim().toUpperCase() || "UNKNOWN";
    };

    const grouped = {};
    for (const b of allBets) {
      const q = (b && b.quarter != null) ? Number(b.quarter) : null;
      if (!Number.isFinite(q) || q < 0 || q > 4) continue;

      const tier = normTier(b.tier);
      const key = `${q}_${tier}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(b);
    }

    const quarterStats = {};
    for (const [key, groupBets] of Object.entries(grouped)) {
      if (!Array.isArray(groupBets) || groupBets.length < 5) continue;

      const [qStr, tier] = key.split("_");
      const q = Number(qStr);

      const basic = this.calcBasic(groupBets);
      if (basic.decisive < 5) continue;

      const shrunk = this.shrunkWinRate(basic.wins, basic.decisive);
      const lift = shrunk - safeGlobalWR;

      quarterStats[key] = {
        quarter: q,
        tier,
        label: q === 0 ? "Full Game" : `Q${q}`,
        ...basic,
        shrunkRate: shrunk,
        lift,
        grade: this.getGrade(shrunk, basic.decisive),
        gradeSymbol: this.getGradeSymbol(shrunk)
      };
    }

    return quarterStats;
  },

  // ==========================================================================
  // Stats_ helpers for Team/Matchup grading + assays
  // ==========================================================================

  getGradeWithThresholds(winRate, n, thresholdsOverride = {}) {
    const g = Config_.grades;
    const t = { ...Config_.thresholds, ...thresholdsOverride };

    if (winRate >= g.PLATINUM.min && n >= t.minNPlatinum) return "PLATINUM";
    if (winRate >= g.GOLD.min && n >= t.minNGold) return "GOLD";
    if (winRate >= g.SILVER.min) return "SILVER";
    if (winRate >= g.BRONZE.min) return "BRONZE";
    if (winRate >= g.ROCK.min) return "ROCK";
    return "CHARCOAL";
  },

  getGradeInfoWithThresholds(winRate, n, thresholdsOverride = {}) {
    const grade = this.getGradeWithThresholds(winRate, n, thresholdsOverride);
    const gradeConfig = Config_.grades[grade];

    return {
      grade,
      symbol: gradeConfig.symbol,
      name: gradeConfig.name,
      color: gradeConfig.color,
      bgColor: gradeConfig.bgColor
    };
  },

  /**
   * Assay teams for Side bets (overall + per quarter).
   */
  assayTeams(sideBets, globalStats) {
    if (!this.log) this.init();
    Log_.section("Assaying Teams");

    const all = Array.isArray(sideBets) ? sideBets : [];
    const teamAssay = {};

    const safeGlobalWR =
      (globalStats && typeof globalStats.winRate === "number" && isFinite(globalStats.winRate))
        ? globalStats.winRate
        : 0;

    const toxicTeams = Array.isArray(Config_.toxicTeams) ? Config_.toxicTeams : [];
    const eliteTeams = Array.isArray(Config_.eliteTeams) ? Config_.eliteTeams : [];

    const tTeam = {
      minN:         Config_.thresholds.minNTeam         ?? 25,
      minNGold:     Config_.thresholds.minNTeamGold     ?? 40,
      minNPlatinum: Config_.thresholds.minNTeamPlatinum ?? 60
    };

    const keyOf = (team, q = null) => (q == null ? team : `${team}__Q${q}`);

    const TEAM_BLOCKLIST = [
      "Q H", "Q A", "H", "A", "HOME", "AWAY",
      "OVER", "UNDER", "TOTAL", "TOTALS",
      "DRAW", "TIE", "PUSH",
      "Q1", "Q2", "Q3", "Q4",
      "1H", "2H", "1Q", "2Q", "3Q", "4Q"
    ];

    const validBets = all.filter(b => {
      if (!b || !b.backedTeam) return false;
      const t = String(b.backedTeam).trim().toUpperCase();
      if (t.length < 3)              return false;
      if (TEAM_BLOCKLIST.includes(t)) return false;
      if (b.source === "Totals")     return false;
      if (b.direction)               return false;
      return true;
    });

    this.log.info(
      `Team assay: ${validBets.length} valid bets from ${all.length} total ` +
      `(${all.length - validBets.length} filtered out)`
    );

    const compute = (betsSlice, team, quarter = null) => {
      if (!team || String(team).trim().length < 3) return null;
      if (!Array.isArray(betsSlice) || betsSlice.length < tTeam.minN) return null;

      const basic = this.calcBasic(betsSlice);
      if (basic.decisive < tTeam.minN) return null;

      const shrunk     = this.shrunkWinRate(basic.wins, basic.decisive);
      const lowerBound = this.wilsonLowerBound(basic.wins, basic.decisive);
      const upperBound = this.wilsonUpperBound(basic.wins, basic.decisive);
      const lift       = shrunk - safeGlobalWR;

      const gradeInfo    = this.getGradeInfoWithThresholds(shrunk, basic.decisive, tTeam);
      const quarterLabel = (quarter == null) ? "All"
                         : (quarter === 0)  ? "Full"
                         : `Q${quarter}`;

      const isConfigToxic = toxicTeams.includes(team);
      const isConfigElite = eliteTeams.includes(team);
      const isPerfToxic   = gradeInfo.grade === "CHARCOAL";
      const isPerfElite   = (gradeInfo.grade === "GOLD" || gradeInfo.grade === "PLATINUM");

      return {
        team,
        source: "Side",
        quarter,
        quarterLabel,
        ...basic,
        shrunkRate: shrunk,
        lowerBound,
        upperBound,
        confidenceInterval: `${this.pct(lowerBound)} - ${this.pct(upperBound)}`,
        lift,
        liftPct: safeGlobalWR > 0 ? (lift / safeGlobalWR) * 100 : 0,
        grade:       gradeInfo.grade,
        gradeSymbol: gradeInfo.symbol,
        gradeName:   gradeInfo.name,
        isToxic: isConfigToxic || isPerfToxic,
        isElite: isConfigElite || isPerfElite,
        leagues:   [...new Set(betsSlice.map(b => b.league).filter(Boolean))].slice(0, 6),
        quarters:  [...new Set(betsSlice.map(b => b.quarter).filter(q => q != null))].sort((a, b) => a - b),
        dateRange: this.getDateRange(betsSlice)
      };
    };

    const grouped = this.groupBy(
      validBets,
      b => String(b.backedTeam).trim().toUpperCase()
    );

    const teamCounts = Object.entries(grouped)
      .map(([t, b]) => [t, b.length])
      .sort((a, b) => b[1] - a[1]);

    const uniqueTeams     = teamCounts.length;
    const teamsAboveMinN  = teamCounts.filter(([_, n]) => n >= tTeam.minN).length;
    const teamsAbove10    = teamCounts.filter(([_, n]) => n >= 10).length;
    const teamsAbove5     = teamCounts.filter(([_, n]) => n >= 5).length;

    this.log.info(`Unique teams: ${uniqueTeams}`);
    this.log.info(`minNTeam threshold: ${tTeam.minN}`);
    this.log.info(`Teams with N >= ${tTeam.minN}: ${teamsAboveMinN}`);
    this.log.info(`Teams with N >= 10: ${teamsAbove10}`);
    this.log.info(`Teams with N >= 5: ${teamsAbove5}`);
    this.log.info(
      `Top 15 teams: ${teamCounts.slice(0, 15).map(([t, n]) => `${t}(${n})`).join(", ")}`
    );

    for (const [team, tBets] of Object.entries(grouped)) {
      if (!team) continue;

      const overall = compute(tBets, team, null);
      if (overall) {
        ConfigLedger_Reader.tagSlice(overall, tBets);
        teamAssay[keyOf(team, null)] = overall;
      }

      const byQuarter = this.groupBy(
        tBets,
        b => (b.quarter == null ? null : Number(b.quarter))
      );

      for (const [qKey, qBets] of Object.entries(byQuarter)) {
        const qNum = Number(qKey);
        if (!Number.isFinite(qNum) || qNum < 0 || qNum > 4) continue;

        const qStats = compute(qBets, team, qNum);
        if (qStats) {
          ConfigLedger_Reader.tagSlice(qStats, qBets);
          teamAssay[keyOf(team, qNum)] = qStats;
        }
      }
    }

    this.log.info(`Assayed ${Object.keys(teamAssay).length} team×quarter keys`);
    Log_.sectionEnd("Assaying Teams");
    return teamAssay;
  },

  /**
   * Assay matchups for Side bets using backedTeam + opponentTeam.
   */
  assayMatchups(sideBets, globalStats) {
    if (!this.log) this.init();
    Log_.section("Assaying Matchups");

    const all = Array.isArray(sideBets) ? sideBets : [];
    const matchupAssay = {};

    const safeGlobalWR =
      (globalStats && typeof globalStats.winRate === "number" && isFinite(globalStats.winRate))
        ? globalStats.winRate
        : 0;

    const toxicMatchups = Array.isArray(Config_.toxicMatchups) ? Config_.toxicMatchups : [];
    const eliteMatchups = Array.isArray(Config_.eliteMatchups) ? Config_.eliteMatchups : [];

    const tM = {
      minN: Config_.thresholds.minNMatchup ?? 5,
      minNReliable: Config_.thresholds.minNMatchupReliable ?? 30,
      minNGold: Config_.thresholds.minNMatchupGold ?? 30,
      minNPlatinum: Config_.thresholds.minNMatchupPlatinum ?? 45
    };

    const keyOf = (mk, q = null) => (q == null ? mk : `${mk}__Q${q}`);

    const withBacked = all.filter(b => b && b.backedTeam).length;
    const withOpp = all.filter(b => b && b.opponentTeam).length;
    const withMK = all.filter(b => b && b.matchupKey).length;

    const grouped0 = this.groupBy(all, b => (b && b.matchupKey) ? String(b.matchupKey).trim().toUpperCase() : null);
    const uniqueMK = Object.keys(grouped0).filter(Boolean).length;
    let maxGroup = 0;
    let maxKey = null;
    for (const [mk, arr] of Object.entries(grouped0)) {
      if (!mk || !Array.isArray(arr)) continue;
      if (arr.length > maxGroup) {
        maxGroup = arr.length;
        maxKey = mk;
      }
    }

    this.log.info(
      `Matchup coverage: bets=${all.length}, backedTeam=${withBacked}, opponentTeam=${withOpp}, matchupKey=${withMK}, unique=${uniqueMK}, maxN=${maxGroup}${maxKey ? ` (${maxKey})` : ""}, minN=${tM.minN}`
    );

    const compute = (betsSlice, matchupKey, quarter = null) => {
      if (!Array.isArray(betsSlice) || betsSlice.length < tM.minN) return null;

      const basic = this.calcBasic(betsSlice);
      if (basic.decisive < tM.minN) return null;

      const shrunk = this.shrunkWinRate(basic.wins, basic.decisive);
      const lowerBound = this.wilsonLowerBound(basic.wins, basic.decisive);
      const upperBound = this.wilsonUpperBound(basic.wins, basic.decisive);
      const lift = shrunk - safeGlobalWR;

      const gradeInfo = this.getGradeInfoWithThresholds(shrunk, basic.decisive, tM);
      const quarterLabel = (quarter == null) ? "All" : (quarter === 0 ? "Full" : `Q${quarter}`);

      const parts = String(matchupKey || "").split("__VS__");
      const backedTeam = parts[0] || "";
      const opponentTeam = parts[1] || "";

      const isConfigToxic = toxicMatchups.includes(matchupKey);
      const isConfigElite = eliteMatchups.includes(matchupKey);

      const reliability = Math.min(1, basic.decisive / tM.minNReliable);
      const isReliable = basic.decisive >= tM.minNReliable;

      const isPerfToxic = isReliable && (gradeInfo.grade === "CHARCOAL");
      const isPerfElite = isReliable && (gradeInfo.grade === "GOLD" || gradeInfo.grade === "PLATINUM");

      return {
        matchupKey,
        backedTeam,
        opponentTeam,
        source: "Side",
        quarter,
        quarterLabel,

        ...basic,
        shrunkRate: shrunk,
        lowerBound,
        upperBound,
        confidenceInterval: `${this.pct(lowerBound)} - ${this.pct(upperBound)}`,

        lift,
        liftPct: safeGlobalWR > 0 ? (lift / safeGlobalWR) * 100 : 0,

        grade: gradeInfo.grade,
        gradeSymbol: gradeInfo.symbol,
        gradeName: gradeInfo.name,

        reliability,
        isReliable,

        isToxic: isConfigToxic || isPerfToxic,
        isElite: isConfigElite || isPerfElite,

        leagues: [...new Set(betsSlice.map(b => b.league).filter(Boolean))].slice(0, 6),
        quarters: [...new Set(betsSlice.map(b => b.quarter).filter(q => q != null))].sort((a, b) => a - b),
        dateRange: this.getDateRange(betsSlice)
      };
    };

    const grouped = grouped0;

    for (const [mk, mBets] of Object.entries(grouped)) {
      if (!mk) continue;

      const overall = compute(mBets, mk, null);
      if (overall) {
        ConfigLedger_Reader.tagSlice(overall, mBets);
        matchupAssay[keyOf(mk, null)] = overall;
      }

      const byQuarter = this.groupBy(mBets, b => (b.quarter == null ? null : Number(b.quarter)));
      for (const [qKey, qBets] of Object.entries(byQuarter)) {
        const qNum = Number(qKey);
        if (!Number.isFinite(qNum) || qNum < 0 || qNum > 4) continue;

        const qStats = compute(qBets, mk, qNum);
        if (qStats) {
          ConfigLedger_Reader.tagSlice(qStats, qBets);
          matchupAssay[keyOf(mk, qNum)] = qStats;
        }
      }
    }

    this.log.info(`Assayed ${Object.keys(matchupAssay).length} matchup keys`);
    Log_.sectionEnd("Assaying Matchups");
    return matchupAssay;
  },
  
  /**
   * Calculate rolling statistics
   */
  calcRolling(bets, windowSize = 50) {
    if (bets.length < windowSize) return [];
    
    const rolling = [];
    
    for (let i = windowSize; i <= bets.length; i++) {
      const window = bets.slice(i - windowSize, i);
      const stats = this.calcBasic(window);
      
      rolling.push({
        index: i,
        winRate: stats.winRate,
        wins: stats.wins,
        losses: stats.losses
      });
    }
    
    return rolling;
  }
};
```

## File: docs/Utils_UtilityFunctions.gs
```
/******************************************************************************
 * MA ASSAYER — Complete Production Module
 * 
 * "Testing the purity of predictions - separating Gold from Charcoal"
 * 
 * COMPLETE ROBUST IMPLEMENTATION
 * 
 * ARCHITECTURE:
 * ├── M1_Output_          Sheet Writers
 * ├── M2_Main_            Controller/Orchestrator
 * ├── M3_Flagger_         Apply Flags to Source
 * ├── M4_Discovery_       Edge Discovery Engine
 * ├── M5_Config_          Configuration & Constants
 * ├── M6_ColResolver_     Fuzzy Column Matching (case-insensitive)
 * ├── M7_Parser_          Data Parsing
 * ├── M8_Stats_           Statistical Calculations
 * ├── M9_Utils_           Utility Functions
 * └── M10_Log_            Logging System
 ******************************************************************************/
 
// ============================================================================
// MODULE: Utils_ — Utility Functions
// ============================================================================

const Utils_ = {
  /**
   * Safe string conversion
   */
  toString(val) {
    if (val === null || val === undefined) return "";
    return String(val);
  },
  
  /**
   * Safe number conversion
   */
  toNumber(val, defaultVal = 0) {
    if (val === null || val === undefined || val === "") return defaultVal;
    const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.\-]/g, ""));
    return isNaN(num) ? defaultVal : num;
  },
  
  /**
   * Safe array check
   */
  isArray(val) {
    return Array.isArray(val);
  },
  
  /**
   * Safe object check
   */
  isObject(val) {
    return val !== null && typeof val === "object" && !Array.isArray(val);
  },
  
  /**
   * Deep clone object
   */
  deepClone(obj) {
    if (obj === null || typeof obj !== "object") return obj;
    if (obj instanceof Date) return new Date(obj);
    if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
    
    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }
    return cloned;
  },
  
  /**
   * Format date
   */
  formatDate(date, format = "yyyy-MM-dd") {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    
    const pad = (n) => String(n).padStart(2, "0");
    
    return format
      .replace("yyyy", d.getFullYear())
      .replace("MM", pad(d.getMonth() + 1))
      .replace("dd", pad(d.getDate()))
      .replace("HH", pad(d.getHours()))
      .replace("mm", pad(d.getMinutes()))
      .replace("ss", pad(d.getSeconds()));
  },
  
  /**
   * Format percentage
   */
  formatPct(val, decimals = 1) {
    if (val === null || val === undefined || isNaN(val)) return "N/A";
    return (val * 100).toFixed(decimals) + "%";
  },
  
  /**
   * Format lift (with sign)
   */
  formatLift(val, decimals = 1) {
    if (val === null || val === undefined || isNaN(val)) return "N/A";
    const prefix = val >= 0 ? "+" : "";
    return prefix + (val * 100).toFixed(decimals) + "%";
  },
  
  /**
   * Truncate string
   */
  truncate(str, maxLen = 50) {
    const s = this.toString(str);
    return s.length > maxLen ? s.substring(0, maxLen - 3) + "..." : s;
  },
  
  /**
   * Pad string
   */
  pad(str, len, char = " ", right = false) {
    const s = this.toString(str);
    if (s.length >= len) return s;
    const padding = char.repeat(len - s.length);
    return right ? s + padding : padding + s;
  },
  
  /**
   * Generate unique ID
   */
  generateId(prefix = "ID") {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },
  
  /**
   * Check if value is empty
   */
  isEmpty(val) {
    if (val === null || val === undefined) return true;
    if (typeof val === "string") return val.trim() === "";
    if (Array.isArray(val)) return val.length === 0;
    if (typeof val === "object") return Object.keys(val).length === 0;
    return false;
  },
  
  /**
   * Safe get nested property
   */
  get(obj, path, defaultVal = null) {
    if (!obj) return defaultVal;
    const keys = path.split(".");
    let current = obj;
    
    for (const key of keys) {
      if (current === null || current === undefined || !current.hasOwnProperty(key)) {
        return defaultVal;
      }
      current = current[key];
    }
    
    return current !== undefined ? current : defaultVal;
  },
  
  /**
   * Chunk array into smaller arrays
   */
  chunk(arr, size) {
    if (!Array.isArray(arr) || size < 1) return [];
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  },
  
  /**
   * Remove duplicates from array
   */
  unique(arr, keyFn = null) {
    if (!Array.isArray(arr)) return [];
    if (!keyFn) return [...new Set(arr)];
    
    const seen = new Set();
    return arr.filter(item => {
      const key = keyFn(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
  
  /**
   * Sort array by multiple keys
   */
  sortBy(arr, ...keys) {
    return [...arr].sort((a, b) => {
      for (const key of keys) {
        const desc = key.startsWith("-");
        const prop = desc ? key.slice(1) : key;
        const aVal = this.get(a, prop, 0);
        const bVal = this.get(b, prop, 0);
        
        if (aVal < bVal) return desc ? 1 : -1;
        if (aVal > bVal) return desc ? -1 : 1;
      }
      return 0;
    });
  }
};
```

## File: README.md
```markdown
# Ma Assayer — Gold Universe Purity Engine

**"Testing the purity of predictions — separating Gold from Charcoal"**

This is the official purity engine for the Ma Golide Gold Universe.

## Architecture
- Satellites (league spreadsheets) → feed clean data to Assayer
- Assayer → produces `ASSAYER_EDGES` + `ASSAYER_LEAGUE_PURITY`
- Mothership → reads the purity contract to build accas

## How to use
1. Point the Assayer at any satellite spreadsheet ID
2. Run "🚀 Run Full Assay"
3. The two output sheets become the official contract for the Mothership

## Repository Structure
All 10 production modules are included.

Made with ❤️ for the Gold Universe.
```
