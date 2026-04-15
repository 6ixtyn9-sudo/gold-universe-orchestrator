/**
 * ======================================================================
 * FILE: Mothership_HiveMind.gs
 * PROJECT: Ma Golide - MOTHERSHIP
 * PURPOSE: Syncs bet data AND results from all satellite leagues
 * VERSION: 3.0 (Results Sync Added)
 * 
 * FUNCTIONS:
 * - syncAllLeagues() - Pull Bet_Slips from satellites
 * - syncAllResults() - Pull ResultsClean from satellites
 * - syncEverything() - Sync both bets and results
 * - updateDashboard() - Update KPI metrics
 * - viewSyncStatus() - Show sync summary
 * ======================================================================
 */
/**
 * PATCH 3: Find sheet by name (case-insensitive, supports partial match)
 * Enhanced with verbose logging for debugging
 * 
 * @param {Spreadsheet} spreadsheet - The spreadsheet to search
 * @param {string} sheetName - The sheet name to find
 * @returns {Sheet|null} The found sheet or null
 */
function _findSheetByName(spreadsheet, sheetName) {
  const FUNC_NAME = '_findSheetByName';
  
  if (!spreadsheet) {
    Logger.log(`[${FUNC_NAME}] ❌ spreadsheet is null/undefined`);
    return null;
  }
  
  if (!sheetName) {
    Logger.log(`[${FUNC_NAME}] ❌ sheetName is null/undefined`);
    return null;
  }
  
  const targetLower = sheetName.toLowerCase().trim();
  
  try {
    const sheets = spreadsheet.getSheets();
    const sheetNames = sheets.map(s => s.getName());
    
    if (ACCA_ENGINE_CONFIG.VERBOSE_LOGGING) {
      Logger.log(`[${FUNC_NAME}] Searching for "${sheetName}" in ${sheets.length} sheets: [${sheetNames.join(', ')}]`);
    }
    
    // Pass 1: Exact match (case-insensitive)
    for (const sheet of sheets) {
      if (sheet.getName().toLowerCase().trim() === targetLower) {
        Logger.log(`[${FUNC_NAME}] ✅ EXACT match found: "${sheet.getName()}"`);
        return sheet;
      }
    }
    
    // Pass 2: Partial match (contains)
    for (const sheet of sheets) {
      const nameLower = sheet.getName().toLowerCase();
      if (nameLower.includes(targetLower) || targetLower.includes(nameLower)) {
        Logger.log(`[${FUNC_NAME}] ✅ PARTIAL match found: "${sheet.getName()}" (target: "${sheetName}")`);
        return sheet;
      }
    }
    
    Logger.log(`[${FUNC_NAME}] ❌ No match found for "${sheetName}"`);
    return null;
    
  } catch (e) {
    Logger.log(`[${FUNC_NAME}] ❌ Error: ${e.message}`);
    return null;
  }
}


// ============================================================
// LOCAL HELPERS
// ============================================================
/**
 * WHY: Satellites sometimes rename ResultsClean (e.g., “ResultsClean Dec”)
 * WHAT: Return the first sheet whose name contains “result” or “clean”, after
 *        checking the legacy exact matches for backward compatibility.
 */
function _findResultsSheet(spreadsheet) {
  if (!spreadsheet) return null;

  const preferred = ['ResultsClean', 'Clean', 'Results'];
  for (const name of preferred) {
    const exact = getSheetInsensitive(spreadsheet, name);
    if (exact) return exact;
  }

  const sheets = spreadsheet.getSheets();
  return sheets.find(sh => {
    const name = sh.getName().toLowerCase();
    return name.includes('result') || name.includes('clean');
  }) || null;
}

/**
 * WHY: Case-insensitive sheet lookup
 */
function getSheetInsensitive(ss, name) {
  if (!ss || !name) return null;
  const lower = name.toLowerCase();
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase() === lower) {
      return sheets[i];
    }
  }
  return null;
}

/**
 * WHY: Flexible header mapping with alias support
 */
function createHeaderMapWithAliases(headerRow) {
  const map = {};
  
  const aliases = {
    'confidence': ['confidence', 'conf', 'conf%', 'conf/margin', 'confidence/info', 'probability', 'prob', 'confidence_pct', 'confidence pct'],
    'ev': ['ev', 'expected value', 'expectedvalue', 'value'],
    'match': ['match', 'game', 'matchup', 'teams'],
    'pick': ['pick', 'selection', 'bet', 'prediction', 'selection_text'],
    'type': ['type', 'bet type', 'bettype', 'category'],
    'odds': ['odds', 'price', 'decimal odds'],
    'league': ['league', 'competition', 'tournament', 'league id'],
    'league name': ['league name', 'leaguename', 'name'],
    'league id': ['league id', 'leagueid', 'id'],
    'file url': ['file url', 'fileurl', 'url', 'link'],
    'time': ['time', 'kickoff', 'start time', 'datetime'],
    'date': ['date', 'game date', 'match date', 'event date'],
    'status': ['status', 'active', 'enabled', 'game status'],
    'home': ['home', 'home team', 'team1'],
    'away': ['away', 'away team', 'team2'],
    'ft score': ['ft score', 'ftscore', 'final score', 'score'],
    'q1': ['q1', 'quarter1', 'quarter 1'],
    'q2': ['q2', 'quarter2', 'quarter 2'],
    'q3': ['q3', 'quarter3', 'quarter 3'],
    'q4': ['q4', 'quarter4', 'quarter 4'],
    'pred': ['pred', 'prediction', 'predicted'],
    'tier': ['tier', 'tier_code', 'risk tier', 'risktier', 'tier display']
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

// ============================================================
// SYNC BETS FROM BET_SLIPS
// ============================================================

/**
 * syncAllLeagues() — v4.2 DEBUG (UI-safe + forensic logging)
 *
 * FIXES:
 * - No longer crashes in trigger/editor context (SpreadsheetApp.getUi guarded)
 * - Adds verbose “what did we match?” logging per bet row so you can verify:
 *   - computed gameKey/baseKey
 *   - Tier1 chosen (config + timestamp + pred/conf/score)
 *   - Tier2 chosen (config + timestamp + tier + abs margin) for (game, quarter)
 *   - OU chosen (config + timestamp + threshold + tier + edge + EV) for (game, quarter, dir)
 *   - confidence/EV source (Bet_Slips vs UpcomingClean vs OU_Log)
 *
 * NOTE:
 * - Requires your existing helpers already in file:
 *   getSheetInsensitive(), createHeaderMapWithAliases(),
 *   _loadTier1PredictionsLatestMap_(), _loadUpcomingCleanMap_(),
 *   _loadTier2LogLatestMap_(), _loadOuLogLatestMap_(),
 *   _parseMatchTeams_(), _toYMD_(), _baseKey_(), _gameKey_(),
 *   _parseQuarter_(), _looksLikeOU_(), _parseOuPick_(), _parseSpreadPick_(),
 *   _findClosestOu_(), _toPctNumber_(), updateDashboard()
 */
function syncAllLeagues() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let ui = null;
  try {
    ui = SpreadsheetApp.getUi();
    Logger.log('[INIT] UI context available');
  } catch (e) {
    Logger.log('[INIT] UI context NOT available (trigger/editor). Continuing without alerts.');
  }

  const DEBUG = true;
  const DEBUG_MAX_ROWS = 200;
  const DEBUG_LOG_SHEET_NAMES = true;

  Logger.log('========== HIVEMIND SYNC BETS START (v4.4 FOREBET-DETERMINISTIC + v4.3 TIER-PATCHED) ==========');
  Logger.log(`[INIT] Start time: ${new Date().toLocaleString()}`);

  // ──────────────────────────────────────────────────────────────
  // ✅ FOREBET PATCH: local helpers (no external dependencies)
  // ──────────────────────────────────────────────────────────────
  function _coerceForebetPrediction_(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return (v === 1 || v === 2) ? v : '';
    var s = String(v).trim().toUpperCase();
    if (!s) return '';
    if (s === '1' || s === 'HOME' || s === 'H') return 1;
    if (s === '2' || s === 'AWAY' || s === 'A') return 2;
    return '';
  }

  function _inferPickSideHomeAway_(pick, teams) {
    var p = String(pick || '').toUpperCase();
    var home = String((teams && teams.home) || '').toUpperCase();
    var away = String((teams && teams.away) || '').toUpperCase();

    if (home && p.indexOf(home) >= 0 && (!away || p.indexOf(away) < 0)) return 'HOME';
    if (away && p.indexOf(away) >= 0 && (!home || p.indexOf(home) < 0)) return 'AWAY';

    if (/\bHOME\b/.test(p)) return 'HOME';
    if (/\bAWAY\b/.test(p)) return 'AWAY';

    var padded = ' ' + p.replace(/\s+/g, ' ').trim() + ' ';
    if (padded.indexOf(' 1 ') >= 0) return 'HOME';
    if (padded.indexOf(' 2 ') >= 0) return 'AWAY';

    return '';
  }

  try {
    try {
      ss.toast('Starting bet sync (v4.4 FOREBET-DETERMINISTIC)...', 'Hive Mind', 3);
    } catch (e) {
      Logger.log('[INIT] toast() not available in this context');
    }

    const configSheet = getSheetInsensitive(ss, 'Config');
    if (!configSheet) throw new Error('Config sheet not found. Run "Setup Mothership" first.');

    const configData = configSheet.getDataRange().getValues();
    if (configData.length < 2) throw new Error('Config sheet is empty. Add satellite URLs first.');

    const configHeaderMap = createHeaderMapWithAliases(configData[0]);
    const leagueNameCol = configHeaderMap['league name'] ?? configHeaderMap['league'];
    const leagueIdCol   = configHeaderMap['league id'] ?? leagueNameCol;
    const urlCol        = configHeaderMap['file url'] ?? configHeaderMap['url'];
    const statusCol     = configHeaderMap['status'];
    const lastSyncCol   = configHeaderMap['last sync'];

    if (urlCol === undefined) throw new Error('Config sheet missing "File URL" column.');

    let syncSheet = getSheetInsensitive(ss, 'Sync_Temp');
    if (!syncSheet) syncSheet = ss.insertSheet('Sync_Temp');
    syncSheet.clear();

    const headers = [
      'League','Date','Time','Home','Away','Match',
      'Market','Quarter','Pick','Line','Direction',
      'Type','Odds','Confidence','EV',

      'MaGolide Pred','MaGolide Conf %','MaGolide Score',
      'Forebet Pred','Forebet %',

      'ForebetPrediction','ForebetAction',

      'RiskTier','Edge Score',

      'Tier1 Config','Tier1 Timestamp',
      'Tier2 Config','Tier2 Timestamp',
      'OU Config','OU Timestamp',

      'SourceSheet','SourceRow','GameKey'
    ];

    syncSheet.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#ff9900')
      .setFontColor('#ffffff');

    const out = [];

    let totalBets = 0;
    let syncedLeagues = 0;
    const skippedLeagues = [];
    const failedLeagues = [];

    for (let r = 1; r < configData.length; r++) {
      const cfgRow = configData[r];

      const leagueId = leagueIdCol !== undefined ? String(cfgRow[leagueIdCol] || '').trim() : `Row${r}`;
      const leagueName = leagueNameCol !== undefined ? String(cfgRow[leagueNameCol] || '').trim() : leagueId;
      const fileUrl = urlCol !== undefined ? String(cfgRow[urlCol] || '').trim() : '';
      const status = statusCol !== undefined ? String(cfgRow[statusCol] || 'Active').trim() : 'Active';

      Logger.log('');
      Logger.log('------------------------------------------------------------');
      Logger.log(`[LEAGUE] ${leagueName || leagueId}`);
      Logger.log(`        status=${status} url=${fileUrl ? fileUrl.substring(0, 60) + '...' : '(empty)'}`);
      Logger.log('------------------------------------------------------------');

      if (status.toLowerCase() !== 'active') { skippedLeagues.push(`${leagueName}: Inactive`); continue; }
      if (!fileUrl || fileUrl.includes('PASTE_')) { skippedLeagues.push(`${leagueName}: No URL`); continue; }

      try {
        const satellite = SpreadsheetApp.openByUrl(fileUrl);
        Logger.log(`[SAT] Opened satellite: "${satellite.getName()}"`);

        if (DEBUG_LOG_SHEET_NAMES) {
          const names = satellite.getSheets().map(s => s.getName());
          Logger.log(`[SAT] Sheets (${names.length}): ${names.join(', ')}`);
        }

        const tier1Map = _loadTier1PredictionsLatestMap_(satellite);
        const upcMap   = _loadUpcomingCleanMap_(satellite);
        const tier2Map = _loadTier2LogLatestMap_(satellite);
        const ouMap    = _loadOuLogLatestMap_(satellite);

        Logger.log(`[MAP] Tier1_Predictions latest entries: ${Object.keys(tier1Map).length}`);
        Logger.log(`[MAP] UpcomingClean entries: ${Object.keys(upcMap).length}`);
        Logger.log(`[MAP] Tier2_Log latest entries: ${Object.keys(tier2Map).length}`);
        Logger.log(`[MAP] OU_Log buckets (game|q|dir): ${Object.keys(ouMap).length}`);

        // ──────────────────────────────────────────────────────────────
        // ✅ FOREBET PATCH: Build gameKey -> forebet_prediction (1/2)
        //    from Tier1_Predictions sheet directly (deterministic).
        // ──────────────────────────────────────────────────────────────
        const forebetPredByGameKey = {};
        try {
          const t1Sheet = getSheetInsensitive(satellite, 'Tier1_Predictions');
          if (t1Sheet) {
            const t1Data = t1Sheet.getDataRange().getValues();
            if (t1Data && t1Data.length >= 2) {
              const h = (t1Data[0] || []).map(x => String(x || '').toLowerCase().trim());

              const idx = {
                fb:     h.findIndex(x => x === 'forebet_prediction' || x === 'forebet prediction' || x === 'forebetprediction'),
                date:   h.findIndex(x => x === 'date' || x === 'match date' || x === 'fixture date' || x === 'game date'),
                league: h.findIndex(x => x === 'league' || x === 'league name' || x === 'league id' || x === 'league_id'),
                home:   h.findIndex(x => x === 'home' || x === 'home team' || x === 'hometeam'),
                away:   h.findIndex(x => x === 'away' || x === 'away team' || x === 'awayteam'),
                match:  h.findIndex(x => x === 'match' || x === 'fixture' || x === 'game')
              };

              if (idx.fb >= 0) {
                let loaded = 0, skipped = 0;

                for (let i = 1; i < t1Data.length; i++) {
                  const row = t1Data[i] || [];
                  const fbPred = _coerceForebetPrediction_(row[idx.fb]);
                  if (!fbPred) { skipped++; continue; }

                  const rowLeague = (idx.league >= 0) ? String(row[idx.league] || '').trim() : '';
                  const leagueForKey = rowLeague || leagueName || leagueId;

                  const dateYMD = (idx.date >= 0) ? _toYMD_(row[idx.date]) : '';
                  if (!dateYMD) { skipped++; continue; }

                  let home = (idx.home >= 0) ? String(row[idx.home] || '').trim() : '';
                  let away = (idx.away >= 0) ? String(row[idx.away] || '').trim() : '';

                  if ((!home || !away) && idx.match >= 0) {
                    const m = String(row[idx.match] || '').trim();
                    if (m) {
                      const t = _parseMatchTeams_(m);
                      home = home || (t.home || '');
                      away = away || (t.away || '');
                    }
                  }

                  if (!home || !away) { skipped++; continue; }

                  const gk = _gameKey_(leagueForKey, dateYMD, home, away);
                  if (!gk) { skipped++; continue; }

                  forebetPredByGameKey[gk] = fbPred;
                  loaded++;
                }

                Logger.log(`[FOREBET] Loaded deterministic forebet_prediction: ${loaded} rows (skipped=${skipped})`);
              } else {
                Logger.log('[FOREBET] Tier1_Predictions: forebet_prediction column not found');
              }
            } else {
              Logger.log('[FOREBET] Tier1_Predictions: empty or too small');
            }
          } else {
            Logger.log('[FOREBET] Tier1_Predictions sheet not found in satellite');
          }
        } catch (e) {
          Logger.log('[FOREBET] Non-fatal: failed to build forebet map: ' + e.message);
        }

        const betSheet = getSheetInsensitive(satellite, 'Bet_Slips');
        if (!betSheet) { failedLeagues.push(`${leagueName}: No Bet_Slips sheet`); continue; }

        const betData = betSheet.getDataRange().getValues();
        if (betData.length < 3) { skippedLeagues.push(`${leagueName}: Bet_Slips too small`); continue; }

        let headerRowIndex = -1;
        for (let scanRow = 0; scanRow < Math.min(20, betData.length); scanRow++) {
          const rowStrings = betData[scanRow].map(cell => String(cell || '').toLowerCase().trim());
          const hasMatch = rowStrings.includes('match') || rowStrings.includes('game');
          const hasPick  = rowStrings.includes('pick') || rowStrings.includes('selection') || rowStrings.includes('selection_text');
          const hasType  = rowStrings.includes('type');
          const hasLeague= rowStrings.includes('league');
          const hasHomeAway = rowStrings.includes('home') && rowStrings.includes('away');
          if ((hasMatch || hasHomeAway) && (hasPick || hasType || hasLeague)) { headerRowIndex = scanRow; break; }
        }
        if (headerRowIndex === -1) { failedLeagues.push(`${leagueName}: No header row in Bet_Slips`); continue; }

        const firstDataRowIndex = headerRowIndex + 1;
        const betHeaderMap = createHeaderMapWithAliases(betData[headerRowIndex]);

        const matchCol = betHeaderMap['match'];
        const pickCol  = betHeaderMap['pick'];
        const dateCol  = betHeaderMap['date'];
        const timeCol  = betHeaderMap['time'];
        const typeCol  = betHeaderMap['type'];
        const oddsCol  = betHeaderMap['odds'];
        const confCol  = betHeaderMap['confidence'];
        const evCol    = betHeaderMap['ev'];
        const leagueCol= betHeaderMap['league'];
        const homeCol  = betHeaderMap['home'];
        const awayCol  = betHeaderMap['away'];

        const tierCol  = betHeaderMap['tier']
                      ?? betHeaderMap['risk tier']
                      ?? betHeaderMap['risktier']
                      ?? betHeaderMap['risk_tier'];

        const hasLegacyMatch = matchCol !== undefined;
        const hasSplitTeams = homeCol !== undefined && awayCol !== undefined;
        const hasPick = pickCol !== undefined;

        Logger.log(`[BET] Bet_Slips header row (1-indexed): ${headerRowIndex + 1}`);
        Logger.log(`[BET] Cols: match=${matchCol} pick=${pickCol} home=${homeCol} away=${awayCol} date=${dateCol} time=${timeCol} type=${typeCol} odds=${oddsCol} conf=${confCol} ev=${evCol} league=${leagueCol} tier=${tierCol}`);

        if (!hasPick || (!hasLegacyMatch && !hasSplitTeams)) {
          failedLeagues.push(`${leagueName}: Bet_Slips missing Match/Pick (or Home/Away + Selection_Text) columns`);
          continue;
        }

        let leagueBets = 0;
        let skippedRows = 0;
        let hitSummary = false;
        let debugLogged = 0;

        for (let i = firstDataRowIndex; i < betData.length; i++) {
          const betRow = betData[i];
          let matchStr = '';
          if (hasLegacyMatch) {
            matchStr = String(betRow[matchCol] || '').trim();
          } else if (hasSplitTeams) {
            const h = String(betRow[homeCol] || '').trim();
            const a = String(betRow[awayCol] || '').trim();
            matchStr = (h && a) ? (h + ' vs ' + a) : '';
          }

          if (!matchStr) { skippedRows++; continue; }

          if (matchStr.toLowerCase().includes('summary') ||
              matchStr.includes('━━━') ||
              matchStr.toLowerCase().includes('total')) {
            const fullRowStr = betRow.join(' ').toLowerCase();
            if (fullRowStr.includes('sniper') || fullRowStr.includes('banker')) continue;
            if (hitSummary) break;
            hitSummary = true;
            continue;
          }

          if (matchStr.includes('━') || matchStr.includes('---') || matchStr.includes('===') ||
              matchStr.toLowerCase() === 'match' || matchStr.toLowerCase() === 'game' ||
              matchStr.toLowerCase().includes('no bankers') ||
              matchStr.toLowerCase().includes('no snipers') ||
              matchStr.toLowerCase().includes('matching criteria')) {
            continue;
          }

          const pick = String(betRow[pickCol] || '').trim();
          if (!pick) { skippedRows++; continue; }

          const rowLeague = leagueCol !== undefined ? String(betRow[leagueCol] || '').trim() : '';
          const league = rowLeague || leagueName || leagueId;

          const dateRaw = dateCol !== undefined ? betRow[dateCol] : '';
          const timeRaw = timeCol !== undefined ? betRow[timeCol] : '';
          const type    = typeCol !== undefined ? String(betRow[typeCol] || '').trim() : '';
          const odds    = oddsCol !== undefined ? betRow[oddsCol] : '';
          const confRaw = confCol !== undefined ? betRow[confCol] : '';
          const evRaw   = evCol !== undefined ? betRow[evCol] : '';

          const tierSlipRaw = tierCol !== undefined ? String(betRow[tierCol] || '').trim() : '';
          const tierSlip = _cleanTierString_(tierSlipRaw);

          const teams = _parseMatchTeams_(matchStr);
          const dateYMD = _toYMD_(dateRaw);

          const baseKey = dateYMD ? _baseKey_(league, dateYMD, teams.home, teams.away) : '';
          const gameKey = dateYMD ? _gameKey_(league, dateYMD, teams.home, teams.away) : '';

          const quarter = _parseQuarter_(pick);
          const isOU = _looksLikeOU_(pick);
          const isQSpread = !!quarter && !isOU;

          const market = isOU ? 'OU' : (isQSpread ? 'Q_SPREAD' : 'MAIN');
          const parsed = isOU
            ? _parseOuPick_(pick)
            : (isQSpread ? _parseSpreadPick_(pick) : { direction:'', line:'' });

          let confidence = _toPctNumber_(confRaw);
          let confSource = (confidence !== '' && confidence !== null) ? 'Bet_Slips' : '';

          const upc = (dateYMD && baseKey) ? (upcMap[baseKey] || {}) : {};
          if ((confidence === '' || confidence === null) && isQSpread && quarter && dateYMD && baseKey) {
            const c = upc[`t2-${quarter.toLowerCase()}-conf`];
            const cNum = _toPctNumber_(c);
            if (cNum !== '') {
              confidence = cNum;
              confSource = `UpcomingClean(t2-${quarter.toLowerCase()}-conf)`;
            }
          }

          const tier1 = (dateYMD && gameKey) ? (tier1Map[gameKey] || {}) : {};
          const magPred  = tier1.magPred ?? '';
          const magConf  = _toPctNumber_(tier1.magConf);
          const magScore = tier1.magScore ?? '';
          const fbPred   = tier1.forebetPred ?? '';
          const fbPct    = tier1.forebetPct ?? '';
          const tier1Cfg = tier1.tunedConfig ?? '';
          const tier1Ts  = tier1.tunedTimestamp ?? '';

          let tier2Tier = '';
          let tier2Abs = '';
          let tier2Cfg = '';
          let tier2Ts = '';
          if (isQSpread && quarter && dateYMD && baseKey) {
            const t2 = tier2Map[`${baseKey}|${quarter}`];
            if (t2) {
              tier2Tier = t2.tier || '';
              tier2Abs = t2.absMargin || '';
              tier2Cfg = t2.configVersion || '';
              tier2Ts  = t2.timestamp || '';
            }
          }

          let ouTier = '';
          let ouEdge = '';
          let ouEV = '';
          let ouCfg = '';
          let ouTs = '';
          let ouChosenThreshold = '';
          let ouCandidateCount = 0;

          if (isOU && quarter && parsed.direction && dateYMD && baseKey) {
            const ouKey = `${baseKey}|${quarter}|${parsed.direction}`;
            const candidates = ouMap[ouKey] || [];
            ouCandidateCount = candidates.length;

            const best = _findClosestOu_(candidates, parsed.line);
            if (best) {
              ouChosenThreshold = best.threshold;
              if (confidence === '' || confidence === null) {
                const cNum = _toPctNumber_(best.confidence);
                if (cNum !== '') {
                  confidence = cNum;
                  confSource = 'OU_Log(confidence)';
                }
              }
              if (evRaw === '' || evRaw === null) ouEV = best.ev;

              ouTier = best.tier;
              ouEdge = best.edge;
              ouCfg = best.configVersion || '';
              ouTs  = best.timestamp || '';
            }
          }

          const dateOut = dateRaw || tier1.date || '';
          const timeOut = timeRaw || tier1.time || '';

          const evOut = (evRaw !== '' && evRaw !== null) ? evRaw : ouEV;
          const evSource = (evRaw !== '' && evRaw !== null) ? 'Bet_Slips' : (ouEV !== '' ? 'OU_Log(EV)' : '');

          const tierOut = tierSlip
            || _cleanTierString_(isOU ? (ouTier || '') : (isQSpread ? (tier2Tier || '') : ''))
            || _deriveTierFromConfidence_(confRaw);
          const edgeOut = isOU ? (ouEdge || '') : (isQSpread ? (tier2Abs || '') : '');

          // ──────────────────────────────────────────────────────────────
          // ✅ FOREBET PATCH: deterministic prediction + action
          // ──────────────────────────────────────────────────────────────
          const forebetPrediction =
            (gameKey && forebetPredByGameKey.hasOwnProperty(gameKey))
              ? forebetPredByGameKey[gameKey]
              : _coerceForebetPrediction_(fbPred);

          let forebetAction = 'NA';
          if (!isOU && (forebetPrediction === 1 || forebetPrediction === 2)) {
            const side = _inferPickSideHomeAway_(pick, teams);
            if (forebetPrediction === 1) {
              if (side === 'HOME') forebetAction = 'WITH';
              else if (side === 'AWAY') forebetAction = 'AGAINST';
            } else if (forebetPrediction === 2) {
              if (side === 'AWAY') forebetAction = 'WITH';
              else if (side === 'HOME') forebetAction = 'AGAINST';
            }
          }

          out.push([
            league,
            dateOut,
            timeOut,
            teams.home,
            teams.away,
            `${teams.home} vs ${teams.away}`,
            market,
            quarter,
            pick,
            parsed.line,
            parsed.direction,
            type,
            odds,
            confidence,
            evOut,

            magPred,
            magConf,
            magScore,
            fbPred,
            fbPct,

            forebetPrediction,
            forebetAction,

            tierOut,
            edgeOut,

            tier1Cfg,
            tier1Ts,
            tier2Cfg,
            tier2Ts,
            ouCfg,
            ouTs,

            'Bet_Slips',
            i + 1,
            gameKey
          ]);

          leagueBets++;
          totalBets++;

          if (DEBUG && debugLogged < DEBUG_MAX_ROWS) {
            debugLogged++;

            Logger.log('');
            Logger.log(`[ROW] Bet_Slips row=${i + 1}`);
            Logger.log(`      league="${league}" dateRaw="${dateRaw}" dateYMD="${dateYMD}" timeRaw="${timeRaw}"`);
            Logger.log(`      match="${matchStr}" => home="${teams.home}" away="${teams.away}"`);
            Logger.log(`      keys: baseKey="${baseKey}" gameKey="${gameKey}"`);
            Logger.log(`      pick="${pick}" => market=${market} quarter="${quarter}" dir="${parsed.direction}" line="${parsed.line}"`);
            Logger.log(`      confRaw="${confRaw}" => confidence="${confidence}" source="${confSource}"`);
            Logger.log(`      evRaw="${evRaw}" => evOut="${evOut}" source="${evSource}"`);
            Logger.log(`      tierSlip="${tierSlip}" => tierOut="${tierOut}"`);
            Logger.log(`      [FOREBET] prediction=${forebetPrediction} action="${forebetAction}" (tier1.forebetPred="${fbPred}")`);

            if (gameKey && tier1Map[gameKey]) {
              Logger.log(`      [Tier1 HIT] cfg="${tier1Cfg}" ts="${tier1Ts}" magPred="${magPred}" magConf="${magConf}" magScore="${magScore}" fbPred="${fbPred}" fb%="${fbPct}"`);
            } else {
              Logger.log(`      [Tier1 MISS] (no Tier1_Predictions match for gameKey)`);
            }

            if (isQSpread && quarter) {
              const t2Key = baseKey ? `${baseKey}|${quarter}` : '';
              if (t2Key && tier2Map[t2Key]) {
                Logger.log(`      [Tier2 HIT] key="${t2Key}" cfg="${tier2Cfg}" ts="${tier2Ts}" tier="${tier2Tier}" absMargin="${tier2Abs}"`);
              } else {
                Logger.log(`      [Tier2 MISS] key="${t2Key}" (no Tier2_Log match)`);
              }

              const upcKey = baseKey || '';
              if (upcKey && upcMap[upcKey]) {
                Logger.log(`      [UpcomingClean HIT] key="${upcKey}" qConf="${upc[`t2-${quarter.toLowerCase()}-conf`]}"`);
              } else {
                Logger.log(`      [UpcomingClean MISS] key="${upcKey}"`);
              }
            }

            if (isOU && quarter && parsed.direction) {
              const ouKey = baseKey ? `${baseKey}|${quarter}|${parsed.direction}` : '';
              Logger.log(`      [OU LOOKUP] key="${ouKey}" candidates=${ouCandidateCount} chosenThreshold="${ouChosenThreshold}" cfg="${ouCfg}" ts="${ouTs}" tier="${ouTier}" edge="${ouEdge}" ev="${ouEV}"`);
            }
          }
        }

        Logger.log(`[LEAGUE DONE] ${leagueName}: synced=${leagueBets} skippedRows=${skippedRows} debugLogged=${debugLogged}`);

        if (lastSyncCol !== undefined) {
          configSheet.getRange(r + 1, lastSyncCol + 1).setValue(new Date().toLocaleString());
        }

        if (leagueBets > 0) syncedLeagues++;
        else skippedLeagues.push(`${leagueName}: 0 valid bets found`);

      } catch (e) {
        Logger.log(`[LEAGUE ERROR] ${leagueName}: ${e.message}`);
        Logger.log(e.stack || '');
        failedLeagues.push(`${leagueName}: ${e.message}`);
      }
    }

    if (out.length > 0) {
      syncSheet.getRange(2, 1, out.length, headers.length).setValues(out);
      try {
        syncSheet.autoResizeColumns(1, headers.length);
      } catch (e) {
        Logger.log('[FINALIZE] autoResizeColumns failed (non-fatal): ' + e.message);
      }
    }

    try {
      updateDashboard();
    } catch (e) {
      Logger.log('[FINALIZE] updateDashboard failed (non-fatal): ' + e.message);
    }

    Logger.log('========== BET SYNC SUMMARY ==========');
    Logger.log(`Total bets synced: ${totalBets}`);
    Logger.log(`Leagues synced: ${syncedLeagues}`);
    Logger.log(`Leagues skipped: ${skippedLeagues.length}`);
    if (skippedLeagues.length) skippedLeagues.forEach(s => Logger.log('  SKIP: ' + s));
    Logger.log(`Leagues failed: ${failedLeagues.length}`);
    if (failedLeagues.length) failedLeagues.forEach(f => Logger.log('  FAIL: ' + f));
    Logger.log('========== HIVEMIND BET SYNC COMPLETE ==========');

    const message =
      `Synced ${totalBets} bets from ${syncedLeagues} leagues.\n\n` +
      `DEBUG mode: ${DEBUG ? 'ON' : 'OFF'} (max per-league detailed logs: ${DEBUG_MAX_ROWS}).\n\n` +
      (failedLeagues.length ? `Failed:\n${failedLeagues.join('\n')}` : 'No failures.');

    if (ui) ui.alert('Bet Sync Complete (v4.4 FOREBET-DETERMINISTIC)', message, ui.ButtonSet.OK);
    else Logger.log('[ALERT suppressed] ' + message.replace(/\n/g, ' | '));

  } catch (e) {
    Logger.log(`[FATAL] ${e.message}`);
    Logger.log(e.stack || '');
    if (ui) ui.alert('Sync Error', e.message, ui.ButtonSet.OK);
  }
}


/** =========================
 *  2) DATE/TIME “LATEST” HELPERS (ADD)
 *  ========================= */
function _parseDateTime_(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v;

  const s = String(v).trim();

  // dd/mm/yyyy hh:mm:ss (your logs)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10) - 1;
    const yyyy = parseInt(m[3], 10);
    const HH = parseInt(m[4] || '0', 10);
    const MI = parseInt(m[5] || '0', 10);
    const SS = parseInt(m[6] || '0', 10);
    return new Date(yyyy, mm, dd, HH, MI, SS);
  }

  // fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function _isLater_(a, b) {
  if (!a) return false;
  if (!b) return true;
  return a.getTime() > b.getTime();
}


/** =========================
 *  3) BASIC PARSERS / KEYS (ADD)
 *  ========================= */
function _parseMatchTeams_(matchStr) {
  const s = String(matchStr || '').trim();

  // common patterns: "Home vs Away", "Home v Away"
  let parts = s.split(/\s+vs\.?\s+/i);
  if (parts.length === 2) return { home: parts[0].trim(), away: parts[1].trim() };

  parts = s.split(/\s+v\s+/i);
  if (parts.length === 2) return { home: parts[0].trim(), away: parts[1].trim() };

  return { home: '', away: '' };
}

function _toPctNumber_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (!s) return '';
  const n = parseFloat(s.replace('%',''));
  return isNaN(n) ? '' : n;
}

function _toYMD_(dateRaw) {
  if (!dateRaw) return '';
  if (dateRaw instanceof Date && !isNaN(dateRaw.getTime())) {
    return Utilities.formatDate(dateRaw, Session.getScriptTimeZone(), 'yyyyMMdd');
  }
  const s = String(dateRaw).trim();

  // dd/mm/yyyy
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}${String(m1[2]).padStart(2,'0')}${String(m1[1]).padStart(2,'0')}`;

  // yyyy-mm-dd
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return `${m2[1]}${m2[2]}${m2[3]}`;

  return ''; // don’t guess
}

function _normTeamKey_(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

function _baseKey_(league, dateYMD, home, away) {
  return `${String(league||'').trim()}|${dateYMD}|${_normTeamKey_(home)}|${_normTeamKey_(away)}`;
}

function _gameKey_(league, dateYMD, home, away) {
  return `${String(league||'').trim()}_${dateYMD}_${_normTeamKey_(home)}_${_normTeamKey_(away)}`;
}

function _parseQuarter_(text) {
  const m = String(text || '').toUpperCase().match(/\bQ([1-4])\b/);
  return m ? `Q${m[1]}` : '';
}

function _looksLikeOU_(pick) {
  const s = String(pick || '').toUpperCase();
  return s.includes('OVER') || s.includes('UNDER');
}

function _parseSpreadPick_(pick) {
  // Examples: "Q1: A +12.5 ★" or "H +16.5" or "Q3 H -2.5"
  const s = String(pick || '')
    .toUpperCase()
    .replace(/\bQ[1-4]\s*:\s*/g, '')
    .trim();

  const side = (s.match(/\b(H|A)\b/) || [])[1] || '';
  const num = (s.match(/([+-]?\d+(\.\d+)?)/) || [])[1];
  return { direction: side, line: (num ? parseFloat(num) : '') };
}

function _parseOuPick_(pick) {
  const raw = String(pick ?? '');
  let s = raw.toUpperCase();

  // ── Normalize common noise ──────────────────────────────────────
  s = s.replace(/½/g, '.5');              // unicode half → .5
  s = s.replace(/,/g, '.');              // decimal comma → dot
  s = s.replace(/[⭐★☆✅❌:–—]/g, ' '); // strip decorations / dashes
  s = s.replace(/\s+/g, ' ').trim();

  // ── Strip tokens whose digits would poison line extraction ──────
  s = s.replace(/\bQUARTER\s*[1-4]\b/g, ' ');
  s = s.replace(/\bQ[1-4]\b/g, ' ');
  s = s.replace(/\bSNIPER\s+DIR\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // ── Structured patterns (priority order) ────────────────────────
  const patterns = [
    /\b(OVER|UNDER)\s+([0-9]+(?:\.[0-9]+)?)/,  // OVER 43.5
    /\b(OVER|UNDER)([0-9]+(?:\.[0-9]+)?)/,     // OVER43.5
    /\b([OU])\s+([0-9]+(?:\.[0-9]+)?)/,        // O 43.5
    /\b([OU])([0-9]+(?:\.[0-9]+)?)/,           // O43.5
    /([0-9]+(?:\.[0-9]+)?)\s+(OVER|UNDER)\b/,  // 43.5 OVER
    /([0-9]+(?:\.[0-9]+)?)\s+([OU])\b/,        // 43.5 O
  ];

  let dirToken = '';
  let numToken = '';

  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;

    if (/^(OVER|UNDER|O|U)$/.test(m[1])) {
      dirToken = m[1];
      numToken = m[2];
    } else if (/^(OVER|UNDER|O|U)$/.test(m[2])) {
      dirToken = m[2];
      numToken = m[1];
    }
    break;                                      // first match wins
  }

  // ── Fallback: keyword scan ──────────────────────────────────────
  if (!dirToken) {
    if (/\bUNDER\b/.test(s) || /\bU\b/.test(s)) dirToken = 'U';
    else if (/\bOVER\b/.test(s) || /\bO\b/.test(s)) dirToken = 'O';
  }

  // Safe now that Q-tokens are stripped
  if (!numToken) {
    const mNum = s.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (mNum) numToken = mNum[1];
  }

  // ── Normalise output ───────────────────────────────────────────
  const direction =
    (dirToken === 'O' || dirToken === 'OVER')  ? 'OVER'  :
    (dirToken === 'U' || dirToken === 'UNDER') ? 'UNDER' : '';

  const n = numToken ? parseFloat(numToken) : NaN;

  return {
    direction,
    line: Number.isFinite(n) ? n : ''           // never NaN
  };
}

function _findClosestOu_(entries, targetLine) {
  if (!entries || entries.length === 0) return null;
  if (targetLine === '' || targetLine === null || isNaN(targetLine)) return entries[0];

  let best = null;
  let bestDiff = Infinity;

  for (const e of entries) {
    const th = parseFloat(e.threshold);
    if (isNaN(th)) continue;
    const diff = Math.abs(th - targetLine);
    if (diff < bestDiff) { bestDiff = diff; best = e; }
  }
  return best;
}


/** =========================
 *  4) MAP LOADERS (ADD/REPLACE)
 *  ========================= */

/**
 * Tier1_Predictions — LATEST row per game_key by Timestamp.
 * Key: game_key (exact)
 */
function _loadTier1PredictionsLatestMap_(satellite) {
  const sh = getSheetInsensitive(satellite, 'Tier1_Predictions');
  const map = {};
  if (!sh) return map;

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return map;

  const h = createHeaderMapWithAliases(data[0]);

  const gameKeyCol = h['game_key'];
  const tsCol      = h['timestamp'];
  const cfgCol     = h['config_version'];

  const leagueCol  = h['league'];
  const dateCol    = h['date'];
  const homeCol    = h['home'];
  const awayCol    = h['away'];
  const timeCol    = h['time']; // may not exist; safe

  const magScoreCol= h['magolide_score'] ?? h['magolide score'];
  const predCol    = h['prediction'];
  const confCol    = h['confidence'];

  const fbPredCol  = h['forebet_prediction'] ?? h['forebet pred'];
  const fbConfCol  = h['forebet_confidence'] ?? h['forebet %'];

  if (gameKeyCol === undefined) return map;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const gk = String(row[gameKeyCol] || '').trim();
    if (!gk) continue;

    const ts = _parseDateTime_(tsCol !== undefined ? row[tsCol] : null);

    const existing = map[gk];
    const existingTs = existing ? existing._ts : null;

    if (!existing || _isLater_(ts, existingTs)) {
      map[gk] = {
        _ts: ts,
        tunedTimestamp: (tsCol !== undefined ? row[tsCol] : ''),
        tunedConfig: (cfgCol !== undefined ? row[cfgCol] : ''),
        league: (leagueCol !== undefined ? row[leagueCol] : ''),
        date: (dateCol !== undefined ? row[dateCol] : ''),
        time: (timeCol !== undefined ? row[timeCol] : ''),
        home: (homeCol !== undefined ? row[homeCol] : ''),
        away: (awayCol !== undefined ? row[awayCol] : ''),
        magPred: (predCol !== undefined ? row[predCol] : ''),
        magConf: (confCol !== undefined ? row[confCol] : ''),
        magScore: (magScoreCol !== undefined ? row[magScoreCol] : ''),
        forebetPred: (fbPredCol !== undefined ? row[fbPredCol] : ''),
        forebetPct: (fbConfCol !== undefined ? row[fbConfCol] : '')
      };
    }
  }

  return map;
}

/**
 * UpcomingClean — quarter spread confidences (t2-qX-conf).
 * Key: baseKey = league|yyyyMMdd|HOME|AWAY
 */
function _loadUpcomingCleanMap_(satellite) {
  const sh = getSheetInsensitive(satellite, 'UpcomingClean');
  const map = {};
  if (!sh) return map;

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return map;

  const h = createHeaderMapWithAliases(data[0]);

  const leagueCol = h['league'];
  const homeCol = h['home'];
  const awayCol = h['away'];
  const dateCol = h['date'];

  const qConfCols = {
    q1: h['t2-q1-conf'],
    q2: h['t2-q2-conf'],
    q3: h['t2-q3-conf'],
    q4: h['t2-q4-conf']
  };

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const league = leagueCol !== undefined ? String(row[leagueCol] || '').trim() : '';
    const home = homeCol !== undefined ? String(row[homeCol] || '').trim() : '';
    const away = awayCol !== undefined ? String(row[awayCol] || '').trim() : '';
    const dateYMD = _toYMD_(dateCol !== undefined ? row[dateCol] : '');
    if (!league || !home || !away || !dateYMD) continue;

    const key = _baseKey_(league, dateYMD, home, away);
    map[key] = map[key] || {};

    if (qConfCols.q1 !== undefined) map[key]['t2-q1-conf'] = row[qConfCols.q1];
    if (qConfCols.q2 !== undefined) map[key]['t2-q2-conf'] = row[qConfCols.q2];
    if (qConfCols.q3 !== undefined) map[key]['t2-q3-conf'] = row[qConfCols.q3];
    if (qConfCols.q4 !== undefined) map[key]['t2-q4-conf'] = row[qConfCols.q4];
  }

  return map;
}

/**
 * Tier2_Log — LATEST row per (game, quarter) by Timestamp.
 * Key: baseKey|Qx
 */
function _loadTier2LogLatestMap_(satellite) {
  const sh = getSheetInsensitive(satellite, 'Tier2_Log');
  const map = {};
  if (!sh) return map;

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return map;

  const h = createHeaderMapWithAliases(data[0]);

  const tsCol      = h['timestamp'];
  const cfgCol     = h['config_version'];

  const leagueCol  = h['league'];
  const homeCol    = h['home'];
  const awayCol    = h['away'];
  const dateCol    = h['date'];
  const quarterCol = h['quarter'];

  const tierCol    = h['tier'];
  const absCol     = h['abs_margin'] ?? h['abs margin'];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const league = leagueCol !== undefined ? String(row[leagueCol] || '').trim() : '';
    const home = homeCol !== undefined ? String(row[homeCol] || '').trim() : '';
    const away = awayCol !== undefined ? String(row[awayCol] || '').trim() : '';
    const dateYMD = _toYMD_(dateCol !== undefined ? row[dateCol] : '');
    const quarter = quarterCol !== undefined ? String(row[quarterCol] || '').toUpperCase().trim() : '';
    if (!league || !home || !away || !dateYMD || !quarter) continue;

    const baseKey = _baseKey_(league, dateYMD, home, away);
    const key = `${baseKey}|${quarter}`;

    const ts = _parseDateTime_(tsCol !== undefined ? row[tsCol] : null);

    const existing = map[key];
    const existingTs = existing ? existing._ts : null;

    if (!existing || _isLater_(ts, existingTs)) {
      map[key] = {
        _ts: ts,
        timestamp: (tsCol !== undefined ? row[tsCol] : ''),
        configVersion: (cfgCol !== undefined ? row[cfgCol] : ''),
        tier: (tierCol !== undefined ? row[tierCol] : ''),
        absMargin: (absCol !== undefined ? row[absCol] : '')
      };
    }
  }

  return map;
}

/**
 * OU_Log — LATEST row per (game, quarter, direction, threshold) by Timestamp.
 * Returned structure:
 *   map[baseKey|Qx|DIR] = [ { threshold, confidence, ev, tier, edge, configVersion, timestamp }, ... ]
 */
function _loadOuLogLatestMap_(satellite) {
  const sh = getSheetInsensitive(satellite, 'OU_Log');
  const map = {};
  if (!sh) return map;

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return map;

  const h = createHeaderMapWithAliases(data[0]);

  const tsCol      = h['timestamp'];
  const cfgCol     = h['config_version'];

  const leagueCol  = h['league'];
  const homeCol    = h['home'];
  const awayCol    = h['away'];
  const dateCol    = h['date'];
  const quarterCol = h['quarter'];

  const thresholdCol = h['threshold'];
  const predCol      = h['prediction'];  // OVER/UNDER
  const confCol      = h['confidence'];
  const evCol        = h['ev_percent'] ?? h['ev percent'] ?? h['ev'];
  const tierCol      = h['tier'];
  const edgeCol      = h['edge_score'] ?? h['edge score'];

  // temp: per (game, q, dir) keep latest per threshold
  // nested[baseKey|Qx|DIR][thresholdStr] = { ...latest }
  const nested = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const league = leagueCol !== undefined ? String(row[leagueCol] || '').trim() : '';
    const home = homeCol !== undefined ? String(row[homeCol] || '').trim() : '';
    const away = awayCol !== undefined ? String(row[awayCol] || '').trim() : '';
    const dateYMD = _toYMD_(dateCol !== undefined ? row[dateCol] : '');
    const quarter = quarterCol !== undefined ? String(row[quarterCol] || '').toUpperCase().trim() : '';

    const dir = predCol !== undefined ? String(row[predCol] || '').toUpperCase().trim() : '';
    const threshold = thresholdCol !== undefined ? row[thresholdCol] : '';

    if (!league || !home || !away || !dateYMD || !quarter || !dir) continue;

    const baseKey = _baseKey_(league, dateYMD, home, away);
    const key = `${baseKey}|${quarter}|${dir}`;
    const thKey = String(threshold).trim(); // exact threshold bucket key

    const ts = _parseDateTime_(tsCol !== undefined ? row[tsCol] : null);

    nested[key] = nested[key] || {};
    const existing = nested[key][thKey];
    const existingTs = existing ? existing._ts : null;

    if (!existing || _isLater_(ts, existingTs)) {
      nested[key][thKey] = {
        _ts: ts,
        timestamp: (tsCol !== undefined ? row[tsCol] : ''),
        configVersion: (cfgCol !== undefined ? row[cfgCol] : ''),
        threshold: threshold,
        confidence: (confCol !== undefined ? row[confCol] : ''),
        ev: (evCol !== undefined ? row[evCol] : ''),
        tier: (tierCol !== undefined ? row[tierCol] : ''),
        edge: (edgeCol !== undefined ? row[edgeCol] : '')
      };
    }
  }

  // flatten nested into arrays
  for (const key in nested) {
    map[key] = Object.keys(nested[key]).map(th => nested[key][th]);
  }

  return map;
}

// ============================================================
// SYNC RESULTS FROM RESULTSCLEAN
// ============================================================
/**
 * WHY: Pull ResultsClean from all active satellite leagues
 * WHAT: Reads Config sheet, imports finished games, writes to Results_Temp
 * VERSION: 3.2 (Fixed header scanning + UI context + verbose logging)
 */
function syncAllResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // ═══════════════════════════════════════════════════════════════
  // SETUP: Handle UI context gracefully
  // ═══════════════════════════════════════════════════════════════
  let ui = null;
  try {
    ui = SpreadsheetApp.getUi();
    Logger.log('[INIT] UI context available');
  } catch (e) {
    Logger.log('[INIT] Running without UI context (trigger or programmatic call)');
  }
  
  Logger.log('');
  Logger.log('╔══════════════════════════════════════════════════════════════╗');
  Logger.log('║         HIVEMIND SYNC RESULTS v3.2 (VERBOSE)                 ║');
  Logger.log('╚══════════════════════════════════════════════════════════════╝');
  Logger.log(`[INIT] Start time: ${new Date().toLocaleString()}`);
  Logger.log('');
  
  try {
    ss.toast('🔄 Starting results sync...', 'Hive Mind', 3);
  } catch (e) {
    Logger.log('[INIT] Toast not available');
  }
  
  try {
    // ═══════════════════════════════════════════════════════════════
    // STEP 1: Get Config sheet
    // ═══════════════════════════════════════════════════════════════
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.log('STEP 1: Loading Config sheet');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const configSheet = getSheetInsensitive(ss, 'Config');
    if (!configSheet) {
      throw new Error('Config sheet not found. Run "Setup Mothership" first.');
    }
    Logger.log(`[CONFIG] ✅ Found Config sheet: "${configSheet.getName()}"`);
    
    const configData = configSheet.getDataRange().getValues();
    Logger.log(`[CONFIG] Total rows: ${configData.length}`);
    
    if (configData.length < 2) {
      throw new Error('Config sheet is empty. Add satellite URLs first.');
    }
    
    // Log config headers
    Logger.log(`[CONFIG] Headers: ${configData[0].join(' | ')}`);
    
    const configHeaderMap = createHeaderMapWithAliases(configData[0]);
    Logger.log(`[CONFIG] Mapped headers: ${JSON.stringify(Object.keys(configHeaderMap))}`);
    
    const leagueNameCol = configHeaderMap['league name'] !== undefined ? configHeaderMap['league name'] : configHeaderMap['league'];
    const urlCol = configHeaderMap['file url'] !== undefined ? configHeaderMap['file url'] : configHeaderMap['url'];
    const statusCol = configHeaderMap['status'];
    
    Logger.log(`[CONFIG] Column indices - LeagueName: ${leagueNameCol}, URL: ${urlCol}, Status: ${statusCol}`);
    
    if (urlCol === undefined) {
      throw new Error('Config sheet missing "File URL" column.');
    }
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 2: Setup Results_Temp sheet
    // ═══════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.log('STEP 2: Setting up Results_Temp sheet');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    let resultsSheet = getSheetInsensitive(ss, 'Results_Temp');
    if (!resultsSheet) {
      resultsSheet = ss.insertSheet('Results_Temp');
      Logger.log('[RESULTS_TEMP] ✅ Created new sheet');
    } else {
      Logger.log('[RESULTS_TEMP] ✅ Using existing sheet');
    }
    resultsSheet.clear();
    Logger.log('[RESULTS_TEMP] Cleared existing data');
    
    // Results headers
    const resultsHeaders = ['League', 'Game Type', 'Home', 'Away', 'Date', 'Time', 'Prob %', 'Pred', 'Pred Score', 'Avg', 'Odds', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'Status', 'FT Score'];
    resultsSheet.getRange(1, 1, 1, resultsHeaders.length).setValues([resultsHeaders])
      .setFontWeight('bold')
      .setBackground('#38761d')
      .setFontColor('#ffffff');
    Logger.log(`[RESULTS_TEMP] Headers written: ${resultsHeaders.length} columns`);
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 3: Process each league
    // ═══════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.log('STEP 3: Processing satellite leagues');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    let totalGames = 0;
    let finishedGames = 0;
    let syncedLeagues = 0;
    let skippedLeagues = [];
    let failedLeagues = [];
    
    const leagueCount = configData.length - 1;
    Logger.log(`[LEAGUES] Found ${leagueCount} league entries to process`);
    
    for (let r = 1; r < configData.length; r++) {
      const row = configData[r];
      
      const leagueName = leagueNameCol !== undefined ? String(row[leagueNameCol] || '').trim() : `League${r}`;
      const fileUrl = urlCol !== undefined ? String(row[urlCol] || '').trim() : '';
      const status = statusCol !== undefined ? String(row[statusCol] || 'Active').trim() : 'Active';
      
      Logger.log('');
      Logger.log(`┌─────────────────────────────────────────────────────────────┐`);
      Logger.log(`│ LEAGUE ${r}/${leagueCount}: ${leagueName}`);
      Logger.log(`└─────────────────────────────────────────────────────────────┘`);
      Logger.log(`   URL: ${fileUrl ? fileUrl.substring(0, 60) + '...' : '(empty)'}`);
      Logger.log(`   Status: ${status}`);
      
      // Check if active
      if (status.toLowerCase() !== 'active') {
        Logger.log(`   ⏭️ SKIPPED: League status is "${status}" (not active)`);
        skippedLeagues.push(`${leagueName}: Inactive`);
        continue;
      }
      
      // Check if URL is valid
      if (!fileUrl) {
        Logger.log(`   ⏭️ SKIPPED: No URL provided`);
        skippedLeagues.push(`${leagueName}: No URL`);
        continue;
      }
      
      if (fileUrl.includes('PASTE_')) {
        Logger.log(`   ⏭️ SKIPPED: Placeholder URL detected`);
        skippedLeagues.push(`${leagueName}: Placeholder URL`);
        continue;
      }
      
      try {
        // ─────────────────────────────────────────────────────────────
        // Open satellite spreadsheet
        // ─────────────────────────────────────────────────────────────
        Logger.log(`   📡 Attempting to open satellite...`);
        const satellite = SpreadsheetApp.openByUrl(fileUrl);
        Logger.log(`   ✅ Opened: "${satellite.getName()}"`);
        
        // List all sheets in satellite
        const allSheets = satellite.getSheets().map(s => s.getName());
        Logger.log(`   📋 Available sheets: ${allSheets.join(', ')}`);
        
        // ─────────────────────────────────────────────────────────────
        // Find ResultsClean sheet
        // ─────────────────────────────────────────────────────────────
        Logger.log(`   🔍 Looking for ResultsClean sheet...`);
        
        let satResultsSheet = getSheetInsensitive(satellite, 'ResultsClean');
        if (satResultsSheet) {
          Logger.log(`   ✅ Found: "ResultsClean"`);
        } else {
          Logger.log(`   ⚠️ "ResultsClean" not found, trying "Clean"...`);
          satResultsSheet = getSheetInsensitive(satellite, 'Clean');
        }
        
        if (satResultsSheet) {
          Logger.log(`   ✅ Found: "Clean"`);
        } else if (!satResultsSheet) {
          Logger.log(`   ⚠️ "Clean" not found, trying "Results"...`);
          satResultsSheet = getSheetInsensitive(satellite, 'Results');
        }
        
        if (!satResultsSheet) {
          Logger.log(`   ❌ FAILED: No ResultsClean/Clean/Results sheet found`);
          failedLeagues.push(`${leagueName}: No results sheet`);
          continue;
        }
        
        Logger.log(`   📊 Using sheet: "${satResultsSheet.getName()}"`);
        
        // ─────────────────────────────────────────────────────────────
        // Read satellite data
        // ─────────────────────────────────────────────────────────────
        const satData = satResultsSheet.getDataRange().getValues();
        Logger.log(`   📏 Sheet dimensions: ${satData.length} rows x ${satData[0] ? satData[0].length : 0} cols`);
        
        if (satData.length < 2) {
          Logger.log(`   ⚠️ SKIPPED: Sheet has less than 2 rows (no data)`);
          skippedLeagues.push(`${leagueName}: Empty results sheet`);
          continue;
        }
        
        // Log first few rows for debugging
        Logger.log(`   📝 First 3 rows preview:`);
        for (let preview = 0; preview < Math.min(3, satData.length); preview++) {
          const previewRow = satData[preview].slice(0, 8).map(c => String(c || '').substring(0, 15));
          Logger.log(`      Row ${preview}: ${previewRow.join(' | ')}`);
        }
        
        // ─────────────────────────────────────────────────────────────
        // SCAN FOR HEADER ROW
        // ─────────────────────────────────────────────────────────────
        Logger.log(`   🔍 Scanning for header row (looking for Home, Away, Status/Date)...`);
        
        let headerRowIndex = -1;
        let firstDataRowIndex = -1;
        
        for (let scanRow = 0; scanRow < Math.min(20, satData.length); scanRow++) {
          const rowValues = satData[scanRow];
          const rowStrings = rowValues.map(cell => String(cell || '').toLowerCase().trim());
          
          // Log what we're checking
          if (scanRow < 5) {
            Logger.log(`      Scanning row ${scanRow}: ${rowStrings.slice(0, 6).join(', ')}`);
          }
          
          // Look for key ResultsClean headers
          const hasHome = rowStrings.includes('home') || rowStrings.includes('home team');
          const hasAway = rowStrings.includes('away') || rowStrings.includes('away team');
          const hasStatus = rowStrings.includes('status');
          const hasDate = rowStrings.includes('date');
          
          if (hasHome && hasAway && (hasStatus || hasDate)) {
            headerRowIndex = scanRow;
            firstDataRowIndex = scanRow + 1;
            Logger.log(`   🎯 HEADER FOUND at row ${scanRow} (0-indexed)`);
            Logger.log(`      hasHome: ${hasHome}, hasAway: ${hasAway}, hasStatus: ${hasStatus}, hasDate: ${hasDate}`);
            break;
          }
        }
        
        if (headerRowIndex === -1) {
          Logger.log(`   ❌ FAILED: Could not find header row in first 20 rows`);
          Logger.log(`      Expected: Row containing "Home", "Away", and "Status" or "Date"`);
          failedLeagues.push(`${leagueName}: No header row found`);
          continue;
        }
        
        // ─────────────────────────────────────────────────────────────
        // Map header columns
        // ─────────────────────────────────────────────────────────────
        const headerRow = satData[headerRowIndex];
        Logger.log(`   📋 Header row content: ${headerRow.slice(0, 12).join(' | ')}`);
        
        const satHeaders = createHeaderMapWithAliases(headerRow);
        Logger.log(`   📍 Mapped columns: ${JSON.stringify(satHeaders)}`);
        
        // Extract column indices
        const homeCol = satHeaders['home'];
        const awayCol = satHeaders['away'];
        const dateCol = satHeaders['date'];
        const timeCol = satHeaders['time'];
        const statusColR = satHeaders['status'];
        const ftScoreCol = satHeaders['ft score'];
        const q1Col = satHeaders['q1'];
        const q2Col = satHeaders['q2'];
        const q3Col = satHeaders['q3'];
        const q4Col = satHeaders['q4'];
        const predCol = satHeaders['pred'];
        const probCol = satHeaders['prob %'] !== undefined ? satHeaders['prob %'] : satHeaders['probability'];
        const oddsCol = satHeaders['odds'];
        const avgCol = satHeaders['avg'];
        const predScoreCol = satHeaders['pred score'];
        const gameTypeCol = satHeaders['game type'];
        const otCol = satHeaders['ot'];
        
        Logger.log(`   📍 Key columns - Home: ${homeCol}, Away: ${awayCol}, Date: ${dateCol}, Status: ${statusColR}, FT Score: ${ftScoreCol}`);
        Logger.log(`   📍 Quarter cols - Q1: ${q1Col}, Q2: ${q2Col}, Q3: ${q3Col}, Q4: ${q4Col}`);
        
        if (homeCol === undefined || awayCol === undefined) {
          Logger.log(`   ❌ FAILED: Missing required columns (Home: ${homeCol}, Away: ${awayCol})`);
          failedLeagues.push(`${leagueName}: Missing Home/Away columns`);
          continue;
        }
        
        // ─────────────────────────────────────────────────────────────
        // Process data rows
        // ─────────────────────────────────────────────────────────────
        Logger.log(`   📊 Processing data rows starting from row ${firstDataRowIndex}...`);
        
        let leagueGames = 0;
        let leagueFinished = 0;
        let leagueSkipped = 0;
        
        for (let i = firstDataRowIndex; i < satData.length; i++) {
          const satRow = satData[i];
          const home = String(satRow[homeCol] || '').trim();
          const away = String(satRow[awayCol] || '').trim();
          
          // Skip empty rows
          if (!home || !away) {
            leagueSkipped++;
            continue;
          }
          
          // Skip duplicate header rows
          if (home.toLowerCase() === 'home' || away.toLowerCase() === 'away') {
            Logger.log(`      Row ${i}: Skipped duplicate header row`);
            leagueSkipped++;
            continue;
          }
          
          const gameStatus = statusColR !== undefined ? String(satRow[statusColR] || '').toUpperCase() : '';
          
          // Get all values
          const gameType = gameTypeCol !== undefined ? satRow[gameTypeCol] : '';
          const date = dateCol !== undefined ? satRow[dateCol] : '';
          const time = timeCol !== undefined ? satRow[timeCol] : '';
          const prob = probCol !== undefined ? satRow[probCol] : '';
          const pred = predCol !== undefined ? satRow[predCol] : '';
          const predScore = predScoreCol !== undefined ? satRow[predScoreCol] : '';
          const avg = avgCol !== undefined ? satRow[avgCol] : '';
          const odds = oddsCol !== undefined ? satRow[oddsCol] : '';
          const q1 = q1Col !== undefined ? satRow[q1Col] : '';
          const q2 = q2Col !== undefined ? satRow[q2Col] : '';
          const q3 = q3Col !== undefined ? satRow[q3Col] : '';
          const q4 = q4Col !== undefined ? satRow[q4Col] : '';
          const ot = otCol !== undefined ? satRow[otCol] : '';
          const ftScore = ftScoreCol !== undefined ? satRow[ftScoreCol] : '';
          
          leagueGames++;
          totalGames++;
          
          // Check if finished
          const isFinished = (gameStatus === 'FT' || gameStatus === 'FINAL' || gameStatus === 'FINISHED' || gameStatus === 'AET');
          if (isFinished) {
            leagueFinished++;
            finishedGames++;
          }
          
          // Log first few games for verification
          if (leagueGames <= 3) {
            Logger.log(`      Game ${leagueGames}: ${home} vs ${away} | Date: ${date} | Status: ${gameStatus} | FT: ${ftScore}`);
          }
          
          // Write to Results_Temp
          resultsSheet.appendRow([
            leagueName,
            gameType,
            home,
            away,
            date,
            time,
            prob,
            pred,
            predScore,
            avg,
            odds,
            q1,
            q2,
            q3,
            q4,
            ot,
            gameStatus,
            ftScore
          ]);
        }
        
        Logger.log(`   ✅ SYNC COMPLETE for ${leagueName}:`);
        Logger.log(`      Games synced: ${leagueGames}`);
        Logger.log(`      Finished (FT): ${leagueFinished}`);
        Logger.log(`      Rows skipped: ${leagueSkipped}`);
        
        if (leagueGames > 0) {
          syncedLeagues++;
        } else {
          skippedLeagues.push(`${leagueName}: 0 valid games found`);
        }
        
      } catch (e) {
        Logger.log(`   ❌ ERROR: ${e.message}`);
        Logger.log(`   Stack: ${e.stack}`);
        failedLeagues.push(`${leagueName}: ${e.message}`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // STEP 4: Finalize
    // ═══════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.log('STEP 4: Finalizing Results_Temp');
    Logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (totalGames > 0) {
      resultsSheet.autoResizeColumns(1, resultsHeaders.length);
      Logger.log('[FINALIZE] Auto-resized columns');
      
      // Color code finished games
      if (finishedGames > 0) {
        Logger.log('[FINALIZE] Color-coding finished games...');
        const allData = resultsSheet.getDataRange().getValues();
        for (let i = 1; i < allData.length; i++) {
          const status = String(allData[i][16] || '').toUpperCase();
          if (status === 'FT' || status === 'FINAL' || status === 'FINISHED' || status === 'AET') {
            resultsSheet.getRange(i + 1, 17).setBackground('#b7e1cd');
          }
        }
        Logger.log(`[FINALIZE] Colored ${finishedGames} finished game rows`);
      }
    }
    
    // Update dashboard
    Logger.log('[FINALIZE] Updating dashboard...');
    try {
      updateDashboard();
      Logger.log('[FINALIZE] Dashboard updated');
    } catch (e) {
      Logger.log(`[FINALIZE] Dashboard update failed: ${e.message}`);
    }
    
    // ═══════════════════════════════════════════════════════════════
    // FINAL SUMMARY
    // ═══════════════════════════════════════════════════════════════
    Logger.log('');
    Logger.log('╔══════════════════════════════════════════════════════════════╗');
    Logger.log('║                    SYNC RESULTS SUMMARY                      ║');
    Logger.log('╚══════════════════════════════════════════════════════════════╝');
    Logger.log(`   ✅ Total games synced: ${totalGames}`);
    Logger.log(`   ✅ Finished games (FT): ${finishedGames}`);
    Logger.log(`   ✅ Leagues synced: ${syncedLeagues}`);
    Logger.log(`   ⏭️ Leagues skipped: ${skippedLeagues.length}`);
    if (skippedLeagues.length > 0) {
      skippedLeagues.forEach(s => Logger.log(`      - ${s}`));
    }
    Logger.log(`   ❌ Leagues failed: ${failedLeagues.length}`);
    if (failedLeagues.length > 0) {
      failedLeagues.forEach(f => Logger.log(`      - ${f}`));
    }
    Logger.log(`   ⏱️ End time: ${new Date().toLocaleString()}`);
    Logger.log('══════════════════════════════════════════════════════════════');
    
    // Build message
    let message = `✅ Synced ${totalGames} games from ${syncedLeagues} leagues.\n\n`;
    message += `📊 Finished (FT): ${finishedGames} games`;
    
    if (skippedLeagues.length > 0) {
      message += `\n\n⏭️ Skipped (${skippedLeagues.length}): ${skippedLeagues.slice(0, 3).join(', ')}${skippedLeagues.length > 3 ? '...' : ''}`;
    }
    
    if (failedLeagues.length > 0) {
      message += `\n\n❌ Failed (${failedLeagues.length}):\n${failedLeagues.join('\n')}`;
    }
    
    // Show alert if UI available
    if (ui) {
      ui.alert('Results Sync Complete', message, ui.ButtonSet.OK);
    } else {
      Logger.log('[ALERT] ' + message.replace(/\n/g, ' | '));
    }
    
  } catch (e) {
    Logger.log('');
    Logger.log('╔══════════════════════════════════════════════════════════════╗');
    Logger.log('║                      FATAL ERROR                             ║');
    Logger.log('╚══════════════════════════════════════════════════════════════╝');
    Logger.log(`   Message: ${e.message}`);
    Logger.log(`   Stack: ${e.stack}`);
    
    if (ui) {
      ui.alert('❌ Sync Error', e.message, ui.ButtonSet.OK);
    }
  }
}

// ============================================================
// SYNC EVERYTHING
// ============================================================
/**
 * WHY: Convenience function to sync both bets and results
 */
function syncEverything() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  
  ss.toast('🔄 Syncing bets and results...', 'Hive Mind', 5);
  
  try {
    // Sync bets first (silently)
    Logger.log('========== SYNC EVERYTHING: BETS ==========');
    _syncBetsSilent(ss);
    
    // FIX: Sync risky bets to ensure they are available for performance grading
    Logger.log('========== SYNC EVERYTHING: RISKY BETS ==========');
    _syncRiskyBetsSilent(ss);
    
    // Then sync results (silently)
    Logger.log('========== SYNC EVERYTHING: RESULTS ==========');
    _syncResultsSilent(ss);
    
    // Update dashboard
    updateDashboard();
    
    // Get counts for message
    const syncSheet = getSheetInsensitive(ss, 'Sync_Temp');
    const resultsSheet = getSheetInsensitive(ss, 'Results_Temp');
    
    const betCount = syncSheet && syncSheet.getLastRow() > 1 ? syncSheet.getLastRow() - 1 : 0;
    const gameCount = resultsSheet && resultsSheet.getLastRow() > 1 ? resultsSheet.getLastRow() - 1 : 0;
    
    ui.alert('Full Sync Complete', 
      `✅ Synced ${betCount} bets\n✅ Synced ${gameCount} games\n\nDashboard updated.`, 
      ui.ButtonSet.OK);
    
  } catch (e) {
    Logger.log(`[HiveMind] FATAL: ${e.message}\n${e.stack}`);
    ui.alert('❌ Sync Error', e.message, ui.ButtonSet.OK);
  }
}


/**
 * Internal: Sync risky bets to Sync_Temp without UI alerts.
 *
 * CONSOLIDATED FIX:
 * - Builder-first: uses _loadPendingRiskyBets + _enrichRiskyBetsWithStrategy if available.
 * - Post-enrichment validation: derives missing pick/type/tier from forebetPred + home/away.
 * - Satellite fallback: scans Analysis_Tier1 for "RISKY" in the magolide pred column
 *   (NOT tier/strategy columns, which don't exist in satellites).
 * - Dedupe normalises BOTH existing and new picks (strips parentheticals).
 * - Per-bet skip logging for diagnostics.
 * - No global helper functions (all inline to avoid collisions).
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @return {{added:number, tierCounts:{HIGH:number,MEDIUM:number,LOW:number}, mode:string, skipped:number}}
 */
function _syncRiskyBetsSilent(ss) {
  var FUNC = '_syncRiskyBetsSilent';
  var result = { added: 0, tierCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 }, mode: 'NONE', skipped: 0 };

  // ══════════════════════════════════════════════════════════════
  // INLINE HELPERS (no global collision risk)
  // ══════════════════════════════════════════════════════════════
  function _sanitisePick(p) {
    // Strip "(vs FB)", "(w FB)", "(against)", etc. for stable dedupe
    return String(p || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function _dedupeKey(league, match, pick) {
    return (String(league || '').toUpperCase().trim() + '|' +
            String(match || '').toUpperCase().trim() + '|' +
            _sanitisePick(pick).toUpperCase());
  }

  function _pctNum(v) {
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v === 'number' && isFinite(v)) return (v > 0 && v <= 1) ? Math.round(v * 100) : v;
    var m = String(v).trim().match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : '';
  }

  function _oddsToCell(odds) {
    if (odds === '' || odds === null || odds === undefined) return '';
    if (typeof odds === 'number' && isFinite(odds)) return odds.toFixed(2);
    var s = String(odds).trim();
    var m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return s;
    var n = parseFloat(m[1]);
    return isFinite(n) ? n.toFixed(2) : s;
  }

  function _safeParseDate(v) {
    if (!v) return null;
    try { if (typeof _parseDateString === 'function') { var d = _parseDateString(v); if (d instanceof Date && !isNaN(d.getTime())) return d; } } catch (e) {}
    if (v instanceof Date && !isNaN(v.getTime())) return v;
    var d2 = new Date(String(v));
    return (d2 instanceof Date && !isNaN(d2.getTime())) ? d2 : null;
  }

  function _safeParseMatch(matchRaw) {
    var home = '', away = '', match = String(matchRaw || '').trim();
    if (!match) return { home: '', away: '', match: '' };
    if (typeof _parseMatchString === 'function') {
      try {
        var mm = _parseMatchString(match);
        if (mm && mm.home) home = String(mm.home).trim();
        if (mm && mm.away) away = String(mm.away).trim();
        if (home && away) return { home: home, away: away, match: home + ' vs ' + away };
      } catch (e) {}
    }
    var parts = match.split(/\s+(?:vs\.?|v\.?|@|-)\s+/i);
    if (parts.length >= 2) {
      home = String(parts[0] || '').trim();
      away = String(parts[1] || '').trim();
      if (home && away) match = home + ' vs ' + away;
    }
    return { home: home, away: away, match: match };
  }

  function _safeHeaderMap(row) {
    try { if (typeof createHeaderMapWithAliases === 'function') return createHeaderMapWithAliases(row); } catch (e) {}
    return _createHeaderMap(row);
  }

  /**
   * Derive gradable pick from forebetPred + strategy + home/away.
   * Returns "" if derivation is impossible.
   */
  function _derivePick(forebetPred, strategy, home, away) {
    var fb = parseInt(forebetPred, 10);
    if ((fb !== 1 && fb !== 2) || !home || !away) return '';
    var stratLc = String(strategy || '').toLowerCase();
    if (stratLc.indexOf('against') >= 0) {
      return (fb === 1) ? (away + ' Win') : (home + ' Win');
    } else if (stratLc.indexOf('with') >= 0) {
      return (fb === 1) ? (home + ' Win') : (away + ' Win');
    }
    // Default: treat as "against" (most common risky play)
    return (fb === 1) ? (away + ' Win') : (home + ' Win');
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 1: PREPARE SYNC_TEMP
  // ══════════════════════════════════════════════════════════════
  try {
    var syncSheet = (typeof getSheetInsensitive === 'function')
      ? getSheetInsensitive(ss, 'Sync_Temp')
      : ss.getSheetByName('Sync_Temp');

    if (!syncSheet) { Logger.log('[' + FUNC + '] Sync_Temp not found'); return result; }

    var syncData = syncSheet.getDataRange().getValues();
    if (!syncData || syncData.length < 1) { Logger.log('[' + FUNC + '] Sync_Temp empty'); return result; }

    var syncHeaders = _safeHeaderMap(syncData[0]);
    var syncColCount = syncData[0].length;

    var cLeague = syncHeaders['league'], cDate = syncHeaders['date'], cTime = syncHeaders['time'],
        cHome = syncHeaders['home'], cAway = syncHeaders['away'], cMatch = syncHeaders['match'],
        cPick = syncHeaders['pick'], cType = syncHeaders['type'], cOdds = syncHeaders['odds'],
        cConf = syncHeaders['confidence'], cEV = syncHeaders['ev'];

    if (cLeague === undefined || cMatch === undefined || cPick === undefined) {
      Logger.log('[' + FUNC + '] Sync_Temp missing league/match/pick columns. Headers: ' + JSON.stringify(syncHeaders));
      return result;
    }

    // Build dedupe index — FIX: sanitise existing picks too
    var existing = {};
    for (var r = 1; r < syncData.length; r++) {
      var key = _dedupeKey(
        syncData[r][cLeague],
        syncData[r][cMatch],
        syncData[r][cPick]
      );
      if (key.length > 2) existing[key] = true; // "||" is minimum empty key
    }
    Logger.log('[' + FUNC + '] Dedupe index built: ' + Object.keys(existing).length + ' existing bets');

    // ══════════════════════════════════════════════════════════════
    // STEP 2: COLLECT RISKY BETS
    // ══════════════════════════════════════════════════════════════
    var collectedBets = [];

    // ---- Try 1: Builder pipeline ----
    if (typeof _loadPendingRiskyBets === 'function') {
      try {
        var rawBets = _loadPendingRiskyBets(ss) || [];
        Logger.log('[' + FUNC + '] Builder loaded ' + rawBets.length + ' raw risky bets');

        if (typeof _enrichRiskyBetsWithStrategy === 'function' && rawBets.length > 0) {
          try {
            rawBets = _enrichRiskyBetsWithStrategy(rawBets) || rawBets;
            Logger.log('[' + FUNC + '] Enricher processed ' + rawBets.length + ' bets');
          } catch (enrichErr) {
            Logger.log('[' + FUNC + '] Enricher failed: ' + enrichErr.message + ' — using raw bets');
          }
        }

        if (rawBets.length > 0) {
          result.mode = 'BUILDER';

          for (var bi = 0; bi < rawBets.length; bi++) {
            var b = rawBets[bi] || {};

            // Post-enrichment validation: ensure required fields exist
            var bLeague = String(b.league || b.League || b.competition || '').trim();
            var bHome = String(b.home || b.Home || '').trim();
            var bAway = String(b.away || b.Away || '').trim();
            var bMatch = String(b.match || b.Match || '').trim();
            if (!bMatch && bHome && bAway) bMatch = bHome + ' vs ' + bAway;

            var bPick = String(b.actualPick || b.pick || b.Pick || b.pickDescription || b.description || '').trim();
            var bType = String(b.type || b.Type || '').trim();
            var bTier = String(b.tier || b.riskiness || b.riskTier || b.Tier || '').toUpperCase().trim();
            var bStrategy = String(b.strategy || b.Strategy || b.action || b.Action || '').trim();
            var bFbPred = b.forebetPred || b.fbPred || b['forebet pred'] || '';
            var bOdds = b.odds || b.Odds || b.price || '';
            var bConf = b.confidence || b.Confidence || b.conf || '';
            var bDate = b.date || b.Date || b.matchDate || '';
            var bTime = b.time || b.Time || '';
            var bRecAction = String(b.recommendedAction || b.motherAction || '').toUpperCase();

            // If confidence is in riskinessData sub-object
            if (!bConf && b.riskinessData && b.riskinessData.confidence != null) {
              bConf = b.riskinessData.confidence;
            }

            // FIX: Derive missing pick from forebetPred if enricher didn't provide one
            if (!bPick || bPick.toUpperCase() === 'RISKY' || /^\d+$/.test(bPick)) {
              bPick = _derivePick(bFbPred, bStrategy, bHome, bAway);
            }

            // FIX: Ensure type contains RISKY
            if (!bType) {
              var sl = '';
              if (bStrategy.toLowerCase().indexOf('against') >= 0) sl = 'vs FB';
              else if (bStrategy.toLowerCase().indexOf('with') >= 0) sl = 'w FB';
              bType = ('RISKY ' + bTier + ' ' + sl).replace(/\s+/g, ' ').trim();
            }
            if (bType.toUpperCase().indexOf('RISKY') < 0) bType = 'RISKY ' + bType;

            collectedBets.push({
              league: bLeague, home: bHome, away: bAway, match: bMatch,
              pick: bPick, type: bType, tier: bTier, strategy: bStrategy,
              odds: bOdds, confidence: bConf, date: bDate, time: bTime,
              forebetPred: bFbPred, recommendedAction: bRecAction
            });
          }
        }
      } catch (builderErr) {
        Logger.log('[' + FUNC + '] Builder pipeline failed: ' + builderErr.message);
        collectedBets = [];
      }
    } else {
      Logger.log('[' + FUNC + '] _loadPendingRiskyBets not found — will use satellite fallback');
    }

    // ---- Try 2: Satellite fallback (only if builder produced 0 bets) ----
    if (collectedBets.length === 0) {
      Logger.log('[' + FUNC + '] Attempting satellite fallback scan...');
      collectedBets = _riskyFallbackSatelliteScan_(ss);
      result.mode = collectedBets.length > 0 ? 'SATELLITE_FALLBACK' : 'NONE';
      Logger.log('[' + FUNC + '] Satellite fallback returned ' + collectedBets.length + ' bets');
    }

    if (!collectedBets.length) {
      Logger.log('[' + FUNC + '] No risky bets found from any source');
      return result;
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 3: PROCESS COLLECTED BETS INTO ROWS
    // ══════════════════════════════════════════════════════════════
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var rowsToAdd = [];

    for (var ci = 0; ci < collectedBets.length; ci++) {
      var bet = collectedBets[ci];
      var skipReason = '';

      // Skip EXTREME / SKIP
      if (bet.tier && bet.tier.indexOf('EXTREME') >= 0) { result.skipped++; continue; }
      if (bet.recommendedAction === 'SKIP') { result.skipped++; continue; }

      // Date filter: skip > 7 days out
      var betDate = _safeParseDate(bet.date);
      if (betDate) {
        betDate.setHours(0, 0, 0, 0);
        if (Math.floor((betDate - today) / 86400000) > 7) { result.skipped++; continue; }
      }

      // Normalise match
      var pm = _safeParseMatch(bet.match);
      var home = bet.home || pm.home;
      var away = bet.away || pm.away;
      var match = pm.match;
      if (!match && home && away) match = home + ' vs ' + away;

      // Ensure pick is gradable
      var pick = _sanitisePick(bet.pick);
      if (!pick || pick.toUpperCase() === 'RISKY' || /^\d+$/.test(pick)) {
        pick = _derivePick(bet.forebetPred, bet.strategy, home, away);
      }

      // Validate required fields
      if (!bet.league) { skipReason = 'missing league'; }
      else if (!match)  { skipReason = 'missing match'; }
      else if (!pick)   { skipReason = 'cannot derive gradable pick'; }

      if (skipReason) {
        Logger.log('[' + FUNC + ']   SKIP bet ' + ci + ': ' + skipReason +
          ' (match=' + (bet.match || '') + ', forebetPred=' + (bet.forebetPred || '') + ')');
        result.skipped++;
        continue;
      }

      // Ensure type contains RISKY
      var typeStr = String(bet.type || '').trim();
      if (!typeStr || typeStr.toUpperCase().indexOf('RISKY') < 0) {
        var sl2 = '';
        var stratLc2 = String(bet.strategy || '').toLowerCase();
        if (stratLc2.indexOf('against') >= 0) sl2 = 'vs FB';
        else if (stratLc2.indexOf('with') >= 0) sl2 = 'w FB';
        typeStr = ('RISKY ' + (bet.tier || 'MEDIUM') + ' ' + sl2).replace(/\s+/g, ' ').trim();
      }

      // Dedupe — FIX: uses sanitised pick for both sides
      var key = _dedupeKey(bet.league, match, pick);
      if (existing[key]) { result.skipped++; continue; }
      existing[key] = true;

      // Build row
      var newRow = new Array(syncColCount).fill('');

      if (cLeague !== undefined) newRow[cLeague] = bet.league;

      if (cDate !== undefined) {
        if (typeof _formatDateValue === 'function') {
          try { newRow[cDate] = _formatDateValue(bet.date); } catch (e) { newRow[cDate] = bet.date || ''; }
        } else { newRow[cDate] = bet.date || ''; }
      }

      if (cTime !== undefined) {
        if (typeof _formatTimeValue === 'function') {
          try { newRow[cTime] = _formatTimeValue(bet.time); } catch (e) { newRow[cTime] = bet.time || ''; }
        } else { newRow[cTime] = bet.time || ''; }
      }

      if (cHome !== undefined) newRow[cHome] = home;
      if (cAway !== undefined) newRow[cAway] = away;
      if (cMatch !== undefined) newRow[cMatch] = match;
      if (cPick !== undefined) newRow[cPick] = pick;
      if (cType !== undefined) newRow[cType] = typeStr;
      if (cOdds !== undefined) newRow[cOdds] = _oddsToCell(bet.odds);
      if (cConf !== undefined) { var cn = _pctNum(bet.confidence); newRow[cConf] = (cn === '' ? '' : cn); }
      if (cEV !== undefined) newRow[cEV] = '';

      rowsToAdd.push(newRow);

      var tU = typeStr.toUpperCase();
      if (tU.indexOf('HIGH') >= 0) result.tierCounts.HIGH++;
      else if (tU.indexOf('MEDIUM') >= 0) result.tierCounts.MEDIUM++;
      else if (tU.indexOf('LOW') >= 0) result.tierCounts.LOW++;
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 4: APPEND
    // ══════════════════════════════════════════════════════════════
    if (rowsToAdd.length > 0) {
      syncSheet.getRange(syncSheet.getLastRow() + 1, 1, rowsToAdd.length, syncColCount).setValues(rowsToAdd);
      result.added = rowsToAdd.length;
      Logger.log('[' + FUNC + '] ✅ Added ' + rowsToAdd.length + ' risky bets (' + result.mode +
        '). Skipped=' + result.skipped +
        '. H=' + result.tierCounts.HIGH + ' M=' + result.tierCounts.MEDIUM + ' L=' + result.tierCounts.LOW);
    } else {
      Logger.log('[' + FUNC + '] ⚠️ No new bets after filters/dedupe. Skipped=' + result.skipped);
    }

    return result;

  } catch (e) {
    Logger.log('[' + FUNC + '] ❌ FATAL: ' + e.message);
    Logger.log('[' + FUNC + '] Stack: ' + e.stack);
    return result;
  }
}


/**
 * Internal: Sync bets without UI alerts
 * ✅ PATCHED: now includes Tier column from Bet_Slips
 */
function _syncBetsSilent(ss) {
  const configSheet = getSheetInsensitive(ss, 'Config');
  if (!configSheet) return;
  
  const configData = configSheet.getDataRange().getValues();
  if (configData.length < 2) return;
  
  const configHeaderMap = createHeaderMapWithAliases(configData[0]);
  
  const leagueNameCol = configHeaderMap['league name'] !== undefined ? configHeaderMap['league name'] : configHeaderMap['league'];
  const urlCol = configHeaderMap['file url'] !== undefined ? configHeaderMap['file url'] : configHeaderMap['url'];
  const statusCol = configHeaderMap['status'];
  
  if (urlCol === undefined) return;
  
  let syncSheet = getSheetInsensitive(ss, 'Sync_Temp');
  if (!syncSheet) {
    syncSheet = ss.insertSheet('Sync_Temp');
  }
  syncSheet.clear();
  
  // ✅ PATCHED: added 'RiskTier' as 10th column
  const canonicalHeaders = ['League', 'Date', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV', 'RiskTier'];
  syncSheet.getRange(1, 1, 1, canonicalHeaders.length).setValues([canonicalHeaders])
    .setFontWeight('bold').setBackground('#ff9900').setFontColor('#ffffff');
  
  for (let r = 1; r < configData.length; r++) {
    const row = configData[r];
    const leagueName = leagueNameCol !== undefined ? String(row[leagueNameCol] || '').trim() : `League${r}`;
    const fileUrl = urlCol !== undefined ? String(row[urlCol] || '').trim() : '';
    const status = statusCol !== undefined ? String(row[statusCol] || 'Active').trim() : 'Active';
    
    if (status.toLowerCase() !== 'active' || !fileUrl || fileUrl.includes('PASTE_')) continue;
    
    try {
      const satellite = SpreadsheetApp.openByUrl(fileUrl);
      const betSheet = getSheetInsensitive(satellite, 'Bet_Slips');
      if (!betSheet || betSheet.getLastRow() < 3) continue;
      
      const betData = betSheet.getDataRange().getValues();
      
      let headerRowIndex = -1;
      for (let scanRow = 0; scanRow < Math.min(20, betData.length); scanRow++) {
        const rowStrings = betData[scanRow].map(cell => String(cell || '').toLowerCase().trim());
        if ((rowStrings.includes('match') || rowStrings.includes('game')) && 
            (rowStrings.includes('pick') || rowStrings.includes('type'))) {
          headerRowIndex = scanRow;
          break;
        }
      }
      
      if (headerRowIndex === -1) continue;
      
      const betHeaderMap = createHeaderMapWithAliases(betData[headerRowIndex]);
      const matchCol = betHeaderMap['match'];
      if (matchCol === undefined) continue;
      
      const pickCol = betHeaderMap['pick'];
      const dateCol = betHeaderMap['date'];
      const timeCol = betHeaderMap['time'];
      const typeCol = betHeaderMap['type'];
      const oddsCol = betHeaderMap['odds'];
      const confCol = betHeaderMap['confidence'];
      const evCol = betHeaderMap['ev'];
      const leagueCol = betHeaderMap['league'];

      // ✅ PATCHED: look up Tier column in satellite Bet_Slips
      const tierCol = betHeaderMap['tier']
                   ?? betHeaderMap['risk tier']
                   ?? betHeaderMap['risktier']
                   ?? betHeaderMap['risk_tier'];
      
      for (let i = headerRowIndex + 1; i < betData.length; i++) {
        const betRow = betData[i];
        const matchStr = String(betRow[matchCol] || '').trim();
        
        if (!matchStr || matchStr.includes('━') || matchStr.toLowerCase() === 'match') continue;
        if (matchStr.toLowerCase().includes('summary') || matchStr.toLowerCase().includes('total')) continue;
        if (matchStr.toLowerCase().includes('no bankers') || matchStr.toLowerCase().includes('no snipers')) continue;
        
        const pick = pickCol !== undefined ? String(betRow[pickCol] || '').trim() : '';
        if (!pick) continue;
        
        syncSheet.appendRow([
          (leagueCol !== undefined ? String(betRow[leagueCol] || '').trim() : '') || leagueName,
          dateCol !== undefined ? betRow[dateCol] : '',
          timeCol !== undefined ? betRow[timeCol] : '',
          matchStr,
          pick,
          typeCol !== undefined ? String(betRow[typeCol] || '').trim() : '',
          oddsCol !== undefined ? betRow[oddsCol] : '',
          confCol !== undefined ? betRow[confCol] : '',
          evCol !== undefined ? betRow[evCol] : '',
          _cleanTierString_(tierCol !== undefined ? String(betRow[tierCol] || '').trim() : '')  // ✅ PATCHED v2: clean symbols
        ]);
      }
    } catch (e) {
      Logger.log(`[Silent Bet Sync] ${leagueName}: ${e.message}`);
    }
  }
  
  syncSheet.autoResizeColumns(1, canonicalHeaders.length);  // ✅ PATCHED: was 9, now uses canonicalHeaders.length
}




/**
 * Internal: Sync results without UI alerts
 */
function _syncResultsSilent(ss) {
  const configSheet = getSheetInsensitive(ss, 'Config');
  if (!configSheet) return;

  const configData = configSheet.getDataRange().getValues();
  if (configData.length < 2) return;

  const configHeaderMap = createHeaderMapWithAliases(configData[0]);
  const leagueNameCol = configHeaderMap['league name'] !== undefined ? configHeaderMap['league name'] : configHeaderMap['league'];
  const urlCol = configHeaderMap['file url'] !== undefined ? configHeaderMap['file url'] : configHeaderMap['url'];
  const statusCol = configHeaderMap['status'];
  if (urlCol === undefined) return;

  let resultsSheet = getSheetInsensitive(ss, 'Results_Temp');
  if (!resultsSheet) {
    resultsSheet = ss.insertSheet('Results_Temp');
  }
  resultsSheet.clear();

  const resultsHeaders = ['League', 'Game Type', 'Home', 'Away', 'Date', 'Time', 'Prob %', 'Pred', 'Pred Score', 'Avg', 'Odds', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'Status', 'FT Score'];
  resultsSheet.getRange(1, 1, 1, resultsHeaders.length)
    .setValues([resultsHeaders])
    .setFontWeight('bold')
    .setBackground('#38761d')
    .setFontColor('#ffffff');

  for (let r = 1; r < configData.length; r++) {
    const row = configData[r];
    const leagueName = leagueNameCol !== undefined ? String(row[leagueNameCol] || '').trim() : `League${r}`;
    const fileUrl = urlCol !== undefined ? String(row[urlCol] || '').trim() : '';
    const status = statusCol !== undefined ? String(row[statusCol] || 'Active').trim() : 'Active';

    if (status.toLowerCase() !== 'active' || !fileUrl || fileUrl.includes('PASTE_')) continue;

    try {
      const satellite = SpreadsheetApp.openByUrl(fileUrl);
      const satResultsSheet = _findResultsSheet(satellite);
      if (!satResultsSheet) continue;

      const satData = satResultsSheet.getDataRange().getValues();
      if (satData.length < 2) continue;

      const satHeaders = createHeaderMapWithAliases(satData[0]);
      const homeCol = satHeaders['home'];
      const awayCol = satHeaders['away'];
      if (homeCol === undefined || awayCol === undefined) continue;

      const dateCol = satHeaders['date'];
      const timeCol = satHeaders['time'];
      const statusColR = satHeaders['status'];
      const ftScoreCol = satHeaders['ft score'];
      const q1Col = satHeaders['q1'];
      const q2Col = satHeaders['q2'];
      const q3Col = satHeaders['q3'];
      const q4Col = satHeaders['q4'];
      const predCol = satHeaders['pred'];
      const probCol = satHeaders['prob %'] !== undefined ? satHeaders['prob %'] : satHeaders['probability'];
      const oddsCol = satHeaders['odds'];
      const avgCol = satHeaders['avg'];
      const predScoreCol = satHeaders['pred score'];
      const gameTypeCol = satHeaders['game type'];
      const otCol = satHeaders['ot'];

      for (let i = 1; i < satData.length; i++) {
        const satRow = satData[i];
        const home = String(satRow[homeCol] || '').trim();
        const away = String(satRow[awayCol] || '').trim();
        if (!home || !away) continue;

        resultsSheet.appendRow([
          leagueName,
          gameTypeCol !== undefined ? satRow[gameTypeCol] : '',
          home,
          away,
          dateCol !== undefined ? satRow[dateCol] : '',
          timeCol !== undefined ? satRow[timeCol] : '',
          probCol !== undefined ? satRow[probCol] : '',
          predCol !== undefined ? satRow[predCol] : '',
          predScoreCol !== undefined ? satRow[predScoreCol] : '',
          avgCol !== undefined ? satRow[avgCol] : '',
          oddsCol !== undefined ? satRow[oddsCol] : '',
          q1Col !== undefined ? satRow[q1Col] : '',
          q2Col !== undefined ? satRow[q2Col] : '',
          q3Col !== undefined ? satRow[q3Col] : '',
          q4Col !== undefined ? satRow[q4Col] : '',
          otCol !== undefined ? satRow[otCol] : '',
          statusColR !== undefined ? satRow[statusColR] : '',
          ftScoreCol !== undefined ? satRow[ftScoreCol] : ''
        ]);
      }

    } catch (err) {
      Logger.log(`[Silent Results Sync] ${leagueName}: ${err.message}`);
    }
  }

  resultsSheet.autoResizeColumns(1, resultsHeaders.length);
}

// ============================================================
// STATUS & DASHBOARD
// ============================================================

/**
 * WHY: Show quick sync status without full sync
 */
function viewSyncStatus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  
  const syncSheet = getSheetInsensitive(ss, 'Sync_Temp');
  const resultsSheet = getSheetInsensitive(ss, 'Results_Temp');
  const configSheet = getSheetInsensitive(ss, 'Config');
  
  let syncedBets = 0;
  if (syncSheet && syncSheet.getLastRow() > 1) {
    syncedBets = syncSheet.getLastRow() - 1;
  }
  
  let syncedGames = 0;
  let finishedGames = 0;
  if (resultsSheet && resultsSheet.getLastRow() > 1) {
    const resultsData = resultsSheet.getDataRange().getValues();
    syncedGames = resultsData.length - 1;
    
    // Count finished games
    for (let i = 1; i < resultsData.length; i++) {
      const status = String(resultsData[i][16] || '').toUpperCase();
      if (status === 'FT' || status === 'FINAL' || status === 'FINISHED' || status === 'AET') {
        finishedGames++;
      }
    }
  }
  
  let activeLeagues = 0;
  let totalLeagues = 0;
  if (configSheet && configSheet.getLastRow() > 1) {
    const configData = configSheet.getDataRange().getValues();
    const headerMap = createHeaderMapWithAliases(configData[0]);
    const statusCol = headerMap['status'];
    
    for (let i = 1; i < configData.length; i++) {
      const status = statusCol !== undefined ? String(configData[i][statusCol] || '') : '';
      if (configData[i][0]) {
        totalLeagues++;
        if (status.toLowerCase() === 'active') {
          activeLeagues++;
        }
      }
    }
  }
  
  ui.alert('Sync Status',
    `📊 Current Status:\n\n` +
    `Total Leagues in Config: ${totalLeagues}\n` +
    `Active Leagues: ${activeLeagues}\n\n` +
    `Bets in Sync_Temp: ${syncedBets}\n` +
    `Games in Results_Temp: ${syncedGames}\n` +
    `Finished Games (FT): ${finishedGames}\n\n` +
    `Run "Sync Everything" to refresh all data.`,
    ui.ButtonSet.OK);
}



/**
 * Parse accuracy value from various formats
 * Handles: "65%", "65", "0.65", 65, etc.
 */
function _parseAccuracyPercent(raw, defaultVal) {
  if (raw === null || raw === undefined || raw === '') {
    return defaultVal;
  }
  
  // Handle string values
  let str = String(raw).trim();
  
  // Remove percentage sign and common text
  str = str.replace(/%/g, '')
           .replace(/percent/gi, '')
           .replace(/,/g, '.')
           .trim();
  
  // Try to parse as number
  const num = parseFloat(str);
  
  if (isNaN(num) || num < 0) {
    return defaultVal;
  }
  
  // If value is between 0 and 1, treat as decimal (0.65 → 65)
  if (num > 0 && num <= 1) {
    return num * 100;
  }
  
  // If value is reasonable percentage (1-100)
  if (num >= 1 && num <= 100) {
    return num;
  }
  
  // Value out of range
  return defaultVal;
}

/**
 * fetchLeagueAccuracyMetrics  (Mothership_HiveMind.gs)
 *
 * PATCH: Stores metrics under multiple deterministic keys so KPI/Tier
 * lookups succeed even when incoming league keys are fused (Name+Code).
 *
 * Key variants stored per league:
 *   - Full name (exact + lowercase)
 *   - Normalized name (normalizeString_ output + lowercase)
 *   - Code (exact + lowercase + uppercase)
 *   - Normalized code
 *   - Fused raw:       "United StatesNBA"
 *   - Fused spaced:    "United States NBA"
 *   - Fused normalized: "UNITED_STATESNBA"
 *   - Fused separated:  "UNITED_STATES_NBA"
 *
 * Intentionally avoids ultra-compact keys (collision risk per critique).
 */
function fetchLeagueAccuracyMetrics() {
  var FUNC_NAME = 'fetchLeagueAccuracyMetrics';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var PENALTY_ACCURACY = (ACCA_ENGINE_CONFIG && ACCA_ENGINE_CONFIG.PENALTY_ACCURACY != null)
    ? ACCA_ENGINE_CONFIG.PENALTY_ACCURACY : 1.0;
  var DEFAULT_ACCURACY = (ACCA_ENGINE_CONFIG && ACCA_ENGINE_CONFIG.DEFAULT_ACCURACY != null)
    ? ACCA_ENGINE_CONFIG.DEFAULT_ACCURACY : 50.0;

  var leagueMetrics = {};

  var configSheet = ss.getSheetByName('Config');
  if (!configSheet) {
    Logger.log('[' + FUNC_NAME + '] ❌ Config sheet not found');
    return leagueMetrics;
  }

  var configData = configSheet.getDataRange().getValues();
  if (!configData || configData.length < 2) {
    Logger.log('[' + FUNC_NAME + '] ⚠️ Config sheet empty or has no data rows');
    return leagueMetrics;
  }

  var headers = configData[0].map(function(h) { return String(h).toLowerCase().trim(); });

  var nameCol = headers.findIndex(function(h) { return h.indexOf('league') !== -1 && h.indexOf('name') !== -1; });
  var codeCol = headers.findIndex(function(h) { return h.indexOf('league') !== -1 && h.indexOf('code') !== -1; });
  var urlCol  = headers.findIndex(function(h) { return h.indexOf('url') !== -1 || h.indexOf('file') !== -1; });
  var statusCol = headers.findIndex(function(h) { return h === 'status'; });

  Logger.log('[' + FUNC_NAME + '] ═══════════════════════════════════════');
  Logger.log('[' + FUNC_NAME + '] Column indexes: Name=' + nameCol + ', Code=' + codeCol + ', URL=' + urlCol + ', Status=' + statusCol);

  if (codeCol < 0) {
    Logger.log('[' + FUNC_NAME + '] ⚠️ WARNING: No "League Code" column found! Add it to Config sheet.');
  }

  // Safe normalizeString_ wrapper (in case this runs in HiveMind context)
  var safeNormalize = function(x) {
    if (typeof normalizeString_ === 'function') return normalizeString_(x);
    return String(x || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').trim();
  };

  // Store a metric under a key (skip empty/null/trivial keys)
  var storeKey = function(k, data) {
    var kk = String(k == null ? '' : k).trim();
    if (kk && kk.length > 0) leagueMetrics[kk] = data;
  };

  for (var r = 1; r < configData.length; r++) {
    var row = configData[r] || [];
    var leagueName = nameCol >= 0 ? String(row[nameCol] || '').trim() : ('League_' + r);
    var leagueCode = codeCol >= 0 ? String(row[codeCol] || '').trim() : '';
    var fileUrl    = urlCol >= 0  ? String(row[urlCol]  || '').trim() : '';
    var status     = statusCol >= 0 ? String(row[statusCol] || 'active').toLowerCase().trim() : 'active';

    if (status !== 'active') continue;
    if (!fileUrl || fileUrl.length < 20 || fileUrl.indexOf('PASTE_') !== -1) continue;

    Logger.log('[' + FUNC_NAME + '] 📂 Processing: "' + leagueName + '" (Code: "' + leagueCode + '")');

    var metricData = {
      bankerAccuracy: PENALTY_ACCURACY,
      sniperAccuracy: PENALTY_ACCURACY,
      hasTier1: false,
      hasTier2: false,
      tier1Source: 'None',
      tier2Source: 'None',
      leagueName: leagueName,
      leagueCode: leagueCode
    };

    try {
      var satellite = SpreadsheetApp.openByUrl(fileUrl);

      var findSheet = function(targetName) {
        var sheets = satellite.getSheets();
        var targetLower = String(targetName || '').toLowerCase();
        var found = null;
        for (var si = 0; si < sheets.length; si++) {
          var sName = sheets[si].getName().toLowerCase();
          if (sName === targetLower) { found = sheets[si]; break; }
        }
        if (!found) {
          for (var si2 = 0; si2 < sheets.length; si2++) {
            if (sheets[si2].getName().toLowerCase().indexOf(targetLower) !== -1) {
              found = sheets[si2]; break;
            }
          }
        }
        return found;
      };

      var extractAccuracy = function(sheetData, labelKeywords, excludeKeywords) {
        excludeKeywords = excludeKeywords || [];
        if (!sheetData || sheetData.length === 0) return null;

        var headerRow = (sheetData[0] || []).map(function(c) { return String(c).toLowerCase(); });
        var proposedIdx = headerRow.findIndex(function(h) {
          return h.indexOf('proposed') !== -1 || h.indexOf('best') !== -1;
        });

        for (var i = 0; i < sheetData.length; i++) {
          var rowData = sheetData[i] || [];
          for (var j = 0; j < rowData.length; j++) {
            var cellText = String(rowData[j] || '').toLowerCase().trim();

            var hasAllKeywords = true;
            for (var kw = 0; kw < labelKeywords.length; kw++) {
              if (cellText.indexOf(String(labelKeywords[kw]).toLowerCase()) === -1) {
                hasAllKeywords = false; break;
              }
            }

            var hasExcluded = false;
            for (var ex = 0; ex < excludeKeywords.length; ex++) {
              if (cellText.indexOf(String(excludeKeywords[ex]).toLowerCase()) !== -1) {
                hasExcluded = true; break;
              }
            }

            if (hasAllKeywords && !hasExcluded) {
              // Strategy A: Same-row value to the right
              for (var k = j + 1; k < rowData.length; k++) {
                var parsed = _parseAccuracyValue(rowData[k]);
                if (parsed !== null && parsed > PENALTY_ACCURACY) {
                  return { value: parsed, row: i + 1, col: k + 1, method: 'same-row' };
                }
              }
              // Strategy B: Next-row value below
              if (i + 1 < sheetData.length) {
                var parsedBelow = _parseAccuracyValue(sheetData[i + 1][j]);
                if (parsedBelow !== null && parsedBelow > PENALTY_ACCURACY) {
                  return { value: parsedBelow, row: i + 2, col: j + 1, method: 'next-row' };
                }
              }
            }
          }
        }
        return null;
      };

      // ── Tier 1 (Banker) ──
      var tier1Sheet = findSheet('Config_Tier1');
      if (tier1Sheet && tier1Sheet.getLastRow() > 0) {
        metricData.hasTier1 = true;
        var tier1Data = tier1Sheet.getDataRange().getValues();
        var t1Result = extractAccuracy(tier1Data, ['accuracy'], ['side']);
        if (t1Result) {
          metricData.bankerAccuracy = t1Result.value;
          metricData.tier1Source = 'Tier1: ' + t1Result.value.toFixed(1) + '%';
          Logger.log('[' + FUNC_NAME + ']   ✅ Tier1: ' + t1Result.value + '%');
        }
      } else {
        Logger.log('[' + FUNC_NAME + ']   ❌ Config_Tier1 not found');
      }

      // ── Tier 2 (Sniper) ──
      var tier2Sheet = findSheet('Config_Tier2_Proposals');
      if (!tier2Sheet) tier2Sheet = findSheet('Config_Tier2');

      if (tier2Sheet && tier2Sheet.getLastRow() > 0) {
        metricData.hasTier2 = true;
        var tier2Data = tier2Sheet.getDataRange().getValues();
        var t2Result = extractAccuracy(tier2Data, ['side', 'accuracy'], []);
        if (t2Result) {
          metricData.sniperAccuracy = t2Result.value;
          metricData.tier2Source = 'Tier2: ' + t2Result.value.toFixed(1) + '%';
          Logger.log('[' + FUNC_NAME + ']   ✅ Tier2: ' + t2Result.value + '%');
        }
      } else {
        Logger.log('[' + FUNC_NAME + ']   ❌ Config_Tier2 not found');
      }

      // Fallback defaults
      if (metricData.hasTier1 && metricData.bankerAccuracy <= PENALTY_ACCURACY) {
        metricData.bankerAccuracy = DEFAULT_ACCURACY;
        metricData.tier1Source = 'Tier1: ' + DEFAULT_ACCURACY.toFixed(1) + '% (default)';
      }
      if (metricData.hasTier2 && metricData.sniperAccuracy <= PENALTY_ACCURACY) {
        metricData.sniperAccuracy = DEFAULT_ACCURACY;
        metricData.tier2Source = 'Tier2: ' + DEFAULT_ACCURACY.toFixed(1) + '% (default)';
      }

    } catch (e) {
      Logger.log('[' + FUNC_NAME + '] ❌ Error: ' + (e && e.message ? e.message : e));
    }

    // ═══════════════════════════════════════════════════════
    // STORE BY MULTIPLE KEYS (name, code, normalized, fused)
    // ═══════════════════════════════════════════════════════
    var nameNorm = safeNormalize(leagueName);
    var codeNorm = safeNormalize(leagueCode);

    // By full name (exact + lowercase)
    storeKey(leagueName, metricData);
    storeKey(leagueName.toLowerCase(), metricData);

    // By normalized name
    if (nameNorm && nameNorm !== 'NA') {
      storeKey(nameNorm, metricData);
      storeKey(nameNorm.toLowerCase(), metricData);
    }

    if (leagueCode && leagueCode.length > 0) {
      // By code (exact + lowercase + uppercase)
      storeKey(leagueCode, metricData);
      storeKey(leagueCode.toLowerCase(), metricData);
      storeKey(leagueCode.toUpperCase(), metricData);

      // By normalized code
      if (codeNorm && codeNorm !== 'NA') {
        storeKey(codeNorm, metricData);
        storeKey(codeNorm.toLowerCase(), metricData);
      }

      // ── Fused variants (catch upstream concatenation bugs) ──

      // Raw fused: "United StatesNBA"
      var fusedRaw = leagueName + leagueCode;
      storeKey(fusedRaw, metricData);
      storeKey(fusedRaw.toLowerCase(), metricData);

      // Spaced fused: "United States NBA"
      var fusedSpaced = leagueName + ' ' + leagueCode;
      storeKey(fusedSpaced, metricData);
      storeKey(fusedSpaced.toLowerCase(), metricData);

      // Normalized fused: "UNITED_STATESNBA"
      if (nameNorm && nameNorm !== 'NA' && codeNorm && codeNorm !== 'NA') {
        var fusedNorm = nameNorm + codeNorm;
        storeKey(fusedNorm, metricData);
        storeKey(fusedNorm.toLowerCase(), metricData);

        // Separated normalized fused: "UNITED_STATES_NBA"
        var fusedNormSep = nameNorm + '_' + codeNorm;
        storeKey(fusedNormSep, metricData);
        storeKey(fusedNormSep.toLowerCase(), metricData);
      }

      Logger.log(
        '[' + FUNC_NAME + ']   🔑 Stored as: "' + leagueName +
        '", "' + leagueCode +
        '", norm="' + nameNorm + '|' + codeNorm +
        '", fused="' + fusedRaw + '"'
      );
    }
  }

  Logger.log('[' + FUNC_NAME + '] ═══════════════════════════════════════');
  Logger.log('[' + FUNC_NAME + '] ✅ Total metric keys: ' + Object.keys(leagueMetrics).length);

  return leagueMetrics;
}

/**
 * Parse accuracy value from various formats into a percentage (0-100).
 *
 * Conversion rules:
 * - Decimal values (0 < x ≤ 1) are converted to percentage (×100)
 * - Values > 1 are treated as already being percentages
 * - String values with '%' suffix are always treated as percentages (no auto-conversion)
 *
 * @param {number|string|null|undefined} value - The accuracy value to parse
 * @returns {number|null} Accuracy as percentage (0-100) rounded to 1 decimal, or null if invalid
 *
 * @example
 * _parseAccuracyValue(0.833)     // → 83.3
 * _parseAccuracyValue(83.3)      // → 83.3
 * _parseAccuracyValue("83.3%")   // → 83.3
 * _parseAccuracyValue("0.5%")    // → 0.5 (explicit %, not auto-converted)
 * _parseAccuracyValue("83,3")    // → 83.3 (European decimal format)
 * _parseAccuracyValue(150)       // → null (out of range)
 * _parseAccuracyValue("abc")     // → null (not a number)
 */
function _parseAccuracyValue(value) {
  // Handle null, undefined, and empty string
  if (value == null || value === '') {
    return null;
  }

  let numValue;
  let isExplicitPercentage = false;

  // Parse based on type
  if (typeof value === 'number') {
    numValue = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();

    // Detect explicit percentage notation (e.g., "0.5%" should stay 0.5, not become 50)
    isExplicitPercentage = trimmed.endsWith('%');

    // Normalize string:
    // - Remove trailing %
    // - Convert comma to period (European decimal format)
    const normalized = trimmed
      .replace(/%$/, '')
      .replace(/,/g, '.')
      .trim();

    if (normalized === '') {
      return null;
    }

    numValue = parseFloat(normalized);
  } else {
    // Unsupported type (object, array, etc.)
    return null;
  }

  // Must be a finite number (rejects NaN, Infinity, -Infinity)
  if (!Number.isFinite(numValue)) {
    return null;
  }

  // Convert decimal (0-1) to percentage (0-100)
  // Skip if explicitly marked as percentage to handle edge cases like "0.5%"
  if (!isExplicitPercentage && numValue > 0 && numValue <= 1) {
    numValue *= 100;
  }

  // Validate range: accuracy must be 0-100
  if (numValue < 0 || numValue > 100) {
    return null;
  }

  // Round to 1 decimal place
  return Math.round(numValue * 10) / 10;
}

/**
 * HELPER: Find sheet by name (case-insensitive, partial match)
 * Use this if you don't want the inline version
 */
function _findSheetByName(spreadsheet, targetName) {
  const sheets = spreadsheet.getSheets();
  const targetLower = targetName.toLowerCase();
  let found = sheets.find(s => s.getName().toLowerCase() === targetLower);
  if (!found) found = sheets.find(s => s.getName().toLowerCase().includes(targetLower));
  return found;
}

function diagnoseLeagueMismatch() {
  const metrics = fetchLeagueAccuracyMetrics();
  
  Logger.log('═══════════════════════════════════════');
  Logger.log('METRICS KEYS (from Config sheet):');
  Object.keys(metrics).forEach(k => Logger.log(`  "${k}"`));
  Logger.log('═══════════════════════════════════════');
  
  // Show what the bets are using
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const outputSheet = ss.getSheetByName('Output') || ss.getSheetByName('Selections');
  if (outputSheet) {
    const data = outputSheet.getDataRange().getValues();
    const leagueCol = data[0].findIndex(h => String(h).toLowerCase().includes('league'));
    if (leagueCol >= 0) {
      const usedCodes = [...new Set(data.slice(1).map(r => String(r[leagueCol]).trim()))];
      Logger.log('LEAGUE CODES USED IN BETS:');
      usedCodes.forEach(c => Logger.log(`  "${c}"`));
    }
  }
}


// ============================================================
// BET LOADER
// ============================================================

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MOTHERSHIP_HIVEMIND.gs - PATCHED FOR SNIPER DIR
 * Handles sync operations from satellite spreadsheets
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Load bets from a sheet with full SNIPER DIR support
 * @param {Sheet} sheet - The sheet to load bets from
 * @returns {Array} Array of bet objects
 */
function _loadBets(sheet) {
  const FUNC_NAME = '_loadBets';
  const data = sheet.getDataRange().getValues();
  
  if (data.length < 2) {
    Logger.log(`[${FUNC_NAME}] Sheet has no data rows`);
    return [];
  }
  
  const headerMap = _createHeaderMap(data[0]);
  Logger.log(`[${FUNC_NAME}] Headers found: ${JSON.stringify(Object.keys(headerMap))}`);
  
  const bets = [];
  const seenIds = new Set();
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    try {
      // Extract core fields
      const league = headerMap['league'] !== undefined 
        ? String(row[headerMap['league']] || '').trim() 
        : '';
      const match = headerMap['match'] !== undefined 
        ? String(row[headerMap['match']] || '').trim() 
        : '';
      const pick = headerMap['pick'] !== undefined 
        ? String(row[headerMap['pick']] || '').trim() 
        : '';
      const type = headerMap['type'] !== undefined 
        ? String(row[headerMap['type']] || '').toUpperCase().trim() 
        : '';
      
      // Skip invalid rows
      if (!match || !pick) continue;
      if (match.includes('Run "Sync')) continue;
      
      // Parse date
      const dateRaw = headerMap['date'] !== undefined ? row[headerMap['date']] : '';
      const dateStr = _formatDateValue(dateRaw);
      
      // Parse time
      const timeRaw = headerMap['time'] !== undefined ? row[headerMap['time']] : null;
      const time = _parseTime(timeRaw, dateRaw);
      
      // Parse confidence (PATCHED for SNIPER DIR)
      const confRaw = headerMap['confidence'] !== undefined ? row[headerMap['confidence']] : null;
      const confidence = _parseConfidence(confRaw, type);
      
      // Parse odds
      const oddsRaw = headerMap['odds'] !== undefined ? row[headerMap['odds']] : null;
      const odds = _parseOdds(oddsRaw, type);
      
      // Parse EV
      let ev = 0;
      const evRaw = headerMap['ev'] !== undefined ? row[headerMap['ev']] : null;
      if (evRaw && evRaw !== 'N/A' && evRaw !== '-') {
        const evStr = String(evRaw).replace('%', '').trim();
        ev = parseFloat(evStr) || 0;
      }
      
      // Generate unique bet ID (includes pick for same-match differentiation)
      const betId = _normalizeMatchKey(league, match, pick);
      
      // Skip duplicates
      if (seenIds.has(betId)) {
        continue;
      }
      seenIds.add(betId);
      
      // ═══════════════════════════════════════════════════════════════════════════
      // PATCHED: Enhanced type detection including SNIPER DIR
      // ═══════════════════════════════════════════════════════════════════════════
      const isBanker = type.includes('BANKER');
      const isSniper = type.includes('SNIPER');  // Catches both "SNIPER" and "SNIPER DIR"
      const isSniperDir = type.includes('SNIPER DIR') || 
                          (type.includes('SNIPER') && type.includes('DIR'));
      const isSniperOU = type.includes('O/U') || type.includes('OU');
      const isSniperMargin = isSniper && !isSniperDir && !isSniperOU;
      
      // ═══════════════════════════════════════════════════════════════════════════
      // PATCHED: Also detect DIR from pick format (e.g., "Q4 UNDER 56.2")
      // ═══════════════════════════════════════════════════════════════════════════
      const pickUpper = pick.toUpperCase();
      const isPickDirFormat = /Q[1-4]\s*(OVER|UNDER)\s*[\d.]+/i.test(pickUpper);
      const finalIsSniperDir = isSniperDir || (isSniper && isPickDirFormat);
      
      bets.push({
        league,
        date: dateStr,
        time,
        match,
        pick,
        type,
        odds,
        confidence,
        ev,
        betId,
        rowIndex: i,
        isBanker,
        isSniper,
        isSniperDir: finalIsSniperDir,  // NEW: Directional O/U pick
        isSniperOU,                      // NEW: O/U pick (non-directional)
        isSniperMargin                   // NEW: Margin/spread pick
      });
      
    } catch (e) {
      Logger.log(`[${FUNC_NAME}] Row ${i} error: ${e.message}`);
    }
  }
  
  // Log summary with SNIPER DIR breakdown
  const bankerCount = bets.filter(b => b.isBanker).length;
  const sniperCount = bets.filter(b => b.isSniper).length;
  const sniperDirCount = bets.filter(b => b.isSniperDir).length;
  const sniperMarginCount = bets.filter(b => b.isSniperMargin).length;
  const sniperOUCount = bets.filter(b => b.isSniperOU).length;
  
  Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════`);
  Logger.log(`[${FUNC_NAME}] Loaded ${bets.length} bets:`);
  Logger.log(`[${FUNC_NAME}]   🔒 Bankers: ${bankerCount}`);
  Logger.log(`[${FUNC_NAME}]   🎯 Snipers: ${sniperCount}`);
  Logger.log(`[${FUNC_NAME}]      ├─ DIR (O/U directional): ${sniperDirCount}`);
  Logger.log(`[${FUNC_NAME}]      ├─ O/U (non-directional): ${sniperOUCount}`);
  Logger.log(`[${FUNC_NAME}]      └─ Margin/Spread: ${sniperMarginCount}`);
  Logger.log(`[${FUNC_NAME}] ═══════════════════════════════════════════════════════`);
  
  return bets;
}

/**
 * Parse confidence value - PATCHED for SNIPER DIR formats
 * Handles: percentages (63%), margins (Margin: +5.0), edges (Edge: 16.8%)
 * @param {*} confRaw - Raw confidence value
 * @param {string} betType - Bet type string
 * @returns {number} Confidence as decimal (0-1)
 */
function _parseConfidence(confRaw, betType) {
  const FUNC_NAME = '_parseConfidence';
  const typeUpper = String(betType || '').toUpperCase();
  
  // Determine bet category
  const isBanker = typeUpper.includes('BANKER');
  const isSniper = typeUpper.includes('SNIPER');
  const isSniperDir = typeUpper.includes('SNIPER DIR') || typeUpper.includes('DIR');
  
  // Default confidences by type
  const DEFAULT_BANKER_CONF = 0.75;
  const DEFAULT_SNIPER_CONF = 0.65;
  const DEFAULT_DIR_CONF = 0.60;
  
  // Handle null/undefined
  if (confRaw === null || confRaw === undefined) {
    if (isSniperDir) return DEFAULT_DIR_CONF;
    if (isSniper) return DEFAULT_SNIPER_CONF;
    if (isBanker) return DEFAULT_BANKER_CONF;
    return DEFAULT_SNIPER_CONF;
  }
  
  const confStr = String(confRaw).toLowerCase().trim();
  
  // Handle empty or N/A values
  if (!confStr || confStr === 'n/a' || confStr === '-' || confStr === 'na') {
    if (isSniperDir) return DEFAULT_DIR_CONF;
    if (isSniper) return DEFAULT_SNIPER_CONF;
    if (isBanker) return DEFAULT_BANKER_CONF;
    return DEFAULT_SNIPER_CONF;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PATCHED: Handle SNIPER DIR specific formats
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Handle "Margin: +X.X" format (regular snipers)
  if (confStr.includes('margin')) {
    const marginMatch = confStr.match(/[+-]?(\d+\.?\d*)/);
    if (marginMatch) {
      const margin = parseFloat(marginMatch[1]);
      // Higher margin = higher confidence (scale: margin 5 = 70%, margin 10 = 80%)
      return Math.min(0.85, 0.60 + (margin * 0.02));
    }
    return DEFAULT_SNIPER_CONF;
  }
  
  // Handle percentage format (e.g., "63%", "59%") - common for SNIPER DIR
  if (confStr.includes('%')) {
    const val = parseFloat(confStr.replace('%', ''));
    if (!isNaN(val)) {
      return val / 100;
    }
    return isSniperDir ? DEFAULT_DIR_CONF : DEFAULT_SNIPER_CONF;
  }
  
  // Handle "Edge: X.X%" format
  if (confStr.includes('edge')) {
    const edgeMatch = confStr.match(/(\d+\.?\d*)/);
    if (edgeMatch) {
      const edge = parseFloat(edgeMatch[1]);
      // Convert edge to confidence (edge 10% = ~60% confidence)
      return Math.min(0.85, 0.50 + (edge / 100));
    }
    return DEFAULT_SNIPER_CONF;
  }
  
  // Handle "Prob: X.X" format
  if (confStr.includes('prob')) {
    const probMatch = confStr.match(/(\d+\.?\d*)/);
    if (probMatch) {
      const prob = parseFloat(probMatch[1]);
      return prob > 1 ? prob / 100 : prob;
    }
    return DEFAULT_SNIPER_CONF;
  }
  
  // Try parsing as plain number
  const numVal = parseFloat(confStr);
  if (!isNaN(numVal)) {
    // If > 1, assume percentage
    return numVal > 1 ? numVal / 100 : numVal;
  }
  
  // Final fallback
  if (isSniperDir) return DEFAULT_DIR_CONF;
  if (isSniper) return DEFAULT_SNIPER_CONF;
  if (isBanker) return DEFAULT_BANKER_CONF;
  return DEFAULT_SNIPER_CONF;
}

/**
 * Parse odds value - handles SNIPER DIR default odds
 * @param {*} oddsRaw - Raw odds value
 * @param {string} betType - Bet type string
 * @returns {number} Decimal odds
 */
function _parseOdds(oddsRaw, betType) {
  const typeUpper = String(betType || '').toUpperCase();
  const isSniper = typeUpper.includes('SNIPER');
  const isSniperDir = typeUpper.includes('SNIPER DIR') || typeUpper.includes('DIR');
  
  // Default odds by type
  const DEFAULT_BANKER_ODDS = 1.40;
  const DEFAULT_SNIPER_ODDS = 1.40;
  const DEFAULT_DIR_ODDS = 1.85;  // O/U bets typically have higher odds
  
  const oddsStr = String(oddsRaw || '').trim();
  
  if (!oddsStr || oddsStr === '-' || oddsStr === 'n/a' || oddsStr === 'N/A') {
    if (isSniperDir) return DEFAULT_DIR_ODDS;
    if (isSniper) return DEFAULT_SNIPER_ODDS;
    return DEFAULT_BANKER_ODDS;
  }
  
  const numOdds = parseFloat(oddsStr);
  
  if (isNaN(numOdds) || numOdds < 1.01) {
    if (isSniperDir) return DEFAULT_DIR_ODDS;
    if (isSniper) return DEFAULT_SNIPER_ODDS;
    return DEFAULT_BANKER_ODDS;
  }
  
  return numOdds;
}


/**
 * computeVerdict — Standalone grade verdict engine (Phase 1)
 *
 * Evaluates a bet's Assayer grades against a requested floor.
 * Returns a verdict object with pass/fail, reasons, and proof log.
 * Does NOT mutate the bet.
 *
 * @param {Object} bet - The enriched bet object
 * @param {Object} [gateCfg] - Override thresholds for this evaluation
 * @param {string} [gateCfg.minEdgeGrade]        - e.g. 'GOLD', 'SILVER'. Empty = skip edge check
 * @param {string} [gateCfg.minPurityGrade]      - e.g. 'GOLD', 'SILVER'. Empty = skip purity check
 * @param {boolean} [gateCfg.requireReliableEdge] - If true, reject unreliable edges. Default: false
 * @param {string} [gateCfg.unknownLeagueAction]  - 'BLOCK' or 'ALLOW'. Default: 'ALLOW'
 * @returns {Object} { passed, verdict, proof, edgeGrade, purityGrade, reasons, ... }
 */
function computeVerdict(bet, gateCfg) {
  gateCfg = gateCfg || {};

  // ── Grade ranking (higher = better) ──
  var GRADE_RANK = {
    PLATINUM: 6, GOLD: 5, SILVER: 4, BRONZE: 3,
    ROCK: 2, CHARCOAL: 1, NONE: 0
  };

  var normGrade = function(g) {
    var s = String(g || '').trim().toUpperCase();
    // Treat N/A, NA, UNKNOWN as "missing" (empty)
    if (s === 'N/A' || s === 'NA' || s === 'UNKNOWN' || s === '-') return '';
    return s;
  };

  var rankOf = function(g) {
    var ng = normGrade(g);
    if (!ng) return -1;
    return (GRADE_RANK[ng] !== undefined) ? GRADE_RANK[ng] : -1;
  };

  // ── Read grades from bet (nested assayer object OR flattened fields) ──
  var edge   = (bet && bet.assayer && bet.assayer.edge)   || null;
  var purity = (bet && bet.assayer && bet.assayer.purity) || null;

  var edgeGrade   = normGrade((edge && edge.grade)   || (bet && bet.assayer_edge_grade)   || '');
  var purityGrade = normGrade((purity && purity.grade) || (bet && bet.assayer_purity_grade) || '');

  // ── Thresholds (empty string = skip that check) ──
  var minEdge   = normGrade(gateCfg.minEdgeGrade   || '');
  var minPurity = normGrade(gateCfg.minPurityGrade || '');

  // ── Reliable flag (prefer edge object, fallback to flattened) ──
  var reliable = (function() {
    if (edge) {
      if (typeof edge.reliable      === 'boolean') return edge.reliable;
      if (typeof edge.isReliable    === 'boolean') return edge.isReliable;
      if (typeof edge.reliableEdge  === 'boolean') return edge.reliableEdge;
      if (typeof edge.reliable_edge === 'boolean') return edge.reliable_edge;
    }
    if (bet && typeof bet.assayer_edge_reliable === 'boolean') return bet.assayer_edge_reliable;
    return undefined;
  })();

  var requireReliable = !!gateCfg.requireReliableEdge;  // default false

  // ── Unknown league heuristic ──
  var unknownAction = String(gateCfg.unknownLeagueAction || 'ALLOW').trim().toUpperCase();
  var blockUnknown  = (unknownAction === 'BLOCK');

  var assayerOk    = (bet && bet.assayer && typeof bet.assayer.ok === 'boolean') ? bet.assayer.ok : undefined;
  var isPenalty     = !!(bet && bet.hasPenalty);
  var unknownLeague = isPenalty || assayerOk === false || !edgeGrade || !purityGrade;

  // ── Evaluate reasons for failure ──
  var reasons = [];

  if (blockUnknown && unknownLeague) {
    reasons.push('UNKNOWN_LEAGUE_BLOCK');
  }

  if (minEdge) {
    if (!edgeGrade) {
      reasons.push('NO_EDGE_MATCH');
    } else if (rankOf(edgeGrade) < rankOf(minEdge)) {
      reasons.push('EDGE_GRADE_FAIL(' + edgeGrade + '<' + minEdge + ')');
    }
  }

  if (minPurity) {
    if (!purityGrade) {
      reasons.push('NO_PURITY_MATCH');
    } else if (rankOf(purityGrade) < rankOf(minPurity)) {
      reasons.push('PURITY_GRADE_FAIL(' + purityGrade + '<' + minPurity + ')');
    }
  }

  if (requireReliable && reliable !== true) {
    reasons.push('EDGE_NOT_RELIABLE(' + String(reliable) + ')');
  }

  var passed  = (reasons.length === 0);
  var verdict = (edgeGrade || 'NONE') + '+' + (purityGrade || 'NONE') + '=' + (passed ? 'PASS' : 'FAIL');

  // ── Build proof log ──
  var liftTxt = '';
  try {
    var liftPP = (edge && typeof edge.lift === 'number') ? (edge.lift * 100) : null;
    if (liftPP != null && isFinite(liftPP)) {
      liftTxt = ' lift=' + (liftPP >= 0 ? '+' : '') + liftPP.toFixed(2) + 'pp';
    }
  } catch(e) {}

  var edgeIdTxt = (edge && edge.edge_id) ? (' edge_id=' + edge.edge_id) : '';
  var relTxt    = (reliable !== undefined) ? (' reliable=' + String(reliable)) : ' reliable=UNKNOWN';
  var okTxt     = (assayerOk !== undefined) ? (' assayer_ok=' + String(assayerOk)) : '';
  var penTxt    = isPenalty ? ' penalty=true' : '';

  var proof =
    'AssayerVerdict=' + verdict + '; ' +
    'gate[minEdge=' + (minEdge || '-') + ',minPurity=' + (minPurity || '-') +
    ',reqReliable=' + requireReliable + ',unknownAction=' + unknownAction + ']; ' +
    'edge=' + (edgeGrade || 'NONE') + edgeIdTxt + liftTxt + relTxt + '; ' +
    'purity=' + (purityGrade || 'NONE') + ';' +
    okTxt + penTxt + '; ' +
    'reasons=[' + reasons.join(', ') + ']';

  return {
    passed:        passed,
    verdict:       verdict,
    proof:         proof,
    edgeGrade:     edgeGrade,
    purityGrade:   purityGrade,
    unknownLeague: unknownLeague,
    reliable:      reliable,
    reasons:       reasons,
    requireReliable: requireReliable,
    blockUnknown:    blockUnknown,
    minEdge:   minEdge,
    minPurity: minPurity
  };
}


/**
 * _filterBets — SINGLE DEFINITIVE VERSION (Phase 1)
 *
 * Four-layer filter pipeline:
 *   Layer 1: Standard (time window + confidence + invalid odds). Skip via skipStandard.
 *   Layer 2: Assayer blocks (Bridge hard-blocks). Skip via applyAssayerBlocks=false.
 *   Layer 3: Grade gate (rank-based floor). Auto-enables when minEdgeGrade/minPurityGrade passed.
 *   Layer 4: Legacy Gold Gate (recompute-if-missing). Defaults OFF.
 *
 * Phase 1 changes:
 *   - Odds range blocker REMOVED. Only invalid odds (≤1.0, NaN) are rejected.
 *   - Grade gate added: supports minEdgeGrade/minPurityGrade overrides.
 *   - Gold Gate defaults OFF (no longer auto-triggered by GOLD_ONLY_MODE).
 *   - Grade gate defaults PERMISSIVE: requireReliableEdge=false, unknownLeagueAction='ALLOW'.
 *
 * DELETE any other function named _filterBets in your project.
 */
function _filterBets(bets, opts) {
  var FUNC_NAME = '_filterBets';
  opts = opts || {};

  var cfg = (typeof ACCA_ENGINE_CONFIG !== 'undefined') ? ACCA_ENGINE_CONFIG : {};
  var VERBOSE = (opts.verboseLogging !== undefined) ? !!opts.verboseLogging : !!cfg.VERBOSE_LOGGING;

  // ═══════════════════════════════════════════════════════════════════════════
  // GATE TOGGLES
  // ═══════════════════════════════════════════════════════════════════════════

  var applyAssayerBlocks = (opts.applyAssayerBlocks === undefined) ? true : !!opts.applyAssayerBlocks;
  var skipStandard       = !!opts.skipStandard;

  // Grade gate: auto-enables when caller passes grade overrides
  var hasGradeOverrides = (opts.minEdgeGrade !== undefined) || (opts.minPurityGrade !== undefined);
  var applyGradeGate = (opts.applyGradeGate === undefined)
    ? hasGradeOverrides
    : !!opts.applyGradeGate;

  // Legacy gold gate: defaults OFF
  var applyGoldGate = (opts.applyGoldGate === undefined) ? false : !!opts.applyGoldGate;

  // ── Grade gate config (PERMISSIVE defaults — only ranks, no extras) ──
  var gradeGateCfg = {
    minEdgeGrade:       (opts.minEdgeGrade   !== undefined) ? String(opts.minEdgeGrade)   : '',
    minPurityGrade:     (opts.minPurityGrade !== undefined) ? String(opts.minPurityGrade) : '',
    requireReliableEdge: (opts.requireReliableEdge !== undefined) ? !!opts.requireReliableEdge : false,
    unknownLeagueAction: (opts.unknownLeagueAction !== undefined) ? String(opts.unknownLeagueAction) : 'ALLOW'
  };

  // ── Legacy gold gate config (uses ACCA_ENGINE_CONFIG defaults) ──
  var goldGateCfg = {
    minEdgeGrade:        cfg.MIN_EDGE_GRADE   || 'GOLD',
    minPurityGrade:      cfg.MIN_PURITY_GRADE || 'GOLD',
    requireReliableEdge: (cfg.REQUIRE_EDGE_RELIABLE !== undefined) ? !!cfg.REQUIRE_EDGE_RELIABLE : !!cfg.REQUIRE_RELIABLE_EDGE,
    unknownLeagueAction: cfg.UNKNOWN_LEAGUE_ACTION || 'BLOCK'
  };

  // ── Standard thresholds ──
  var now = new Date();
  var timeWindowHours = Number(cfg.TIME_WINDOW_HOURS || 48);
  if (!isFinite(timeWindowHours) || timeWindowHours <= 0) timeWindowHours = 48;
  var cutoffFuture = new Date(now.getTime() + timeWindowHours * 60 * 60 * 1000);

  var minConfidence = Number(cfg.MIN_CONFIDENCE || 0.50);
  if (!isFinite(minConfidence) || minConfidence < 0) minConfidence = 0.50;

  // ── Diagnostic header ──
  Logger.log('[' + FUNC_NAME + '] gates: assayerBlocks=' + applyAssayerBlocks +
    ' gradeGate=' + applyGradeGate +
    ' goldGate=' + applyGoldGate +
    ' skipStandard=' + skipStandard);
  if (applyGradeGate) {
    Logger.log('[' + FUNC_NAME + '] gradeGateCfg: minEdge=' + (gradeGateCfg.minEdgeGrade || '-') +
      ' minPurity=' + (gradeGateCfg.minPurityGrade || '-') +
      ' reqReliable=' + gradeGateCfg.requireReliableEdge +
      ' unknownAction=' + gradeGateCfg.unknownLeagueAction);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COUNTERS
  // ═══════════════════════════════════════════════════════════════════════════

  var filtered = [];

  var excluded = {
    // Layer 1: Standard
    past: 0, future: 0, lowConf: 0, invalidOdds: 0,

    // Layer 2: Assayer blocks
    assayerBlocked: 0,
    blockedByNoEdge: 0,
    blockedByNoPurity: 0,
    blockedByPurityGrade: 0,
    blockedByPurityReliability: 0,
    blockedByPurityBuilding: 0,
    blockedByEdgeGrade: 0,
    blockedByEdgeReliability: 0,
    blockedByEdgeSmallSample: 0,
    blockedByOther: 0,

    // Layer 3: Grade gate
    gradeGateFail: 0,

    // Layer 4: Legacy gold gate
    goldGateRecomputed: 0,
    goldGateFail: 0
  };

  var rejected = [];
  var MAX_REJECTED = 500;
  var MAX_LOG_LINES = 80;
  var logLines = 0;

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN FILTER LOOP
  // ═══════════════════════════════════════════════════════════════════════════

  var betList = bets || [];
  for (var bi = 0; bi < betList.length; bi++) {
    var bet = betList[bi];
    if (!bet || typeof bet !== 'object') continue;

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 1: STANDARD FILTERS (time + confidence + data sanity)
    // ─────────────────────────────────────────────────────────────────────────
    if (!skipStandard) {
      var betTime = (bet.time instanceof Date) ? bet.time : new Date(bet.time);
      if (!betTime || !isFinite(betTime.getTime())) { excluded.past++; continue; }
      if (betTime < now)           { excluded.past++;   continue; }
      if (betTime > cutoffFuture)  { excluded.future++; continue; }

      var conf = Number(bet.confidence);
      if (!isFinite(conf)) conf = 0;
      var minConf = bet.isSniperDir ? (minConfidence - 0.05) : minConfidence;
      if (conf < minConf) { excluded.lowConf++; continue; }

      // PHASE 1: Odds range blocker REMOVED.
      // Only reject mathematically invalid odds (would break acca math).
      var odds = Number(bet.odds);
      if (!isFinite(odds) || odds <= 1.0) {
        excluded.invalidOdds++;
        if (VERBOSE && logLines < MAX_LOG_LINES) {
          Logger.log('[' + FUNC_NAME + '] ❌ INVALID_ODDS betId=' + (bet.betId || '') +
            ' odds=' + bet.odds);
          logLines++;
        }
        continue;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 2: ASSAYER BLOCK ENFORCEMENT (Bridge hard-blocks)
    // ─────────────────────────────────────────────────────────────────────────
    if (applyAssayerBlocks && bet.assayer && bet.assayer.blocked === true) {
      excluded.assayerBlocked++;

      var code = String(
        bet.assayer_block_reason_code ||
        (bet.assayer && bet.assayer.blockReasonCode) || ''
      ).trim().toUpperCase();

      if      (code === 'NO_EDGE')                                excluded.blockedByNoEdge++;
      else if (code === 'NO_PURITY')                              excluded.blockedByNoPurity++;
      else if (code === 'PURITY_GRADE' || code === 'PURITY_HARD_BLOCK') excluded.blockedByPurityGrade++;
      else if (code === 'PURITY_BUILDING')                        excluded.blockedByPurityBuilding++;
      else if (code === 'PURITY_RELIABILITY')                     excluded.blockedByPurityReliability++;
      else if (code === 'EDGE_GRADE')                             excluded.blockedByEdgeGrade++;
      else if (code === 'EDGE_RELIABILITY')                       excluded.blockedByEdgeReliability++;
      else if (code === 'EDGE_SMALL_SAMPLE')                      excluded.blockedByEdgeSmallSample++;
      else                                                        excluded.blockedByOther++;

      if (rejected.length < MAX_REJECTED) {
        rejected.push({
          stage: 'ASSAYER_BLOCK', betId: bet.betId || '', league: bet.league || '',
          match: bet.match || '', pick: bet.pick || '', reasonCode: code
        });
      }
      if (VERBOSE && logLines < MAX_LOG_LINES) {
        Logger.log('[' + FUNC_NAME + '] ❌ ASSAYER_BLOCKED code=' + code +
          ' betId=' + (bet.betId || '') + ' league=' + (bet.league || ''));
        logLines++;
      }
      continue;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 3: GRADE GATE (rank-based floor — NO recompute, uses existing grades)
    // Auto-enabled when caller passes minEdgeGrade / minPurityGrade.
    // Defaults: requireReliableEdge=false, unknownLeagueAction='ALLOW'
    // ─────────────────────────────────────────────────────────────────────────
    if (applyGradeGate) {
      var gv = computeVerdict(bet, gradeGateCfg);

      if (!gv.passed) {
        excluded.gradeGateFail++;

        if (rejected.length < MAX_REJECTED) {
          rejected.push({
            stage: 'GRADE_GATE', betId: bet.betId || '', league: bet.league || '',
            match: bet.match || '', pick: bet.pick || '',
            edgeGrade: gv.edgeGrade, purityGrade: gv.purityGrade,
            verdict: gv.verdict, reasons: gv.reasons
          });
        }
        if (VERBOSE && logLines < MAX_LOG_LINES) {
          Logger.log('[' + FUNC_NAME + '] ❌ GRADE_GATE_FAIL betId=' + (bet.betId || '') +
            ' league=' + (bet.league || '') +
            ' edge=' + (gv.edgeGrade || 'NONE') + ' purity=' + (gv.purityGrade || 'NONE') +
            ' reasons=' + JSON.stringify(gv.reasons));
          logLines++;
        }
        continue;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 4: LEGACY GOLD GATE (recompute-if-missing — OFF by default)
    // Only fires when caller explicitly passes applyGoldGate: true
    // ─────────────────────────────────────────────────────────────────────────
    if (applyGoldGate) {
      var hasDecision =
        (typeof bet.assayer_passed === 'boolean') &&
        (typeof bet.assayer_verdict === 'string') &&
        (String(bet.assayer_verdict).trim() !== '');

      if (!hasDecision) {
        excluded.goldGateRecomputed++;
        var gv2 = computeVerdict(bet, goldGateCfg);

        bet.assayer_passed       = gv2.passed;
        bet.assayer_verdict      = gv2.verdict;
        bet.assayer_proof_log    = gv2.proof;
        bet.assayer_edge_grade   = gv2.edgeGrade || '';
        bet.assayer_purity_grade = gv2.purityGrade || '';

        if (VERBOSE) {
          Logger.log('[GoldGate RECOMPUTE] betId=' + (bet.betId || '') +
            ' verdict=' + gv2.verdict + ' passed=' + gv2.passed);
        }
      }

      if (bet.assayer_passed !== true) {
        excluded.goldGateFail++;

        if (rejected.length < MAX_REJECTED) {
          rejected.push({
            stage: 'GOLD_GATE', betId: bet.betId || '', league: bet.league || '',
            verdict: bet.assayer_verdict || ''
          });
        }
        if (VERBOSE && logLines < MAX_LOG_LINES) {
          Logger.log('[' + FUNC_NAME + '] ❌ GOLD_GATE_FAIL betId=' + (bet.betId || '') +
            ' verdict=' + (bet.assayer_verdict || ''));
          logLines++;
        }
        continue;
      }
    }

    // ── PASSED ALL LAYERS ──
    filtered.push(bet);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT + LOGGING
  // ═══════════════════════════════════════════════════════════════════════════

  var audit = {
    at: new Date().toISOString(),
    input: betList.length,
    passed: filtered.length,
    gates: {
      skipStandard: skipStandard,
      applyAssayerBlocks: applyAssayerBlocks,
      applyGradeGate: applyGradeGate,
      applyGoldGate: applyGoldGate
    },
    gradeGateCfg: applyGradeGate ? gradeGateCfg : null,
    excluded: excluded,
    rejectedCount: rejected.length,
    sampleRejected: rejected.slice(0, 50)
  };

  try { filtered._audit = audit; } catch(e) {}

  try {
    PropertiesService.getScriptProperties().setProperty(
      'ACCA_ENGINE_LAST_FILTER_AUDIT', JSON.stringify(audit));
    PropertiesService.getScriptProperties().setProperty(
      'ACCA_ENGINE_LAST_FILTER_REJECTED', JSON.stringify(rejected.slice(0, 200)));
  } catch(e) {}

  // ── Summary lines ──
  Logger.log('[' + FUNC_NAME + '] RESULT: ' + filtered.length + '/' + betList.length + ' passed');

  if (!skipStandard) {
    Logger.log('[' + FUNC_NAME + '] Standard: past=' + excluded.past +
      ' future=' + excluded.future + ' lowConf=' + excluded.lowConf +
      ' invalidOdds=' + excluded.invalidOdds);
  }

  if (applyAssayerBlocks) {
    Logger.log('[' + FUNC_NAME + '] Assayer blocks: ' + excluded.assayerBlocked +
      ' (purityGrade=' + excluded.blockedByPurityGrade +
      ', noEdge=' + excluded.blockedByNoEdge +
      ', edgeGrade=' + excluded.blockedByEdgeGrade +
      ', other=' + excluded.blockedByOther + ')');
  }

  if (applyGradeGate) {
    Logger.log('[' + FUNC_NAME + '] Grade gate: ' + excluded.gradeGateFail + ' rejected' +
      ' (floor: edge>=' + (gradeGateCfg.minEdgeGrade || '-') +
      ' purity>=' + (gradeGateCfg.minPurityGrade || '-') + ')');
  }

  if (applyGoldGate) {
    Logger.log('[' + FUNC_NAME + '] Gold gate: ' + excluded.goldGateFail + ' failed' +
      ' (' + excluded.goldGateRecomputed + ' recomputed)');
  }

  return filtered;
}
