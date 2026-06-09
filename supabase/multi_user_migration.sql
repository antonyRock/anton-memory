-- Multi-user migration: user_id + RLS + backfill to Anton
-- Run once in Supabase → SQL Editor → Run (after review).

-- Auth user IDs
-- Anton: f224756a-d4ae-4f09-a315-9991c03ebe84
-- Mama:  8c246548-94a6-4cab-a5d9-718a64f8f887

-- ---------------------------------------------------------------------------
-- 1. Profiles (public.users) synced with auth.users
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

alter table public.users drop constraint if exists users_id_fkey;
alter table public.users
  add constraint users_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

insert into public.users (id, display_name, tagline)
values
  ('f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid, 'Антон', 'Ты можешь всё!'),
  ('8c246548-94a6-4cab-a5d9-718a64f8f887'::uuid, 'Мама', 'Ты можешь всё!')
on conflict (id) do update
set
  display_name = excluded.display_name,
  tagline = excluded.tagline,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Add user_id columns (nullable during backfill)
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists user_id uuid;

alter table public.messages
  add column if not exists user_id uuid;

alter table public.projects
  add column if not exists user_id uuid;

alter table public.documents
  add column if not exists user_id uuid;

alter table public.facts
  add column if not exists user_id uuid;

alter table public.entities
  add column if not exists user_id uuid;

alter table public.tasks
  add column if not exists user_id uuid;

-- ---------------------------------------------------------------------------
-- 3. Backfill existing data → Anton
-- ---------------------------------------------------------------------------

update public.conversations
set user_id = 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid
where user_id is null
   or user_id = '00000000-0000-0000-0000-000000000001'::uuid;

update public.messages m
set user_id = coalesce(c.user_id, 'f224756a-d4ae-4f09-a315-9991c03ebe84'::uuid)
from public.conversations c
where m.conversation_id = c.id
  and m.user_id is null;

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
-- 4. NOT NULL + foreign keys
-- ---------------------------------------------------------------------------

alter table public.conversations drop constraint if exists conversations_user_id_fkey;

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
-- 5. Indexes
-- ---------------------------------------------------------------------------

create index if not exists conversations_user_id_idx
  on public.conversations (user_id, updated_at desc);

create index if not exists messages_user_id_idx
  on public.messages (user_id, conversation_id, created_at);

create index if not exists messages_user_created_at_idx
  on public.messages (user_id, created_at desc);

create index if not exists projects_user_id_idx
  on public.projects (user_id, updated_at desc);

create index if not exists documents_user_id_idx
  on public.documents (user_id, created_at desc);

create index if not exists facts_user_id_idx
  on public.facts (user_id, created_at desc);

create index if not exists entities_user_id_idx
  on public.entities (user_id, created_at desc);

create index if not exists tasks_user_id_idx
  on public.tasks (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Auto user_id on INSERT (auth.uid())
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
before insert on public.conversations
for each row execute function public.set_user_id_from_auth();

drop trigger if exists messages_set_user_id on public.messages;
create trigger messages_set_user_id
before insert on public.messages
for each row execute function public.set_user_id_from_auth();

drop trigger if exists projects_set_user_id on public.projects;
create trigger projects_set_user_id
before insert on public.projects
for each row execute function public.set_user_id_from_auth();

drop trigger if exists documents_set_user_id on public.documents;
create trigger documents_set_user_id
before insert on public.documents
for each row execute function public.set_user_id_from_auth();

drop trigger if exists facts_set_user_id on public.facts;
create trigger facts_set_user_id
before insert on public.facts
for each row execute function public.set_user_id_from_auth();

drop trigger if exists entities_set_user_id on public.entities;
create trigger entities_set_user_id
before insert on public.entities
for each row execute function public.set_user_id_from_auth();

drop trigger if exists tasks_set_user_id on public.tasks;
create trigger tasks_set_user_id
before insert on public.tasks
for each row execute function public.set_user_id_from_auth();

-- ---------------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.projects enable row level security;
alter table public.documents enable row level security;
alter table public.facts enable row level security;
alter table public.entities enable row level security;
alter table public.tasks enable row level security;
alter table public.message_documents enable row level security;

-- conversations
drop policy if exists conversations_select_own on public.conversations;
drop policy if exists conversations_insert_own on public.conversations;
drop policy if exists conversations_update_own on public.conversations;
drop policy if exists conversations_delete_own on public.conversations;

create policy conversations_select_own on public.conversations
  for select using (user_id = auth.uid());

create policy conversations_insert_own on public.conversations
  for insert with check (user_id = auth.uid());

create policy conversations_update_own on public.conversations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy conversations_delete_own on public.conversations
  for delete using (user_id = auth.uid());

-- messages
drop policy if exists messages_select_own on public.messages;
drop policy if exists messages_insert_own on public.messages;
drop policy if exists messages_update_own on public.messages;
drop policy if exists messages_delete_own on public.messages;

create policy messages_select_own on public.messages
  for select using (user_id = auth.uid());

create policy messages_insert_own on public.messages
  for insert with check (user_id = auth.uid());

create policy messages_update_own on public.messages
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messages_delete_own on public.messages
  for delete using (user_id = auth.uid());

-- projects
drop policy if exists projects_select_own on public.projects;
drop policy if exists projects_insert_own on public.projects;
drop policy if exists projects_update_own on public.projects;
drop policy if exists projects_delete_own on public.projects;

create policy projects_select_own on public.projects
  for select using (user_id = auth.uid());

create policy projects_insert_own on public.projects
  for insert with check (user_id = auth.uid());

create policy projects_update_own on public.projects
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy projects_delete_own on public.projects
  for delete using (user_id = auth.uid());

-- documents
drop policy if exists documents_select_own on public.documents;
drop policy if exists documents_insert_own on public.documents;
drop policy if exists documents_update_own on public.documents;
drop policy if exists documents_delete_own on public.documents;

create policy documents_select_own on public.documents
  for select using (user_id = auth.uid());

create policy documents_insert_own on public.documents
  for insert with check (user_id = auth.uid());

create policy documents_update_own on public.documents
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy documents_delete_own on public.documents
  for delete using (user_id = auth.uid());

-- facts
drop policy if exists facts_select_own on public.facts;
drop policy if exists facts_insert_own on public.facts;
drop policy if exists facts_update_own on public.facts;
drop policy if exists facts_delete_own on public.facts;

create policy facts_select_own on public.facts
  for select using (user_id = auth.uid());

create policy facts_insert_own on public.facts
  for insert with check (user_id = auth.uid());

create policy facts_update_own on public.facts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy facts_delete_own on public.facts
  for delete using (user_id = auth.uid());

-- entities
drop policy if exists entities_select_own on public.entities;
drop policy if exists entities_insert_own on public.entities;
drop policy if exists entities_update_own on public.entities;
drop policy if exists entities_delete_own on public.entities;

create policy entities_select_own on public.entities
  for select using (user_id = auth.uid());

create policy entities_insert_own on public.entities
  for insert with check (user_id = auth.uid());

create policy entities_update_own on public.entities
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy entities_delete_own on public.entities
  for delete using (user_id = auth.uid());

-- tasks
drop policy if exists tasks_select_own on public.tasks;
drop policy if exists tasks_insert_own on public.tasks;
drop policy if exists tasks_update_own on public.tasks;
drop policy if exists tasks_delete_own on public.tasks;

create policy tasks_select_own on public.tasks
  for select using (user_id = auth.uid());

create policy tasks_insert_own on public.tasks
  for insert with check (user_id = auth.uid());

create policy tasks_update_own on public.tasks
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy tasks_delete_own on public.tasks
  for delete using (user_id = auth.uid());

-- message_documents (via message or document ownership)
drop policy if exists message_documents_select_own on public.message_documents;
drop policy if exists message_documents_insert_own on public.message_documents;
drop policy if exists message_documents_update_own on public.message_documents;
drop policy if exists message_documents_delete_own on public.message_documents;

create policy message_documents_select_own on public.message_documents
  for select using (
    exists (
      select 1 from public.messages m
      where m.id = message_documents.message_id
        and m.user_id = auth.uid()
    )
    or exists (
      select 1 from public.documents d
      where d.id = message_documents.document_id
        and d.user_id = auth.uid()
    )
  );

create policy message_documents_insert_own on public.message_documents
  for insert with check (
    exists (
      select 1 from public.messages m
      where m.id = message_documents.message_id
        and m.user_id = auth.uid()
    )
    and exists (
      select 1 from public.documents d
      where d.id = message_documents.document_id
        and d.user_id = auth.uid()
    )
  );

create policy message_documents_update_own on public.message_documents
  for update using (
    exists (
      select 1 from public.messages m
      where m.id = message_documents.message_id
        and m.user_id = auth.uid()
    )
  );

create policy message_documents_delete_own on public.message_documents
  for delete using (
    exists (
      select 1 from public.messages m
      where m.id = message_documents.message_id
        and m.user_id = auth.uid()
    )
  );

-- public.users profiles: read/update own row
alter table public.users enable row level security;

drop policy if exists users_select_own on public.users;
drop policy if exists users_update_own on public.users;

create policy users_select_own on public.users
  for select using (id = auth.uid());

create policy users_update_own on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. Stats function (messages.user_id)
-- ---------------------------------------------------------------------------

create or replace function public.get_user_stats(p_user_id uuid)
returns table (chats bigint, words bigint, days bigint)
language plpgsql
stable
as $$
begin
  return query
  select
    (
      select count(*)::bigint
      from public.conversations c
      where c.user_id = p_user_id
    ) as chats,
    coalesce(
      (
        select sum(
          case
            when coalesce(trim(m.content), '') = '' then 0
            else cardinality(regexp_split_to_array(trim(m.content), '\s+'))
          end
        )::bigint
        from public.messages m
        where m.role = 'user'
          and m.user_id = p_user_id
      ),
      0
    ) as words,
    coalesce(
      (
        select count(distinct (m.created_at at time zone 'utc')::date)::bigint
        from public.messages m
        where m.role = 'user'
          and m.user_id = p_user_id
      ),
      0
    ) as days;
end;
$$;
