-- SIGAP LAUT — DRAF skema PostgreSQL + PostGIS (Fase 0). BELUM diterapkan ke basis data mana pun.
-- Prinsip: UUID, UTC (timestamptz), provenance di setiap data, versi rute tidak bisa diubah setelah diajukan,
-- audit append-only, RLS di semua tabel yang terekspos, data simulasi terpisah dari produksi.
-- Geometri: EPSG:4326 (WGS84). Jarak/penyangga dihitung dengan geography (geodesik, meter).

create extension if not exists postgis;
create extension if not exists pgcrypto;          -- gen_random_uuid()

-- ---------- Enum ----------
create type app_role        as enum ('super_admin','admin','operator','safety_officer','viewer');
create type data_realm      as enum ('production','simulation');           -- dipisahkan di setiap tabel data
create type route_status    as enum ('draft','submitted','approved','rejected','archived');
create type severity_level  as enum ('normal','advisory','warning','critical');
create type alert_state     as enum ('detected','active','acknowledged','resolved');
create type source_status   as enum ('connected','degraded','stale','unavailable','configuration_required');
create type hazard_category as enum ('weather','marine','shallow_water','obstruction','nav_mark','restricted_area','nav_warning','traffic');
create type value_kind      as enum ('observed','forecast','analysis','interpolated','extrapolated','missing','simulated');

-- ---------- Organisasi, pengguna, peran ----------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
create table user_profiles (                          -- 1:1 dengan auth.users (Supabase Auth)
  user_id uuid primary key,                           -- references auth.users(id)
  organization_id uuid not null references organizations(id),
  full_name text not null,
  rank_title text,
  role app_role not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Kapal ----------
create table vessels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  hull_number text,
  loa_m numeric(6,2) check (loa_m > 0), beam_m numeric(5,2) check (beam_m > 0),
  draft_m numeric(5,2) check (draft_m > 0),
  ukc_min_m numeric(4,2) check (ukc_min_m > 0),        -- ketentuan UKC kapal (disetujui)
  cruise_speed_kn numeric(4,1) check (cruise_speed_kn > 0),
  range_nm numeric(7,1),
  realm data_realm not null default 'production',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table vessel_positions (                       -- posisi aktual; tidak pernah dibuat-buat
  id bigint generated always as identity primary key,
  vessel_id uuid not null references vessels(id),
  position geography(Point,4326) not null,
  cog_deg numeric(5,1), sog_kn numeric(5,1),
  observed_at timestamptz not null,                  -- waktu fix GPS (UTC)
  received_at timestamptz not null default now(),
  source text not null,                              -- 'gps:<device>', 'ais:<provider>', 'simulation'
  valid boolean not null default true, quality jsonb not null default '{}',
  realm data_realm not null default 'production'
);
create index on vessel_positions (vessel_id, observed_at desc);
create index on vessel_positions using gist (position);

-- ---------- Rute & versi ----------
create table routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null, departure_name text, destination_name text,
  vessel_id uuid references vessels(id),
  current_version_id uuid,                            -- fk ditambahkan setelah route_versions
  status route_status not null default 'draft',
  created_by uuid not null, created_at timestamptz not null default now(),
  realm data_realm not null default 'production'
);
create table route_versions (                         -- tidak bisa diubah setelah status != draft (trigger)
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references routes(id) on delete cascade,
  version int not null,
  departure_at timestamptz not null,
  default_speed_kn numeric(4,1) not null check (default_speed_kn > 0),
  geom geography(LineString,4326) not null,          -- dibentuk dari waypoint (lon,lat)
  total_nm numeric(8,2) not null,
  calc_method text not null,                         -- mis. 'vincenty-wgs84 v1'
  status route_status not null default 'draft',
  submitted_by uuid, submitted_at timestamptz, reviewed_by uuid, reviewed_at timestamptz, review_note text,
  created_by uuid not null, created_at timestamptz not null default now(),
  unique (route_id, version)
);
alter table routes add constraint routes_current_version_fk foreign key (current_version_id) references route_versions(id);
create index on route_versions using gist (geom);

create table route_waypoints (
  id uuid primary key default gen_random_uuid(),
  route_version_id uuid not null references route_versions(id) on delete cascade,
  seq int not null check (seq >= 1),
  name text,
  position geography(Point,4326) not null,
  lat_input text not null, lon_input text not null,  -- teks asli yang diketik (audit; tidak diubah diam-diam)
  planned_speed_kn numeric(4,1) check (planned_speed_kn > 0),
  eta timestamptz,
  validation jsonb not null default '{}',            -- hasil validasi (rentang, duplikat, presisi)
  unique (route_version_id, seq)
);
create index on route_waypoints using gist (position);

create table route_segments (
  id uuid primary key default gen_random_uuid(),
  route_version_id uuid not null references route_versions(id) on delete cascade,
  seq int not null,
  from_wp uuid not null references route_waypoints(id), to_wp uuid not null references route_waypoints(id),
  geom geography(LineString,4326) not null,
  distance_nm numeric(8,3) not null, initial_bearing_deg numeric(5,1) not null,
  speed_kn numeric(4,1) not null, duration_s int not null,
  enter_at timestamptz not null, exit_at timestamptz not null,
  unique (route_version_id, seq)
);
create index on route_segments using gist (geom);

-- ---------- Sumber data ----------
create table data_sources (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                         -- 'open-meteo-marine', 'bmkg-cap', 'etopo-2022', ...
  provider text not null, dataset text not null,
  license text not null, license_url text,
  coverage geography(Polygon,4326),
  variables text[] not null default '{}',
  horizon_hours int, resolution text,
  status source_status not null default 'configuration_required',
  last_success_at timestamptz, last_failure_at timestamptz, last_error text,
  quota jsonb not null default '{}',
  config jsonb not null default '{}'                 -- tanpa rahasia; rahasia di secret store server
);
create table forecast_runs (                          -- satu baris per model run yang di-ingest
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references data_sources(id),
  model text not null, issued_at timestamptz not null,
  valid_from timestamptz not null, valid_to timestamptz not null,
  storage_uri text not null,                         -- grid (Zarr/COG) di object storage
  ingested_at timestamptz not null default now(),
  checksum text not null,
  unique (source_id, model, issued_at)               -- ingestion idempoten
);

-- ---------- Hazard ----------
create table hazard_zones (                           -- area/objek: ENC, navarea, zona terlarang, peringatan BMKG
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references data_sources(id),
  external_id text,
  category hazard_category not null,
  title text not null, description text,
  geom geography(Geometry,4326) not null,
  valid_from timestamptz, valid_to timestamptz,
  observed_at timestamptz, issued_at timestamptz,
  attributes jsonb not null default '{}',            -- atribut asli sumber (mis. S-57 DEPARE, VALSOU, QUASOU)
  realm data_realm not null default 'production',
  unique (source_id, external_id)
);
create index on hazard_zones using gist (geom);
create index on hazard_zones (category, valid_to);

create table hazard_observations (                    -- laporan perwira / observasi lapangan
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  category hazard_category not null,
  position geography(Point,4326) not null,
  observed_at timestamptz not null, reported_by uuid not null,
  details jsonb not null default '{}',
  realm data_realm not null default 'production'
);
create index on hazard_observations using gist (position);

-- ---------- Aturan peringatan (harus disetujui) ----------
create table rule_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null, version int not null,
  rules jsonb not null,                              -- ambang per kategori/kapal, margin, cadangan surut, koridor
  approved_by uuid, approved_at timestamptz,         -- analisis produksi hanya memakai rule set yang disetujui
  created_by uuid not null, created_at timestamptz not null default now(),
  unique (organization_id, name, version)
);

-- ---------- Analisis ----------
create table route_analyses (
  id uuid primary key default gen_random_uuid(),
  route_version_id uuid not null references route_versions(id),
  rule_set_id uuid not null references rule_sets(id),
  requested_by uuid not null, started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'running',            -- running | done | failed
  corridor_nm numeric[] not null default '{1,5,10}',
  inputs jsonb not null default '{}',                -- forecast_runs yang dipakai, versi kode, parameter
  overall severity_level,
  realm data_realm not null default 'production'
);
create table route_analysis_results (                 -- satu baris per temuan/titik sampel bermasalah
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references route_analyses(id) on delete cascade,
  segment_id uuid references route_segments(id),
  category hazard_category not null, severity severity_level not null,
  position geography(Point,4326),
  distance_to_route_nm numeric(7,2),
  encounter_at timestamptz,
  value numeric, threshold numeric, unit text,
  value_kind value_kind not null,
  source_id uuid references data_sources(id), forecast_run_id uuid references forecast_runs(id),
  hazard_zone_id uuid references hazard_zones(id),
  provenance jsonb not null default '{}'             -- nilai per model, selisih antarmodel, sel grid
);
create index on route_analysis_results (analysis_id, severity);

-- ---------- Peringatan ----------
create table alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  analysis_id uuid references route_analyses(id),
  route_version_id uuid references route_versions(id),
  category hazard_category not null, severity severity_level not null,
  title text not null, description text not null,
  position geography(Point,4326), segment_id uuid references route_segments(id),
  distance_to_route_nm numeric(7,2), encounter_at timestamptz,
  source_id uuid references data_sources(id),
  observed_at timestamptz, issued_at timestamptz, valid_from timestamptz, valid_to timestamptz,
  detected_at timestamptz not null default now(),
  data_quality jsonb not null default '{}',
  review_action text not null,
  state alert_state not null default 'detected',
  dedupe_key text not null,                          -- cegah duplikat untuk hazard+segmen+jendela waktu yang sama
  realm data_realm not null default 'production',
  unique (organization_id, dedupe_key)
);
create index on alerts (organization_id, state, severity);
create index on alerts using gist (position);

create table alert_events (                           -- append-only; tidak ada update/delete
  id bigint generated always as identity primary key,
  alert_id uuid not null references alerts(id),
  from_state alert_state, to_state alert_state not null,
  actor uuid,                                        -- null = sistem
  note text,
  at timestamptz not null default now()
);

-- ---------- Pengaturan & audit ----------
create table system_settings (
  key text primary key, value jsonb not null,
  updated_by uuid, updated_at timestamptz not null default now()
);
create table audit_logs (                             -- append-only
  id bigint generated always as identity primary key,
  actor uuid, action text not null, entity text not null, entity_id text,
  before jsonb, after jsonb, ip inet, at timestamptz not null default now()
);
revoke update, delete on alert_events, audit_logs from public;

-- ---------- RLS (sketsa) ----------
alter table vessels enable row level security;
alter table vessel_positions enable row level security;
alter table routes enable row level security;
alter table route_versions enable row level security;
alter table route_waypoints enable row level security;
alter table route_segments enable row level security;
alter table route_analyses enable row level security;
alter table route_analysis_results enable row level security;
alter table alerts enable row level security;
alter table alert_events enable row level security;
alter table hazard_observations enable row level security;
alter table rule_sets enable row level security;
alter table user_profiles enable row level security;
alter table audit_logs enable row level security;

-- Fungsi bantu (security definer, search_path terkunci) membaca peran & organisasi pengguna aktif.
create function app_role_of(uid uuid) returns app_role language sql stable security definer set search_path = public as
$$ select role from user_profiles where user_id = uid and active $$;
create function app_org_of(uid uuid) returns uuid language sql stable security definer set search_path = public as
$$ select organization_id from user_profiles where user_id = uid and active $$;

-- Contoh kebijakan: baca rute hanya dalam organisasi sendiri; tulis draft oleh operator ke atas.
create policy routes_read on routes for select using (organization_id = app_org_of(auth.uid()));
create policy routes_write on routes for insert with check (
  organization_id = app_org_of(auth.uid()) and app_role_of(auth.uid()) in ('operator','admin','super_admin'));
-- Status peringatan hanya diubah lewat fungsi server (acknowledge_alert / resolve_alert) yang menulis alert_events.
create policy alerts_read on alerts for select using (organization_id = app_org_of(auth.uid()));
-- audit_logs: hanya admin membaca; tidak ada kebijakan insert untuk klien (ditulis oleh server/trigger).
create policy audit_read on audit_logs for select using (app_role_of(auth.uid()) in ('admin','super_admin'));
