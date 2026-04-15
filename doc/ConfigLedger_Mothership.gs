/******************************************************************************
 * CONFIG LEDGER — Mothership Module
 * Repo: Ma_Golide_Mothership
 *
 * Paste into the Mothership Apps Script project. Call
 * ConfigLedger_Mothership.init(assayerSpreadsheetId) when loading Assayer data.
 ******************************************************************************/

var ConfigLedger_Mothership = {

  _ledgerRows: null,
  _assayerId: null,
  _log: null,

  init: function (assayerSpreadsheetId) {
    this._assayerId = assayerSpreadsheetId || null;
    this._ledgerRows = null;
    this._log = (typeof Log_ !== "undefined") ? Log_.module("CFG_MOTHERSHIP") : {
      info: function (m) { console.log(m); },
      warn: function (m) { console.warn(m); },
      error: function (m) { console.error(m); }
    };
    this._loadLedger();
    this._log.info("ConfigLedger_Mothership ready.");
  },

  filterByStamp: function (rows, options) {
    if (!Array.isArray(rows)) {
      return [];
    }
    var opts = {
      allowedVersions: [],
      minStampPurity: 70,
      includeUnstamped: false
    };
    if (options) {
      if (options.allowedVersions) opts.allowedVersions = options.allowedVersions;
      if (options.minStampPurity != null) opts.minStampPurity = options.minStampPurity;
      if (options.includeUnstamped != null) opts.includeUnstamped = options.includeUnstamped;
    }
    var self = this;
    return rows.filter(function (row) {
      var stamp = self._resolveField(row, ["dominant_stamp", "stamp_id", "stampId"]);
      var purity = self._resolvePct(row, ["stamp_purity", "stampPurity"]);
      var version = self._resolveField(row, ["dominant_version", "version"]) ||
        self._versionForStamp(stamp);
      if (!stamp) {
        return opts.includeUnstamped;
      }
      if (purity !== null && purity < opts.minStampPurity) {
        return false;
      }
      if (opts.allowedVersions.length > 0 &&
        opts.allowedVersions.indexOf(version) === -1) {
        return false;
      }
      return true;
    });
  },

  segmentByStamp: function (rows) {
    if (!Array.isArray(rows)) {
      return {};
    }
    var segments = {};
    var self = this;
    var idx;
    for (idx = 0; idx < rows.length; idx++) {
      var row = rows[idx];
      var stamp = self._resolveField(row, ["dominant_stamp", "stamp_id"]) || "__UNSTAMPED__";
      if (!segments[stamp]) {
        var meta = self._metaForStamp(stamp);
        segments[stamp] = {
          stampId: stamp,
          version: meta ? meta.version : (stamp === "__UNSTAMPED__" ? null : "unknown"),
          builtAt: meta ? meta.built_at : null,
          count: 0,
          goldCount: 0,
          winRateSum: 0,
          rows: []
        };
      }
      var seg = segments[stamp];
      seg.count++;
      seg.rows.push(row);
      var grade = self._resolveField(row, ["grade"]);
      if (grade === "GOLD" || grade === "PLATINUM") {
        seg.goldCount++;
      }
      var wr = self._resolveFloat(row, ["win_rate", "winRate", "shrunkRate"]);
      if (wr !== null) {
        seg.winRateSum += wr;
      }
    }
    var k;
    for (k in segments) {
      if (Object.prototype.hasOwnProperty.call(segments, k)) {
        var s = segments[k];
        s.goldPct = s.count > 0 ? (s.goldCount / s.count) : 0;
        s.avgWinRate = s.count > 0 ? (s.winRateSum / s.count) : 0;
        delete s.winRateSum;
      }
    }
    return segments;
  },

  getDriftReport: function (rows) {
    if (!Array.isArray(rows)) {
      return [];
    }
    var byKey = {};
    var self = this;
    var i2;
    for (i2 = 0; i2 < rows.length; i2++) {
      var row2 = rows[i2];
      var key = [
        self._resolveField(row2, ["league"]) || "?",
        self._resolveField(row2, ["source"]) || "?",
        self._resolveField(row2, ["gender"]) || "?",
        self._resolveField(row2, ["tier"]) || "?"
      ].join("|");
      var stamp2 = self._resolveField(row2, ["dominant_stamp"]);
      var wr2 = self._resolveFloat(row2, ["win_rate", "shrunkRate"]);
      var q2 = self._resolveField(row2, ["quarter"]) || "All";
      if (q2 !== "All" && q2 !== "all" && q2 !== "") {
        continue;
      }
      if (!byKey[key]) {
        byKey[key] = {};
      }
      if (stamp2) {
        if (!byKey[key][stamp2]) {
          byKey[key][stamp2] = [];
        }
        if (wr2 !== null) {
          byKey[key][stamp2].push(wr2);
        }
      }
    }
    var warnings = [];
    var key3;
    for (key3 in byKey) {
      if (!Object.prototype.hasOwnProperty.call(byKey, key3)) {
        continue;
      }
      var stampMap = byKey[key3];
      var stamps = Object.keys(stampMap);
      if (stamps.length < 2) {
        continue;
      }
      var avgRates = stamps.map(function (sid) {
        var rates = stampMap[sid];
        return rates.length > 0
          ? rates.reduce(function (a, b) { return a + b; }, 0) / rates.length
          : null;
      }).filter(function (v) { return v !== null; });
      var maxDelta = avgRates.length > 1
        ? Math.max.apply(null, avgRates) - Math.min.apply(null, avgRates)
        : 0;
      var severity = maxDelta >= 0.10 ? "HIGH"
        : maxDelta >= 0.05 ? "MEDIUM"
          : "LOW";
      warnings.push({
        key: key3,
        stamps: stamps,
        stampCount: stamps.length,
        maxWinRateDelta: maxDelta,
        severity: severity,
        warning: key3 + ": " + stamps.length + " config versions, max Δ = " +
          (maxDelta * 100).toFixed(1) + "% win rate"
      });
    }
    warnings.sort(function (a, b) {
      return b.maxWinRateDelta - a.maxWinRateDelta;
    });
    return warnings;
  },

  isSafeToAcca: function (purityRow, options) {
    var opts = {
      allowedVersions: [],
      minPurity: 80,
      minN: 30
    };
    if (options) {
      if (options.allowedVersions) opts.allowedVersions = options.allowedVersions;
      if (options.minPurity != null) opts.minPurity = options.minPurity;
      if (options.minN != null) opts.minN = options.minN;
    }
    var stamp = this._resolveField(purityRow, ["dominant_stamp"]);
    var purity = this._resolvePct(purityRow, ["stamp_purity"]);
    var version = this._versionForStamp(stamp);
    var n = this._resolveFloat(purityRow, ["n"]) || 0;
    if (!stamp) {
      return { safe: false, reason: "No config stamp — prediction provenance unknown", stamp: null };
    }
    if (purity !== null && purity < opts.minPurity) {
      return {
        safe: false,
        reason: "Stamp purity " + purity.toFixed(0) + "% < required " + opts.minPurity + "% — mixed config data",
        stamp: stamp
      };
    }
    if (opts.allowedVersions.length > 0 && opts.allowedVersions.indexOf(version) === -1) {
      return {
        safe: false,
        reason: "Config version \"" + version + "\" not in allowed list",
        stamp: stamp
      };
    }
    if (n < opts.minN) {
      return {
        safe: false,
        reason: "Insufficient sample N=" + n + " (need " + opts.minN + ") for this config slice",
        stamp: stamp
      };
    }
    return { safe: true, reason: "OK", stamp: stamp, version: version };
  },

  writeConfigLedgerSummary: function (sheet, allPurityRows, startRow) {
    if (!sheet) {
      return;
    }
    var segments = this.segmentByStamp(allPurityRows || []);
    var driftWarns = this.getDriftReport(allPurityRows || []);
    var row = startRow || (sheet.getLastRow() + 2);
    var data = [];
    data.push(["═══════════════════════════════════════════════"]);
    data.push(["CONFIG LEDGER SUMMARY"]);
    data.push([""]);
    data.push(["Stamp ID", "Version", "Built At", "Rows", "Gold%", "Avg Win Rate"]);
    var segList = Object.keys(segments);
    var si;
    for (si = 0; si < segList.length; si++) {
      var seg2 = segments[segList[si]];
      data.push([
        seg2.stampId || "—",
        seg2.version || "unknown",
        seg2.builtAt || "—",
        seg2.count,
        (seg2.goldPct * 100).toFixed(1) + "%",
        (seg2.avgWinRate * 100).toFixed(1) + "%"
      ]);
    }
    data.push([""]);
    if (driftWarns.length > 0) {
      data.push(["⚠ CONFIG DRIFT DETECTED"]);
      data.push(["Key", "Severity", "Configs", "Max WR Δ", "Warning"]);
      var wi;
      for (wi = 0; wi < Math.min(10, driftWarns.length); wi++) {
        var w = driftWarns[wi];
        data.push([w.key, w.severity, w.stampCount, (w.maxWinRateDelta * 100).toFixed(1) + "%", w.warning]);
      }
    } else {
      data.push(["✓ No config drift detected"]);
    }
    var padded = data.map(function (r) {
      var copy = r.slice();
      while (copy.length < 6) {
        copy.push("");
      }
      return copy.slice(0, 6);
    });
    sheet.getRange(row, 1, padded.length, 6).setValues(padded);
    sheet.getRange(row, 1).setFontSize(12).setFontWeight("bold");
  },

  _loadLedger: function () {
    this._ledgerRows = [];
    try {
      var ss = this._assayerId
        ? SpreadsheetApp.openById(this._assayerId)
        : SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName("Config_Ledger");
      if (!sheet) {
        this._log.warn("Config_Ledger not found in Assayer sheet — drift detection disabled");
        return;
      }
      var data = sheet.getDataRange().getValues();
      var headers = data[0].map(function (h) {
        return String(h).trim().toLowerCase().replace(/\s+/g, "_");
      });
      var ri;
      for (ri = 1; ri < data.length; ri++) {
        var obj = {};
        var hi;
        for (hi = 0; hi < headers.length; hi++) {
          obj[headers[hi]] = data[ri][hi];
        }
        this._ledgerRows.push(obj);
      }
      this._log.info("Config_Ledger loaded: " + this._ledgerRows.length + " entries");
    } catch (err) {
      this._log.warn("Config_Ledger load error: " + err.message);
    }
  },

  _metaForStamp: function (stampId) {
    if (!stampId || !Array.isArray(this._ledgerRows)) {
      return null;
    }
    var li;
    for (li = 0; li < this._ledgerRows.length; li++) {
      if (this._ledgerRows[li].stamp_id === stampId) {
        return this._ledgerRows[li];
      }
    }
    return null;
  },

  _versionForStamp: function (stampId) {
    var meta = this._metaForStamp(stampId);
    return meta ? (meta.version || null) : null;
  },

  _resolveField: function (obj, keys) {
    var ki;
    for (ki = 0; ki < keys.length; ki++) {
      var k = keys[ki];
      if (obj && obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
        return obj[k];
      }
    }
    return null;
  },

  _resolvePct: function (obj, keys) {
    var raw = this._resolveField(obj, keys);
    if (raw === null) {
      return null;
    }
    var s = String(raw).replace("%", "").trim();
    var n = parseFloat(s);
    return isNaN(n) ? null : (n > 1 ? n : n * 100);
  },

  _resolveFloat: function (obj, keys) {
    var raw = this._resolveField(obj, keys);
    if (raw === null) {
      return null;
    }
    var n = parseFloat(String(raw).replace("%", ""));
    return isNaN(n) ? null : n;
  }
};
