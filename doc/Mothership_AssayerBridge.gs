/**
 * Mothership_AssayerBridge.gs  
 * ─────────────────────────────────────────────
 * - Loads ASSAYER_EDGES + ASSAYER_LEAGUE_PURITY from remote Assayer sheet
 * - Computes bucketing EXACTLY per contract
 * - Derives Mother bet dimensions (best-effort parse)
 * - Matches best edge (wildcard nulls)
 * - Looks up league purity and returns routing action
 * - Public API surface (no trailing underscore) over internals
 * - Phase 2 compatibility adapter
 */

/* ═══════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════ */

/**
 * Strict boolean reader for config values that may arrive as strings from
 * Sheets / Properties.  Uses assayerBoolOrNull_() so "false" → false.
 * Falls back to the existing ASSAYER_BRIDGE value WITHOUT !! coercion.
 */
function assayerCfgBool_(v, defaultVal) {
  var b = assayerBoolOrNull_(v);
  return (b === null) ? defaultVal : b;
}

/**
 * Sync builder/orchestrator config into ASSAYER_BRIDGE so both systems agree.
 * Call ONCE before enrichment begins.
 *
 * Handles:
 *   - Back-compat aliases (REQUIRE_RELIABLE_EDGE → REQUIRE_EDGE_RELIABLE)
 *   - Safe boolean parsing (string "false" → false)
 *   - Enum validation on UNKNOWN_LEAGUE_ACTION
 *   - Number guards (empty string won't zero-out)
 *   - LOGGING sub-config
 */
function assayerApplyBridgeConfig_(cfg) {
  cfg = cfg || {};

  // ── Back-compat alias ──
  if (cfg.REQUIRE_RELIABLE_EDGE != null && cfg.REQUIRE_EDGE_RELIABLE == null) {
    cfg.REQUIRE_EDGE_RELIABLE = cfg.REQUIRE_RELIABLE_EDGE;
  }

  // ── Booleans (strict) ──
  if (cfg.GOLD_ONLY_MODE != null)
    ASSAYER_BRIDGE.GOLD_ONLY_MODE = assayerCfgBool_(cfg.GOLD_ONLY_MODE, ASSAYER_BRIDGE.GOLD_ONLY_MODE);
  if (cfg.REQUIRE_EDGE_RELIABLE != null)
    ASSAYER_BRIDGE.REQUIRE_EDGE_RELIABLE = assayerCfgBool_(cfg.REQUIRE_EDGE_RELIABLE, ASSAYER_BRIDGE.REQUIRE_EDGE_RELIABLE);
  if (cfg.DISALLOW_SMALL_SAMPLE_EDGES != null)
    ASSAYER_BRIDGE.DISALLOW_SMALL_SAMPLE_EDGES = assayerCfgBool_(cfg.DISALLOW_SMALL_SAMPLE_EDGES, ASSAYER_BRIDGE.DISALLOW_SMALL_SAMPLE_EDGES);
  if (cfg.PURITY_LOOKUP_DEBUG != null)
    ASSAYER_BRIDGE.PURITY_LOOKUP_DEBUG = assayerCfgBool_(cfg.PURITY_LOOKUP_DEBUG, ASSAYER_BRIDGE.PURITY_LOOKUP_DEBUG);
  if (cfg.ALLOW_TIER_FALLBACK != null)
    ASSAYER_BRIDGE.ALLOW_TIER_FALLBACK = assayerCfgBool_(cfg.ALLOW_TIER_FALLBACK, ASSAYER_BRIDGE.ALLOW_TIER_FALLBACK);
  if (cfg.ALLOW_GENDER_FALLBACK != null)
    ASSAYER_BRIDGE.ALLOW_GENDER_FALLBACK = assayerCfgBool_(cfg.ALLOW_GENDER_FALLBACK, ASSAYER_BRIDGE.ALLOW_GENDER_FALLBACK);
  if (cfg.ALLOW_W_TO_M_FALLBACK != null)
    ASSAYER_BRIDGE.ALLOW_W_TO_M_FALLBACK = assayerCfgBool_(cfg.ALLOW_W_TO_M_FALLBACK, ASSAYER_BRIDGE.ALLOW_W_TO_M_FALLBACK);
  if (cfg.STRICT_REQUIRE_PURITY_CHECKMARK != null)
    ASSAYER_BRIDGE.STRICT_REQUIRE_PURITY_CHECKMARK = assayerCfgBool_(cfg.STRICT_REQUIRE_PURITY_CHECKMARK, ASSAYER_BRIDGE.STRICT_REQUIRE_PURITY_CHECKMARK);
  if (cfg.STRICT_BLOCK_BUILDING_PURITY != null)
    ASSAYER_BRIDGE.STRICT_BLOCK_BUILDING_PURITY = assayerCfgBool_(cfg.STRICT_BLOCK_BUILDING_PURITY, ASSAYER_BRIDGE.STRICT_BLOCK_BUILDING_PURITY);

  // ── Numbers (guard empty string — Number("") is 0) ──
  if (cfg.MIN_EDGE_SPECIFICITY != null && cfg.MIN_EDGE_SPECIFICITY !== "") {
    var ms = Number(cfg.MIN_EDGE_SPECIFICITY);
    if (isFinite(ms)) ASSAYER_BRIDGE.MIN_EDGE_SPECIFICITY = ms;
  }
  if (cfg.BLOCKED_SCORE_DELTA != null && cfg.BLOCKED_SCORE_DELTA !== "") {
    var bsd = Number(cfg.BLOCKED_SCORE_DELTA);
    if (isFinite(bsd)) ASSAYER_BRIDGE.BLOCKED_SCORE_DELTA = bsd;
  }

  // ── Strings / enums ──
  if (cfg.MIN_EDGE_GRADE)
    ASSAYER_BRIDGE.MIN_EDGE_GRADE = String(cfg.MIN_EDGE_GRADE).trim().toUpperCase();
  if (cfg.MIN_PURITY_GRADE)
    ASSAYER_BRIDGE.MIN_PURITY_GRADE = String(cfg.MIN_PURITY_GRADE).trim().toUpperCase();
  if (cfg.UNKNOWN_LEAGUE_ACTION) {
    var ula = String(cfg.UNKNOWN_LEAGUE_ACTION).trim().toUpperCase();
    ASSAYER_BRIDGE.UNKNOWN_LEAGUE_ACTION =
      (ula === "BLOCK" || ula === "NEUTRAL" || ula === "ALLOW") ? ula : ASSAYER_BRIDGE.UNKNOWN_LEAGUE_ACTION;
  }
  if (cfg.UNKNOWN_EDGE_ACTION) {
    var uea = String(cfg.UNKNOWN_EDGE_ACTION).trim().toUpperCase();
    ASSAYER_BRIDGE.UNKNOWN_EDGE_ACTION =
      (uea === "BLOCK" || uea === "NEUTRAL" || uea === "ALLOW") ? uea : ASSAYER_BRIDGE.UNKNOWN_EDGE_ACTION;
  }

  // ── LOGGING sub-config ──
  if (cfg.LOGGING && typeof cfg.LOGGING === "object") {
    ASSAYER_BRIDGE.LOGGING = ASSAYER_BRIDGE.LOGGING || {};
    if (cfg.LOGGING.ENABLED != null)
      ASSAYER_BRIDGE.LOGGING.ENABLED = assayerCfgBool_(cfg.LOGGING.ENABLED, ASSAYER_BRIDGE.LOGGING.ENABLED);
    if (cfg.LOGGING.LOG_ACCEPTS != null)
      ASSAYER_BRIDGE.LOGGING.LOG_ACCEPTS = assayerCfgBool_(cfg.LOGGING.LOG_ACCEPTS, ASSAYER_BRIDGE.LOGGING.LOG_ACCEPTS);
    if (cfg.LOGGING.LOG_REJECTS != null)
      ASSAYER_BRIDGE.LOGGING.LOG_REJECTS = assayerCfgBool_(cfg.LOGGING.LOG_REJECTS, ASSAYER_BRIDGE.LOGGING.LOG_REJECTS);
  }

  // ── Confirmation log ──
  Logger.log(
    "[AssayerBridge] Config applied:" +
    " GOLD_ONLY_MODE=" + ASSAYER_BRIDGE.GOLD_ONLY_MODE +
    " MIN_EDGE_GRADE=" + ASSAYER_BRIDGE.MIN_EDGE_GRADE +
    " MIN_PURITY_GRADE=" + ASSAYER_BRIDGE.MIN_PURITY_GRADE +
    " UNKNOWN_LEAGUE_ACTION=" + ASSAYER_BRIDGE.UNKNOWN_LEAGUE_ACTION +
    " UNKNOWN_EDGE_ACTION=" + ASSAYER_BRIDGE.UNKNOWN_EDGE_ACTION +
    " REQUIRE_EDGE_RELIABLE=" + ASSAYER_BRIDGE.REQUIRE_EDGE_RELIABLE
  );

  return ASSAYER_BRIDGE;
}

const ASSAYER_BRIDGE = {
  EDGE_SHEET: "ASSAYER_EDGES",
  PURITY_SHEET: "ASSAYER_LEAGUE_PURITY",
  PURITY_SCORE_DELTA: {
    BOOST: +3.0,
    NEUTRAL: 0.0,
    CAUTION: -2.0,
    SUPPRESS: -6.0,
    BLOCK: 0.0,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH: Gold-standard gating + controls (defaults are strict/safe)
  // ─────────────────────────────────────────────────────────────────────────
  GOLD_ONLY_MODE: false,                 // hard gate: require Edge + Purity meet minimums
  MIN_EDGE_GRADE: "SILVER",               // minimum edge grade allowed when GOLD_ONLY_MODE=true
  MIN_PURITY_GRADE: "SILVER",             // minimum purity grade allowed when GOLD_ONLY_MODE=true
  UNKNOWN_LEAGUE_ACTION: "BLOCK",       // what to do when no purity row exists: "BLOCK" | "NEUTRAL"
  UNKNOWN_EDGE_ACTION: "ALLOW",         // what to do when no edge row exists: "ALLOW" | "BLOCK"
  REQUIRE_EDGE_RELIABLE: false,          // if true: only edges with reliable===true are match-eligible
  DISALLOW_SMALL_SAMPLE_EDGES: false,    // if true: sample_size==="Small" edges are excluded (hard)
  MIN_EDGE_SPECIFICITY: 1,              // mitigates wildcard/broad-edge risk (0 disables)
  BLOCKED_SCORE_DELTA: -999,            // for downstream score-based routers that ignore blocked flag
  
  // Purity lookup robustness + debug
  PURITY_LOOKUP_DEBUG: true,
  ALLOW_TIER_FALLBACK: true,           // ⚠️ broadens matching — see note below
  ALLOW_GENDER_FALLBACK: true,         // ⚠️ broadens matching — see note below
  ALLOW_W_TO_M_FALLBACK: false,        // last-resort; OFF by default

  // Strict-policy valves (defaults = your current strict behavior)
  STRICT_REQUIRE_PURITY_CHECKMARK: false,
  STRICT_BLOCK_BUILDING_PURITY: false,

  LOGGING: {                            // Logger.log controls
    ENABLED: true,
    LOG_ACCEPTS: true,
    LOG_REJECTS: true,
  },
};


const ASSAYER_GRADE_RANK = {
  PLATINUM: 6,
  GOLD: 5,
  SILVER: 4,
  BRONZE: 3,
  ROCK: 2,
  CHARCOAL: 1,
  NONE: 0
};


/* ═══════════════════════════════════════════
   CONFIG PROFILE HELPERS (Assayer Port)
   ═══════════════════════════════════════════ */

function _bridgeSafeParseJSON_(s) {
  if (!s || typeof s !== 'string') return null;
  s = s.trim();
  if (!s.startsWith('{') && !s.startsWith('[')) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

function _bridgeNormalizeConfigVal_(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  var s = String(raw).trim().toUpperCase();
  return s || null;
}

function _bridgeFlattenConfigProfile_(obj) {
  if (!obj || typeof obj !== 'object') return {};
  var out = {};
  if (obj.cfgKey) out.cfgKey = _bridgeNormalizeConfigVal_(obj.cfgKey);
  if (obj.cfgBucket) out.cfgBucket = _bridgeNormalizeConfigVal_(obj.cfgBucket);
  return out;
}

/* ═══════════════════════════════════════════
   SHARED UTILITIES
   ═══════════════════════════════════════════ */

function assayerCanonUpper_(v) {
  if (v === "" || v === null || v === undefined) return null;
  var s = String(v).trim();
  return s ? s.toUpperCase() : null;
}

function assayerCanonSource_(v) {
  var s = assayerCanonUpper_(v);
  if (!s) return null;
  if (s === "SIDE" || s === "SIDES" || s === "SPREAD" || s === "SPREADS") return "SIDE";
  if (s === "TOTAL" || s === "TOTALS" || s === "OU" || s === "O/U") return "TOTALS";
  if (s === "FLEET") return "FLEET";
  return s;
}

function assayerCanonQuarter_(v) {
  var s = assayerCanonUpper_(v);
  if (!s) return null;
  s = s.replace(/\s+/g, "");
  if (s === "ALL" || s === "ANY" || s === "UNIVERSAL") return "ALL";
  if (s === "FULL" || s === "FULLTIME" || s === "FT" || s === "GAME") return "FULL";
  var m = s.match(/^Q?([1-4])$/) || s.match(/^QUARTER([1-4])$/);
  if (m) return "Q" + m[1];
  return s;
}

function assayerCanonGender_(v) {
  var s = assayerCanonUpper_(v);
  if (!s) return null;
  if (s === "ALL" || s === "ANY" || s === "UNIVERSAL") return "ALL";
  if (s === "M" || s === "MEN" || s === "MALE") return "M";
  if (s === "W" || s === "WOMEN" || s === "FEMALE") return "W";
  return s;
}

function assayerCanonTier_(v) {
  var s = assayerCanonUpper_(v);
  if (!s) return null;
  if (s === "UNKNOWN" || s === "UNK") return "UNKNOWN";
  if (s === "EVEN") return "UNKNOWN";  // NBA "EVEN" = no tier signal → wildcard
  if (s === "TIER1" || s === "T1") return "STRONG";
  if (s === "TIER2" || s === "T2") return "MEDIUM";
  if (s === "STRONG" || s === "MEDIUM") return s;
  return s;
}

function assayerCanonSide_(v) {
  var s = assayerCanonUpper_(v);
  if (!s) return null;
  if (s === "H" || s === "HOME") return "H";
  if (s === "A" || s === "AWAY") return "A";
  return s;
}

function assayerCanonDirection_(v) {
  var s = assayerCanonUpper_(v);
  if (!s) return null;
  if (s === "OVER" || s === "O") return "OVER";
  if (s === "UNDER" || s === "U") return "UNDER";
  return s;
}

function assayerCanonBucket_(v) {
  var s = String(v == null ? "" : v).trim();
  return s ? s.replace(/\s+/g, "") : null;
}

function assayerCanonGrade_(v) {
  return assayerCanonUpper_(v);
}

/**
 * Normalize confidence to decimal [0,1].
 * Accepts: 0.62, 62, "62%", "0.62", null/undefined.
 * Returns: Number in [0,1] or null if unparseable.
 */
function assayerNormalizeConfidenceDecimal_(v) {
  if (v == null) return null;
  var s = String(v).replace(/[%\s]/g, "");
  var n = Number(s);
  if (!isFinite(n)) return null;
  if (n >= 0 && n <= 1) return n;
  if (n > 1 && n <= 100) return n / 100;
  return null;
}

/**
 * Extract a valid Google Sheets spreadsheet ID from a value that might be:
 *   - a raw ID string
 *   - a full URL (docs.google.com/spreadsheets/d/{id}/...)
 *   - a placeholder like "PASTE_ASSAYER_SHEET_ID_HERE"
 *   - empty / null
 * Returns: clean ID string, or "" if invalid.
 */
function assayerExtractSpreadsheetId_(value) {
  var s = String(value || "").trim();
  if (!s) return "";
  if (/PASTE.*SHEET.*ID.*HERE/i.test(s)) return "";

  var m = s.match(/\/d\/([a-zA-Z0-9_-]{25,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
  if (m) return m[1];

  if (/^[a-zA-Z0-9_-]{25,}$/.test(s)) return s;
  return "";
}

function assayerNormKey_(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^\w]/g, "");
}

function assayerSimplify_(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ─────────────────────────────────────────────────────────────────────────
   PATCH: Grade / gating helpers
   ───────────────────────────────────────────────────────────────────────── */

// File 4: Shared/Config Files
// 20) OPTIONAL helper: does not change behavior unless adopted in loaders

function _createBaseBetObject_(fields) {
  fields = fields || {};
  const type = String(fields.type || '').trim();
  const typeU = type.toUpperCase();

  return {
    betId: fields.betId || '',
    league: fields.league || '',
    date: fields.date || '',
    time: fields.time || null,
    match: fields.match || '',
    home: fields.home || '',
    away: fields.away || '',
    pick: fields.pick || '',
    type,
    odds: (typeof fields.odds === 'number') ? fields.odds : parseFloat(fields.odds),
    confidence: (typeof fields.confidence === 'number') ? fields.confidence : parseFloat(fields.confidence),

    isBanker: typeU.includes('BANKER'),
    isSniper: typeU.includes('SNIPER'),
    isDirectional: typeU.includes('DIR'),

    // Assayer matching dimensions (optional)
    source: fields.source || '',
    quarter: fields.quarter || null,
    isWomen: (typeof fields.isWomen === 'boolean') ? fields.isWomen : null,
    tier: fields.tier || null,
    side: fields.side || null,
    direction: fields.direction || null,
    confBucket: fields.confBucket || null,
    spreadBucket: fields.spreadBucket || null,
    lineBucket: fields.lineBucket || null
  };
}

function assayerGradeRank_(grade) {
  var g = String(grade || "").trim().toUpperCase();
  return ASSAYER_GRADE_RANK[g] || 0;
}

function assayerIsGradeAtLeast_(grade, minGrade) {
  return assayerGradeRank_(grade) >= assayerGradeRank_(minGrade);
}

function assayerBoolOrNull_(v) {
  if (v === "" || v === null || v === undefined) return null;
  if (v === true || v === false) return v;
  var s = String(v).trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "yes" || s === "y" || s === "1") return true;
  if (s === "no" || s === "n" || s === "0") return false;
  if (cfg.MIN_PURITY_GRADE) ASSAYER_BRIDGE.MIN_PURITY_GRADE = String(cfg.MIN_PURITY_GRADE).toUpperCase();
  if (cfg.UNKNOWN_LEAGUE_ACTION) ASSAYER_BRIDGE.UNKNOWN_LEAGUE_ACTION = String(cfg.UNKNOWN_LEAGUE_ACTION).toUpperCase();
  if (cfg.UNKNOWN_EDGE_ACTION) ASSAYER_BRIDGE.UNKNOWN_EDGE_ACTION = String(cfg.UNKNOWN_EDGE_ACTION).toUpperCase();
  if (cfg.REQUIRE_EDGE_RELIABLE !== undefined) ASSAYER_BRIDGE.REQUIRE_EDGE_RELIABLE = !!cfg.REQUIRE_EDGE_RELIABLE;
  return null;
}

function assayerSampleSizeKey_(v) {
  var s = String(v || "").trim().toUpperCase();
  if (!s) return "";
  // tolerate variants: "Small", "SMALL", "Small (n<...)" etc.
  if (s.indexOf("SMALL") === 0) return "SMALL";
  if (s.indexOf("MED") === 0) return "MEDIUM";
  if (s.indexOf("LARGE") === 0) return "LARGE";
  return s;
}

function assayerIsSmallSampleEdge_(edge) {
  var ss = assayerSampleSizeKey_(edge && edge.sample_size);
  if (ss === "SMALL") return true;
  // fallback heuristic if sample_size is missing but n is tiny
  var n = (edge && Number.isFinite(edge.n)) ? edge.n : null;
  if (!ss && n != null && n > 0 && n < 10) return true;
  return false;
}

function assayerEdgePassesGlobalFilters_(edge) {
  if (!edge) return false;

  var goldOnly = (ASSAYER_BRIDGE.GOLD_ONLY_MODE === true);
  var minGrade = ASSAYER_BRIDGE.MIN_EDGE_GRADE || "GOLD";

  var grade = String(edge.grade || "").trim().toUpperCase();

  // Always hard-stop toxic grades (regardless of GOLD_ONLY_MODE)
  if (grade === "ROCK" || grade === "CHARCOAL" || grade === "BRONZE") return false;

  // Hard exclude below-min grades in strict mode
  if (goldOnly && !assayerIsGradeAtLeast_(grade, minGrade)) return false;

  // Optional: require reliable===true
  if (ASSAYER_BRIDGE.REQUIRE_EDGE_RELIABLE === true) {
    if (edge.reliable !== true) return false;
  }

  // Optional: drop Small-sample edges
  if (ASSAYER_BRIDGE.DISALLOW_SMALL_SAMPLE_EDGES === true) {
    if (assayerIsSmallSampleEdge_(edge)) return false;
  }

  // Optional: mitigate wildcard / broad edges
  var minSpec = Number(ASSAYER_BRIDGE.MIN_EDGE_SPECIFICITY);
  if (isFinite(minSpec) && minSpec > 0) {
    if (assayerEdgeSpecificity_(edge) < minSpec) return false;
  }

  return true;
}

function assayerPurityPassesMinimums_(purityRow) {
  if (!purityRow) return false;

  var grade  = assayerCanonGrade_(purityRow.grade) || "";
  var status = String(purityRow.status || "").trim();

  // Always hard-stop toxic grades
  if (grade === "CHARCOAL" || grade === "ROCK" || grade === "BRONZE") return false;

  if (ASSAYER_BRIDGE.GOLD_ONLY_MODE === true) {
    var minPur = ASSAYER_BRIDGE.MIN_PURITY_GRADE || "GOLD";
    if (!assayerIsGradeAtLeast_(grade, minPur)) return false;

    if (ASSAYER_BRIDGE.STRICT_BLOCK_BUILDING_PURITY === true && status.includes("📊")) return false;
    if (ASSAYER_BRIDGE.STRICT_REQUIRE_PURITY_CHECKMARK === true && !status.includes("✅")) return false;
  }

  return true;
}

// ============================================================
// ASSAYER PROOF HELPERS — Paste anywhere above assayerIsGoldStandard_
// ============================================================

/**
 * Null-safe string coercion. Returns '∅' for empty/null/undefined.
 */
function assayerSafe_(v) {
  return (v === null || v === undefined || v === '') ? '∅' : String(v);
}

/**
 * Truncate to maxLen chars, appending '…' if clipped.
 */
function assayerTrunc_(v, maxLen) {
  var s = (v === null || v === undefined) ? '' : String(v);
  maxLen = (typeof maxLen === 'number' && maxLen > 0) ? maxLen : 120;
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + '…';
}

/**
 * Boolean → deterministic display string.
 */
function assayerFmtBool_(b) {
  if (b === true)  return 'true';
  if (b === false) return 'false';
  return '∅';
}

/**
 * Decimal (0‑1) → percentage display.  0.685 → "68.5%"
 */
function assayerFmtPct_(dec) {
  if (typeof dec !== 'number' || !isFinite(dec)) return '∅';
  return (dec * 100).toFixed(1) + '%';
}

/**
 * Decimal lift → percentage-point display.  0.032 → "+3.2pp"
 */
function assayerFmtPP_(liftDec) {
  if (typeof liftDec !== 'number' || !isFinite(liftDec)) return '∅';
  var pp = liftDec * 100;
  return (pp >= 0 ? '+' : '') + pp.toFixed(1) + 'pp';
}


// ============================================================
// assayerIsGoldStandard_  (FULL REPLACE)
//
// PASS/BLOCK logic is UNCHANGED.
// What changed:
//   1. Positive EVIDENCE recorded when a gate is satisfied
//      (so PASS bets explain WHY they qualified, not just BLOCK bets).
//   2. qualifiesFor field: GOLD_PORTFOLIO | SILVER_PORTFOLIO | PASSED_BRIDGE
//   3. proofLog includes all 4 refs (DIMS, EDGE, PURITY, GATES)
//      plus EVIDENCE + BLOCKS sections.
//   4. GOLD_ONLY_MODE enforcement state printed per-gate
//      ("ENFORCED" vs "NOT-ENFORCED") so you can spot mis-config instantly.
//   5. Hard-truncated to 3000 chars to prevent cell/log bloat.
//   6. NEW: primaryBlockReason, blockReasonCodesCsv, primaryBlockFamily
//      returned as discrete fields so downstream consumers never need
//      to parse proofLog to group by rejection reason.
// ============================================================
function assayerIsGoldStandard_(dims, bestEdge, purityRow, purityEval) {

  // ── Read bridge config ──
  var goldOnly = (ASSAYER_BRIDGE.GOLD_ONLY_MODE === true);
  var minEdge  = (ASSAYER_BRIDGE.MIN_EDGE_GRADE  || 'GOLD').toUpperCase();
  var minPur   = (ASSAYER_BRIDGE.MIN_PURITY_GRADE || 'GOLD').toUpperCase();

  var unknownLeagueAction = String(
    ASSAYER_BRIDGE.UNKNOWN_LEAGUE_ACTION || 'NEUTRAL'
  ).trim().toUpperCase();
  if (unknownLeagueAction !== 'BLOCK' && unknownLeagueAction !== 'NEUTRAL') {
    unknownLeagueAction = 'NEUTRAL';
  }

  // ── Accumulators ──
  var reasonCodes = [];   // machine-readable block codes
  var evidence    = [];   // positive proof  (why it QUALIFIES)
  var blocks      = [];   // negative proof  (why it's BLOCKED)

  function addBlock(code, msg)  { reasonCodes.push(code); blocks.push(msg); }
  function addEvidence(msg)     { evidence.push(msg); }

  var passed = true;

  var edgeGrade   = bestEdge  ? (assayerCanonGrade_(bestEdge.grade)  || '') : '';
  var purityGrade = purityRow ? (assayerCanonGrade_(purityRow.grade) || '') : '';

  var enforceLabel = goldOnly ? 'ENFORCED' : 'NOT-ENFORCED';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // EDGE GATE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!bestEdge) {
    if (String(ASSAYER_BRIDGE.UNKNOWN_EDGE_ACTION || '').toUpperCase() === 'ALLOW') {
      addEvidence('NoEdge(allowed by config)');
    } else {
      passed = false;
      addBlock('NO_EDGE', 'No edge match found in ASSAYER_EDGES');
    }

  } else {

    // Hard blocks (ALWAYS forbidden regardless of goldOnly)
    if (edgeGrade === 'ROCK' || edgeGrade === 'CHARCOAL') {
      // NOTE: User requested relaxing hard blocks.
      // We rely on grade floor now.
    }
    // Grade floor (only enforced when goldOnly=true)
    else if (goldOnly && !assayerIsGradeAtLeast_(edgeGrade, minEdge)) {
      passed = false;
      addBlock('EDGE_GRADE',
        'Edge grade ' + (edgeGrade || 'N/A') +
        ' below floor ' + minEdge + ' (' + enforceLabel + ')');
    }
    else {
      // ✅ Positive evidence — this is WHY the bet earns its place
      addEvidence(
        'Edge=' + (edgeGrade || '∅') +
        ' (floor=' + minEdge + ' ' + enforceLabel + ')'
      );
      if (bestEdge.lift != null) {
        addEvidence('Lift=' + assayerFmtPP_(bestEdge.lift));
      }
      if (bestEdge.win_rate != null) {
        addEvidence('EdgeWR=' + assayerFmtPct_(bestEdge.win_rate) +
          ' (n=' + assayerSafe_(bestEdge.n) + ')');
      }
    }

    // Reliability check
    if (ASSAYER_BRIDGE.REQUIRE_EDGE_RELIABLE === true) {
      if (bestEdge.reliable !== true) {
        passed = false;
        addBlock('EDGE_RELIABILITY', 'Edge not marked reliable');
      } else {
        addEvidence('EdgeReliable=✓');
      }
    }

    // Small-sample check
    if (ASSAYER_BRIDGE.DISALLOW_SMALL_SAMPLE_EDGES === true &&
        assayerIsSmallSampleEdge_(bestEdge)) {
      passed = false;
      addBlock('EDGE_SMALL_SAMPLE', 'Edge sample_size="Small"');
    }

    // Specificity floor
    var minSpec = Number(ASSAYER_BRIDGE.MIN_EDGE_SPECIFICITY);
    if (isFinite(minSpec) && minSpec > 0) {
      var actualSpec = assayerEdgeSpecificity_(bestEdge);
      if (actualSpec < minSpec) {
        passed = false;
        addBlock('EDGE_TOO_BROAD',
          'Specificity ' + actualSpec + ' < min ' + minSpec);
      } else {
        addEvidence('Spec=' + actualSpec + '/' + minSpec);
      }
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PURITY GATE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!purityRow) {
    if (goldOnly && unknownLeagueAction === 'BLOCK') {
      passed = false;
      addBlock('NO_PURITY',
        'No purity match (unknown league → BLOCK by config)');
    } else {
      addEvidence(
        'NoPurity(policy=' + unknownLeagueAction +
        ' goldOnly=' + goldOnly + ')'
      );
    }
  } else {
    var status = String(purityRow.status || '').trim();

    // Hard blocks (always forbidden)
    if (purityGrade === 'CHARCOAL' || purityGrade === 'ROCK') {
      // NOTE: User requested relaxing purity hard blocks.
      // We will no longer trigger PURITY_HARD_BLOCK. 
      // The grade floor (minPurity) will catch it if it's below the threshold.
    }
    // Grade floor (only enforced when goldOnly=true)
    else if (goldOnly && !assayerIsGradeAtLeast_(purityGrade, minPur)) {
      passed = false;
      addBlock('PURITY_GRADE',
        'Purity grade ' + (purityGrade || 'N/A') +
        ' below floor ' + minPur + ' (' + enforceLabel + ')');
    }
    // Strict building check
    else if (goldOnly &&
             ASSAYER_BRIDGE.STRICT_BLOCK_BUILDING_PURITY === true &&
             status.indexOf('📊') >= 0) {
      passed = false;
      addBlock('PURITY_BUILDING', 'Purity is 📊 Building (strict mode)');
    }
    // Strict checkmark check
    else if (goldOnly &&
             ASSAYER_BRIDGE.STRICT_REQUIRE_PURITY_CHECKMARK === true &&
             status.indexOf('✅') < 0) {
      passed = false;
      addBlock('PURITY_RELIABILITY', 'Purity missing ✅ (strict mode)');
    }
    else {
      // ✅ Positive evidence
      addEvidence(
        'Purity=' + (purityGrade || '∅') +
        ' (floor=' + minPur + ' ' + enforceLabel + ')'
      );
      if (purityRow.win_rate != null) {
        addEvidence('PurityWR=' + assayerFmtPct_(purityRow.win_rate) +
          ' (n=' + assayerSafe_(purityRow.n) + ')');
      }
      if (status) {
        addEvidence('PurityStatus=' + assayerTrunc_(status, 30));
      }
    }
  }

  // PurityEval override (unchanged)
  if (purityEval && purityEval.action === 'BLOCK' && passed === true) {
    passed = false;
    addBlock('PURITY_ACTION_BLOCK',
      'Purity action=BLOCK (' + (purityEval.reason || 'derived') + ')');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // VERDICT + PORTFOLIO TIER COMPUTATION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var verdict = passed ? 'PASS' : 'BLOCK';
  var action  = passed
    ? ((purityEval && purityEval.action) ? purityEval.action : 'NEUTRAL')
    : 'BLOCK';

  // Compute the highest portfolio tier this bet objectively qualifies for
  // (independent of whether GOLD_ONLY_MODE is on — this is informational)
  var qualifiesFor = '';
  if (passed) {
    var hasEdgeGrade   = (edgeGrade !== '');
    var hasPurityGrade = (purityGrade !== '');

    var meetsGoldEdge    = hasEdgeGrade   && assayerIsGradeAtLeast_(edgeGrade,   'GOLD');
    var meetsGoldPurity  = hasPurityGrade && assayerIsGradeAtLeast_(purityGrade, 'GOLD');
    var meetsSilverEdge  = hasEdgeGrade   && assayerIsGradeAtLeast_(edgeGrade,   'SILVER');
    var meetsSilverPurity= hasPurityGrade && assayerIsGradeAtLeast_(purityGrade, 'SILVER');

    if (meetsGoldEdge && meetsGoldPurity) {
      qualifiesFor = 'GOLD_PORTFOLIO';
    } else if (meetsSilverEdge && meetsSilverPurity) {
      qualifiesFor = 'SILVER_PORTFOLIO';
    } else if (meetsSilverEdge || meetsSilverPurity) {
      qualifiesFor = 'PARTIAL_SILVER';
    } else {
      qualifiesFor = 'PASSED_BRIDGE';
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PROOF LOG ASSEMBLY
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var edgeRef   = assayerFormatEdgeRef_(bestEdge);
  var purityRef = assayerFormatPurityRef_(purityRow);
  var dimsRef   = assayerFormatDimsRef_(dims);
  var gatesRef  = assayerFormatGatesRef_();

  var decisionRef =
    'DECISION{' +
      'verdict=' + verdict +
      ' action=' + action +
      ' edgeGrade=' + (edgeGrade || '∅') +
      ' purityGrade=' + (purityGrade || '∅') +
      (qualifiesFor ? (' qualifiesFor=' + qualifiesFor) : '') +
    '}';

  // Build parts array (nulls filtered out)
  var proofParts = [
    passed ? 'BRIDGE_PASS' : 'BRIDGE_BLOCK',
    qualifiesFor ? ('TIER=' + qualifiesFor) : null,
    gatesRef,
    dimsRef,
    edgeRef,
    purityRef,
    decisionRef,
    evidence.length
      ? ('EVIDENCE{' + evidence.join('; ') + '}')
      : null,
    blocks.length
      ? ('BLOCKS{' + blocks.join('; ') + '}')
      : null,
    'REASONS[' + (reasonCodes.length ? reasonCodes.join(',') : '∅') + ']'
  ];

  var proofLog = '';
  for (var pi = 0; pi < proofParts.length; pi++) {
    if (proofParts[pi]) {
      if (proofLog) proofLog += ' | ';
      proofLog += proofParts[pi];
    }
  }

  // Hard-truncate to prevent cell/log bloat
  if (proofLog.length > 3000) {
    proofLog = proofLog.slice(0, 2997) + '…';
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NEW: Discrete block-reason fields
  //
  // These allow downstream consumers (Bet_Audit writer,
  // Dropped_Performance grader, performance logs) to group
  // by rejection reason WITHOUT parsing proofLog strings.
  //
  // primaryBlockReason:  First (most specific) reason code
  //                      e.g. "PURITY_HARD_BLOCK", "NO_EDGE"
  //
  // blockReasonCodesCsv: ALL reason codes comma-joined
  //                      e.g. "EDGE_HARD_BLOCK,PURITY_GRADE"
  //
  // primaryBlockFamily:  First segment before underscore
  //                      e.g. "PURITY" from "PURITY_HARD_BLOCK"
  //                      Useful for high-level grouping
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var primaryBlockReason  = (!passed && reasonCodes.length) ? reasonCodes[0] : '';
  var blockReasonCodesCsv = reasonCodes.length ? reasonCodes.join(',') : '';
  var primaryBlockFamily  = primaryBlockReason
    ? String(primaryBlockReason).split('_')[0]
    : '';

  return {
    passed:          passed,
    blocked:         (action === 'BLOCK'),
    action:          action,
    verdict:         verdict,
    edgeGrade:       edgeGrade,
    purityGrade:     purityGrade,
    proofLog:        proofLog,
    reasonCodes:     reasonCodes,

    // Legacy field name — now guaranteed to equal primaryBlockReason
    blockReasonCode: primaryBlockReason,

    qualifiesFor:    qualifiesFor,

    // NEW: discrete fields for painless grouping in
    // performance logs, Bet_Audit, and Dropped_Performance
    primaryBlockReason:  primaryBlockReason,
    blockReasonCodesCsv: blockReasonCodesCsv,
    primaryBlockFamily:  primaryBlockFamily
  };
}


// ============================================================
// STRUCTURED REF BUILDERS
// Each produces a deterministic, human-readable reference string.
// These are stored as SEPARATE fields on every bet so portfolio
// writers can print them directly without parsing proofLog.
// ============================================================

/**
 * EDGE_REF{...} — complete fingerprint of the matched ASSAYER_EDGES row.
 * Returns 'EDGE_REF{NONE}' when no edge was matched.
 */
function assayerFormatEdgeRef_(edge) {
  if (!edge) return 'EDGE_REF{NONE}';

  var spec = (typeof assayerEdgeSpecificity_ === 'function')
    ? assayerEdgeSpecificity_(edge) : '∅';

  return (
    'EDGE_REF{' +
      'id='       + assayerSafe_(edge.edge_id) +
      ' src='     + assayerSafe_(edge.source) +
      ' pat="'    + assayerTrunc_(edge.pattern, 100) + '"' +
      ' grade='   + assayerSafe_(edge.grade) +
      ' symbol='  + assayerSafe_(edge.symbol) +
      ' lift='    + assayerFmtPP_(edge.lift) +
      ' wr='      + assayerFmtPct_(edge.win_rate) +
      ' n='       + assayerSafe_(edge.n) +
      ' w='       + assayerSafe_(edge.wins) +
      ' l='       + assayerSafe_(edge.losses) +
      ' lb='      + assayerFmtPct_(edge.lower_bound) +
      ' ub='      + assayerFmtPct_(edge.upper_bound) +
      ' reliable=' + assayerFmtBool_(edge.reliable) +
      ' sample='  + assayerSafe_(edge.sample_size) +
      ' spec='    + assayerSafe_(spec) +
      ' upd='     + assayerSafe_(edge.updated_at) +
    '}'
  );
}

/**
 * PURITY_REF{...} — complete fingerprint of the matched ASSAYER_LEAGUE_PURITY row.
 * Returns 'PURITY_REF{NONE}' when no purity row was found.
 * Always looked up, even for unsupported sources.
 */
function assayerFormatPurityRef_(purityRow) {
  if (!purityRow) return 'PURITY_REF{NONE}';

  return (
    'PURITY_REF{' +
      'league='  + assayerSafe_(purityRow.league) +
      ' src='    + assayerSafe_(purityRow.source) +
      ' q='      + assayerSafe_(purityRow.quarter) +
      ' gender=' + assayerSafe_(purityRow.gender) +
      ' tier='   + assayerSafe_(purityRow.tier) +
      ' grade='  + assayerSafe_(purityRow.grade) +
      ' status="' + assayerTrunc_(purityRow.status, 80) + '"' +
      ' wr='     + assayerFmtPct_(purityRow.win_rate) +
      ' n='      + assayerSafe_(purityRow.n) +
      ' upd='    + assayerSafe_(purityRow.updated_at) +
    '}'
  );
}

/**
 * DIMS{...} — the derived dimensions used for look-up (bet → Assayer matching).
 */
function assayerFormatDimsRef_(d) {
  d = d || {};
  return (
    'DIMS{' +
      'lg='       + assayerSafe_(d.league) +
      ' src='     + assayerSafe_(d.source) +
      ' q='       + assayerSafe_(d.quarter) +
      ' qPur='    + assayerSafe_(d.quarterPurity) +
      ' isWomen=' + assayerFmtBool_(d.isWomen) +
      ' gender='  + assayerSafe_(d.gender) +
      ' typeKey=' + assayerSafe_(d.typeKey) +
      ' tierEdge=' + assayerSafe_(d.tier) +
      ' tierPur=' + assayerSafe_(d.tierPurity) +
      ' side='    + assayerSafe_(d.side) +
      ' dir='     + assayerSafe_(d.direction) +
      ' conf='    + (typeof d.confidence === 'number' && isFinite(d.confidence)
                       ? d.confidence.toFixed(3) : '∅') +
      ' confB='   + assayerSafe_(d.conf_bucket) +
      ' spreadB=' + assayerSafe_(d.spread_bucket) +
      ' lineB='   + assayerSafe_(d.line_bucket) +
    '}'
  );
}

/**
 * GATES{...} — the active bridge configuration snapshot.
 * Surfaced per-bet so you can instantly see whether GOLD_ONLY_MODE
 * is actually enforcing the grade floors or not.
 */
function assayerFormatGatesRef_() {
  var b = ASSAYER_BRIDGE || {};
  var ula = String(b.UNKNOWN_LEAGUE_ACTION || 'NEUTRAL').trim().toUpperCase();
  if (ula !== 'BLOCK' && ula !== 'NEUTRAL') ula = 'NEUTRAL';

  return (
    'GATES{' +
      'goldOnly='        + (b.GOLD_ONLY_MODE === true) +
      ' minEdge='        + assayerSafe_((b.MIN_EDGE_GRADE || '').toUpperCase()) +
      ' minPur='         + assayerSafe_((b.MIN_PURITY_GRADE || '').toUpperCase()) +
      ' unkLeague='      + ula +
      ' reqReliable='    + (b.REQUIRE_EDGE_RELIABLE === true) +
      ' noSmallSample='  + (b.DISALLOW_SMALL_SAMPLE_EDGES === true) +
      ' minSpec='        + assayerSafe_(b.MIN_EDGE_SPECIFICITY) +
      ' strictBuilding=' + (b.STRICT_BLOCK_BUILDING_PURITY === true) +
      ' strictCheck='    + (b.STRICT_REQUIRE_PURITY_CHECKMARK === true) +
      ' tierFB='         + (b.ALLOW_TIER_FALLBACK === true) +
      ' genderFB='       + (b.ALLOW_GENDER_FALLBACK === true) +
      ' w2mFB='          + (b.ALLOW_W_TO_M_FALLBACK === true) +
    '}'
  );
}


function assayerLogDecision_(dims, verdictObj, bestEdge, purityRow) {
  try {
    var cfg = ASSAYER_BRIDGE.LOGGING || {};
    if (!cfg.ENABLED) return;

    var isReject = verdictObj && verdictObj.verdict === "BLOCK";
    if (isReject && !cfg.LOG_REJECTS) return;
    if (!isReject && !cfg.LOG_ACCEPTS) return;

    var league = dims && dims.league ? dims.league : "";
    var source = dims && dims.source ? dims.source : "";
    var q = dims && dims.quarter ? dims.quarter : "";
    var eg = verdictObj && verdictObj.edgeGrade ? verdictObj.edgeGrade : "";
    var pg = verdictObj && verdictObj.purityGrade ? verdictObj.purityGrade : "";

    var edgeId = (bestEdge && bestEdge.edge_id) ? bestEdge.edge_id : "";
    var proof = (verdictObj && verdictObj.proofLog) ? verdictObj.proofLog : "";

    Logger.log(
      "[AssayerBridge] " +
      (isReject ? "BLOCK" : "PASS") +
      " | league=" + league +
      " source=" + source +
      (q ? (" quarter=" + q) : "") +
      " | edge=" + (edgeId || "none") +
      " edgeGrade=" + (eg || "N/A") +
      " purityGrade=" + (pg || "N/A") +
      " | " + proof
    );
  } catch (e) {
    // never let logging break routing
  }
}


/* ═══════════════════════════════════════════
   CORE LOADER
   ═══════════════════════════════════════════ */

/**
 * Load edge + purity tables from the Assayer spreadsheet.
 * PATCHED: after normalising edge rows, back-fills any blank dimension columns
 *          from the edge's filters_json blob so edges are never broader than intended.
 */
function loadAssayerData_(assayerSheetId) {
  var out = {
    ok: false,
    assayerSheetId: assayerExtractSpreadsheetId_(assayerSheetId),
    edges: [],
    purity: [],
    meta: { loadedAt: new Date().toISOString() },
    error: "",
  };

  if (!out.assayerSheetId) {
    out.error = "Missing/invalid assayer_sheet_id (placeholder or empty)";
    return out;
  }

  try {
    var assayerSS = SpreadsheetApp.openById(out.assayerSheetId);

    var edgeSh = assayerSS.getSheetByName(ASSAYER_BRIDGE.EDGE_SHEET);
    if (!edgeSh) throw new Error('Missing sheet "' + ASSAYER_BRIDGE.EDGE_SHEET + '" in Assayer');

    var puritySh = assayerSS.getSheetByName(ASSAYER_BRIDGE.PURITY_SHEET);
    if (!puritySh) throw new Error('Missing sheet "' + ASSAYER_BRIDGE.PURITY_SHEET + '" in Assayer');

    out.edges  = assayerReadSheetAsObjects_(edgeSh).map(assayerNormalizeEdgeRow_);
    out.purity = assayerReadSheetAsObjects_(puritySh).map(assayerNormalizePurityRow_);

    /* ── Back-fill edge dims from filters_json ── */
    for (var ei = 0; ei < out.edges.length; ei++) {
      var edge  = out.edges[ei];
      var fjRaw = edge.filters_json || edge.filtersJson || edge.filters || "";
      if (!fjRaw || typeof fjRaw !== "string") continue;

      var fjStr = String(fjRaw).trim();
      if (!fjStr.startsWith("{")) continue;

      try {
        var fj = JSON.parse(fjStr);

        if (edge.quarter == null && fj.quarter != null) {
          edge.quarter = assayerCanonQuarter_(fj.quarter);
        }

        // BUG 1 FIX: == null guards null/undefined but NOT false
        if (edge.is_women == null && fj.isWomen != null) {
          edge.is_women = assayerBoolOrNull_(fj.isWomen);
        }

        if (edge.conf_bucket == null && fj.confBucket != null)
          edge.conf_bucket = assayerCanonBucket_(fj.confBucket);
        if (edge.spread_bucket == null && fj.spreadBucket != null)
          edge.spread_bucket = assayerCanonBucket_(fj.spreadBucket);
        if (edge.line_bucket == null && fj.lineBucket != null)
          edge.line_bucket = assayerCanonBucket_(fj.lineBucket);

        if (edge.side == null && fj.side != null)
          edge.side = assayerCanonSide_(fj.side);
        if (edge.direction == null && fj.direction != null)
          edge.direction = assayerCanonDirection_(fj.direction);
        if (edge.tier == null && fj.tier != null)
          edge.tier = assayerCanonTier_(fj.tier);
        if (edge.source == null && fj.source != null)
          edge.source = assayerCanonSource_(fj.source);
      } catch (parseErr) {
        /* skip invalid JSON silently */
      }
    }

    out.meta.assayerName = assayerSS.getName();
    out.meta.edgeCount   = out.edges.length;
    out.meta.purityCount = out.purity.length;

    out.ok = true;
    return out;

  } catch (e) {
    out.error = e.message || String(e);
    Logger.log("[AssayerBridge] loadAssayerData_ failed: " + out.error);
    return out;
  }
}


/* ═══════════════════════════════════════════
   CORE ENRICHER
   ═══════════════════════════════════════════ */

/**
 * Enrich a single bet with Assayer edge + purity data.
 * PATCHED: bets whose source is not in the Assayer edge universe (e.g. "HighQuarter")
 *          receive a neutral result with scoreDelta = 0 and no edge/purity.
 */
// ============================================================
// assayerEnrichBet_  (FULL REPLACE)
//
// What changed vs. original:
//   1. Purity is ALWAYS looked up (even for unsupported sources).
//      Criticism: "unsupported-source bets had PURITY_REF{NONE}
//      even though a purity row could be shown." — FIXED.
//
//   2. Every bet gets 6 new structured fields:
//        assayer_edge_ref      — EDGE_REF{...} or EDGE_REF{NONE}
//        assayer_purity_ref    — PURITY_REF{...} or PURITY_REF{NONE}
//        assayer_edge_pattern  — raw pattern string for display
//        assayer_purity_key    — deterministic key for grouping
//        assayer_qualifies_for — GOLD_PORTFOLIO | SILVER_PORTFOLIO | etc.
//        assayer_proof_log     — full proof (truncated to ≤3000 chars)
//
//   3. Grade and symbol are SEPARATE fields (never concatenated).
//
//   4. proofLog is never empty on PASS bets.
//
//   5. PASS/BLOCK logic is UNCHANGED — only recording changed.
// ============================================================
function assayerEnrichBet_(bet, assayerData) {

  // Shallow clone
  var clean = {};
  for (var k in bet) {
    if (Object.prototype.hasOwnProperty.call(bet, k)) clean[k] = bet[k];
  }

  // ── Defaults: always present on EVERY bet ──
  clean.assayer_edge_ref      = 'EDGE_REF{NONE}';
  clean.assayer_purity_ref    = 'PURITY_REF{NONE}';
  clean.assayer_edge_pattern  = '';
  clean.assayer_purity_key    = '';
  clean.assayer_qualifies_for = '';
  clean.assayer_edge_id       = '';
  clean.assayer_edge_grade    = '';
  clean.assayer_edge_symbol   = '';
  clean.assayer_edge_lift     = null;
  clean.assayer_edge_reliable = undefined;
  clean.assayer_purity_grade  = '';
  clean.assayer_purity_status = '';
  clean.assayer_purity_action = '';

  // NEW: always-present discrete block fields
  clean.assayer_block_reason_family    = '';
  clean.assayer_block_reason_codes_csv = '';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BRANCH A: No Assayer data → FAIL CLOSED
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (!assayerData || !assayerData.ok) {
    var errMsg = (assayerData && assayerData.error)
      ? assayerData.error : 'Assayer not loaded';

    var noDataProof =
      'BRIDGE_BLOCK | TIER=∅' +
      ' | ' + assayerFormatGatesRef_() +
      ' | ' + assayerFormatDimsRef_(null) +
      ' | EDGE_REF{NONE}' +
      ' | PURITY_REF{NONE}' +
      ' | DECISION{verdict=NO_DATA action=BLOCK edgeGrade=∅ purityGrade=∅}' +
      ' | BLOCKS{Assayer data not available: ' + assayerTrunc_(errMsg, 200) + '}' +
      ' | REASONS[NO_DATA]';

    clean.assayer = {
      ok: false,
      reason: 'Assayer load error: ' + errMsg,
      dims: null, edge: null, purity: null,
      purityAction: 'BLOCK',
      blocked: true,
      scoreDelta: ASSAYER_BRIDGE.BLOCKED_SCORE_DELTA,
      passed: false,
      verdict: 'NO_DATA',
      proofLog: noDataProof,
      edgeGrade: '',
      purityGrade: '',
      reasonCodes: ['NO_DATA'],
      blockReasonCode: 'NO_DATA',
      qualifiesFor: '',
      primaryBlockReason: 'NO_DATA',
      blockReasonCodesCsv: 'NO_DATA',
      primaryBlockFamily: 'NO'
    };

    clean.assayer_passed                = false;
    clean.assayer_verdict               = 'NO_DATA';
    clean.assayer_proof_log             = noDataProof;
    clean.assayer_block_reason_code     = 'NO_DATA';
    clean.assayer_block_reason_codes    = 'NO_DATA';
    clean.assayer_block_reason_codes_csv = 'NO_DATA';
    clean.assayer_block_reason_family   = 'NO';
    clean.assayer_purity_action         = 'BLOCK';

    return clean;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FRONT-DOOR NORMALIZATION (for dims derivation ONLY)
  // Cleans pick/type before deriving dims, restores after.
  // This is the single chokepoint — no need to patch
  // syncAllLeagues or any other ingestion path.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var _origPick = clean.pick;
  var _origType = clean.type;
  try {
    var tmp = _stripGlyphsForDims({ pick: _origPick, type: _origType });
    if (tmp && tmp._dimsPickClean != null) clean.pick = tmp._dimsPickClean;
    if (tmp && tmp._dimsTypeClean != null) clean.type = tmp._dimsTypeClean;
  } catch (e) {
    // non-fatal; proceed with originals
  }

  // ── Derive dims ──
  var dims = assayerDeriveBetDims_(clean);

  // Restore originals for downstream display / Sync_Temp writes
  clean.pick = _origPick;
  clean.type = _origType;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PURITY: ALWAYS looked up
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var purityRow = assayerLookupLeaguePurity_(dims, assayerData.purity);

  clean.assayer_purity_ref    = assayerFormatPurityRef_(purityRow);
  clean.assayer_purity_grade  = (purityRow && purityRow.grade)  || '';
  clean.assayer_purity_status = (purityRow && purityRow.status) || '';
  clean.assayer_purity_key    = purityRow
    ? ('league=' + (purityRow.league || '') +
       '|src='   + (purityRow.source || '') +
       '|q='     + (purityRow.quarter || '') +
       '|g='     + (purityRow.gender || '') +
       '|tier='  + (purityRow.tier || ''))
    : '';

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BRANCH B: Unsupported source → neutral pass-through
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var SUPPORTED_SOURCES = ['SIDE', 'TOTALS', 'FLEET'];
  if (SUPPORTED_SOURCES.indexOf(dims.source) < 0) {

    var unsupEvidence = 'Unsupported source "' + dims.source + '" — neutral pass-through';
    if (purityRow) {
      unsupEvidence += '; purity=' + (purityRow.grade || '∅') +
        ' wr=' + assayerFmtPct_(purityRow.win_rate);
    }

    var unsupProof =
      'BRIDGE_PASS | TIER=NEUTRAL_UNSUPPORTED_SOURCE' +
      ' | ' + assayerFormatGatesRef_() +
      ' | ' + assayerFormatDimsRef_(dims) +
      ' | EDGE_REF{NONE}' +
      ' | ' + clean.assayer_purity_ref +
      ' | DECISION{verdict=NEUTRAL action=NEUTRAL edgeGrade=∅' +
        ' purityGrade=' + assayerSafe_(purityRow && purityRow.grade) +
        ' qualifiesFor=NEUTRAL_UNSUPPORTED_SOURCE}' +
      ' | EVIDENCE{' + unsupEvidence + '}' +
      ' | REASONS[∅]';

    clean.assayer = {
      ok: true,
      reason: 'Neutral — unsupported source: ' + dims.source,
      dims: dims, edge: null, purity: purityRow,
      purityAction: 'NEUTRAL',
      blocked: false,
      scoreDelta: 0,
      passed: true,
      verdict: 'NEUTRAL_UNSUPPORTED_SOURCE',
      proofLog: unsupProof,
      edgeGrade: '',
      purityGrade: (purityRow && purityRow.grade) || '',
      reasonCodes: [],
      blockReasonCode: '',
      qualifiesFor: 'NEUTRAL_UNSUPPORTED_SOURCE',
      primaryBlockReason: '',
      blockReasonCodesCsv: '',
      primaryBlockFamily: ''
    };

    clean.assayer_purity_action         = 'NEUTRAL';
    clean.assayer_passed                = true;
    clean.assayer_verdict               = 'NEUTRAL_UNSUPPORTED_SOURCE';
    clean.assayer_proof_log             = unsupProof;
    clean.assayer_block_reason_code     = '';
    clean.assayer_block_reason_codes    = '';
    clean.assayer_block_reason_codes_csv = '';
    clean.assayer_block_reason_family   = '';
    clean.assayer_qualifies_for         = 'NEUTRAL_UNSUPPORTED_SOURCE';

    return clean;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // BRANCH C: Full evaluation (SIDE / TOTALS)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  var purityEval = assayerDerivePurityAction_(purityRow);
  var bestEdge   = assayerMatchBetToBestEdge_(dims, assayerData.edges);

  var edgeLiftPP = (bestEdge && typeof bestEdge.lift === 'number')
    ? (bestEdge.lift * 100) : 0;

  var purityDelta = (ASSAYER_BRIDGE.PURITY_SCORE_DELTA &&
    ASSAYER_BRIDGE.PURITY_SCORE_DELTA[purityEval.action] != null)
    ? ASSAYER_BRIDGE.PURITY_SCORE_DELTA[purityEval.action] : 0;

  // Gold Standard gate
  var verdictObj = assayerIsGoldStandard_(dims, bestEdge, purityRow, purityEval);

  var finalPurityAction = (verdictObj && verdictObj.blocked)
    ? 'BLOCK' : (purityEval.action || 'NEUTRAL');

  clean.assayer = {
    ok: true,
    reason: (verdictObj && verdictObj.blocked)
      ? (verdictObj.proofLog || 'Blocked') : '',
    dims: dims,
    edge: bestEdge,
    purity: purityRow,
    purityAction: finalPurityAction,
    blocked: finalPurityAction === 'BLOCK',
    scoreDelta: (finalPurityAction === 'BLOCK')
      ? ASSAYER_BRIDGE.BLOCKED_SCORE_DELTA
      : (edgeLiftPP + purityDelta),
    passed:          !!(verdictObj && verdictObj.passed),
    verdict:         verdictObj ? verdictObj.verdict       : 'UNKNOWN',
    proofLog:        verdictObj ? verdictObj.proofLog      : '',
    edgeGrade:       verdictObj ? verdictObj.edgeGrade     : '',
    purityGrade:     verdictObj ? verdictObj.purityGrade   : '',
    reasonCodes:     verdictObj ? (verdictObj.reasonCodes     || []) : [],
    blockReasonCode: verdictObj ? (verdictObj.blockReasonCode || '') : '',
    qualifiesFor:    verdictObj ? (verdictObj.qualifiesFor    || '') : '',

    // NEW discrete fields (propagated from assayerIsGoldStandard_)
    primaryBlockReason:  verdictObj ? (verdictObj.primaryBlockReason  || '') : '',
    blockReasonCodesCsv: verdictObj ? (verdictObj.blockReasonCodesCsv || '') : '',
    primaryBlockFamily:  verdictObj ? (verdictObj.primaryBlockFamily  || '') : ''
  };

  // Guarantee PASS never produces empty proofLog
  if (clean.assayer.passed === true &&
      (!clean.assayer.proofLog || String(clean.assayer.proofLog).trim() === '')) {
    clean.assayer.proofLog =
      'BRIDGE_PASS' +
      ' | ' + assayerFormatGatesRef_() +
      ' | ' + assayerFormatDimsRef_(dims) +
      ' | ' + assayerFormatEdgeRef_(bestEdge) +
      ' | ' + assayerFormatPurityRef_(purityRow) +
      ' | DECISION{verdict=PASS action=' + finalPurityAction + '}';
  }

  // ── Flat fields: edge ──
  clean.assayer_edge_id       = (bestEdge && bestEdge.edge_id) || '';
  clean.assayer_edge_grade    = (bestEdge && bestEdge.grade)   || '';
  clean.assayer_edge_symbol   = (bestEdge && bestEdge.symbol)  || '';
  clean.assayer_edge_lift     = (bestEdge && typeof bestEdge.lift === 'number')
    ? bestEdge.lift : null;
  clean.assayer_edge_reliable = (bestEdge && typeof bestEdge.reliable === 'boolean')
    ? bestEdge.reliable : undefined;

  // ── Flat fields: purity ──
  clean.assayer_purity_action = finalPurityAction;

  // ── Flat fields: verdict + proof ──
  clean.assayer_passed             = clean.assayer.passed;
  clean.assayer_verdict            = clean.assayer.verdict;
  clean.assayer_proof_log          = clean.assayer.proofLog;
  clean.assayer_block_reason_code  = clean.assayer.blockReasonCode || '';
  clean.assayer_block_reason_codes = (clean.assayer.reasonCodes || []).join(',');

  // NEW discrete flat fields (for Bet_Audit / perf logs)
  clean.assayer_block_reason_codes_csv = clean.assayer.blockReasonCodesCsv ||
    clean.assayer_block_reason_codes || '';
  clean.assayer_block_reason_family = clean.assayer.primaryBlockFamily || (
    clean.assayer_block_reason_code
      ? String(clean.assayer_block_reason_code).split('_')[0]
      : ''
  );

  // ── Structured refs ──
  clean.assayer_edge_ref      = assayerFormatEdgeRef_(bestEdge);
  clean.assayer_purity_ref    = assayerFormatPurityRef_(purityRow);
  clean.assayer_edge_pattern  = (bestEdge && bestEdge.pattern) || '';
  clean.assayer_qualifies_for = clean.assayer.qualifiesFor || '';

  // ── Log decision ──
  assayerLogDecision_(dims, verdictObj, bestEdge, purityRow);

  return clean;
}


/* ═══════════════════════════════════════════
   BUCKETING — EXACT boundaries per contract
   ═══════════════════════════════════════════ */

function computeConfidenceBucket_(confidenceDecimal) {
  const c = Number(confidenceDecimal);
  if (!isFinite(c)) return null;

  if (c < 0.55) return "<55%";
  if (c >= 0.55 && c <= 0.60) return "55-60%";
  if (c >= 0.601 && c <= 0.65) return "60-65%";
  if (c >= 0.651 && c <= 0.70) return "65-70%";
  if (c > 0.70) return "≥70%";
  return null;
}

function computeSpreadBucket_(spreadValue) {
  const s0 = Number(spreadValue);
  if (!isFinite(s0)) return null;
  const s = Math.abs(s0);

  if (s < 3) return "<3";
  if (s >= 3 && s <= 4) return "3-4";
  if (s >= 4.5 && s <= 5.5) return "4.5-5.5";
  if (s > 5.5 && s <= 6) return "5.5-6";
  if (s > 6 && s <= 7) return "6-7";
  if (s > 7) return ">7";
  return null;
}

function computeLineBucket_(lineValue) {
  const l = Number(lineValue);
  if (!isFinite(l)) return null;

  if (l < 35) return "<35";
  if (l >= 35 && l <= 40) return "35-40";
  if (l >= 40.01 && l <= 50) return "40-50";
  if (l >= 50.01 && l <= 60) return "50-60";
  if (l >= 60.01 && l <= 70) return "60-70";
  if (l > 70) return ">70";
  return null;
}


/* ═══════════════════════════════════════════
   EDGE MATCHING
   ═══════════════════════════════════════════ */

function assayerMatchBetToBestEdge_(dims, edges) {
  if (!dims || !edges || edges.length === 0) return null;

  var matches = [];
  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    if (!assayerEdgePassesGlobalFilters_(e)) continue;
    if (assayerBetMatchesEdge_(dims, e)) matches.push(e);
  }
  if (matches.length === 0) return null;

  matches.sort(function(a, b) {
    var sa = assayerEdgeSpecificity_(a);
    var sb = assayerEdgeSpecificity_(b);
    if (sa !== sb) return sb - sa;

    var ga = assayerGradeRank_(a.grade);
    var gb = assayerGradeRank_(b.grade);
    if (ga !== gb) return gb - ga;

    var la = (typeof a.lift === "number") ? a.lift : -999;
    var lb = (typeof b.lift === "number") ? b.lift : -999;
    if (la !== lb) return lb - la;

    var lba = (typeof a.lower_bound === "number") ? a.lower_bound : -999;
    var lbb = (typeof b.lower_bound === "number") ? b.lower_bound : -999;
    if (lba !== lbb) return lbb - lba;

    var na = (Number.isInteger(a.n) ? a.n : -1);
    var nb = (Number.isInteger(b.n) ? b.n : -1);
    return nb - na;
  });

  return matches[0] || null;
}

/**
 * Check if a bet's dimensions match an edge's filter dimensions.
 * ◄◄ PATCH: enforces type_key so SNIPER_OU_DIR bets cannot hijack
 *           SNIPER_OU_STAR edges (and vice-versa).
 */
function assayerBetMatchesEdge_(dims, edge) {
  if (!dims || !edge) return false;

  if (edge.source && dims.source && edge.source !== dims.source) return false;

  // Match flat dimensions for ALL edges (including FLEET)
  if (edge.quarter       != null && dims.quarter       !== edge.quarter)       return false;
  if (edge.is_women      != null && dims.isWomen       !== edge.is_women)      return false;
  if (edge.tier          != null && dims.tier          !== edge.tier)          return false;
  if (edge.side          != null && dims.side          !== edge.side)          return false;
  if (edge.direction     != null && dims.direction     !== edge.direction)     return false;
  if (edge.conf_bucket   != null && dims.conf_bucket   !== edge.conf_bucket)   return false;
  if (edge.spread_bucket != null && dims.spread_bucket !== edge.spread_bucket) return false;
  if (edge.line_bucket   != null && dims.line_bucket   !== edge.line_bucket)   return false;

  // Exact type match enforcement
  if (edge.type_key != null && dims.typeKey !== edge.type_key) return false;

  // If edge has cfgKey or cfgBucket stored in filters_json, match those too
  // (Currently, Assayer doesn't output cfgKey as columns, but we future-proof this)
  if (edge.cfgKey != null && dims.cfgKey !== undefined && dims.cfgKey !== edge.cfgKey) return false;
  if (edge.cfgBucket != null && dims.cfgBucket !== undefined && dims.cfgBucket !== edge.cfgBucket) return false;

  return true;
}

/**
 * Count how many filter dimensions an edge specifies.
 * ◄◄ PATCH: includes type_key so correct-market edges win tie-breaks.
 */
function assayerEdgeSpecificity_(edge) {
  var n = 0;
  if (!edge) return n;

  var keys = [
    "quarter",
    "is_women",
    "tier",
    "side",
    "direction",
    "conf_bucket",
    "spread_bucket",
    "line_bucket",
    "type_key",
    "cfgKey",
    "cfgBucket"
  ];
  for (var i = 0; i < keys.length; i++) {
    if (edge[keys[i]] != null) n++;
  }

  return n;
}

/**
 * Safe wrapper: push engine/phase config into ASSAYER_BRIDGE before enrichment.
 * ◄◄ NEW FUNCTION — prevents config desync (Breach 2).
 *
 * Call this ONCE before any _enrichBetsWithAccuracy call so Bridge
 * stamps PASS/BLOCK metadata under the correct gates.
 * No-ops safely if assayerApplyBridgeConfig_ doesn't exist.
 */
function accaEngineSyncAssayerBridgeConfig_(cfg, label) {
  label = label || 'AccaEngine';

  // ACCA_GATES_V2 override — applied at function boundary so ALL callers benefit.
  // Object.assign clones — does NOT mutate the caller's original cfg object.
  if (typeof ACCA_GATES_V2_ENABLED !== 'undefined' && ACCA_GATES_V2_ENABLED === true &&
      typeof ACCA_GATES_V2 === 'object' && ACCA_GATES_V2) {
    cfg = Object.assign({}, cfg || {}, {
      UNKNOWN_EDGE_ACTION:   ACCA_GATES_V2.UNKNOWN_EDGE_ACTION,
      MIN_EDGE_GRADE:        (cfg && cfg.MIN_EDGE_GRADE)        || 'SILVER',
      MIN_PURITY_GRADE:      (cfg && cfg.MIN_PURITY_GRADE)      || 'SILVER',
      REQUIRE_EDGE_RELIABLE: (cfg && cfg.REQUIRE_EDGE_RELIABLE) === true
    });
  }

  if (typeof assayerApplyBridgeConfig_ === 'function') {
    assayerApplyBridgeConfig_(cfg || {});
    Logger.log('[AssayerBridge] Config applied: GOLD_ONLY_MODE=' +
      (cfg && cfg.GOLD_ONLY_MODE) + ' MIN_EDGE_GRADE=' +
      (cfg && cfg.MIN_EDGE_GRADE) + ' MIN_PURITY_GRADE=' +
      (cfg && cfg.MIN_PURITY_GRADE) + ' UNKNOWN_EDGE_ACTION=' +
      (cfg && cfg.UNKNOWN_EDGE_ACTION));
  } else {
    Logger.log('[' + label + '] ⚠️ assayerApplyBridgeConfig_ not found — ' +
      'Bridge will use its own defaults. Grade metadata may be inconsistent.');
  }
}

/**
 * Stamp explicit, stable edge references onto the bet object.
 * ◄◄ NEW FUNCTION — makes it impossible for a bet to "claim" it matched
 *    an edge without carrying the proof alongside it.
 *
 * Stamps:
 *   assayer_dims_source     — what source the bet was classified as
 *   assayer_dims_type_key   — what market the bet was classified as
 *   assayer_edge_id         — the edge_id of the matched edge (or "")
 *   assayer_edge_pattern    — human-readable pattern of matched edge
 *   assayer_edge_source     — source column of matched edge
 *   assayer_edge_type_key   — type_key column of matched edge
 *
 * Safe to call even when no edge matched (blanks all edge fields).
 */
function assayerStampBetEdgeRefs_(bet) {
  if (!bet || typeof bet !== "object") return bet;

  // ── Derive dims so downstream can always see what market the bet claims ──
  var dims = null;
  try { dims = assayerDeriveBetDims_(bet); } catch (_) { dims = null; }

  bet.assayer_dims_source   = (dims && dims.source)  ? String(dims.source)  : "";
  bet.assayer_dims_type_key = (dims && dims.typeKey)  ? String(dims.typeKey) : "";

  // ── Stamp the edge the system actually matched ──
  var edge = (bet.assayer && bet.assayer.edge) ? bet.assayer.edge : null;

  bet.assayer_edge_id       = (edge && edge.edge_id)  ? String(edge.edge_id)  : "";
  bet.assayer_edge_pattern  = (edge && edge.pattern)   ? String(edge.pattern)  : "";
  bet.assayer_edge_source   = (edge && edge.source)    ? String(edge.source)   : "";
  bet.assayer_edge_type_key = (edge && edge.type_key)  ? String(edge.type_key) : "";

  return bet;
}


/* ═══════════════════════════════════════════
   LEAGUE PURITY LOOKUP + ACTION
   ═══════════════════════════════════════════ */

function assayerLookupLeaguePurity_(dims, purityRows) {
  if (!dims || !purityRows || purityRows.length === 0) return null;

  var league = assayerCanonUpper_(dims.league);
  if (!league) return null;

  var src    = assayerCanonSource_(dims.source);
  var gender = assayerCanonGender_(dims.gender);
  var tier   = assayerCanonTier_(dims.tierPurity);
  var qBet   = assayerCanonQuarter_(dims.quarterPurity);

  // 1) Collect league rows once
  var leagueRows = [];

  // EXACT MATCH FIRST
  for (var i = 0; i < purityRows.length; i++) {
    var r0 = purityRows[i];
    if (!r0 || !r0.league) continue;
    if (assayerCanonUpper_(r0.league) === league) leagueRows.push(r0);
  }

  // UNIQUE PREFIX FALLBACK (If exact match fails)
  if (leagueRows.length === 0) {
    var parts = league.split('_');
    if (parts.length > 0) {
      var prefix = parts[0] + '_';
      var fallbackRows = [];
      var matchedPrefixes = {};

      for (var i = 0; i < purityRows.length; i++) {
        var r0 = purityRows[i];
        if (!r0 || !r0.league) continue;
        var purLeague = assayerCanonUpper_(r0.league);
        if (purLeague && purLeague.indexOf(prefix) === 0) {
          fallbackRows.push(r0);
          matchedPrefixes[purLeague] = true;
        }
      }

      var uniquePrefixMatches = Object.keys(matchedPrefixes);
      if (uniquePrefixMatches.length === 1) {
        leagueRows = fallbackRows;
      }
    }
  }

  if (leagueRows.length === 0) return null;

  // 2) Parameterized filter
  function collect_(opts) {
    opts = opts || {};
    var out = [];
    var rej = { source: 0, gender: 0, tier: 0, quarter: 0 };

    for (var j = 0; j < leagueRows.length; j++) {
      var r = leagueRows[j];

      var rSource = assayerCanonSource_(r.source);
      if (rSource && src && rSource !== src) { rej.source++; continue; }

      var rGender = assayerCanonGender_(r.gender);
      if (!opts.relaxGender && rGender && gender) {
        if (rGender !== gender && rGender !== "ALL" && gender !== "ALL") {
          rej.gender++; continue;
        }
      }

      var rTier = assayerCanonTier_(r.tier);
      if (!opts.relaxTier && rTier && tier) {
        if (rTier !== tier && rTier !== "UNKNOWN") { rej.tier++; continue; }
      }

      var qRow = assayerCanonQuarter_(r.quarter);
      if (qRow && qBet) {
        if (qRow !== qBet && qRow !== "ALL" && qRow !== "FULL") {
          rej.quarter++; continue;
        }
      }

      out.push(r);
    }
    return { candidates: out, rejects: rej };
  }

  // Pass 1: strict
  var pass = collect_({ relaxTier: false, relaxGender: false });

  // Pass 2: relax tier
  if (pass.candidates.length === 0 && ASSAYER_BRIDGE.ALLOW_TIER_FALLBACK === true) {
    pass = collect_({ relaxTier: true, relaxGender: false });
  }

  // Pass 3: relax gender
  if (pass.candidates.length === 0 && ASSAYER_BRIDGE.ALLOW_GENDER_FALLBACK === true) {
    pass = collect_({ relaxTier: true, relaxGender: true });
  }

  // Pass 4: W→M last resort (OFF by default)
  if (pass.candidates.length === 0 && gender === "W" &&
      ASSAYER_BRIDGE.ALLOW_W_TO_M_FALLBACK === true) {
    gender = "M";
    pass = collect_({ relaxTier: true, relaxGender: true });
  }

  var candidates = pass.candidates;

  // Debug logging on miss
  if (candidates.length === 0) {
    if (ASSAYER_BRIDGE.PURITY_LOOKUP_DEBUG === true &&
        ASSAYER_BRIDGE.LOGGING && ASSAYER_BRIDGE.LOGGING.ENABLED === true) {
      Logger.log(
        "[AssayerBridge] Purity MISS | league=" + league +
        " source=" + (src || "N/A") +
        " gender=" + (gender || "N/A") +
        " tier=" + (tier || "N/A") +
        " quarter=" + (qBet || "N/A") +
        " | leagueRows=" + leagueRows.length +
        " rejects=" + JSON.stringify(pass.rejects)
      );
    }
    return null;
  }

  // In gold-only mode, prefer rows that pass minimums
  if (ASSAYER_BRIDGE.GOLD_ONLY_MODE === true) {
    var strict = [];
    for (var k = 0; k < candidates.length; k++) {
      if (assayerPurityPassesMinimums_(candidates[k])) strict.push(candidates[k]);
    }
    if (strict.length > 0) candidates = strict;
  }

  candidates.sort(function(a, b) {
    var sa = assayerPuritySpecificityScore_(dims, a);
    var sb = assayerPuritySpecificityScore_(dims, b);
    if (sa !== sb) return sb - sa;

    var ga = assayerGradeRank_(a.grade);
    var gb = assayerGradeRank_(b.grade);
    if (ga !== gb) return gb - ga;

    var na = Number.isFinite(a.n) ? a.n : -1;
    var nb = Number.isFinite(b.n) ? b.n : -1;
    return nb - na;
  });

  return candidates[0] || null;
}

function assayerPuritySpecificityScore_(dims, row) {
  var s = 0;

  var qRow = assayerCanonQuarter_(row.quarter);
  var qBet = assayerCanonQuarter_(dims && dims.quarterPurity);
  if (qRow === qBet)        s += 4;
  else if (qRow === "FULL") s += 2;
  else if (qRow === "ALL")  s += 1;

  var gRow = assayerCanonGender_(row.gender);
  var gBet = assayerCanonGender_(dims && dims.gender);
  if (gBet !== "ALL" && gRow === gBet) s += 3;
  else if (gRow === "ALL")             s += 1;

  var tRow = assayerCanonTier_(row.tier);
  var tBet = assayerCanonTier_(dims && dims.tierPurity);
  if (tRow === tBet)            s += 3;
  else if (tRow === "UNKNOWN")  s += 1;

  return s;
}

function assayerDerivePurityAction_(purityRow) {
  if (!purityRow) {
    if (ASSAYER_BRIDGE.GOLD_ONLY_MODE === true &&
        String(ASSAYER_BRIDGE.UNKNOWN_LEAGUE_ACTION || "").toUpperCase() === "BLOCK") {
      return { action: "BLOCK", reason: "No purity match (unknown league)" };
    }
    return { action: "NEUTRAL", reason: "No purity match" };
  }

  var grade  = assayerCanonGrade_(purityRow.grade) || "";
  var status = String(purityRow.status || "").trim();

  // Hard blocks — always, regardless of mode
  if (grade === "CHARCOAL") return { action: "BLOCK", reason: "Charcoal (hard block)" };
  if (grade === "ROCK")     return { action: "BLOCK", reason: "Rock (hard block)" };
  if (grade === "BRONZE")   return { action: "BLOCK", reason: "Bronze (hard block)" };
  if (status.includes("⛔")) return { action: "BLOCK", reason: "Avoid" };

  // Building valve
  if (status.includes("📊")) {
    if (ASSAYER_BRIDGE.GOLD_ONLY_MODE === true &&
        ASSAYER_BRIDGE.STRICT_BLOCK_BUILDING_PURITY === true) {
      return { action: "BLOCK", reason: "Building (strict mode)" };
    }
    return { action: "NEUTRAL", reason: "Building" };
  }

  if (ASSAYER_BRIDGE.GOLD_ONLY_MODE === true) {
    var minPur = ASSAYER_BRIDGE.MIN_PURITY_GRADE || "GOLD";
    if (!assayerIsGradeAtLeast_(grade, minPur))
      return { action: "BLOCK", reason: "Purity below " + minPur };
    if (ASSAYER_BRIDGE.STRICT_REQUIRE_PURITY_CHECKMARK === true && !status.includes("✅"))
      return { action: "BLOCK", reason: "Not reliable (missing ✅)" };
    return { action: "BOOST", reason: "Gold-standard purity" };
  }

  // Non-strict (legacy) — BRONZE can never reach here (hard-blocked above)
  if ((grade === "PLATINUM" || grade === "GOLD") && status.includes("✅"))
    return { action: "BOOST", reason: "Gold/Platinum Reliable" };
  if (grade === "SILVER" && status.includes("✅"))
    return { action: "NEUTRAL", reason: "Silver Reliable" };

  return { action: "NEUTRAL", reason: "Default" };
}


/**
 * Canonical source derivation for a bet.
 * Returns "HIGHQUARTER" | "TOTALS" | "SIDE"
 * HighQuarter prevents false-positive edge matching against Side/Totals edges.
 *
 * ◄◄ FIX: All pattern matching uses glyph-stripped pick/type.
 *          Prefers bet._dimsPickClean / bet._dimsTypeClean if present
 *          (from _stripGlyphsForDims), otherwise cleans inline.
 *          Prevents glyphs like ● ○ ✅ and embedded (65%) from corrupting
 *          OVER/UNDER/TOTAL regex matches or HIGHQUARTER detection.
 *
 *          Example without fix:
 *            pick = "Q1: H +5.5 ● (65%) ●"
 *            → ● chars adjacent to numbers can corrupt \b word boundaries
 *            → (65%) could false-match if line-parsing runs on same string
 *
 *          Example with fix:
 *            cleaned = "Q1: H +5.5"
 *            → clean pattern matching, correct SIDE classification
 */

// ---------------------------------------------------------------------------
// Config-profile helpers (v5.0.0 Fleet support)
// ---------------------------------------------------------------------------
function _assayerSafeParseJSON_(s) {
  if (!s || typeof s !== 'string') return {};
  var t = s.trim();
  if (!t || t === '{}') return {};
  try { return JSON.parse(t); } catch (_) { return {}; }
}

function _assayerNormalizeConfigVal_(raw) {
  if (raw === null || raw === undefined || raw === '') return undefined;
  var s = String(raw).trim();
  if (!s) return undefined;
  var u = s.toUpperCase();
  if (u === 'TRUE')  return true;
  if (u === 'FALSE') return false;
  if (/^\d+(\.\d+)?%$/.test(s)) { var p = parseFloat(s); return isFinite(p) ? p / 100 : s; }
  var n = Number(s);
  if (!isNaN(n) && isFinite(n)) return n;
  return s;
}

function _assayerFlattenConfigProfile_(obj) {
  if (!obj || typeof obj !== 'object') return {};
  var out = {};
  var sheets = Object.keys(obj);
  for (var si = 0; si < sheets.length; si++) {
    var sheet = sheets[si];
    var props  = obj[sheet];
    if (!props || typeof props !== 'object') continue;
    var pkeys = Object.keys(props);
    for (var pi = 0; pi < pkeys.length; pi++) {
      var normKey = String(pkeys[pi]).trim().replace(/\s+/g, ' ');
      if (!normKey) continue;
      out[sheet + '.' + normKey] = _assayerNormalizeConfigVal_(props[pkeys[pi]]);
    }
  }
  return out;
}

function _assayerIsThresholdKey_(keyPath) {
  return /min|max|threshold|\bev\b|expected.value|confidence|edge|tolerance/i.test(keyPath);
}

function _assayerBucketCfgValue_(keyPath, val) {
  if (val === undefined || val === null) return 'MISSING';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';

  if (/confidence/i.test(keyPath)) {
    var c = typeof val === 'number' ? val : parseFloat(val);
    if (!isFinite(c)) return 'MISSING';
    if (c > 1 && c <= 100) c = c / 100;
    // For Mothership fallback, we don't have Config_.confBuckets easily available
    // but Assayer uses default buckets:
    if (c < 0.55) return '<55%';
    if (c < 0.60) return '55-60%';
    if (c < 0.65) return '60-65%';
    if (c < 0.70) return '65-70%';
    return '>=70%';
  }

  if (/\bev\b|expected.value/i.test(keyPath)) {
    var ev = typeof val === 'number' ? val : parseFloat(val);
    if (!isFinite(ev)) return 'MISSING';
    if (ev < 0)  return '<0';
    if (ev < 2)  return '0-2';
    if (ev < 5)  return '2-5';
    if (ev < 10) return '5-10';
    return '>=10';
  }

  var nv = typeof val === 'number' ? val : Number(val);
  if (!isNaN(nv) && isFinite(nv)) {
    if (nv <= 0)  return '<=0';
    if (nv <= 1)  return '0-1';
    if (nv <= 2)  return '1-2';
    if (nv <= 5)  return '2-5';
    if (nv <= 10) return '5-10';
    return '>=10';
  }

  return String(val).trim().slice(0, 30) || 'MISSING';
}

function _assayerGetCfgFlat_(bet) {
  if (!bet._cfgFlat) {
    bet._cfgFlat = _assayerFlattenConfigProfile_(
      _assayerSafeParseJSON_((bet && bet.config_profile) ? bet.config_profile : '{}')
    );
  }
  return bet._cfgFlat;
}

// ---------------------------------------------------------------------------
function assayerDeriveBetSource_(bet) {

  // ── ◄◄ FIX: Inline cleaner (self-sufficient if _stripGlyphsForDims not called) ──
  var _srcClean = function(s) {
    s = String(s || '');
    // Remove decorative glyphs (NOT ★☆ — those are semantic for STAR detection,
    // but irrelevant for source derivation so safe to strip here too)
    s = s.replace(/[●○★☆✅⬡♦◆■□•·🔒🎯🔥📊🔴🟡🟢]/g, ' ');
    // Remove multi-char emoji
    s = s.replace(/⚠️/g, ' ');
    // Remove embedded percentages: "(65%)" or "( 65 %)"
    s = s.replace(/\(\s*\d{1,3}\s*%\s*\)/g, ' ');
    // Remove standalone percentages: "65%"
    s = s.replace(/\b\d{1,3}\s*%\b/g, ' ');
    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  };

  // ── Prefer pre-stripped fields, fall back to inline clean ──
  var typeRaw = (bet && bet._dimsTypeClean)
    ? bet._dimsTypeClean
    : _srcClean((bet && (bet.type || bet.Type)) || "");

  var pickRaw = (bet && bet._dimsPickClean)
    ? bet._dimsPickClean
    : _srcClean((bet && (bet.pick || bet.Pick)) || "");

  var type = typeRaw.toUpperCase();
  var pick = pickRaw.toUpperCase();

  // ── 1. Default: FLEET ──
  // All INTAKE__ sheets in Assayer generate Fleet edges.
  return "FLEET";
}

/* ═══════════════════════════════════════════
   BET DIMENSION DERIVATION
   ═══════════════════════════════════════════ */
/**
 * Derive all Assayer dimensions for a bet.
 *
 * ◄◄ FIX: All pattern matching uses glyph-stripped pick/type.
 *          Prefers bet._dimsPickClean / bet._dimsTypeClean if present
 *          (from _stripGlyphsForDims), otherwise cleans inline.
 *          ★☆ STAR detection still checks raw originals (semantic glyphs).
 *          Embedded percentages like (65%) stripped before parsing.
 *
 * ◄◄ PATCH: derives dims.typeKey so edge matching respects market boundaries.
 *           Uses assayerDeriveBetSource_() for source (HighQuarter safety).
 *           Detection includes ★☆ symbols + structural direction+line fallback.
 */
function assayerDeriveBetDims_(bet) {
  var leagueRaw = String((bet && bet.league) || "").trim();
  var league = leagueRaw.toUpperCase();
  if (league === "WNB") league = "WNBA";

  // ══════════════════════════════════════════════════
  // ◄◄ FIX: Glyph stripping — clean strings for pattern matching
  //
  // pickOrig / typeOrig = untouched originals (for ★☆ STAR detection only)
  // pick / typeRaw      = cleaned versions (for ALL pattern matching)
  //
  // If _stripGlyphsForDims() was called upstream, use its output.
  // Otherwise, clean inline so this function is self-sufficient.
  // ══════════════════════════════════════════════════
  var pickOrig = String((bet && bet.pick) || "");
  var typeOrig = String((bet && bet.type) || "");
  var matchRaw = String((bet && bet.match) || "");

  // Inline cleaner — used only if _dimsPickClean/_dimsTypeClean not present
  var _dimsSafeClean = function(s) {
    s = String(s || '');
    // 1. Remove decorative single-char glyphs (NOT ★☆ — those are semantic)
    s = s.replace(/[●○✅⬡♦◆■□•·🔒🎯🔥📊🔴🟡🟢]/g, ' ');
    // 2. Remove multi-char emoji
    s = s.replace(/⚠️/g, ' ');
    // 3. Remove embedded percentages: "(65%)" or "( 65 %)"
    s = s.replace(/\(\s*\d{1,3}\s*%\s*\)/g, ' ');
    // 4. Remove standalone percentages: "65%"
    s = s.replace(/\b\d{1,3}\s*%\b/g, ' ');
    // 5. Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  };

  // Prefer pre-stripped fields, fall back to inline clean
  var pick    = (bet && bet._dimsPickClean) ? bet._dimsPickClean : _dimsSafeClean(pickOrig);
  var typeRaw = (bet && bet._dimsTypeClean) ? bet._dimsTypeClean : _dimsSafeClean(typeOrig);
  var match   = matchRaw;                                 // match doesn't need cleaning

  var typeU   = typeRaw.toUpperCase();
  var pickU   = pick.toUpperCase();

  // ══════════════════════════════════════════════════
  // Standard dims derivation (now uses cleaned strings)
  // ══════════════════════════════════════════════════
  var isWomen = assayerInferIsWomen_(leagueRaw, match);
  var gender  = (isWomen === true) ? "W" : (isWomen === false) ? "M" : "ALL";

  var quarterEdgeRaw = assayerParseQuarterFromText_(pick)
                    || assayerParseQuarterFromText_(typeU)
                    || null;
  var quarterEdge   = assayerCanonQuarter_(quarterEdgeRaw);
  var quarterPurity = quarterEdge || "ALL";

  var confidenceRaw = bet ? bet.confidence : null;
  var confidence = Number(confidenceRaw);
  if (isFinite(confidence) && confidence > 1 && confidence <= 100) confidence /= 100;
  if (!isFinite(confidence)) confidence = null;
  var conf_bucket = (confidence == null) ? null : computeConfidenceBucket_(confidence);

  var source = "FLEET";

  var direction = null, line = null, line_bucket = null;
  var side = null, spread = null, spread_bucket = null;
  var typeKey = typeU;
  var cfgKey = undefined, cfgBucket = undefined;

  // Flatten config profile if available
  if (bet && bet.Config_Profile) {
    var flatCfg = _bridgeFlattenConfigProfile_(_bridgeSafeParseJSON_(bet.Config_Profile));
    if (flatCfg.cfgKey) cfgKey = flatCfg.cfgKey;
    if (flatCfg.cfgBucket) cfgBucket = flatCfg.cfgBucket;
  }

  var tierPurity = "UNKNOWN";
  if (bet && bet.tier) {
    tierPurity = String(bet.tier);
  } else {
    if (typeU.includes("TIER1") || typeU.includes("BANKER") || typeU.includes("WIN"))
      tierPurity = "STRONG";
    else if (typeU.includes("TIER2") || typeU.includes("SNIPER") || typeU.includes("QUARTER"))
      tierPurity = "MEDIUM";
  }

  tierPurity = assayerCanonTier_(tierPurity) || "UNKNOWN";
  var tierEdge = (tierPurity === "UNKNOWN") ? null : tierPurity;

  // ◄◄ PATCH END ─────────────────────────────────────────────────────────────

  return {
    league:        league,
    source:        source,
    quarter:       quarterEdge,
    quarterPurity: quarterPurity,
    isWomen:       isWomen,
    gender:        gender,
    tier:          tierEdge,
    tierPurity:    tierPurity,
    side:          side,
    direction:     direction,
    confidence:    confidence,
    conf_bucket:   assayerCanonBucket_(conf_bucket),
    spread:        spread,
    spread_bucket: assayerCanonBucket_(spread_bucket),
    line:          line,
    line_bucket:   assayerCanonBucket_(line_bucket),
    typeKey:       typeKey,                                 // ◄◄ PATCH
    cfgKey:        cfgKey,
    cfgBucket:     cfgBucket
  };
}

/**
 * Infer gender from League or Match string.
 * Priority: "Women"/"(W)"/Standalone "W" -> True.
 */
function assayerInferIsWomen_(league, matchStr) {
  const lg = String(league || "").toUpperCase();
  const m = String(matchStr || "").toUpperCase();

  // 1. Check League for explicit WOMEN indicators
  if (lg.includes("WOMEN") || lg.includes("_W")) return true;

  // PATCH: avoid false positives on compact league codes (e.g. "SW2")
  // Only treat "W" as a standalone token when surrounded by NON-alphanumerics (or string edges).
  if (/(^|[^A-Z0-9])W([^A-Z0-9]|$)/.test(lg)) return true;

  // 2. Check Match String for standalone "W" (The primary indicator per user)
  // \bW\b matches "W" at start, end, or between spaces (e.g. "Team W", "W Team", "Team W vs")
  if (/\bW\b/.test(m)) return true;
  
  // 3. Standard text indicators
  if (m.includes("WOMEN") || m.includes("(W)")) return true;

  // 4. Explicit Men indicators (Safe fallback, lower priority)
  if (m.includes("(M)") || /\bMEN\b/.test(m)) return false;

  return null; // Default/Unknown (often treated as Men/Mixed in downstream logic)
}

function assayerParseQuarterFromText_(text) {
  const s = String(text || "").toUpperCase();
  const m = s.match(/\bQ([1-4])\b/);
  if (m) return `Q${m[1]}`;
  return null;
}

function assayerParseSpreadFromText_(text) {
  var s = String(text || "");

  // Strip leading "Q1:" so the quarter digit can't be grabbed as spread
  s = s.replace(/^\s*Q[1-4]\s*:\s*/i, "");

  // Prefer explicit signed spread
  var m = s.match(/([+-]\s*\d+(?:\.\d+)?)/);
  if (m) {
    var n1 = Number(String(m[1]).replace(/\s+/g, ""));
    return isFinite(n1) ? n1 : null;
  }

  // Fallback: number after H/A/Home/Away
  m = s.match(/\b(?:H|A|HOME|AWAY)\b[^0-9+-]*([+-]?\d+(?:\.\d+)?)/i);
  if (m) {
    var n2 = Number(m[1]);
    return isFinite(n2) ? n2 : null;
  }

  return null;
}

function assayerParseTotalsPick_(pick) {
  var s = String(pick || "").toUpperCase();
  var m = s.match(/\b(OVER|UNDER)\b\s*([0-9]+(?:\.[0-9]+)?)/);
  if (!m) return null;
  return {
    direction: (m[1] === "OVER" ? "OVER" : "UNDER"),
    line: Number(m[2])
  };
}

function assayerInferSideFromPickMatch_(pick, matchStr) {
  const p = String(pick || "").toLowerCase();
  if (/\bhome\b|\b(h)\b/.test(p)) return "H";
  if (/\baway\b|\b(a)\b/.test(p)) return "A";

  const teams = assayerParseTeamsFromMatch_(matchStr);
  if (!teams) return null;

  const pNorm = assayerSimplify_(p);
  const homeNorm = assayerSimplify_(teams.home);
  const awayNorm = assayerSimplify_(teams.away);

  if (homeNorm && pNorm.includes(homeNorm)) return "H";
  if (awayNorm && pNorm.includes(awayNorm)) return "A";

  return null;
}

function assayerParseTeamsFromMatch_(matchStr) {
  const s = String(matchStr || "").trim();
  if (!s) return null;

  const patterns = [
    /(.+?)\s+vs\s+(.+)/i,
    /(.+?)\s+v\s+(.+)/i,
    /(.+?)\s+@\s+(.+)/i,
    /(.+?)\s+-\s+(.+)/i,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m) return { home: m[1].trim(), away: m[2].trim() };
  }
  return null;
}


/* ═══════════════════════════════════════════
   SHEET READING + NORMALIZATION
   ═══════════════════════════════════════════ */

function assayerReadSheetAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];

  const headers = values[0].map(h => String(h || "").trim());
  const rows = values.slice(1);

  const out = [];
  for (const r of rows) {
    const any = r.some(v => String(v || "").trim() !== "");
    if (!any) continue;

    const o = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      o[assayerNormKey_(key)] = r[i];
    }
    out.push(o);
  }
  return out;
}

/**
 * Normalize a raw ASSAYER_EDGES row into a clean edge object.
 * ◄◄ PATCH: extracts and normalizes type_key column.
 */
function assayerNormalizeEdgeRow_(r) {
  var norm = function(v) {
    if (v === "" || v === null || v === undefined) return null;
    var s = String(v).trim();
    return s ? s : null;
  };
  var upperOrNull = function(v) {                          // ◄◄ PATCH helper
    var s = norm(v);
    if (!s) return null;
    return s.toUpperCase().replace(/\s+/g, '_');
  };
  var numOrNull = function(v) {
    if (v === "" || v === null || v === undefined) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  };
  var intOrNull = function(v) {
    var n = numOrNull(v);
    return (n !== null && Number.isInteger(n)) ? n : null;
  };

  var out = {
    edge_id:       norm(r.edge_id),
    source:        assayerCanonSource_(r.source),
    pattern:       norm(r.pattern),
    discovered:    norm(r.discovered),
    updated_at:    norm(r.updated_at),

    quarter:       assayerCanonQuarter_(r.quarter),
    is_women:      assayerBoolOrNull_(r.is_women),
    tier:          assayerCanonTier_(r.tier),
    side:          assayerCanonSide_(r.side),
    direction:     assayerCanonDirection_(r.direction),
    conf_bucket:   assayerCanonBucket_(r.conf_bucket),
    spread_bucket: assayerCanonBucket_(r.spread_bucket),
    line_bucket:   assayerCanonBucket_(r.line_bucket),
    type_key:      upperOrNull(r.type_key),                // ◄◄ PATCH

    filters_json:  norm(r.filters_json),
    cfgKey:        null,
    cfgBucket:     null,

    n:             intOrNull(r.n),
    wins:          intOrNull(r.wins),
    losses:        intOrNull(r.losses),
    win_rate:      numOrNull(r.win_rate),
    lower_bound:   numOrNull(r.lower_bound),
    upper_bound:   numOrNull(r.upper_bound),
    lift:          numOrNull(r.lift),

    grade:         assayerCanonGrade_(r.grade),
    symbol:        norm(r.symbol),
    reliable:      assayerBoolOrNull_(r.reliable),
    sample_size:   norm(r.sample_size),
  };

  if (out.filters_json) {
    try {
      var parsed = JSON.parse(out.filters_json);
      if (parsed.cfgKey != null) out.cfgKey = String(parsed.cfgKey);
      if (parsed.cfgBucket != null) out.cfgBucket = String(parsed.cfgBucket);
      if (!out.type_key) {
        var t = parsed.typeKey || parsed.type;
        if (t != null) out.type_key = upperOrNull(t);
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  return out;
}

function assayerNormalizePurityRow_(r) {
  var norm = function(v) {
    if (v === "" || v === null || v === undefined) return null;
    var s = String(v).trim();
    return s ? s : null;
  };
  var numOrNull = function(v) {
    if (v === "" || v === null || v === undefined) return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  };

  return {
    league:     assayerCanonUpper_(r.league),
    quarter:    assayerCanonQuarter_(r.quarter),
    source:     assayerCanonSource_(r.source),
    gender:     assayerCanonGender_(r.gender),
    tier:       assayerCanonTier_(r.tier),
    n:          numOrNull(r.n),
    win_rate:   numOrNull(r.win_rate),
    grade:      assayerCanonGrade_(r.grade),
    status:     norm(r.status),
    updated_at: norm(r.updated_at),
  };
}


/* ═══════════════════════════════════════════
   PHASE 2 COMPATIBILITY ADAPTER
   ═══════════════════════════════════════════ */

var __ASSAYER_DATA_CACHE__ = null;

/**
 * Cached Assayer data loader.
 * Only caches successful loads (ok:true). Failed loads are not cached
 * so a Config fix mid-run can recover without script reload.
 */
function _getAssayerDataCached_() {
  if (__ASSAYER_DATA_CACHE__ && __ASSAYER_DATA_CACHE__.ok) return __ASSAYER_DATA_CACHE__;

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var id = String(getAssayerSheetIdForMother_(ss) || "").trim();
    if (!id) return null;

    var data = loadAssayerData_(id);
    if (data && data.ok) {
      __ASSAYER_DATA_CACHE__ = data;
    }
    return data;
  } catch (e) {
    Logger.log("[AssayerAdapter] _getAssayerDataCached_ error: " + e.message);
    return null;
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   PATCH: helper to expose match candidates (Phase 2 "matches" field)
   ───────────────────────────────────────────────────────────────────────── */

function assayerMatchBetToEdgesAll_(dims, edges) {
  if (!dims || !edges || edges.length === 0) return [];

  var matches = [];
  for (var i = 0; i < edges.length; i++) {
    var e = edges[i];
    if (!assayerEdgePassesGlobalFilters_(e)) continue;
    if (assayerBetMatchesEdge_(dims, e)) matches.push(e);
  }
  if (matches.length === 0) return [];

  matches.sort(function(a, b) {
    var sa = assayerEdgeSpecificity_(a);
    var sb = assayerEdgeSpecificity_(b);
    if (sa !== sb) return sb - sa;

    var ga = assayerGradeRank_(a.grade);
    var gb = assayerGradeRank_(b.grade);
    if (ga !== gb) return gb - ga;

    var la = (typeof a.lift === "number") ? a.lift : -999;
    var lb = (typeof b.lift === "number") ? b.lift : -999;
    if (la !== lb) return lb - la;

    var lba = (typeof a.lower_bound === "number") ? a.lower_bound : -999;
    var lbb = (typeof b.lower_bound === "number") ? b.lower_bound : -999;
    if (lba !== lbb) return lbb - lba;

    var na = (Number.isInteger(a.n) ? a.n : -1);
    var nb = (Number.isInteger(b.n) ? b.n : -1);
    return nb - na;
  });

  return matches;
}

/**
 * Annotate a bet for Mother policy routing.
 * Normalizes bet fields + confidence before calling Phase 1 enricher.
 * Returns: { normalizedBet, matches, bestEdge, purity }
 */
function assayerAnnotateBetForMother_(betLike, assayerData) {
  try {
    if (typeof assayerEnrichBet_ !== "function") {
      return { normalizedBet: null, matches: [], bestEdge: null, purity: null };
    }

    var b = betLike || {};

    // Normalize confidence to decimal 0..1
    var confRaw = (b.confidence != null) ? b.confidence : b.Confidence;
    var conf = Number(confRaw);
    if (isFinite(conf) && conf > 1 && conf <= 100) conf = conf / 100;
    if (!isFinite(conf)) conf = undefined;

    // Normalize keys Phase 1 expects (case-insensitive fallbacks)
    var betForAssayer = {};
    for (var k in b) { if (b.hasOwnProperty(k)) betForAssayer[k] = b[k]; }
    betForAssayer.league     = b.league  || b.League  || "";
    betForAssayer.match      = b.match   || b.Match   || b.matchup || "";
    betForAssayer.pick       = b.pick    || b.Pick    || "";
    betForAssayer.type       = b.type    || b.Type    || b.betType || "";
    betForAssayer.confidence = conf;

    var enriched = assayerEnrichBet_(betForAssayer, assayerData);
    var a = (enriched && enriched.assayer) ? enriched.assayer : null;

    var purity = (a && a.purity)
      ? { grade: a.purity.grade, status: a.purity.status, win_rate: a.purity.win_rate, n: a.purity.n, updated_at: a.purity.updated_at, motherAction: a.purityAction || "" }
      : null;

    // PATCH: populate matches (previously always [])
    var matches = [];
    if (a && a.dims && assayerData && Array.isArray(assayerData.edges)) {
      matches = assayerMatchBetToEdgesAll_(a.dims, assayerData.edges).slice(0, 12);
    }

    return {
      normalizedBet: a ? a.dims : null,
      matches: matches,
      bestEdge: a ? a.edge : null,
      purity: purity
    };
  } catch (e) {
    Logger.log("[AssayerAdapter] assayerAnnotateBetForMother_ error: " + e.message);
    return { normalizedBet: null, matches: [], bestEdge: null, purity: null };
  }
}


/* ═══════════════════════════════════════════
   PUBLIC API (no trailing underscore)
   ═══════════════════════════════════════════ */

function loadAssayerData(assayerSheetId) {
  if (typeof loadAssayerData_ !== "function") {
    throw new Error("[AssayerPublicAPI] loadAssayerData_ is not defined — is Mothership_AssayerBridge.gs loaded?");
  }
  return loadAssayerData_(assayerSheetId);
}

function assayerEnrichBet(bet, assayerData) {
  if (typeof assayerEnrichBet_ !== "function") {
    throw new Error("[AssayerPublicAPI] assayerEnrichBet_ is not defined");
  }
  return assayerEnrichBet_(bet, assayerData);
}

/**
 * computeConfidenceBucket() — public wrapper.
 * Accepts EITHER decimal (0.62) or percent (62); normalizes before bucketing.
 */
function computeConfidenceBucket(confidenceMaybePctOrDec) {
  if (typeof computeConfidenceBucket_ !== "function") {
    throw new Error("[AssayerPublicAPI] computeConfidenceBucket_ is not defined");
  }
  var dec = assayerNormalizeConfidenceDecimal_(confidenceMaybePctOrDec);
  if (dec == null) return null;
  return computeConfidenceBucket_(dec);
}

function computeSpreadBucket(spreadValue) {
  if (typeof computeSpreadBucket_ !== "function") {
    throw new Error("[AssayerPublicAPI] computeSpreadBucket_ is not defined");
  }
  return computeSpreadBucket_(spreadValue);
}

function computeLineBucket(lineValue) {
  if (typeof computeLineBucket_ !== "function") {
    throw new Error("[AssayerPublicAPI] computeLineBucket_ is not defined");
  }
  return computeLineBucket_(lineValue);
}

// Legacy aliases (some modules use these names)
function getConfidenceBucket_(v) { return computeConfidenceBucket(v); }
function getSpreadBucket_(v)     { return computeSpreadBucket(v); }
function getLineBucket_(v)       { return computeLineBucket(v); }

/**
 * matchBetToEdges(arg1, arg2)
 * Supports:
 *   matchBetToEdges(dims, edgesArray)        — Phase 2 style
 *   matchBetToEdges(betObject, assayerData)  — where assayerData.edges exists
 */
function matchBetToEdges(arg1, arg2) {
  if (typeof assayerMatchBetToBestEdge_ !== "function") {
    throw new Error("[AssayerPublicAPI] assayerMatchBetToBestEdge_ is not defined");
  }

  var edges = null;
  if (Array.isArray(arg2)) {
    edges = arg2;
  } else if (arg2 && typeof arg2 === "object" && Array.isArray(arg2.edges)) {
    edges = arg2.edges;
  }
  if (!edges || edges.length === 0) return null;

  var dims = null;
  if (arg1 && typeof arg1 === "object") {
    if ("conf_bucket" in arg1 || "spread_bucket" in arg1 || "line_bucket" in arg1) {
      dims = arg1;
    } else if (typeof assayerDeriveBetDims_ === "function") {
      dims = assayerDeriveBetDims_(arg1);
    }
  }
  if (!dims) return null;

  return assayerMatchBetToBestEdge_(dims, edges);
}

/**
 * lookupLeaguePurity(arg1, arg2)
 * Supports:
 *   lookupLeaguePurity(dims, purityArray)       — Phase 2 style
 *   lookupLeaguePurity(betObject, assayerData)  — where assayerData.purity exists
 */
function lookupLeaguePurity(arg1, arg2) {
  if (typeof assayerLookupLeaguePurity_ !== "function") {
    throw new Error("[AssayerPublicAPI] assayerLookupLeaguePurity_ is not defined");
  }

  var purity = null;
  if (Array.isArray(arg2)) {
    purity = arg2;
  } else if (arg2 && typeof arg2 === "object" && Array.isArray(arg2.purity)) {
    purity = arg2.purity;
  }
  if (!purity || purity.length === 0) return null;

  var dims = null;
  if (arg1 && typeof arg1 === "object") {
    if ("league" in arg1 && ("quarterPurity" in arg1 || "tierPurity" in arg1)) {
      dims = arg1;
    } else if (typeof assayerDeriveBetDims_ === "function") {
      dims = assayerDeriveBetDims_(arg1);
    }
  }
  if (!dims) return null;

  return assayerLookupLeaguePurity_(dims, purity);
}


/* ═══════════════════════════════════════════
   CONFIG READER
   ═══════════════════════════════════════════ */

/**
 * Read assayer_sheet_id from Mother's Config sheet.
 * Supports: column-header layout, KV-pair layout, DocumentProperties fallback.
 * Returns clean spreadsheet ID or "".
 */
function getAssayerSheetIdForMother_(ss) {
  try {
    // (1) DocumentProperties fallback
    try {
      var dp = PropertiesService.getDocumentProperties();
      var dpVal = String(dp.getProperty("ASSAYER_SHEET_ID") || dp.getProperty("assayer_sheet_id") || "").trim();
      var dpId = assayerExtractSpreadsheetId_(dpVal);
      if (dpId) return dpId;
    } catch (e) { /* ignore */ }

    var sh = ss.getSheetByName("Config");
    if (!sh) return "";

    var lr = sh.getLastRow();
    var lc = sh.getLastColumn();
    if (lr < 1 || lc < 1) return "";

    var rowsToRead = Math.min(60, lr);
    var colsToRead = Math.min(12, lc);
    var grid = sh.getRange(1, 1, rowsToRead, colsToRead).getValues();

    // (2) Column-header layout: row 1 has headers
    var headers = grid[0].map(function(h) { return String(h); });
    var idx = -1;
    for (var h = 0; h < headers.length; h++) {
      if (assayerNormKey_(headers[h]) === "assayer_sheet_id") { idx = h; break; }
    }
    if (idx >= 0) {
      for (var r = 1; r < grid.length; r++) {
        var id = assayerExtractSpreadsheetId_(grid[r][idx]);
        if (id) return id;
      }
    }

    // (3) KV-pair layout: col A = key, col B = value
    if (colsToRead >= 2) {
      for (var i = 0; i < grid.length; i++) {
        if (assayerNormKey_(grid[i][0]) === "assayer_sheet_id") {
          var id2 = assayerExtractSpreadsheetId_(grid[i][1]);
          if (id2) return id2;
        }
      }
    }

    // (4) Loose scan: any cell matching key, right-adjacent = value
    for (var r2 = 0; r2 < grid.length; r2++) {
      for (var c = 0; c < grid[r2].length - 1; c++) {
        if (assayerNormKey_(grid[r2][c]) === "assayer_sheet_id") {
          var id3 = assayerExtractSpreadsheetId_(grid[r2][c + 1]);
          if (id3) return id3;
        }
      }
    }

    return "";
  } catch (e) {
    Logger.log("[AssayerBridge] getAssayerSheetIdForMother_ error: " + e.message);
    return "";
  }
}
