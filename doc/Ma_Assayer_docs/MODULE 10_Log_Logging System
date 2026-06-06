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
