-- Extend user stats with files/images counts (run once in Supabase SQL editor)

create or replace function public.is_image_document(
  p_file_type text,
  p_file_name text,
  p_metadata jsonb
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(p_file_type, '') ilike 'image/%'
    or coalesce(p_metadata->>'kind', '') in ('image', 'generated_image')
    or coalesce(p_file_name, '') ~* '\.(png|jpe?g|webp|gif|bmp|svg)$';
$$;

create or replace function public.get_user_stats(p_user_id uuid)
returns table (chats bigint, files bigint, images bigint, words bigint, days bigint)
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
    (
      select count(*)::bigint
      from public.documents d
      where d.user_id = p_user_id
        and not public.is_image_document(d.file_type, d.file_name, d.metadata)
    ) as files,
    (
      select count(*)::bigint
      from public.documents d
      where d.user_id = p_user_id
        and public.is_image_document(d.file_type, d.file_name, d.metadata)
    ) as images,
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
