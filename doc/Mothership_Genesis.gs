/**
 * ======================================================================
 * FILE: Mothership_Genesis.gs
 * PROJECT: Ma Golide - MOTHERSHIP
 * PURPOSE: One-click setup for Central Command structure
 * AUTHOR: AI Council (GPT-5.1, The Architect)
 * VERSION: 2.1 (Aligned with AccaEngine)
 * USAGE: Run setupMothership() once when creating a new Mothership file
 * ======================================================================
 */

/**
 * Sanity check function to prevent column mismatch errors
 * @param {Array} headers - Header array to validate
 * @param {string} rangeStr - Range string (e.g., 'A1:H1')
 * @returns {boolean} True if valid
 */
function _validateHeadersAndRange(headers, rangeStr) {
  if (!headers || !Array.isArray(headers) || headers.length === 0) {
    throw new Error('Invalid headers array');
  }
  
  if (!rangeStr || typeof rangeStr !== 'string') {
    throw new Error('Invalid range string');
  }
  
  // Extract column count from range (e.g., 'A1:H1' -> 8 columns)
  const rangeMatch = rangeStr.match(/^([A-Z]+)\d+:([A-Z]+)\d+$/);
  if (!rangeMatch) {
    throw new Error(`Invalid range format: ${rangeStr}`);
  }
  
  const startCol = rangeMatch[1];
  const endCol = rangeMatch[2];
  const expectedCols = _columnLetterToNumber(endCol) - _columnLetterToNumber(startCol) + 1;
  
  const actualCols = headers.length;
  
  if (actualCols !== expectedCols) {
    throw new Error(`Column mismatch: headers have ${actualCols} columns but range ${rangeStr} expects ${expectedCols} columns`);
  }
  
  return true;
}

/**
 * Convert column letter to number (A=1, B=2, ..., Z=26, AA=27, etc.)
 * @param {string} col - Column letter(s)
 * @returns {number} Column number
 */
function _columnLetterToNumber(col) {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return result;
}

/**
 * WHY: To establish a standardized, repeatable structure for the central hub
 * WHAT: Creates and formats all required Mothership sheets
 * HOW: Uses SpreadsheetApp to create Config, Sync_Temp, Acca_Portfolio, Acca_Results, Master_Dashboard
 * WHERE: This script runs ONLY inside the 'Ma Golide - MOTHERSHIP' Google Sheet
 */
function setupMothership() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  
  // Confirmation dialog
  const confirm = ui.alert(
    ' Ma Golide Mothership Setup',
    'This will create/reset the following sheets:\n\n' +
    'Config - Single satellite management sheet\n' +
    'Sync_Temp - Bet staging area\n' +
    'Acca_Portfolio - Accumulator display\n' +
    'Acca_Results - Results tracker\n' +
    'Master_Dashboard - KPI overview\n\n' +
    'Continue with setup?',
    ui.ButtonSet.YES_NO
  );
  
  if (confirm !== ui.Button.YES) {
    ss.toast(' Setup cancelled', 'Ma Golide', 3);
    ss.toast('❌ Setup cancelled', 'Ma Golide', 3);
    return;
  }
  
  ss.toast(' Constructing Central Command...', 'Ma Golide Mothership', 5);

  try {
    ss.toast('Creating Config sheet...', 'Step 1/11', 3);
    _createConfigSheet(ss);
    
    ss.toast('Creating Sync_Temp sheet...', 'Step 2/11', 3);
    _createSyncTempSheet(ss);
    
    ss.toast('Creating Acca_Portfolio sheet...', 'Step 3/11', 3);
    _createAccaPortfolioSheet(ss);
    
    ss.toast('Creating Acca_Results sheet...', 'Step 4/11', 3);
    _createAccaResultsSheet(ss);
    
    ss.toast('Creating Master_Dashboard sheet...', 'Step 5/11', 3);
    _createDashboardSheet(ss);
    
    ss.toast('Creating Config_Ledger sheet...', 'Step 6/11', 3);
    _createConfigLedgerSheet(ss);
    
    ss.toast('Creating Vault sheets...', 'Step 7/11', 3);
    _createVaultSheets(ss);
    
    ss.toast('Creating Analysis sheets...', 'Step 8/11', 3);
    _createAnalysisSheets(ss);
    
    ss.toast('Creating Performance sheets...', 'Step 9/11', 3);
    _createPerformanceSheets(ss);
    
    ss.toast('Creating Risky Analysis sheets...', 'Step 10/11', 3);
    _createRiskySheets(ss);
    
    ss.toast('Creating Historical sheets...', 'Step 11/11', 3);
    _createHistoricalSheets(ss);
    
    _cleanupDefaultSheet(ss);

    ss.toast(' Mothership Construction Complete!', 'Success', 5);
    ui.alert(
      ' Mothership Ready!',
      'Successfully created all 11 sheets:\n\n' +
      'Config - Single satellite management sheet\n' +
      'Sync_Temp - Staging area for synced bets\n' +
      'Acca_Portfolio - Your accumulator display\n' +
      'Acca_Results - Track wins/losses\n' +
      'Master_Dashboard - KPI overview\n' +
      'Config_Ledger - Configuration with dominant_stamp\n' +
      'Vault & MA_Vault - Bet vault with purity tracking\n' +
      'Analysis_Tier1 & MA_Discovery - Analysis sheets\n' +
      'Performance sheets - League & Bet performance\n' +
      'Risky analysis sheets - Risky accumulator analysis\n' +
      'Historical sheets - Results archive & performance log\n\n' +
      'NEXT STEPS:\n' +
      '1. Go to Config sheet (single satellite management)\n' +
      '2. Add your satellite spreadsheet URLs\n' +
      '3. Run "Sync All Leagues" from the menu',
      ui.ButtonSet.OK
    );
  } catch (e) {
    Logger.log(`[Genesis] ERROR: ${e.message}\n${e.stack}`);
    ui.alert('❌ Setup Error', `Failed to complete setup:\n\n${e.message}`, ui.ButtonSet.OK);
  }
}

/**
 * WHY: Config sheet is the central configuration hub for the Mothership
 * WHAT: Creates a clean, efficient configuration interface
 * HOW: Sets up headers for satellite management
 */
function _createConfigSheet(ss) {
  let sheet = ss.getSheetByName('Config');
  if (!sheet) {
    sheet = ss.insertSheet('Config', 1);
  }
  sheet.clear();

  const headers = [
    'League ID', 'League Name', 'File URL', 'Sport Type', 'Status', 'Quarters', 'Last Sync', 'assayer_sheet_id'
  ];

  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(headers, 'A1:H1');

  sheet.getRange('A1:H1').setValues([headers])
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');

  // Add example rows
  sheet.getRange('A2:H4').setValues([
    ['NBA_2025', 'NBA', 'https://your-satellite-url-here', 'Basketball', 'Active', '4', '', ''],
    ['EURO_2025', 'Euroleague', 'https://your-satellite-url-here', 'Basketball', 'Active', '4', '', ''],
    ['', '', '', '', '', '', '', '']
  ]);

  // Format columns
  sheet.setColumnWidth(1, 100);   // League ID
  sheet.setColumnWidth(2, 150);   // League Name
  sheet.setColumnWidth(3, 400);   // File URL
  sheet.setColumnWidth(4, 120);   // Sport Type
  sheet.setColumnWidth(5, 80);    // Status
  sheet.setColumnWidth(6, 100);   // Quarters
  sheet.setColumnWidth(7, 120);   // Last Sync
  sheet.setColumnWidth(8, 150);   // assayer_sheet_id

  Logger.log('[Genesis] Config sheet created (with assayer_sheet_id)');
}

/**
 * WHY: Sync_Temp is the staging area for synced bets before portfolio building
 * WHAT: Creates the canonical schema for bet data
 * HOW: Sets up headers matching AccaEngine expectations
 */
function _createSyncTempSheet(ss) {
  let sheet = ss.getSheetByName('Sync_Temp');
  if (!sheet) {
    sheet = ss.insertSheet('Sync_Temp', 1);
  }
  sheet.clear();
  
  const headers = [['League', 'Time', 'Match', 'Pick', 'Type', 'Odds', 'Confidence', 'EV']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(headers[0], 'A1:H1');
  
  sheet.getRange('A1:H1').setValues(headers)
    .setFontWeight('bold')
    .setBackground('#ff9900')
    .setFontColor('#ffffff');

  sheet.getRange('A2').setValue('⏳ Run "Sync All Leagues" to populate this sheet');
  sheet.getRange('A2:H2').merge().setFontColor('#999999').setFontStyle('italic');

  sheet.autoResizeColumns(1, 8);

  Logger.log('[Genesis] Sync_Temp sheet created');
}

/**
 * WHY: Acca_Portfolio displays the built accumulators
 * WHAT: Creates the display sheet for accumulator portfolios
 * HOW: Sets up structure for AccaEngine output
 */
function _createAccaPortfolioSheet(ss) {
  let sheet = ss.getSheetByName('Acca_Portfolio');
  if (!sheet) {
    sheet = ss.insertSheet('Acca_Portfolio', 2);
  }
  sheet.clear();
  
  sheet.getRange('A1:I1').merge()
    .setValue('🎰 MA GOLIDE - ACCUMULATOR PORTFOLIO')
    .setFontWeight('bold')
    .setFontSize(14)
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');

  sheet.getRange('A3').setValue('⏳ Run "Build Portfolio" after syncing leagues');
  sheet.getRange('A3:I3').merge().setFontColor('#999999').setFontStyle('italic');

  Logger.log('[Genesis] Acca_Portfolio sheet created');
}

/**
 * WHY: Acca_Results tracks accumulator outcomes
 * WHAT: Creates the results tracking sheet
 * HOW: Sets up headers for result monitoring
 */
function _createAccaResultsSheet(ss) {
  let sheet = ss.getSheetByName('Acca_Results');
  if (!sheet) {
    sheet = ss.insertSheet('Acca_Results', 3);
  }
  sheet.clear();
  
  const headers = [[
    'Acca ID', 'Type', 'Legs', 'Total Odds', 'Avg Conf%',
    'Created', 'Window Start', 'Window End',
    'Status', 'Legs Won', 'Legs Lost', 'Legs Pending', 'Result'
  ]];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(headers[0], 'A1:M1');
  
  sheet.getRange('A1:M1').setValues(headers)
    .setFontWeight('bold')
    .setBackground('#38761d')
    .setFontColor('#ffffff');

  sheet.getRange('A2').setValue('⏳ Results will appear here after building and checking accumulators');
  sheet.getRange('A2:M2').merge().setFontColor('#999999').setFontStyle('italic');

  sheet.autoResizeColumns(1, 13);

  Logger.log('[Genesis] Acca_Results sheet created');
}

/**
 * WHY: Master_Dashboard provides KPI overview
 * WHAT: Creates the dashboard for performance metrics
 * HOW: Sets up structure for HiveMind updates
 */
function _createDashboardSheet(ss) {
  let sheet = ss.getSheetByName('Master_Dashboard');
  if (!sheet) {
    sheet = ss.insertSheet('Master_Dashboard', 4);
  }
  sheet.clear();
  
  sheet.getRange('A1:D1').merge()
    .setValue('🏀 MA GOLIDE - HIVE MIND DASHBOARD')
    .setFontWeight('bold')
    .setFontSize(14)
    .setBackground('#674ea7')
    .setFontColor('#ffffff');

  const kpiData = [
    ['', ''],
    ['📊 SYNC STATUS', ''],
    ['Total Leagues:', '0'],
    ['Active Leagues:', '0'],
    ['Last Sync:', 'Never'],
    ['', ''],
    ['📈 BET STATISTICS', ''],
    ['Total Bets Synced:', '0'],
    ['Bankers:', '0'],
    ['Snipers:', '0'],
    ['', ''],
    ['🎰 ACCUMULATOR STATS', ''],
    ['Total Accas Built:', '0'],
    ['Accas Won:', '0'],
    ['Accas Lost:', '0'],
    ['Accas Pending:', '0'],
    ['Win Rate:', 'N/A'],
    ['', ''],
    ['💰 PERFORMANCE', ''],
    ['Best Acca Type:', 'N/A'],
    ['Total ROI:', 'N/A']
  ];

  sheet.getRange(2, 1, kpiData.length, 2).setValues(kpiData);

  [3, 8, 13, 20].forEach(row => {
    sheet.getRange(row, 1, 1, 2).setFontWeight('bold').setBackground('#e8e8e8');
  });

  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 120);

  Logger.log('[Genesis] Master_Dashboard sheet created');
}

/**
 * WHY: Clean up default Sheet1
 * WHAT: Removes the auto-created Sheet1
 * HOW: Tries to delete, ignores if doesn't exist
 */
function _cleanupDefaultSheet(ss) {
  try {
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet) {
      ss.deleteSheet(defaultSheet);
      Logger.log('[Genesis] Removed default Sheet1');
    }
  } catch (e) {
    // Ignore - sheet might not exist or can't be deleted
  }
}

  
/**
 * _createConfigLedgerSheet - Create Config_Ledger sheet with dominant_stamp and stamp_purity
 */
function _createConfigLedgerSheet(ss) {
  let sheet = ss.getSheetByName('Config_Ledger');
  if (!sheet) {
    sheet = ss.insertSheet('Config_Ledger');
  }
  sheet.clear();

  const headers = [['config_key', 'config_value', 'description', 'last_updated', 'dominant_stamp', 'stamp_purity']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(headers[0], 'A1:F1');
  
  sheet.getRange('A1:F1').setValues(headers)
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');

  // Add default config rows
  sheet.getRange('A2:F2').setValues([[
    'system_initialized',
    'true',
    'System initialization timestamp',
    new Date().toISOString(),
    new Date().toISOString(),
    '1.0'
  ]]);

  sheet.autoResizeColumns(1, 6);
  Logger.log('[Genesis] Config_Ledger sheet created');
}

/**
 * _createVaultSheets - Create Vault and MA_Vault sheets
 */
function _createVaultSheets(ss) {
  // Create Vault sheet
  let vaultSheet = ss.getSheetByName('Vault');
  if (!vaultSheet) {
    vaultSheet = ss.insertSheet('Vault');
  }
  vaultSheet.clear();

  const vaultHeaders = [['vault_id', 'league', 'team', 'opponent', 'bet_type', 'confidence', 'grade', 'purity', 'timestamp']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(vaultHeaders[0], 'A1:I1');
  
  vaultSheet.getRange('A1:I1').setValues(vaultHeaders)
    .setFontWeight('bold')
    .setBackground('#6a1b9a')
    .setFontColor('#ffffff');

  // Create MA_Vault sheet
  let maVaultSheet = ss.getSheetByName('MA_Vault');
  if (!maVaultSheet) {
    maVaultSheet = ss.insertSheet('MA_Vault');
  }
  maVaultSheet.clear();

  const maVaultHeaders = [['vault_id', 'league', 'team', 'opponent', 'bet_type', 'confidence', 'grade', 'purity', 'timestamp', 'dominant_stamp']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(maVaultHeaders[0], 'A1:J1');
  
  maVaultSheet.getRange('A1:J1').setValues(maVaultHeaders)
    .setFontWeight('bold')
    .setBackground('#6a1b9a')
    .setFontColor('#ffffff');

  Logger.log('[Genesis] Vault sheets created');
}

/**
 * _createAnalysisSheets - Create Analysis_Tier1 and other analysis sheets
 */
function _createAnalysisSheets(ss) {
  // Create Analysis_Tier1
  let analysisSheet = ss.getSheetByName('Analysis_Tier1');
  if (!analysisSheet) {
    analysisSheet = ss.insertSheet('Analysis_Tier1');
  }
  analysisSheet.clear();

  const analysisHeaders = [['analysis_id', 'league', 'team', 'opponent', 'bet_type', 'confidence', 'grade', 'purity', 'timestamp']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(analysisHeaders[0], 'A1:I1');
  
  analysisSheet.getRange('A1:I1').setValues(analysisHeaders)
    .setFontWeight('bold')
    .setBackground('#ff9900')
    .setFontColor('#ffffff');

  // Create MA_Discovery
  let discoverySheet = ss.getSheetByName('MA_Discovery');
  if (!discoverySheet) {
    discoverySheet = ss.insertSheet('MA_Discovery');
  }
  discoverySheet.clear();

  const discoveryHeaders = [['discovery_id', 'league', 'team', 'opponent', 'edge_type', 'edge_value', 'confidence', 'timestamp']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(discoveryHeaders[0], 'A1:H1');
  
  discoverySheet.getRange('A1:H1').setValues(discoveryHeaders)
    .setFontWeight('bold')
    .setBackground('#ff9900')
    .setFontColor('#ffffff');

  Logger.log('[Genesis] Analysis sheets created');
}

/**
 * _createPerformanceSheets - Create performance tracking sheets
 */
function _createPerformanceSheets(ss) {
  // Create League_Performance
  let leaguePerfSheet = ss.getSheetByName('League_Performance');
  if (!leaguePerfSheet) {
    leaguePerfSheet = ss.insertSheet('League_Performance');
  }
  leaguePerfSheet.clear();

  const leaguePerfHeaders = [['league', 'total_bets', 'wins', 'losses', 'win_rate', 'avg_odds', 'last_updated']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(leaguePerfHeaders[0], 'A1:G1');
  
  leaguePerfSheet.getRange('A1:G1').setValues(leaguePerfHeaders)
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');

  // Create Bet_Performance
  let betPerfSheet = ss.getSheetByName('Bet_Performance');
  if (!betPerfSheet) {
    betPerfSheet = ss.insertSheet('Bet_Performance');
  }
  betPerfSheet.clear();

  const betPerfHeaders = [['bet_id', 'league', 'team', 'opponent', 'bet_type', 'result', 'payout', 'timestamp']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(betPerfHeaders[0], 'A1:H1');
  
  betPerfSheet.getRange('A1:H1').setValues(betPerfHeaders)
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');

  Logger.log('[Genesis] Performance sheets created');
}

/**
 * _createRiskySheets - Create risky accumulator analysis sheets
 */
function _createRiskySheets(ss) {
  // Create Risky_Bets_Analysis
  let riskySheet = ss.getSheetByName('Risky_Bets_Analysis');
  if (!riskySheet) {
    riskySheet = ss.insertSheet('Risky_Bets_Analysis');
  }
  riskySheet.clear();

  const riskyHeaders = [['bet_id', 'league', 'team', 'opponent', 'risk_level', 'confidence', 'recommendation', 'timestamp']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(riskyHeaders[0], 'A1:H1');
  
  riskySheet.getRange('A1:H1').setValues(riskyHeaders)
    .setFontWeight('bold')
    .setBackground('#ff6b6b')
    .setFontColor('#ffffff');

  // Create Risky_Accas
  let riskyAccaSheet = ss.getSheetByName('Risky_Accas');
  if (!riskyAccaSheet) {
    riskyAccaSheet = ss.insertSheet('Risky_Accas');
  }
  riskyAccaSheet.clear();

  const riskyAccaHeaders = [['acca_id', 'total_bets', 'risk_score', 'expected_value', 'recommendation', 'timestamp']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(riskyAccaHeaders[0], 'A1:F1');
  
  riskyAccaSheet.getRange('A1:F1').setValues(riskyAccaHeaders)
    .setFontWeight('bold')
    .setBackground('#ff6b6b')
    .setFontColor('#ffffff');

  Logger.log('[Genesis] Risky analysis sheets created');
}

/**
 * _createHistoricalSheets - Create historical tracking sheets
 */
function _createHistoricalSheets(ss) {
  // Create Historical_Results_Archive
  let histResultsSheet = ss.getSheetByName('Historical_Results_Archive');
  if (!histResultsSheet) {
    histResultsSheet = ss.insertSheet('Historical_Results_Archive');
  }
  histResultsSheet.clear();

  const histResultsHeaders = [['result_id', 'event_date', 'league', 'team', 'opponent', 'result', 'payout', 'timestamp']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(histResultsHeaders[0], 'A1:H1');
  
  histResultsSheet.getRange('A1:H1').setValues(histResultsHeaders)
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');

  // Create Historical_Performance_Log
  let histPerfSheet = ss.getSheetByName('Historical_Performance_Log');
  if (!histPerfSheet) {
    histPerfSheet = ss.insertSheet('Historical_Performance_Log');
  }
  histPerfSheet.clear();

  const histPerfHeaders = [['log_id', 'timestamp', 'metric', 'value', 'description']];
  
  // Sanity check to prevent column mismatch
  _validateHeadersAndRange(histPerfHeaders[0], 'A1:E1');
  
  histPerfSheet.getRange('A1:E1').setValues(histPerfHeaders)
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');

  Logger.log('[Genesis] Historical sheets created');
}



