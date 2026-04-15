/**
 * UNIFIED INTEGRATION AUDIT — consolidated.v5 (ASSAYER→MOTHER CONTRACT)
 *
 * Changes from v4:
 *   ✅ Contract updated: ASSAYER_EDGES (25 cols) + ASSAYER_LEAGUE_PURITY (10 cols)
 *   ✅ Type validation: decimal ranges, boolean, enum, JSON, integer, math sanity
 *   ✅ Legacy detection: flags old Edge_Output as needing migration
 *   ✅ Both contract sheets validated on Assayer self-check + Mother remote check
 *   ✅ Contract output shows full two-sheet schema with column notes
 *   ✅ Fingerprinting detects ASSAYER_EDGES / ASSAYER_LEAGUE_PURITY sheet names
 */

/* ==========================================================
   CONSTANTS
   ========================================================== */

const SYS_AUDIT = {
  VERSION: "2026-02-14.consolidated.v5",

  REPORT_SHEET:   "SYS_Audit_Report",
  SUMMARY_SHEET:  "SYS_Audit_Summary",
  CONTRACT_SHEET: "SYS_Data_Contract",
  MAP_SHEET:      "SYS_System_Map",

  MAX_SHEET_LIST:   600,
  MAX_HEADER_COLS:  60,
  MAX_SAMPLE_ROWS:  5,

  DEFAULT_SAT_CHECK_LIMIT: 3,
  DEFAULT_STALE_HOURS:     24,

  AUTO_CACHE_ROLE:          true,
  ROLE_CONFIDENCE_TO_CACHE: 0.80,

  // ── v5: type-validation sample depth ──
  TYPE_CHECK_ROWS: 3,
};

const HEADER_SCAN = {
  MAX_ROWS:          15,
  TITLE_MAX_CELLS:   2,
  PARENT_FILL_RATIO: 0.70,
  SHORT_TEXT:        25,
  MED_TEXT:          50,
};

// ── v5: complete contract rewrite ──────────────────────────────────────────
const SYS_CONTRACT = {

  // ── ASSAYER → MOTHER: Edge catalog ──
  EDGE_SHEET_NAME: "ASSAYER_EDGES",
  EDGE_REQUIRED_COLS: [
    "edge_id","source","pattern","discovered","updated_at",
    "quarter","is_women","tier","side","direction",
    "conf_bucket","spread_bucket","line_bucket",
    "filters_json",
    "n","wins","losses","win_rate","lower_bound","upper_bound","lift",
    "grade","symbol","reliable","sample_size"
  ],
  // Subset used for fast sheet fingerprinting (role detection)
  EDGE_FINGERPRINT: ["edge_id","filters_json","win_rate","grade","lift"],

  // ── ASSAYER → MOTHER: League purity ──
  LEAGUE_PURITY_SHEET_NAME: "ASSAYER_LEAGUE_PURITY",
  LEAGUE_PURITY_REQUIRED_COLS: [
    "league","quarter","source","gender","tier",
    "n","win_rate","grade","status","updated_at"
  ],
  LEAGUE_PURITY_FINGERPRINT: ["league","gender","tier","win_rate","status"],

  // ── Legacy sheet name (v4 contract, pre-migration) ──
  LEGACY_EDGE_SHEET: "Edge_Output",

  // ── Enum constraints for type validation ──
  VALID_GRADES:       ["PLATINUM","GOLD","SILVER","BRONZE","ROCK","CHARCOAL"],
  VALID_SAMPLE_SIZES: ["Small","Medium","Large"],
  VALID_SOURCES:      ["Side","Totals"],
  VALID_QUARTERS_EDGE:   ["Q1","Q2","Q3","Q4"],          // edges use Q-prefix
  VALID_QUARTERS_LEAGUE: ["All","Full","Q1","Q2","Q3","Q4"], // purity uses All/Full/Q-prefix
  VALID_SIDES:        ["H","A"],
  VALID_DIRECTIONS:   ["Over","Under"],
  VALID_GENDERS:      ["M","W","All"],

  // ── GOLIDE → MOTHER: Upcoming (unchanged from v4) ──
  UPCOMING_SHEET_NAME:      "UpcomingClean",
  UPCOMING_REQUIRED_COLS:   ["league","home","away"],
  UPCOMING_RECOMMENDED_COLS:["date","time","odds_home","odds_away","confidence"],
  UPCOMING_EXTRA_COLS: ["date","time","odds_home","odds_away","confidence"],
  UPCOMING_EXTRA_MIN:  2,

  // ── Satellite index (unchanged) ──
  SAT_INDEX_SHEET: "Satellite_Index",
  SAT_ID_COL:      "sheet_id",
  SAT_ENABLED_COL: "enabled",
  SAT_LEAGUE_COL:  "league",
};


/* ==========================================================
   MAIN
   ========================================================== */

function runUnifiedAudit() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const F   = [];
  const now = new Date().toISOString();
  const add = (sev, cat, item, detail) =>
    F.push([now, sev, cat, item, String(detail ?? "")]);

  const sheets     = ss.getSheets().slice(0, SYS_AUDIT.MAX_SHEET_LIST);
  const sheetInfos = buildSheetInfos_(sheets, add);

  const roleResult = resolveRole_(ss, sheetInfos, add);

  add("INFO","meta","audit_version",    SYS_AUDIT.VERSION);
  add("INFO","meta","system_role",      roleResult.role);
  add("INFO","meta","detected_by",      roleResult.detectedBy);
  add("INFO","meta","confidence",       (roleResult.confidence*100).toFixed(0)+"%");
  add("INFO","meta","spreadsheet_name", ss.getName());
  add("INFO","meta","spreadsheet_id",   ss.getId());
  add("INFO","meta","timezone",         ss.getSpreadsheetTimeZone());
  add("INFO","meta","locale",           safeCall_(()=>ss.getSpreadsheetLocale(),"unknown"));

  add("INFO","sheets","total_count", sheets.length);
  sheetInfos.forEach(si => {
    const dataRows = Math.max(0, si.lastRow - si.dataStartRow + 1);
    add("INFO","sheets","dimensions",
      `${si.name} :: ${dataRows} data rows × ${si.lastCol} cols`);
    add("INFO","sheets","header_detection",
      `${si.name} :: headers in row ${si.headerRow}`
      + (si.hasParentRow ? ` (parent group row ${si.headerRow-1})` : "")
      + ` | ${si.headers.filter(Boolean).length} cols detected`
      + (si.headerRow > 1 ? ` (skipped ${si.headerRow-1} title/banner row${si.headerRow>2?"s":""})`:""));
  });

  const cfgLoad = loadConfigSmart_(ss, roleResult.role, add);
  const cfg     = cfgLoad.cfg;
  const cfgNorm = cfgLoad.cfgNorm;

  const contract = resolveContract_(cfg, cfgNorm);

  runRoleChecks_(roleResult.role, { ss, sheets, sheetInfos, cfg, cfgNorm, contract, add });

  const summary = summarize_(F);
  writeReport_(ss, F, summary);
  writeDataContract_(ss, roleResult, contract);
  writeSystemMap_(ss, roleResult, F, summary, contract);

  Logger.log("Audit complete: " + JSON.stringify(summary, null, 2));
  return summary;
}


/* ==========================================================
   DEEP HEADER DISCOVERY  (unchanged from v4)
   ========================================================== */

function discoverHeaders_(sheet) {
  const lc = Math.min(SYS_AUDIT.MAX_HEADER_COLS, sheet.getLastColumn());
  const lr = sheet.getLastRow();
  const empty = {
    headerRow:1, headers:[], headersRaw:[], headersAll:[], headerNorm:[],
    headerNormSet:new Set(), dataStartRow:2, hasParentRow:false, dataWidth:0
  };
  if (lc <= 0 || lr <= 0) return empty;

  const scanRows = Math.min(HEADER_SCAN.MAX_ROWS, lr);
  const grid     = sheet.getRange(1, 1, scanRows, lc).getValues();

  let dataWidth = 0;
  for (const row of grid) {
    for (let c = row.length - 1; c >= 0; c--) {
      if (!isBlank_(row[c])) { dataWidth = Math.max(dataWidth, c + 1); break; }
    }
  }
  if (dataWidth === 0) return empty;

  const frozenRows = safeCall_(() => sheet.getFrozenRows(), 0);

  let bestScore = -Infinity;
  let bestIdx   = 0;

  for (let r = 0; r < grid.length; r++) {
    const nextRow = (r + 1 < grid.length) ? grid[r + 1] : null;
    const score   = scoreRowAsHeader_(grid[r], dataWidth, frozenRows, r, nextRow);
    if (score > bestScore) { bestScore = score; bestIdx = r; }
  }

  const bestRow   = grid[bestIdx].slice(0, dataWidth);
  const bestFill  = bestRow.filter(v => !isBlank_(v));
  const numericCt = bestFill.filter(v => typeof v === "number" || v instanceof Date).length;
  if (bestFill.length > 0 && numericCt / bestFill.length > 0.6) {
    bestIdx = 0;
  }

  let headersRaw = grid[bestIdx].slice(0, dataWidth).map(v => String(v ?? "").trim());

  let hasParentRow = false;
  let headersComposite = headersRaw.slice();

  if (bestIdx > 0) {
    const parentRow   = grid[bestIdx - 1].slice(0, dataWidth);
    const parentFill  = parentRow.filter(v => !isBlank_(v)).length;
    const childFill   = headersRaw.filter(v => v !== "").length;
    if (parentFill > 0 && parentFill < childFill * HEADER_SCAN.PARENT_FILL_RATIO) {
      hasParentRow    = true;
      headersComposite = buildCompositeHeaders_(parentRow, headersRaw, dataWidth);
    }
  }

  const headersAllSet = new Set();
  headersRaw.forEach(h       => { if (h) headersAllSet.add(h); });
  headersComposite.forEach(h => { if (h) headersAllSet.add(h); });
  const headersAll = Array.from(headersAllSet);

  const headerNorm    = headersAll.map(normKey_).filter(Boolean);
  const headerNormSet = new Set(headerNorm);

  return {
    headerRow:     bestIdx + 1,
    headers:       headersComposite,
    headersRaw,
    headersAll,
    headerNorm,
    headerNormSet,
    dataStartRow:  bestIdx + 2,
    hasParentRow,
    dataWidth,
  };
}

function scoreRowAsHeader_(row, dataWidth, frozenRows, rowIndex, nextRow) {
  const cells    = row.slice(0, dataWidth);
  const filled   = cells.filter(v => !isBlank_(v));
  const fillCt   = filled.length;
  if (fillCt === 0) return -100;

  const textCells = filled.filter(v => typeof v === "string");
  const textCt    = textCells.length;
  const numCt     = filled.filter(v => typeof v === "number" || v instanceof Date).length;
  const textRatio = textCt / fillCt;
  const fillRatio = fillCt / Math.max(dataWidth, 1);
  const avgLen    = textCells.length > 0
    ? textCells.reduce((s, v) => s + v.length, 0) / textCells.length : 999;
  const uniq      = new Set(filled.map(v => String(v).toLowerCase().trim()));
  const uniqRatio = uniq.size / fillCt;

  let score = 0;
  score += textRatio * 35;
  score += fillRatio * 25;
  if      (avgLen <= HEADER_SCAN.SHORT_TEXT) score += 20;
  else if (avgLen <= HEADER_SCAN.MED_TEXT)   score += 10;
  score += uniqRatio * 15;
  if (fillCt <= HEADER_SCAN.TITLE_MAX_CELLS && dataWidth > 4) score -= 40;
  if (numCt / fillCt > 0.5) score -= 30;
  if (frozenRows > 0 && (rowIndex + 1) === frozenRows) score += 12;
  if (frozenRows > 0 && (rowIndex + 1) === frozenRows + 1 && rowIndex > 0) score += 5;
  if (nextRow) {
    const nxt    = nextRow.slice(0, dataWidth).filter(v => !isBlank_(v));
    const nxtNum = nxt.filter(v => typeof v === "number" || v instanceof Date).length;
    if (nxt.length > 0 && nxtNum / nxt.length > 0.25) score += 10;
  }
  return score;
}

function buildCompositeHeaders_(parentRow, childHeaders, dataWidth) {
  const parentLabels = parentRow.map(v => String(v ?? "").trim());
  const result       = childHeaders.slice();
  let currentParent = "";
  for (let c = 0; c < dataWidth; c++) {
    if (parentLabels[c]) currentParent = parentLabels[c];
    if (result[c] && currentParent) {
      if (normKey_(currentParent) !== normKey_(result[c])) {
        result[c] = currentParent + "_" + result[c];
      }
    }
  }
  return result;
}


/* ==========================================================
   SHEET INFO BUILDING  (unchanged)
   ========================================================== */

function buildSheetInfos_(sheets, add) {
  return sheets.map(sh => {
    const name = sh.getName();
    const disc = discoverHeaders_(sh);
    return {
      name,
      headerRow:     disc.headerRow,
      headers:       disc.headers,
      headersRaw:    disc.headersRaw,
      headersAll:    disc.headersAll,
      headerNorm:    disc.headerNorm,
      headerNormSet: disc.headerNormSet,
      dataStartRow:  disc.dataStartRow,
      hasParentRow:  disc.hasParentRow,
      dataWidth:     disc.dataWidth,
      lastRow:       sh.getLastRow(),
      lastCol:       sh.getLastColumn(),
    };
  });
}


/* ==========================================================
   ROLE RESOLUTION  (unchanged framework)
   ========================================================== */

function resolveRole_(ss, sheetInfos, add) {
  const dp       = safeGetDocumentProperties_();
  const explicit = dp ? (dp.getProperty("SYSTEM_ROLE") || "").toUpperCase().trim() : "";
  if (["MOTHER","ASSAYER","GOLIDE"].includes(explicit)) {
    return { role: explicit, confidence: 1.0, detectedBy: "SYSTEM_ROLE property (override)" };
  }

  const infer = inferRoleFromFingerprints_(sheetInfos);

  if (SYS_AUDIT.AUTO_CACHE_ROLE && dp && infer.confidence >= SYS_AUDIT.ROLE_CONFIDENCE_TO_CACHE) {
    dp.setProperty("SYSTEM_ROLE", infer.role);
    add("INFO","meta","role_cached",
      `SYSTEM_ROLE set to ${infer.role} (confidence ${Math.round(infer.confidence*100)}%)`);
  } else if (!dp) {
    add("INFO","meta","role_cache_skipped","DocumentProperties unavailable");
  }

  if (infer.role === "GENERIC") {
    add("WARN","meta","role_uncertain",
      "Role inference inconclusive. Audit runs in GENERIC mode.");
  }
  return infer;
}


/* ==========================================================
   ROLE FINGERPRINT INFERENCE  ── v5: updated for new contract ──
   ========================================================== */

function inferRoleFromFingerprints_(sheetInfos) {
  const edgeFP   = new Set(SYS_CONTRACT.EDGE_FINGERPRINT.map(normKey_));
  const purityFP = new Set(SYS_CONTRACT.LEAGUE_PURITY_FINGERPRINT.map(normKey_));
  const upReq    = new Set(SYS_CONTRACT.UPCOMING_REQUIRED_COLS.map(normKey_));
  const upExtra  = SYS_CONTRACT.UPCOMING_EXTRA_COLS.map(normKey_);

  const names = new Set(sheetInfos.map(s => s.name));

  let edgeSheetNameHit   = false;
  let puritySheetNameHit = false;
  let edgeColHit         = null;
  let purityColHit       = null;
  let upcomingHit        = null;
  let satIndexHit        = null;
  let legacyEdgeHit      = false;

  let maCount        = 0;
  let hasSide        = names.has("Side");
  let hasTotals      = names.has("Totals");
  let hasRawH2H      = false;
  let hasAccaPort    = names.has("Acca_Portfolio");
  let hasUpName      = names.has(SYS_CONTRACT.UPCOMING_SHEET_NAME);

  // ── v5: detect contract sheet names directly ──
  if (names.has(SYS_CONTRACT.EDGE_SHEET_NAME))          edgeSheetNameHit   = true;
  if (names.has(SYS_CONTRACT.LEAGUE_PURITY_SHEET_NAME)) puritySheetNameHit = true;
  if (names.has(SYS_CONTRACT.LEGACY_EDGE_SHEET))        legacyEdgeHit      = true;

  for (const info of sheetInfos) {
    const H = info.headerNormSet;

    // ── v5: edge column fingerprint ──
    if (!edgeColHit && isSuperset_(H, edgeFP)) {
      edgeColHit = { sheet: info.name };
    }

    // ── v5: league purity column fingerprint ──
    if (!purityColHit && isSuperset_(H, purityFP)) {
      purityColHit = { sheet: info.name };
    }

    // Upcoming: strict (unchanged)
    if (!upcomingHit && isSuperset_(H, upReq)) {
      const extraCount = countInSet_(H, upExtra);
      if (extraCount >= SYS_CONTRACT.UPCOMING_EXTRA_MIN) {
        upcomingHit = { sheet: info.name, extraCount };
      }
    }

    // Satellite_Index shape (unchanged)
    if (!satIndexHit) {
      const hasId = H.has(normKey_(SYS_CONTRACT.SAT_ID_COL));
      const hasEn = H.has(normKey_(SYS_CONTRACT.SAT_ENABLED_COL));
      const hasLg = H.has(normKey_(SYS_CONTRACT.SAT_LEAGUE_COL));
      if (hasId && (hasEn || hasLg)) satIndexHit = { sheet: info.name };
    }

    if ((info.name || "").startsWith("MA_")) maCount++;
    if (/^RawH2H_\d+$/.test(info.name || "")) hasRawH2H = true;
  }

  // ── scoring ──
  let sM = 0, sA = 0, sG = 0;
  const why = [];

  // ── v5: ASSAYER signals (updated) ──
  if (edgeSheetNameHit && puritySheetNameHit) {
    sA += 200; why.push("ASSAYER_EDGES + ASSAYER_LEAGUE_PURITY sheets");
  } else if (edgeSheetNameHit) {
    sA += 150; why.push("ASSAYER_EDGES sheet");
  } else if (puritySheetNameHit) {
    sA += 100; why.push("ASSAYER_LEAGUE_PURITY sheet");
  }
  if (edgeColHit)        { sA += 80;  why.push(`Edge col signature: ${edgeColHit.sheet}`); }
  if (purityColHit)      { sA += 40;  why.push(`Purity col signature: ${purityColHit.sheet}`); }
  if (legacyEdgeHit)     { sA += 30;  why.push("Legacy Edge_Output (needs migration)"); }
  if (maCount >= 3)      { sA += 120; why.push(`MA_* sheets (${maCount})`); }
  else if (maCount >= 1) { sA += 30;  why.push(`MA_* sheets (${maCount})`); }
  if (hasSide)           { sA += 15;  why.push("Side"); }
  if (hasTotals)         { sA += 15;  why.push("Totals"); }

  // GOLIDE signals (unchanged)
  if (hasRawH2H)         { sG += 120; why.push("RawH2H_N pattern"); }
  if (hasUpName)         { sG += 110; why.push(`${SYS_CONTRACT.UPCOMING_SHEET_NAME} sheet exists`); }
  if (upcomingHit)       { sG += 70;  why.push(`Upcoming-strong headers: ${upcomingHit.sheet}`); }

  // MOTHER signals (unchanged)
  if (hasAccaPort)       { sM += 120; why.push("Acca_Portfolio"); }
  if (satIndexHit)       { sM += 90;  why.push(`Satellite_Index shape: ${satIndexHit.sheet}`); }
  if (edgeSheetNameHit && upcomingHit) { sM += 60; why.push("both Edge+Upcoming (orchestrator)"); }

  const scores = [
    { role: "MOTHER",  score: sM },
    { role: "ASSAYER", score: sA },
    { role: "GOLIDE",  score: sG },
  ].sort((a,b) => b.score - a.score);

  const top = scores[0], second = scores[1];
  if (top.score === 0) {
    return { role: "GENERIC", confidence: 0.0, detectedBy: "no fingerprints matched" };
  }

  const confidence = clamp_((top.score - second.score) / Math.max(1, top.score), 0, 1);

  // Guardrail: MA_* dominant → never misclassify as GOLIDE
  if (top.role === "GOLIDE" && maCount >= 3 && !hasUpName && !hasRawH2H) {
    return {
      role: "ASSAYER",
      confidence: Math.max(confidence, 0.85),
      detectedBy: "guardrail: MA_* dominant | " + why.slice(0,3).join(" | "),
    };
  }

  return {
    role: top.role,
    confidence,
    detectedBy: "deep-scan fingerprints: " + why.slice(0,5).join(" | "),
  };
}


/* ==========================================================
   CONFIG  (unchanged)
   ========================================================== */

function loadConfigSmart_(ss, role, add) {
  const candidates = ["Config_Tier2", "Config", "Settings"];
  for (const name of candidates) {
    const sh = ss.getSheetByName(name);
    if (sh) {
      add("OK","config","config_sheet_found", name);
      return parseConfigSheet_(sh, add);
    }
  }
  add("WARN","config","config_sheet_missing",
    `Tried: ${candidates.join(", ")} (continuing without config)`);
  return { cfg:{}, cfgNorm:{} };
}

function parseConfigSheet_(sheet, add) {
  const lr = sheet.getLastRow();
  const lc = sheet.getLastColumn();
  if (lr < 1 || lc < 1) {
    add("WARN","config","config_sheet_empty", sheet.getName());
    return { cfg:{}, cfgNorm:{} };
  }

  const rowsToRead = Math.min(50, lr);
  const colsToRead = Math.min(10, lc);
  const grid = sheet.getRange(1,1, rowsToRead, colsToRead).getValues();

  const h0 = normKey_(grid[0][0]);
  const h1 = normKey_(grid[0][1]);
  const looksKV = (h0==="key"&&h1==="value") || (h0==="config"&&h1==="value");

  let cfg = {};
  if (lc <= 2 || looksKV) {
    cfg = readConfigKV_(sheet);
    add("INFO","config","config_format","key-value (A=key, B=value)");
  } else {
    cfg = readConfigKV_(sheet);
    if (Object.keys(cfg).length < 2) {
      cfg = readConfigRowBased_(sheet);
      add("INFO","config","config_format","row-based (headers in row 1)");
    } else {
      const rowCfg = readConfigRowBased_(sheet);
      Object.keys(rowCfg).forEach(k => { if (cfg[k] === undefined) cfg[k] = rowCfg[k]; });
      add("INFO","config","config_format","hybrid (KV + row-based supplement)");
    }
  }

  add("INFO","config","config_key_count", Object.keys(cfg).length);
  const cfgNorm = {};
  Object.keys(cfg).forEach(k => { cfgNorm[normKey_(k)] = cfg[k]; });
  return { cfg, cfgNorm };
}

function readConfigKV_(sheet) {
  const lr = sheet.getLastRow();
  if (lr < 1) return {};
  const data = sheet.getRange(1,1, lr, Math.max(2, sheet.getLastColumn())).getValues();
  const out = {};
  let start = 0;
  const h0 = normKey_(data[0][0]), h1 = normKey_(data[0][1]);
  if ((h0==="key"&&h1==="value")||(h0==="config"&&h1==="value")) start = 1;
  for (let i = start; i < data.length; i++) {
    const k = String(data[i][0] || "").trim();
    if (k) out[k] = data[i][1];
  }
  return out;
}

function readConfigRowBased_(sheet) {
  const lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 2 || lc < 1) return {};
  const headers = sheet.getRange(1,1,1,lc).getValues()[0].map(v => String(v||"").trim());
  const data    = sheet.getRange(2,1, lr-1, lc).getValues();
  const out = {};
  for (let r = data.length - 1; r >= 0; r--) {
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c];
      if (h && out[h] === undefined && !isBlank_(data[r][c])) out[h] = data[r][c];
    }
  }
  return out;
}


/* ==========================================================
   CONTRACT RESOLUTION  ── v5: adds league purity fields ──
   ========================================================== */

function resolveContract_(cfg, cfgNorm) {
  const c = {
    // ── v5: Assayer → Mother (two sheets) ──
    EDGE_SHEET_NAME:             SYS_CONTRACT.EDGE_SHEET_NAME,
    EDGE_REQUIRED_COLS:          SYS_CONTRACT.EDGE_REQUIRED_COLS.slice(),
    LEAGUE_PURITY_SHEET_NAME:    SYS_CONTRACT.LEAGUE_PURITY_SHEET_NAME,
    LEAGUE_PURITY_REQUIRED_COLS: SYS_CONTRACT.LEAGUE_PURITY_REQUIRED_COLS.slice(),

    // Golide → Mother (unchanged)
    UPCOMING_SHEET_NAME:      SYS_CONTRACT.UPCOMING_SHEET_NAME,
    UPCOMING_REQUIRED_COLS:   SYS_CONTRACT.UPCOMING_REQUIRED_COLS.slice(),
    UPCOMING_RECOMMENDED_COLS:SYS_CONTRACT.UPCOMING_RECOMMENDED_COLS.slice(),

    // Satellites (unchanged)
    SAT_INDEX_SHEET: SYS_CONTRACT.SAT_INDEX_SHEET,
    SAT_ID_COL:      SYS_CONTRACT.SAT_ID_COL,
    SAT_ENABLED_COL: SYS_CONTRACT.SAT_ENABLED_COL,
    SAT_LEAGUE_COL:  SYS_CONTRACT.SAT_LEAGUE_COL,

    STALE_HOURS:     SYS_AUDIT.DEFAULT_STALE_HOURS,
    SAT_CHECK_LIMIT: SYS_AUDIT.DEFAULT_SAT_CHECK_LIMIT,
  };

  // Config overrides (string fields)
  const strMap = {
    edge_sheet_name:           "EDGE_SHEET_NAME",
    league_purity_sheet_name:  "LEAGUE_PURITY_SHEET_NAME",
    upcoming_sheet_name:       "UPCOMING_SHEET_NAME",
    satellite_index_sheet:     "SAT_INDEX_SHEET",
    satellite_id_col:          "SAT_ID_COL",
    satellite_enabled_col:     "SAT_ENABLED_COL",
    satellite_league_col:      "SAT_LEAGUE_COL",
  };
  Object.keys(strMap).forEach(k => {
    const v = getCfg_(cfg, cfgNorm, k);
    if (v !== undefined && String(v).trim()) c[strMap[k]] = String(v).trim();
  });

  const staleH = Number(getCfg_(cfg, cfgNorm, "edge_stale_hours"));
  if (Number.isFinite(staleH) && staleH > 0) c.STALE_HOURS = staleH;

  const satLim = Number(getCfg_(cfg, cfgNorm, "satellite_check_limit"));
  if (Number.isFinite(satLim) && satLim >= 0) c.SAT_CHECK_LIMIT = clampInt_(satLim, 0, 20);

  return c;
}


/* ==========================================================
   ROLE-SPECIFIC CHECKS
   ========================================================== */

function runRoleChecks_(role, ctx) {
  const { add } = ctx;
  if (role === "MOTHER")  return motherChecks_(ctx);
  if (role === "ASSAYER") return assayerChecks_(ctx);
  if (role === "GOLIDE")  return golideChecks_(ctx);

  add("INFO","generic","hint",
    "No role inferred. Ensure the workbook contains ASSAYER_EDGES / ASSAYER_LEAGUE_PURITY headers, "
    + "UpcomingClean headers, or a Satellite_Index shape.");
}


/* ==========================================================
   MOTHER CHECKS  ── v5: validates both contract sheets ──
   ========================================================== */

function motherChecks_(ctx) {
  const { ss, add, cfg, cfgNorm, contract } = ctx;
  add("INFO","integration","mother_to_assayer","starting Assayer contract checks");

  const assayerId = String(getCfg_(cfg, cfgNorm, "assayer_sheet_id") || "").trim();
  if (!assayerId) {
    add("FAIL","integration","assayer_sheet_id",
      "Missing. Add assayer_sheet_id to Mother config so audit can validate Assayer output.");
  } else {
    let assayerSS = null;
    try {
      assayerSS = SpreadsheetApp.openById(assayerId);
      add("OK","integration","assayer_reachable", assayerSS.getName());
    } catch (e) {
      add("FAIL","integration","assayer_unreachable",
        `Cannot open Assayer (${assayerId}). Check sharing / scopes. Error: ${e.message}`);
    }
    if (assayerSS) {
      validateAssayerContract_(add, assayerSS, contract);
    }
  }

  // Satellite checks (unchanged)
  add("INFO","integration","mother_to_golide","starting satellite spot-checks");
  validateSatellites_(add, ss, contract);
}


/* ==========================================================
   v5: ASSAYER CONTRACT VALIDATION  (replaces validateRemoteEdgeOutput_)
   Validates BOTH ASSAYER_EDGES and ASSAYER_LEAGUE_PURITY
   Works for both remote (Mother→Assayer) and local (Assayer self-check)
   ========================================================== */

function validateAssayerContract_(add, targetSS, contract) {
  const prefix = "assayer";

  // ── Check for legacy Edge_Output ──
  const legacySh = targetSS.getSheetByName(SYS_CONTRACT.LEGACY_EDGE_SHEET);
  if (legacySh) {
    add("WARN","integration",`${prefix}_legacy_edge_output`,
      `Legacy "${SYS_CONTRACT.LEGACY_EDGE_SHEET}" found. Migrate to "${contract.EDGE_SHEET_NAME}" per contract v4.2.0.`);
  }

  // ══════════════════════════════════════════════════════════
  // ASSAYER_EDGES validation
  // ══════════════════════════════════════════════════════════
  const edgeSh = targetSS.getSheetByName(contract.EDGE_SHEET_NAME);
  if (!edgeSh) {
    add("FAIL","integration",`${prefix}_edge_sheet_missing`,
      `Missing "${contract.EDGE_SHEET_NAME}". Mother cannot ingest edges.`);
  } else {
    add("OK","integration",`${prefix}_edge_sheet_found`, contract.EDGE_SHEET_NAME);

    const disc = discoverHeaders_(edgeSh);
    const norm = disc.headerNormSet;

    // Column presence
    let edgeMissing = 0;
    contract.EDGE_REQUIRED_COLS.forEach(col => {
      const nk = normKey_(col);
      const ok = norm.has(nk);
      add(ok ? "OK" : "FAIL", "integration", `${prefix}_edge.${col}`,
        ok ? `present (row ${disc.headerRow})` : "MISSING — contract violation");
      if (!ok) edgeMissing++;
    });

    // Row count
    const edgeLR = edgeSh.getLastRow();
    const edgeDataRows = edgeLR - disc.dataStartRow + 1;
    if (edgeDataRows <= 0) {
      add("WARN","integration",`${prefix}_edge_empty`,"ASSAYER_EDGES has zero data rows");
    } else {
      add("OK","integration",`${prefix}_edge_rows`,
        `${edgeDataRows} edges (data starts row ${disc.dataStartRow})`);

      // Type validation on sample rows (only if columns are present)
      if (edgeMissing === 0) {
        validateEdgeDataTypes_(add, edgeSh, disc, prefix, edgeLR);
      }

      // Freshness
      validateFreshness_(add, edgeSh, disc, prefix + "_edge", contract.STALE_HOURS);
    }
  }

  // ══════════════════════════════════════════════════════════
  // ASSAYER_LEAGUE_PURITY validation
  // ══════════════════════════════════════════════════════════
  const puritySh = targetSS.getSheetByName(contract.LEAGUE_PURITY_SHEET_NAME);
  if (!puritySh) {
    add("FAIL","integration",`${prefix}_purity_sheet_missing`,
      `Missing "${contract.LEAGUE_PURITY_SHEET_NAME}". Mother cannot route by league.`);
  } else {
    add("OK","integration",`${prefix}_purity_sheet_found`, contract.LEAGUE_PURITY_SHEET_NAME);

    const disc = discoverHeaders_(puritySh);
    const norm = disc.headerNormSet;

    let purityMissing = 0;
    contract.LEAGUE_PURITY_REQUIRED_COLS.forEach(col => {
      const nk = normKey_(col);
      const ok = norm.has(nk);
      add(ok ? "OK" : "FAIL", "integration", `${prefix}_purity.${col}`,
        ok ? `present (row ${disc.headerRow})` : "MISSING — contract violation");
      if (!ok) purityMissing++;
    });

    const purityLR = puritySh.getLastRow();
    const purityDataRows = purityLR - disc.dataStartRow + 1;
    if (purityDataRows <= 0) {
      add("WARN","integration",`${prefix}_purity_empty`,"ASSAYER_LEAGUE_PURITY has zero data rows");
    } else {
      add("OK","integration",`${prefix}_purity_rows`,
        `${purityDataRows} league combos (data starts row ${disc.dataStartRow})`);

      if (purityMissing === 0) {
        validatePurityDataTypes_(add, puritySh, disc, prefix, purityLR);
      }

      validateFreshness_(add, puritySh, disc, prefix + "_purity", contract.STALE_HOURS);
    }
  }
}


/* ==========================================================
   v5: EDGE DATA TYPE VALIDATION
   Checks sample rows for correct types/ranges/enums
   ========================================================== */

function validateEdgeDataTypes_(add, sheet, disc, prefix, lastRow) {
  const colMap = buildHeaderMap_(disc.headers);
  const cat    = "integration";
  const tag    = prefix + "_edge_types";

  // Sample rows: first, middle, last data row
  const sampleRows = buildSampleRowIndices_(disc.dataStartRow, lastRow, SYS_AUDIT.TYPE_CHECK_ROWS);
  const lc = sheet.getLastColumn();

  let passCount = 0, failCount = 0;
  const fail = (msg) => { add("WARN", cat, tag, msg); failCount++; };
  const pass = ()    => { passCount++; };

  for (const rowIdx of sampleRows) {
    const row = sheet.getRange(rowIdx, 1, 1, lc).getValues()[0];
    const label = `row ${rowIdx}`;

    // win_rate: decimal 0–1
    const wr = getByHeader_(row, colMap, "win_rate");
    if (typeof wr === "number" && wr >= 0 && wr <= 1) pass();
    else fail(`${label}: win_rate=${wr} (expected decimal 0–1)`);

    // lower_bound: decimal 0–1
    const lb = getByHeader_(row, colMap, "lower_bound");
    if (typeof lb === "number" && lb >= 0 && lb <= 1) pass();
    else fail(`${label}: lower_bound=${lb} (expected decimal 0–1)`);

    // upper_bound: decimal 0–1
    const ub = getByHeader_(row, colMap, "upper_bound");
    if (typeof ub === "number" && ub >= 0 && ub <= 1) pass();
    else fail(`${label}: upper_bound=${ub} (expected decimal 0–1)`);

    // lift: numeric (typically -0.5 to +0.5)
    const lift = getByHeader_(row, colMap, "lift");
    if (typeof lift === "number" && isFinite(lift)) pass();
    else fail(`${label}: lift=${lift} (expected numeric decimal)`);

    // n, wins, losses: integers
    const n = getByHeader_(row, colMap, "n");
    const w = getByHeader_(row, colMap, "wins");
    const l = getByHeader_(row, colMap, "losses");
    if (Number.isInteger(n) && n > 0) pass();
    else fail(`${label}: n=${n} (expected positive integer)`);

    // wins + losses = n
    if (Number.isInteger(w) && Number.isInteger(l) && Number.isInteger(n)) {
      if (w + l === n) pass();
      else fail(`${label}: wins(${w}) + losses(${l}) ≠ n(${n})`);
    }

    // grade: enum
    const grade = String(getByHeader_(row, colMap, "grade") || "");
    if (SYS_CONTRACT.VALID_GRADES.includes(grade)) pass();
    else fail(`${label}: grade="${grade}" (expected ${SYS_CONTRACT.VALID_GRADES.join("|")})`);

    // reliable: boolean
    const rel = getByHeader_(row, colMap, "reliable");
    if (rel === true || rel === false) pass();
    else fail(`${label}: reliable=${rel} (expected boolean TRUE/FALSE)`);

    // sample_size: enum
    const ss = String(getByHeader_(row, colMap, "sample_size") || "");
    if (SYS_CONTRACT.VALID_SAMPLE_SIZES.includes(ss)) pass();
    else fail(`${label}: sample_size="${ss}" (expected ${SYS_CONTRACT.VALID_SAMPLE_SIZES.join("|")})`);

    // source: enum
    const src = String(getByHeader_(row, colMap, "source") || "");
    if (SYS_CONTRACT.VALID_SOURCES.includes(src)) pass();
    else fail(`${label}: source="${src}" (expected Side|Totals)`);

    // filters_json: valid JSON
    const fj = String(getByHeader_(row, colMap, "filters_json") || "");
    if (fj) {
      try { JSON.parse(fj); pass(); }
      catch (e) { fail(`${label}: filters_json not valid JSON: "${fj.slice(0,60)}"`); }
    }

    // quarter: nullable, but if present must be Q1-Q4
    const qtr = getByHeader_(row, colMap, "quarter");
    if (isBlank_(qtr) || qtr === "" || qtr === null) { /* nullable = ok */ }
    else if (SYS_CONTRACT.VALID_QUARTERS_EDGE.includes(String(qtr))) pass();
    else fail(`${label}: quarter="${qtr}" (expected Q1-Q4 or blank)`);

    // side: nullable enum
    const side = getByHeader_(row, colMap, "side");
    if (isBlank_(side) || side === "" || side === null) { /* nullable */ }
    else if (SYS_CONTRACT.VALID_SIDES.includes(String(side))) pass();
    else fail(`${label}: side="${side}" (expected H|A or blank)`);

    // direction: nullable enum
    const dir = getByHeader_(row, colMap, "direction");
    if (isBlank_(dir) || dir === "" || dir === null) { /* nullable */ }
    else if (SYS_CONTRACT.VALID_DIRECTIONS.includes(String(dir))) pass();
    else fail(`${label}: direction="${dir}" (expected Over|Under or blank)`);
  }

  add(failCount === 0 ? "OK" : "WARN", cat, `${prefix}_edge_type_summary`,
    `${passCount} checks passed, ${failCount} issues across ${sampleRows.length} sample rows`);
}


/* ==========================================================
   v5: LEAGUE PURITY DATA TYPE VALIDATION
   ========================================================== */

function validatePurityDataTypes_(add, sheet, disc, prefix, lastRow) {
  const colMap = buildHeaderMap_(disc.headers);
  const cat    = "integration";
  const tag    = prefix + "_purity_types";

  const sampleRows = buildSampleRowIndices_(disc.dataStartRow, lastRow, SYS_AUDIT.TYPE_CHECK_ROWS);
  const lc = sheet.getLastColumn();

  let passCount = 0, failCount = 0;
  const fail = (msg) => { add("WARN", cat, tag, msg); failCount++; };
  const pass = ()    => { passCount++; };

  for (const rowIdx of sampleRows) {
    const row = sheet.getRange(rowIdx, 1, 1, lc).getValues()[0];
    const label = `row ${rowIdx}`;

    // win_rate: decimal 0–1
    const wr = getByHeader_(row, colMap, "win_rate");
    if (typeof wr === "number" && wr >= 0 && wr <= 1) pass();
    else fail(`${label}: win_rate=${wr} (expected decimal 0–1)`);

    // n: positive integer
    const n = getByHeader_(row, colMap, "n");
    if (Number.isInteger(n) && n > 0) pass();
    else fail(`${label}: n=${n} (expected positive integer)`);

    // grade: enum
    const grade = String(getByHeader_(row, colMap, "grade") || "");
    if (SYS_CONTRACT.VALID_GRADES.includes(grade)) pass();
    else fail(`${label}: grade="${grade}" (expected ${SYS_CONTRACT.VALID_GRADES.join("|")})`);

    // source: enum
    const src = String(getByHeader_(row, colMap, "source") || "");
    if (SYS_CONTRACT.VALID_SOURCES.includes(src)) pass();
    else fail(`${label}: source="${src}" (expected Side|Totals)`);

    // gender: enum
    const gen = String(getByHeader_(row, colMap, "gender") || "");
    if (SYS_CONTRACT.VALID_GENDERS.includes(gen)) pass();
    else fail(`${label}: gender="${gen}" (expected M|W|All)`);

    // quarter: enum (All/Full/Q1-Q4)
    const qtr = String(getByHeader_(row, colMap, "quarter") || "");
    if (SYS_CONTRACT.VALID_QUARTERS_LEAGUE.includes(qtr)) pass();
    else fail(`${label}: quarter="${qtr}" (expected ${SYS_CONTRACT.VALID_QUARTERS_LEAGUE.join("|")})`);

    // league: non-empty string
    const lg = getByHeader_(row, colMap, "league");
    if (lg && String(lg).trim().length > 0) pass();
    else fail(`${label}: league is blank`);
  }

  add(failCount === 0 ? "OK" : "WARN", cat, `${prefix}_purity_type_summary`,
    `${passCount} checks passed, ${failCount} issues across ${sampleRows.length} sample rows`);
}


/* ==========================================================
   v5: FRESHNESS VALIDATOR  (extracted, reusable)
   ========================================================== */

function validateFreshness_(add, sheet, disc, tagPrefix, staleHours) {
  const colMap     = buildHeaderMap_(disc.headers);
  const updatedIdx = colMap[normKey_("updated_at")];
  if (updatedIdx === undefined) {
    add("WARN","integration",`${tagPrefix}_freshness`,"No updated_at column found");
    return;
  }

  const lr = sheet.getLastRow();
  const lastVal = sheet.getRange(lr, updatedIdx + 1).getValue();
  const dt = new Date(lastVal);
  if (isNaN(dt.getTime())) {
    add("WARN","integration",`${tagPrefix}_freshness`,
      `updated_at not parseable: "${String(lastVal).slice(0,60)}"`);
  } else {
    const ageH = (Date.now() - dt.getTime()) / 3600000;
    add(ageH <= staleHours ? "OK" : "WARN", "integration", `${tagPrefix}_freshness`,
      `Last update ${dt.toISOString()} (${Math.round(ageH)}h ago, threshold ${staleHours}h)`);
  }
}


/* ==========================================================
   SATELLITE VALIDATION  (unchanged)
   ========================================================== */

function validateSatellites_(add, motherSS, contract) {
  const idx = motherSS.getSheetByName(contract.SAT_INDEX_SHEET);
  if (!idx) {
    add("WARN","integration","satellite_index_missing",
      `No "${contract.SAT_INDEX_SHEET}".`);
    return;
  }

  const disc  = discoverHeaders_(idx);
  const hmap  = buildHeaderMap_(disc.headers);
  const idIdx = hmap[normKey_(contract.SAT_ID_COL)];
  const enIdx = hmap[normKey_(contract.SAT_ENABLED_COL)];
  const lgIdx = hmap[normKey_(contract.SAT_LEAGUE_COL)];

  if (idIdx === undefined) {
    add("FAIL","integration","satellite_index_schema",
      `Missing "${contract.SAT_ID_COL}" column in ${contract.SAT_INDEX_SHEET}`);
    return;
  }

  const lr = idx.getLastRow();
  if (lr < disc.dataStartRow) {
    add("WARN","integration","satellite_index_empty","No data rows");
    return;
  }

  const rows = idx.getRange(disc.dataStartRow, 1, lr - disc.dataStartRow + 1, idx.getLastColumn()).getValues();
  const sats = rows.map((r,i) => ({
    id:      String(r[idIdx] || "").trim(),
    enabled: enIdx === undefined ? true : safeBool_(r[enIdx]).value,
    label:   lgIdx !== undefined ? String(r[lgIdx] || "").trim() : `row_${disc.dataStartRow + i}`,
  })).filter(x => x.id && x.enabled);

  add("INFO","integration","satellites_enabled",
    `${sats.length} enabled, checking up to ${contract.SAT_CHECK_LIMIT}`);

  sats.slice(0, contract.SAT_CHECK_LIMIT).forEach(sat => {
    let satSS = null;
    try {
      satSS = SpreadsheetApp.openById(sat.id);
      add("OK","integration",`${sat.label}_reachable`, satSS.getName());
    } catch (e) {
      add("FAIL","integration",`${sat.label}_unreachable`, e.message);
      return;
    }

    const up = satSS.getSheetByName(contract.UPCOMING_SHEET_NAME);
    if (!up) {
      add("FAIL","integration",`${sat.label}_missing_upcoming`,
        `Missing "${contract.UPCOMING_SHEET_NAME}"`);
      return;
    }

    const upDisc = discoverHeaders_(up);
    const upH    = upDisc.headerNormSet;
    contract.UPCOMING_REQUIRED_COLS.forEach(col => {
      const nk = normKey_(col);
      add(upH.has(nk) ? "OK" : "FAIL", "integration", `${sat.label}.${col}`,
        upH.has(nk) ? `present (row ${upDisc.headerRow})` : "missing");
    });

    const satDataRows = up.getLastRow() - upDisc.dataStartRow + 1;
    add(satDataRows > 0 ? "OK" : "WARN", "integration", `${sat.label}_upcoming_rows`,
      satDataRows > 0 ? `${satDataRows} rows` : "no data rows");
  });
}


/* ==========================================================
   ASSAYER SELF-CHECK  ── v5: validates both contract sheets ──
   ========================================================== */

function assayerChecks_(ctx) {
  const { ss, add, contract, sheetInfos } = ctx;
  add("INFO","integration","assayer_self_check","starting (v5 two-sheet contract)");

  // Use the same validator as Mother — just point it at local spreadsheet
  validateAssayerContract_(add, ss, contract);

  // ── v5: additional Assayer-specific diagnostics ──
  const names = new Set(sheetInfos.map(s => s.name));

  // Check that source data sheets exist
  if (names.has("Side"))   add("OK","integration","assayer_source_side","Side sheet present");
  else add("WARN","integration","assayer_source_side","Side sheet missing — edges may be incomplete");

  if (names.has("Totals")) add("OK","integration","assayer_source_totals","Totals sheet present");
  else add("WARN","integration","assayer_source_totals","Totals sheet missing — edges may be incomplete");

  // Count MA_* sheets for health
  const maSheets = sheetInfos.filter(s => s.name.startsWith("MA_")).map(s => s.name);
  add("INFO","integration","assayer_ma_sheets", `${maSheets.length}: ${maSheets.join(", ")}`);

  add("INFO","integration","assayer_self_check","complete");
}


/* ==========================================================
   GOLIDE CHECKS  (unchanged)
   ========================================================== */

function golideChecks_(ctx) {
  const { ss, add, contract } = ctx;
  add("INFO","integration","golide_self_check","starting");

  const sh = ss.getSheetByName(contract.UPCOMING_SHEET_NAME);
  if (!sh) {
    add("FAIL","integration","upcoming_missing",
      `Missing "${contract.UPCOMING_SHEET_NAME}".`);
    return;
  }

  const disc = discoverHeaders_(sh);
  const norm = disc.headerNormSet;
  contract.UPCOMING_REQUIRED_COLS.forEach(col => {
    const nk = normKey_(col);
    add(norm.has(nk) ? "OK" : "FAIL", "integration", `upcoming_schema.${col}`,
      norm.has(nk) ? `present (row ${disc.headerRow})` : "missing");
  });

  const dataRows = sh.getLastRow() - disc.dataStartRow + 1;
  add(dataRows > 0 ? "OK" : "WARN", "integration", "upcoming_rows",
    dataRows > 0 ? `${dataRows} rows` : "no data rows");

  add("INFO","integration","golide_self_check","complete");
}


/* ==========================================================
   OUTPUT: REPORT + SUMMARY  (unchanged)
   ========================================================== */

function writeReport_(ss, rows, summary) {
  const sh = upsertSheet_(ss, SYS_AUDIT.REPORT_SHEET);
  sh.clear();

  const header = [["timestamp","severity","category","item","detail"]];
  sh.getRange(1,1,1,5).setValues(header).setFontWeight("bold");

  if (rows.length) {
    sh.getRange(2,1, rows.length, 5)
      .setValues(rows.map(r => r.map(sanitizeCell_)));
  }
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 5);

  const sum = upsertSheet_(ss, SYS_AUDIT.SUMMARY_SHEET);
  sum.clear();
  sum.getRange(1,1,7,2).setValues([
    ["audit_version",  SYS_AUDIT.VERSION],
    ["run_time",       new Date().toISOString()],
    ["total_findings", summary.total],
    ["readiness_pct",  summary.readinessPct + "%"],
    ["ok",             summary.counts.OK],
    ["warn",           summary.counts.WARN],
    ["fail",           summary.counts.FAIL],
  ].map(r => r.map(sanitizeCell_)));
  sum.autoResizeColumns(1,2);
  sum.getRange(1,1,1,2).setFontWeight("bold");
}


/* ==========================================================
   OUTPUT: DATA CONTRACT  ── v5: shows full two-sheet schema ──
   ========================================================== */

function writeDataContract_(ss, roleResult, contract) {
  const sh = upsertSheet_(ss, SYS_AUDIT.CONTRACT_SHEET);
  sh.clear();

  const rows = [];
  rows.push(["DATA CONTRACT (v5)","","","","",""]);
  rows.push(["Generated", new Date().toISOString(), "Role", roleResult.role, "",""]);
  rows.push(["Detected by", roleResult.detectedBy, "Confidence",
    (roleResult.confidence*100).toFixed(0)+"%", "",""]);
  rows.push(["","","","","",""]);

  // ── ASSAYER_EDGES contract ──
  rows.push(["═══ ASSAYER → MOTHER: EDGE CATALOG ═══","","","","",""]);
  rows.push(["Direction","Sheet","Column","Status","Type","Notes"]);

  const edgeNotes = {
    edge_id:       "Unique string, e.g. SIDE_QUARTER_1_SIDE_H",
    source:        "Enum: Side | Totals",
    pattern:       "Human-readable, e.g. quarter=1 + side=H",
    discovered:    "Date string (YYYY-MM-DD)",
    updated_at:    "ISO 8601 timestamp",
    quarter:       "Nullable. Values: Q1 | Q2 | Q3 | Q4 (null = any)",
    is_women:      "Nullable boolean. TRUE/FALSE (null = unconstrained)",
    tier:          "Nullable. Values: EVEN | MEDIUM | STRONG",
    side:          "Nullable. Values: H | A",
    direction:     "Nullable. Values: Over | Under",
    conf_bucket:   "Nullable string, e.g. ≥70%, 65-70%, <55%",
    spread_bucket: "Nullable string, e.g. <3, 3-4",
    line_bucket:   "Nullable string, e.g. <35, 35-40, 50-60",
    filters_json:  "JSON escape hatch — all criteria as key/value pairs",
    n:             "Integer — total decisive bets",
    wins:          "Integer",
    losses:        "Integer (wins + losses = n)",
    win_rate:      "Decimal 0–1 (NOT percentage)",
    lower_bound:   "Decimal 0–1 (Wilson 90% CI lower)",
    upper_bound:   "Decimal 0–1 (Wilson 90% CI upper)",
    lift:          "Decimal (e.g. 0.200 = +20pp vs baseline)",
    grade:         "Enum: PLATINUM | GOLD | SILVER | BRONZE | ROCK | CHARCOAL",
    symbol:        "Display glyph: ⬡ | Au | Ag | Cu | ite | 🜃",
    reliable:      "Boolean TRUE/FALSE (n ≥ 30)",
    sample_size:   "Enum: Small | Medium | Large",
  };

  contract.EDGE_REQUIRED_COLS.forEach(c => {
    rows.push([
      "Assayer → Mother", contract.EDGE_SHEET_NAME, c, "REQUIRED",
      edgeNotes[c] ? edgeNotes[c].split(".")[0].split(",")[0].split("—")[0].trim() : "",
      edgeNotes[c] || ""
    ]);
  });

  rows.push(["","","","","",""]);

  // ── ASSAYER_LEAGUE_PURITY contract ──
  rows.push(["═══ ASSAYER → MOTHER: LEAGUE PURITY ═══","","","","",""]);
  rows.push(["Direction","Sheet","Column","Status","Type","Notes"]);

  const purityNotes = {
    league:     "League code string",
    quarter:    "Enum: All | Full | Q1 | Q2 | Q3 | Q4",
    source:     "Enum: Side | Totals",
    gender:     "Enum: M | W",
    tier:       "Enum: EVEN | MEDIUM | STRONG | UNKNOWN",
    n:          "Integer — decisive bets",
    win_rate:   "Decimal 0–1 — Bayesian shrunk rate",
    grade:      "Enum: PLATINUM–CHARCOAL",
    status:     "Display: ✅ Reliable | 📊 Building | ⛔ Avoid | 🌟 Elite",
    updated_at: "ISO 8601 timestamp",
  };

  contract.LEAGUE_PURITY_REQUIRED_COLS.forEach(c => {
    rows.push([
      "Assayer → Mother", contract.LEAGUE_PURITY_SHEET_NAME, c, "REQUIRED",
      purityNotes[c] ? purityNotes[c].split(".")[0].split(",")[0].split("—")[0].trim() : "",
      purityNotes[c] || ""
    ]);
  });

  rows.push(["","","","","",""]);

  // ── GOLIDE → MOTHER contract (unchanged) ──
  rows.push(["═══ GOLIDE → MOTHER: UPCOMING ═══","","","","",""]);
  rows.push(["Direction","Sheet","Column","Status","Type","Notes"]);
  contract.UPCOMING_REQUIRED_COLS.forEach(c =>
    rows.push(["Golide → Mother", contract.UPCOMING_SHEET_NAME, c, "REQUIRED", "", ""]));
  contract.UPCOMING_RECOMMENDED_COLS.forEach(c =>
    rows.push(["Golide → Mother", contract.UPCOMING_SHEET_NAME, c, "RECOMMENDED", "", ""]));

  sh.getRange(1,1, rows.length, 6).setValues(rows.map(r => r.map(sanitizeCell_)));
  sh.setFrozenRows(2);
  sh.autoResizeColumns(1,6);
  sh.getRange(1,1,1,6).setFontWeight("bold").setFontSize(12);
}


/* ==========================================================
   OUTPUT: SYSTEM MAP  ── v5: updated contract summary ──
   ========================================================== */

function writeSystemMap_(ss, roleResult, findings, summary, contract) {
  const sh = upsertSheet_(ss, SYS_AUDIT.MAP_SHEET);
  sh.clear();

  const rows = [];
  rows.push(["SYSTEM MAP -- FOR LLM CONTEXT","",""]);
  rows.push(["Generated",     new Date().toISOString(), ""]);
  rows.push(["Role",          roleResult.role, ""]);
  rows.push(["Detected by",   roleResult.detectedBy, ""]);
  rows.push(["Confidence",    (roleResult.confidence*100).toFixed(0)+"%", ""]);
  rows.push(["Spreadsheet",   ss.getName(), ""]);
  rows.push(["Readiness",     summary.readinessPct+"%",
    `OK:${summary.counts.OK} WARN:${summary.counts.WARN} FAIL:${summary.counts.FAIL}`]);
  rows.push(["","",""]);

  rows.push(["-- SHEETS (dimensions) --","",""]);
  findings.filter(f => f[2]==="sheets" && f[3]==="dimensions")
    .forEach(f => rows.push(["", f[4], ""]));

  rows.push(["","",""]);
  rows.push(["-- HEADER DETECTION --","",""]);
  findings.filter(f => f[2]==="sheets" && f[3]==="header_detection")
    .forEach(f => rows.push(["", f[4], ""]));

  rows.push(["","",""]);
  rows.push(["-- INTEGRATION --","",""]);
  findings.filter(f => f[2]==="integration")
    .forEach(f => rows.push([f[1], f[3], f[4]]));

  rows.push(["","",""]);
  rows.push(["-- FAILURES --","",""]);
  const fails = findings.filter(f => f[1]==="FAIL");
  if (fails.length) fails.forEach(f => rows.push([f[2], f[3], f[4]]));
  else rows.push(["(none)","",""]);

  // ── v5: expanded contract summary ──
  rows.push(["","",""]);
  rows.push(["-- ASSAYER→MOTHER CONTRACT --","",""]);
  rows.push(["Edge sheet",    contract.EDGE_SHEET_NAME, `${contract.EDGE_REQUIRED_COLS.length} required cols`]);
  rows.push(["Edge cols",     contract.EDGE_REQUIRED_COLS.join(", "), ""]);
  rows.push(["Purity sheet",  contract.LEAGUE_PURITY_SHEET_NAME, `${contract.LEAGUE_PURITY_REQUIRED_COLS.length} required cols`]);
  rows.push(["Purity cols",   contract.LEAGUE_PURITY_REQUIRED_COLS.join(", "), ""]);
  rows.push(["","",""]);
  rows.push(["-- GOLIDE→MOTHER CONTRACT --","",""]);
  rows.push(["Upcoming sheet", contract.UPCOMING_SHEET_NAME, ""]);
  rows.push(["Required cols",  contract.UPCOMING_REQUIRED_COLS.join(", "), ""]);

  sh.getRange(1,1, rows.length, 3).setValues(rows.map(r => r.map(sanitizeCell_)));
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1,3);
  sh.getRange(1,1,1,3).setFontWeight("bold").setFontSize(12);
}


/* ==========================================================
   HELPERS  (existing — unchanged)
   ========================================================== */

function safeGetDocumentProperties_() {
  try { return PropertiesService.getDocumentProperties(); }
  catch (e) { return null; }
}

function sanitizeCell_(v) {
  if (typeof v === "string" && /^[=+\-@]/.test(v)) return "'" + v;
  return v;
}

function getCfg_(cfg, cfgNorm, key) {
  const nk = normKey_(key);
  if (cfgNorm && cfgNorm[nk] !== undefined) return cfgNorm[nk];
  if (cfg && cfg[key] !== undefined) return cfg[key];
  return undefined;
}

function normKey_(s) {
  return String(s || "")
    .toLowerCase().trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/[^\w]/g, "");
}

function isSuperset_(setA, setB) {
  for (const x of setB) if (!setA.has(x)) return false;
  return true;
}

function countInSet_(setObj, arrKeys) {
  let n = 0;
  for (const k of arrKeys) if (setObj.has(k)) n++;
  return n;
}

function buildHeaderMap_(headers) {
  const map = {};
  (headers || []).forEach((h, i) => {
    const k = normKey_(h);
    if (k && map[k] === undefined) map[k] = i;
  });
  return map;
}

function safeBool_(v) {
  if (v === true)  return { value: true,  confident: true };
  if (v === false) return { value: false, confident: true };
  const s = String(v || "").trim().toLowerCase();
  if (!s) return { value: false, confident: true };
  if (["true","1","yes","y","on"].includes(s))  return { value: true,  confident: true };
  if (["false","0","no","n","off"].includes(s)) return { value: false, confident: true };
  return { value: false, confident: false };
}

function isBlank_(v) { return v === "" || v === null || v === undefined; }

function clampInt_(n, lo, hi) {
  n = Math.floor(Number(n) || 0);
  return Math.max(lo, Math.min(hi, n));
}

function clamp_(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function upsertSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function summarize_(findings) {
  const counts = { OK: 0, INFO: 0, WARN: 0, FAIL: 0 };
  findings.forEach(r => { counts[r[1]] = (counts[r[1]] || 0) + 1; });
  const total = counts.OK + counts.INFO + counts.WARN + counts.FAIL;
  const denom = (counts.OK + counts.WARN + counts.FAIL) || 1;
  const readinessPct = Math.round((counts.OK / denom) * 100);
  return { total, counts, readinessPct };
}

function safeCall_(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}


/* ==========================================================
   v5: NEW HELPERS  (type validation support)
   ========================================================== */

/**
 * Get cell value by header name from a row array + column map
 */
function getByHeader_(row, colMap, headerName) {
  const idx = colMap[normKey_(headerName)];
  if (idx === undefined || idx >= row.length) return undefined;
  return row[idx];
}

/**
 * Build sample row indices: first, middle, last data row
 * Returns 1-based row indices for sheet.getRange()
 */
function buildSampleRowIndices_(dataStartRow, lastRow, maxSamples) {
  const dataRows = lastRow - dataStartRow + 1;
  if (dataRows <= 0) return [];
  if (dataRows === 1) return [dataStartRow];
  if (dataRows <= maxSamples) {
    const indices = [];
    for (let r = dataStartRow; r <= lastRow; r++) indices.push(r);
    return indices;
  }

  // first, middle, last
  const indices = [dataStartRow];
  if (maxSamples >= 3) {
    indices.push(Math.floor((dataStartRow + lastRow) / 2));
  }
  indices.push(lastRow);
  return indices;
}
