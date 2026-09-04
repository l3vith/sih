-- NWIS Supabase Schema — run in SQL Editor (https://supabase.com/dashboard/project/_/sql/new)
-- Idempotent: safe to re-run

-- Extensions (pgvector for embeddings, postgis optional for geo queries)
create extension if not exists "pgcrypto";
create extension if not exists "vector" with schema public;
-- create extension if not exists postgis; -- uncomment if plan requires geodesic queries

-- Wells — one row per well_name (natural key, per PLAN.md Well record)
create table if not exists public.wells (
  id uuid primary key default gen_random_uuid(),
  well_name text unique not null,
  latitude double precision,
  longitude double precision,
  current_md double precision,
  current_tvd double precision,
  formation text,
  operator text,
  rig_name text,
  lease_block text,
  progress double precision,
  avg_rop double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wells_location_idx on public.wells (latitude, longitude);

-- Documents — mirrors Analysis { report, corpus, embeddingModel, documentVector, segments, embeddings }
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  name text unique not null, -- original file name, natural key
  well_name text references public.wells(well_name) on delete set null,
  report jsonb not null,
  corpus text,
  embedding_model text,
  -- pgvector column (384 dim for Xenova/all-MiniLM-L6-v2). Falls back to jsonb if vector ext not enabled
  document_vector vector(384),
  document_vector_json jsonb,
  segments jsonb,
  embeddings jsonb,
  pages integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_well_name_idx on public.documents (well_name);
create index if not exists documents_report_gin on public.documents using gin (report);

-- Telemetry samples — windowed eRTMAC feed per well
create table if not exists public.telemetry_samples (
  id uuid primary key default gen_random_uuid(),
  well_id uuid references public.wells(id) on delete cascade,
  time text,
  depth double precision,
  wob double precision, rop double precision, rpm double precision,
  torque double precision, spp double precision,
  flow_in double precision, flow_out double precision,
  mud_weight double precision, gas double precision, hook_load double precision,
  quality text check (quality in ('good','degraded','missing')),
  created_at timestamptz not null default now()
);
create index if not exists telemetry_well_time_idx on public.telemetry_samples (well_id, created_at desc);

-- Alerts — live drilling risk alerts (persistence/hysteresis gated)
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  well_id uuid references public.wells(id) on delete cascade,
  time text,
  depth double precision,
  kind text not null check (kind in ('Mud Loss','Kick','Stuck Pipe','Overpressure','Torque Spike')),
  severity text not null check (severity in ('high','medium','low')),
  message text,
  evidence text,
  acknowledged boolean not null default false,
  suppressed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists alerts_well_created_idx on public.alerts (well_id, created_at desc);
create index if not exists alerts_kind_idx on public.alerts (kind);

-- Optional: document_chunks for vector search (one row per section/embedding)
create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete cascade,
  label text,
  excerpt text,
  embedding vector(384),
  created_at timestamptz not null default now()
);
create index if not exists chunks_doc_idx on public.document_chunks (document_id);

-- Updated-at trigger
create or replace function public.set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;
drop trigger if exists wells_updated_at on public.wells;
create trigger wells_updated_at before update on public.wells for each row execute function public.set_updated_at();
drop trigger if exists documents_updated_at on public.documents;
create trigger documents_updated_at before update on public.documents for each row execute function public.set_updated_at();

-- RLS: enable but allow anon read/write for MVP (lock down before pilot per PLAN.md Step 6)
alter table public.wells enable row level security;
alter table public.documents enable row level security;
alter table public.telemetry_samples enable row level security;
alter table public.alerts enable row level security;
alter table public.document_chunks enable row level security;

drop policy if exists "allow all for anon" on public.wells;
create policy "allow all for anon" on public.wells for all using (true) with check (true);
drop policy if exists "allow all for anon" on public.documents;
create policy "allow all for anon" on public.documents for all using (true) with check (true);
drop policy if exists "allow all for anon" on public.telemetry_samples;
create policy "allow all for anon" on public.telemetry_samples for all using (true) with check (true);
drop policy if exists "allow all for anon" on public.alerts;
create policy "allow all for anon" on public.alerts for all using (true) with check (true);
drop policy if exists "allow all for anon" on public.document_chunks;
create policy "allow all for anon" on public.document_chunks for all using (true) with check (true);

-- Storage bucket for raw PDFs/images (create via dashboard or via sql)
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
on conflict (id) do nothing;
drop policy if exists "allow anon documents storage" on storage.objects;
create policy "allow anon documents storage" on storage.objects for all using (bucket_id = 'documents') with check (bucket_id = 'documents');
