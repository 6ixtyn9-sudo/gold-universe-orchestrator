-- SQL for Phase 2: Orchestration & Scheduling

-- 1. Create the 'bets' table to centralize all satellite data
create table bets (
  id uuid primary key default gen_random_uuid(),
  satellite_id uuid references satellites(id),
  league text,
  match_date date,
  match_time text,
  home_team text,
  away_team text,
  market text, -- MAIN, OU, Q_SPREAD
  quarter text,
  pick text,
  line numeric,
  direction text,
  odds numeric,
  confidence numeric,
  ev numeric,
  
  -- Analytical fields
  magolide_pred text,
  magolide_conf numeric,
  magolide_score numeric,
  forebet_pred numeric,
  forebet_pct numeric,
  
  -- Metadata
  risk_tier text,
  edge_score numeric,
  game_key text,
  source_sheet text,
  source_row integer,
  
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast retrieval
create index idx_bets_game_key on bets(game_key);
create index idx_bets_satellite_id on bets(satellite_id);
create index idx_bets_match_date on bets(match_date);

-- 2. Enable pg_cron (if not already enabled)
create extension if not exists pg_cron;

-- 3. Example Cron Job: Trigger every 6 hours
-- select cron.schedule('fleet-sync', '0 */6 * * *', 'select net.http_post(...)');
-- Note: This requires a Supabase Edge Function to be the target.
