-- 🧠 Supabase Brain: Migration Script
-- Date: 2026-05-07
-- Description: Creates tables for computed outputs and global config ledger.

-- 1. Global Config Ledger
CREATE TABLE IF NOT EXISTS public.config_ledger_global (
    stamp_id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    built_at DATE NOT NULL,
    active_leagues JSONB,
    tier_thresholds JSONB,
    conf_thresholds JSONB,
    settings_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Computed Outputs (Python Engine Results)
CREATE TABLE IF NOT EXISTS public.satellite_computed_outputs (
    satellite_id TEXT PRIMARY KEY,
    computed_at TIMESTAMPTZ NOT NULL,
    stamp_id TEXT REFERENCES public.config_ledger_global(stamp_id),
    bet_slips_json JSONB,
    summary_meta JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Satellite Sync Events (Enhanced)
ALTER TABLE public.satellite_sync_events 
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'SHEET_MIRROR',
ADD COLUMN IF NOT EXISTS logic_engine TEXT DEFAULT 'LEGACY_GS';

-- 4. Registry (if not exists)
CREATE TABLE IF NOT EXISTS public.satellite_registry (
    satellite_id TEXT PRIMARY KEY,
    spreadsheet_id TEXT NOT NULL,
    owner_email TEXT,
    status TEXT DEFAULT 'ACTIVE',
    last_seen TIMESTAMPTZ
);

-- Add comments for documentation
COMMENT ON TABLE public.config_ledger_global IS 'Canonical configuration fingerprints for the entire fleet.';
COMMENT ON TABLE public.satellite_computed_outputs IS 'Centralized storage for Python-generated bet slips and analytics.';
