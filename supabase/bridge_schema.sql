create table if not exists satellite_sync_events (
  id uuid primary key default gen_random_uuid(),
  satellite_id uuid references satellites(id),
  sheet_id text not null,
  spreadsheet_name text,
  bridge_version text,
  status text not null default 'received',
  tabs_received jsonb,
  row_counts jsonb,
  error text,
  created_at timestamptz default now()
);

create table if not exists satellite_tab_snapshots (
  id uuid primary key default gen_random_uuid(),
  satellite_id uuid references satellites(id),
  sheet_id text not null,
  tab_name text not null,
  values_json jsonb not null,
  row_count integer,
  col_count integer,
  bridge_version text,
  created_at timestamptz default now()
);

create index if not exists idx_satellite_tab_snapshots_sheet_id
  on satellite_tab_snapshots(sheet_id);

create index if not exists idx_satellite_tab_snapshots_tab_name
  on satellite_tab_snapshots(tab_name);

create index if not exists idx_satellite_sync_events_sheet_id
  on satellite_sync_events(sheet_id);
