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
