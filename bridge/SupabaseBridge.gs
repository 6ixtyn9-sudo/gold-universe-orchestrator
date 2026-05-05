/**
 * SupabaseBridge.gs
 * Thin bridge between Google Sheets UX and Supabase backend.
 * No service-role secrets should live here.
 */

const GOLD_BRIDGE_VERSION = '2026-05-05.1';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Ma Golide')
    .addItem('Sync This Satellite → Supabase', 'syncSatelliteToSupabase')
    .addItem('Refresh Status ← Supabase', 'refreshSatelliteStatusFromSupabase')
    .addItem('Show Bridge Config', 'showBridgeConfig')
    .addToUi();
}

function showBridgeConfig() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_SYNC_URL') || '';
  const tokenSet = !!props.getProperty('SUPABASE_BRIDGE_TOKEN');

  SpreadsheetApp.getUi().alert(
    'Ma Golide Supabase Bridge\n\n' +
    'Version: ' + GOLD_BRIDGE_VERSION + '\n' +
    'Spreadsheet ID: ' + SpreadsheetApp.getActive().getId() + '\n' +
    'Sync URL set: ' + (url ? 'YES' : 'NO') + '\n' +
    'Bridge token set: ' + (tokenSet ? 'YES' : 'NO')
  );
}

function syncSatelliteToSupabase() {
  const ss = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();

  const syncUrl = props.getProperty('SUPABASE_SYNC_URL');
  const bridgeToken = props.getProperty('SUPABASE_BRIDGE_TOKEN');

  if (!syncUrl) {
    SpreadsheetApp.getUi().alert('Missing SUPABASE_SYNC_URL in Script Properties.');
    return;
  }

  const payload = {
    bridge_version: GOLD_BRIDGE_VERSION,
    spreadsheet_id: ss.getId(),
    spreadsheet_name: ss.getName(),
    synced_at: new Date().toISOString(),
    tabs: {
      UpcomingClean: readTabValues_('UpcomingClean'),
      Upcoming_Clean: readTabValues_('Upcoming_Clean'),
      ResultsClean: readTabValues_('ResultsClean'),
      Results_Clean: readTabValues_('Results_Clean'),
      Bet_Slips: readTabValues_('Bet_Slips'),
      BetSlips: readTabValues_('BetSlips'),
      Config_Tier2: readTabValues_('Config_Tier2'),
      LeagueQuarterO_U_Stats: readTabValues_('LeagueQuarterO_U_Stats')
    }
  };

  const headers = {
    'Content-Type': 'application/json'
  };

  if (bridgeToken) {
    headers['Authorization'] = 'Bearer ' + bridgeToken;
  }

  const res = UrlFetchApp.fetch(syncUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();

  SpreadsheetApp.getUi().alert(
    'Supabase Sync Complete\n\n' +
    'HTTP: ' + code + '\n\n' +
    body.slice(0, 1500)
  );
}

function refreshSatelliteStatusFromSupabase() {
  SpreadsheetApp.getUi().alert(
    'Refresh-from-Supabase will be added after sync ingestion is live.'
  );
}

function readTabValues_(tabName) {
  const sh = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sh) return null;

  const range = sh.getDataRange();
  const values = range.getValues();

  // Avoid sending totally empty tabs.
  if (!values || values.length === 0) return [];

  return values;
}
