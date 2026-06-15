-- Telegram integration for TBrain (run once in Supabase SQL editor)

alter table public.users add column if not exists telegram_user_id bigint unique;
