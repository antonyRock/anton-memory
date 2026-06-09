-- User profiles + per-user conversations (multi-user ready)
-- Run once in Supabase SQL editor.

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  avatar_url text,
  tagline text not null default 'Ты можешь всё!',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations add column if not exists user_id uuid references public.users(id) on delete set null;

create index if not exists conversations_user_id_idx
  on public.conversations (user_id, updated_at desc);

insert into public.users (id, display_name, tagline)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Антон',
  'Ты можешь всё!'
)
on conflict (id) do update
set
  display_name = excluded.display_name,
  tagline = excluded.tagline,
  updated_at = now();

update public.conversations
set user_id = '00000000-0000-0000-0000-000000000001'::uuid
where user_id is null;

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
        inner join public.conversations c on c.id = m.conversation_id
        where m.role = 'user'
          and c.user_id = p_user_id
      ),
      0
    ) as words,
    coalesce(
      (
        select count(distinct (m.created_at at time zone 'utc')::date)::bigint
        from public.messages m
        inner join public.conversations c on c.id = m.conversation_id
        where m.role = 'user'
          and c.user_id = p_user_id
      ),
      0
    ) as days;
end;
$$;
