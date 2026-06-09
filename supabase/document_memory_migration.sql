-- Optional migration (NOT applied automatically).
-- Current implementation stores document_id inside facts/entities/tasks.metadata jsonb.
-- Run manually in Supabase SQL editor if you want dedicated FK columns and indexes.

alter table public.facts add column if not exists source_document_id bigint;
alter table public.entities add column if not exists source_document_id bigint;
alter table public.tasks add column if not exists source_document_id bigint;

create index if not exists facts_source_document_id_idx
  on public.facts (source_document_id);

create index if not exists entities_source_document_id_idx
  on public.entities (source_document_id);

create index if not exists tasks_source_document_id_idx
  on public.tasks (source_document_id);

-- Backfill from metadata.document_id when present:
-- update public.facts
-- set source_document_id = (metadata->>'document_id')::bigint
-- where source_document_id is null and metadata ? 'document_id';
