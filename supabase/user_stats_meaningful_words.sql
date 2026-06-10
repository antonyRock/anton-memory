-- Meaningful word count for user stats (skip с, я, и and other stop words)
-- Run once in Supabase SQL editor after multi_user_migration.sql

create or replace function public.normalize_word_token(raw text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(raw, ''), '[^[:alpha:][:digit:]]', '', 'g'));
$$;

create or replace function public.is_meaningful_word(raw text)
returns boolean
language sql
immutable
as $$
  select
    length(public.normalize_word_token(raw)) >= 2
    and public.normalize_word_token(raw) not in (
      'и', 'а', 'но', 'с', 'со', 'в', 'во', 'на', 'за', 'по', 'из', 'от', 'до', 'к', 'ко', 'у', 'о', 'об',
      'я', 'ты', 'мы', 'вы', 'он', 'она', 'оно', 'они',
      'не', 'ни', 'же', 'ли', 'бы', 'то', 'как', 'так', 'что', 'это', 'где', 'или', 'для', 'при', 'без',
      'ещё', 'eще', 'уже', 'там', 'тут', 'вот'
    );
$$;

create or replace function public.count_meaningful_words(p_text text)
returns bigint
language sql
immutable
as $$
  select count(*)::bigint
  from unnest(regexp_split_to_array(trim(coalesce(p_text, '')), '\s+')) as token(raw)
  where public.is_meaningful_word(token.raw);
$$;

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
        select sum(public.count_meaningful_words(m.content))::bigint
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
