-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: mirror_schema
-- Run ONCE in Supabase SQL editor (or via: supabase db push)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Unique constraint on (sheet_id, tab_name) — required for upserts.
--    Without this, each mirror run would INSERT duplicates instead of updating.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_snapshot_sheet_tab'
      AND conrelid = 'public.satellite_tab_snapshots'::regclass
  ) THEN
    ALTER TABLE public.satellite_tab_snapshots
      ADD CONSTRAINT uq_snapshot_sheet_tab
      UNIQUE (sheet_id, tab_name);
    RAISE NOTICE 'Added unique constraint uq_snapshot_sheet_tab';
  ELSE
    RAISE NOTICE 'Constraint uq_snapshot_sheet_tab already exists — skipping';
  END IF;
END
$$;

-- 2. last_mirrored_at — tracks when the central mirror last touched this tab.
ALTER TABLE public.satellite_tab_snapshots
  ADD COLUMN IF NOT EXISTS last_mirrored_at timestamptz DEFAULT now();

-- 3. error_message on sync events — allows recording per-sheet errors.
ALTER TABLE public.satellite_sync_events
  ADD COLUMN IF NOT EXISTS error_message text;

-- 4. bridge_version — differentiates rows written by the bridge ("bridge-v1")
--    vs. the central mirror ("mirror-v1").
ALTER TABLE public.satellite_tab_snapshots
  ADD COLUMN IF NOT EXISTS bridge_version text;

-- 5. Index for fast lookups by sheet_id
CREATE INDEX IF NOT EXISTS idx_snapshots_sheet_id
  ON public.satellite_tab_snapshots (sheet_id);

-- 6. Index for last_mirrored_at — find stale satellites
CREATE INDEX IF NOT EXISTS idx_snapshots_last_mirrored
  ON public.satellite_tab_snapshots (last_mirrored_at DESC);

-- 7. Index on satellite_sync_events
CREATE INDEX IF NOT EXISTS idx_sync_events_sheet_created
  ON public.satellite_sync_events (sheet_id, created_at DESC);
