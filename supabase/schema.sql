-- Supabase schema for the Second Brain MVP.
-- Run this in Supabase SQL Editor for project:
-- https://slpnkzvetjhwchcobaig.supabase.co

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.facts (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  source_message_id uuid null references public.messages(id) on delete set null,
  confidence numeric(4, 3) null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'unknown',
  description text null,
  source_message_id uuid null references public.messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'open',
  description text null,
  due_at timestamptz null,
  source_message_id uuid null references public.messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists facts_set_updated_at on public.facts;
create trigger facts_set_updated_at
before update on public.facts
for each row execute function public.set_updated_at();

drop trigger if exists entities_set_updated_at on public.entities;
create trigger entities_set_updated_at
before update on public.entities
for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create index if not exists messages_created_at_idx
  on public.messages (created_at desc);

create index if not exists messages_role_created_at_idx
  on public.messages (role, created_at desc);

create index if not exists facts_created_at_idx
  on public.facts (created_at desc);

create index if not exists facts_content_trgm_idx
  on public.facts using gin (content gin_trgm_ops);

create index if not exists entities_created_at_idx
  on public.entities (created_at desc);

create index if not exists entities_type_idx
  on public.entities (type);

create index if not exists entities_name_trgm_idx
  on public.entities using gin (name gin_trgm_ops);

create index if not exists tasks_created_at_idx
  on public.tasks (created_at desc);

create index if not exists tasks_status_idx
  on public.tasks (status);

create index if not exists tasks_title_trgm_idx
  on public.tasks using gin (title gin_trgm_ops);

alter table public.messages enable row level security;
alter table public.facts enable row level security;
alter table public.entities enable row level security;
alter table public.tasks enable row level security;

-- MVP note:
-- The Next.js API uses SUPABASE_SERVICE_ROLE_KEY on the server.
-- Service role bypasses RLS. Do not expose it to browser code.
-- For multi-user production, add user_id columns plus RLS policies.
