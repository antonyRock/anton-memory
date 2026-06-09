-- Repair / finish multi-user migration (safe to re-run)
-- Fixes legacy placeholder user from users_migration.sql (00000000-...0001)
--
-- Anton: f224756a-d4ae-4f09-a315-9991c03ebe84
-- Mama:  8c246548-94a6-4cab-a5d9-718a64f8f887

-- ---------------------------------------------------------------------------
-- 1. Drop FKs that block user_id changes (legacy conversations → public.users)
-- ---------------------------------------------------------------------------

alter table public.conversations drop constraint if exists conversations_user_id_fkey;
alter table public.messages drop constraint if exists messages_user_id_fkey;
alter table public.projects drop constraint if exists projects_user_id_fkey;
alter table public.documents drop constraint if exists documents_user_id_fkey;
alter table public.facts drop constraint if exists facts_user_id_fkey;
alter table public.entities drop constraint if exists entities_user_id_fkey;
alter table public.tasks drop constraint if exists tasks_user_id_fkey;
alter table public.users drop constraint if exists users_id_fkey;

-- ---------------------------------------------------------------------------
-- 2. Ensure columns exist
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  id uuid primary key,
  display_name text not null,
  avatar_url text,
  tagline text not null default 'Ты можешь всё!',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations add column if not exists user_id uuid;
alter table public.messages add column if not exists user_id uuid;
alter table public.projects add column if not exists user_id uuid;
alter table public.documents add column if not exists user_id uuid;
alter table public.facts add column if not exists user_id uuid;
alter table public.entities add column if not exists user_id uuid;
alter table public.tasks add column if not exists user_id uuid;

-- ---------------------------------------------------------------------------
-- 3. Backfill ALL existing data → Anton (no FK checks yet)
-- ---------------------------------------------------------------------------

update public.conversations
set user_id = 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid;

update public.messages m
set user_id = coalesce(c.user_id, 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid)
from public.conversations c
where m.conversation_id = c.id;

update public.messages
set user_id = 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid
where user_id is null;

update public.projects
set user_id = 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid
where user_id is null;

update public.documents
set user_id = 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid
where user_id is null;

update public.facts
set user_id = 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid
where user_id is null;

update public.entities
set user_id = 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid
where user_id is null;

update public.tasks
set user_id = 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid
where user_id is null;

-- ---------------------------------------------------------------------------
-- 4. Remove legacy placeholder profile (not in auth.users)
-- ---------------------------------------------------------------------------

delete from public.users
where id = '00000000-0000-0000-0000-000000000001'::uuid;

-- ---------------------------------------------------------------------------
-- 5. Auth-aligned profiles (Anton + Mama must exist in Supabase Auth)
-- ---------------------------------------------------------------------------

insert into public.users (id, display_name, tagline)
values
  ('f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid, 'Антон', 'Ты можешь всё!'),
  ('8c246548-94a6-4cab-a5d9-718a64f8f887'::uuid, 'Мама', 'Ты можешь всё!')
on conflict (id) do update
set
  display_name = excluded.display_name,
  tagline = excluded.tagline,
  updated_at = now();

alter table public.users
  add constraint users_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 6. NOT NULL + FK → auth.users (not public.users)
-- ---------------------------------------------------------------------------

alter table public.conversations alter column user_id set not null;
alter table public.messages alter column user_id set not null;
alter table public.projects alter column user_id set not null;
alter table public.documents alter column user_id set not null;
alter table public.facts alter column user_id set not null;
alter table public.entities alter column user_id set not null;
alter table public.tasks alter column user_id set not null;

alter table public.conversations
  add constraint conversations_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.messages
  add constraint messages_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.projects
  add constraint projects_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.documents
  add constraint documents_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.facts
  add constraint facts_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.entities
  add constraint entities_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

alter table public.tasks
  add constraint tasks_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 7. Triggers + stats
-- ---------------------------------------------------------------------------

create or replace function public.set_user_id_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  if new.user_id is null then
    raise exception 'user_id is required';
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_set_user_id on public.conversations;
create trigger conversations_set_user_id
before insert on public.conversations for each row execute function public.set_user_id_from_auth();

drop trigger if exists messages_set_user_id on public.messages;
create trigger messages_set_user_id
before insert on public.messages for each row execute function public.set_user_id_from_auth();

drop trigger if exists projects_set_user_id on public.projects;
create trigger projects_set_user_id
before insert on public.projects for each row execute function public.set_user_id_from_auth();

drop trigger if exists documents_set_user_id on public.documents;
create trigger documents_set_user_id
before insert on public.documents for each row execute function public.set_user_id_from_auth();

drop trigger if exists facts_set_user_id on public.facts;
create trigger facts_set_user_id
before insert on public.facts for each row execute function public.set_user_id_from_auth();

drop trigger if exists entities_set_user_id on public.entities;
create trigger entities_set_user_id
before insert on public.entities for each row execute function public.set_user_id_from_auth();

drop trigger if exists tasks_set_user_id on public.tasks;
create trigger tasks_set_user_id
before insert on public.tasks for each row execute function public.set_user_id_from_auth();

create or replace function public.get_user_stats(p_user_id uuid)
returns table (chats bigint, words bigint, days bigint)
language plpgsql stable as $$
begin
  return query
  select
    (select count(*)::bigint from public.conversations c where c.user_id = p_user_id),
    coalesce((
      select sum(case when coalesce(trim(m.content), '') = '' then 0
        else cardinality(regexp_split_to_array(trim(m.content), '\s+')) end)::bigint
      from public.messages m where m.role = 'user' and m.user_id = p_user_id
    ), 0),
    coalesce((
      select count(distinct (m.created_at at time zone 'utc')::date)::bigint
      from public.messages m where m.role = 'user' and m.user_id = p_user_id
    ), 0);
end;
$$;
