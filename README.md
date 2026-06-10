# TBrain

Production: **[https://tbrain.vercel.app](https://tbrain.vercel.app)**  
GitHub: **[github.com/antonyRock/anton-memory](https://github.com/antonyRock/anton-memory)**

PWA-чат «второй мозг»: ChatGPT-подобный интерфейс, долговременная память в Supabase PostgreSQL, голосовой ввод, проекты и файлы.

**Последний релиз:** [Beta multi-user & voice update](docs/RELEASE_NOTES.md) · [CHANGELOG](docs/CHANGELOG.md)

---

## О проекте

**TBrain** — личный «второй мозг»: чат с AI, который **помнит** важное между разговорами.

Обычный ChatGPT забывает контекст после сессии. TBrain сохраняет факты, сущности, задачи и содержимое файлов в Supabase и подмешивает их в следующие ответы. Идея — не просто поболтать, а накапливать знания: проекты, документы, заметки, голосовые мысли — всё в одном месте с памятью.

Для кого: личное использование и небольшой beta-круг (несколько пользователей с изоляцией данных).

---

## Что уже есть

- **Next.js + TypeScript + App Router** — один экран чата, PWA (`manifest.webmanifest`, service worker, установка на телефон).
- **Supabase Auth (beta)** — вход по email/паролю, logout, изоляция по `user_id`.
- **Чат** — сообщения, ввод, микрофон, drag & drop файлов, кнопка «в конец чата», fullscreen preview изображений.
- **Backend API:**
  - `POST /api/chat` — память → OpenAI → ответ → background memory extraction
  - `POST /api/transcribe` — голос → текст (OpenAI, fallback-модель, retry)
  - `GET/POST /api/conversations`, `/api/projects`, `/api/files`, `/api/documents`, `/api/user`
- **Память** — `facts`, `entities`, `tasks`; retrieval из таблиц + документов; extractor после сообщений.
- **Проекты** — папки для чатов; файлы внутри проектов; поиск по названию и содержимому файлов.
- **Excel / PDF / docx** — parsing, parsed data в `documents` (без base64-картинок в JSON).
- **Sidebar** — проекты, чаты, профиль пользователя, статистика (чаты, слова, активные дни).
- **Голос** — pending recordings в IndexedDB до успешной транскрибации.
- **Profiling** — замеры этапов `/api/chat` (`lib/request-profile.ts`).

Таблицы Supabase: `messages`, `facts`, `entities`, `tasks`, `conversations`, `projects`, `documents`, `users`.

---

## Ожидаемая схема Supabase

Базовая схема: `supabase/schema.sql`. Дополнительные миграции по мере развития:

| Файл | Назначение |
|------|------------|
| `schema.sql` | базовые таблицы |
| `conversations_migration.sql` | чаты |
| `projects_migration.sql` | проекты |
| `document_memory_migration.sql` | документы и память файлов |
| `multi_user_migration.sql` | `user_id`, profiles, RLS |
| `multi_user_repair.sql` | repair legacy placeholder user |

Выполняйте в Supabase → SQL Editor. Для beta multi-user после `schema.sql` нужен как минимум `multi_user_migration.sql`.

---

## Быстрый старт (локально)

```bash
git clone https://github.com/antonyRock/anton-memory.git
cd anton-memory
npm install
cp .env.example .env.local
# заполните .env.local (см. ниже)
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

Сборка production локально:

```bash
npm run build
npm start
```

---

## Переменные окружения

Скопируйте `.env.example` → `.env.local` и заполните:

| Переменная | Где используется | Описание |
|------------|------------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | URL проекта Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client | **anon public** key (Supabase → Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | service role key — **не** добавляйте в клиент |
| `OPENAI_API_KEY` | server | ключ OpenAI |
| `OPENAI_CHAT_MODEL` | server | модель чата, напр. `gpt-4o-mini` |
| `OPENAI_TRANSCRIPTION_MODEL` | server | основная модель распознавания речи |
| `OPENAI_TRANSCRIBE_MODEL` | server | alias для transcription provider |
| `OPENAI_TRANSCRIBE_FALLBACK_MODEL` | server | fallback при ошибке основной модели |
| `OPENAI_IMAGE_MODEL` | server | модель генерации изображений (опционально) |

Пример минимального `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-...
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe
OPENAI_TRANSCRIBE_FALLBACK_MODEL=gpt-4o-mini-transcribe
```

### Vercel (production)

Добавьте **те же** переменные в [Vercel → tbrain → Settings → Environment Variables](https://vercel.com/antonyrocks-projects/tbrain/settings/environment-variables), включая `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Без anon key на production появится экран «Auth не настроен».

Канонический домен: **https://tbrain.vercel.app** (см. `vercel.json`).

---

## Supabase Auth (beta login)

1. В Supabase включите **Authentication → Providers → Email** (email + password).
2. Добавьте в `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Выполните SQL-миграции multi-user (см. [Multi-user](#multi-user-beta)).
4. Перезапустите dev-сервер: `npm run dev`.
5. Откройте приложение — должен появиться экран входа. После login API получает JWT и фильтрует данные по `user_id`.

Клиент: `AuthProvider`, `AuthGate`, `LoginScreen`.  
Server: `lib/server-auth.ts`, `lib/request-context.ts` — JWT из `Authorization: Bearer` или `?access_token=` (для картинок).

---

## Beta-пользователи в Supabase (вручную)

1. **Authentication → Users → Add user** — создайте email + password для каждого beta-тестера.
2. Скопируйте **User UID** из карточки пользователя.
3. В **SQL Editor** добавьте профиль в `public.users`:

```sql
insert into public.users (id, display_name, tagline)
values (
  '00000000-0000-0000-0000-000000000000'::uuid,  -- UID из auth.users
  'Имя',
  'Ты можешь всё!'
)
on conflict (id) do update
set display_name = excluded.display_name, updated_at = now();
```

4. Для полной изоляции данных выполните миграции:
   - `supabase/multi_user_migration.sql` — основная миграция `user_id` + RLS
   - `supabase/multi_user_repair.sql` — если ранее был placeholder user из `users_migration.sql`

Порядок для новой базы: `schema.sql` → остальные миграции по необходимости → `multi_user_migration.sql`.

---

## Проверка голосового ввода

1. Запустите приложение на **HTTPS** или `localhost` (микрофон требует secure context).
2. На iPhone по локальной сети (`http://192.168.x.x`) микрофон **не работает** — используйте [tbrain.vercel.app](https://tbrain.vercel.app) или `npm run dev:lan` с HTTPS-тunnel.
3. Нажмите иконку микрофона в поле ввода, говорите, отпустите — текст появится после `/api/transcribe`.
4. При ошибке сети запись сохраняется в **IndexedDB** (`tbrain-voice-recordings`) — можно повторить транскрибацию.
5. Убедитесь, что заданы `OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL` и при необходимости `OPENAI_TRANSCRIBE_FALLBACK_MODEL`.

---

## Multi-user (beta)

### Миграция БД

```text
supabase/multi_user_migration.sql   # user_id, backfill, RLS, profiles
supabase/multi_user_repair.sql      # repair legacy placeholder user (если нужно)
```

Таблицы с `user_id`: `conversations`, `messages`, `projects`, `documents`, `facts`, `entities`, `tasks`.

### Проверка изоляции

1. Создайте двух пользователей в Supabase Auth (см. выше).
2. Войдите под первым — создайте чат и сообщение.
3. Выйдите, войдите под вторым — чаты первого пользователя не должны отображаться.
4. Скрипт проверки (нужен `.env.local` с service role):

```bash
node scripts/verify-multi-user.mjs
```

Ожидание: все строки в 7 таблицах принадлежат ожидаемому `user_id`, профили в `public.users` на месте.

---

## Деплой на Vercel

1. Репозиторий: [github.com/antonyRock/anton-memory](https://github.com/antonyRock/anton-memory)
2. Vercel-проект: **tbrain**, ветка `main`
3. Push в `main` → автодеплой на **https://tbrain.vercel.app**
4. В **Settings → Domains** оставьте только `tbrain.vercel.app` (удалите старые `chatgpt-*` алиасы, если остались)

---

## Структура проекта (кратко)

| Область | Путь |
|---------|------|
| UI чата | `app/page.tsx` |
| Auth | `components/AuthProvider.tsx`, `AuthGate.tsx`, `LoginScreen.tsx` |
| Sidebar / профиль | `components/SidebarUserProfile.tsx` |
| API | `app/api/*` |
| Память | `lib/memory.ts`, `lib/chat-post-processing.ts` |
| Голос | `hooks/useVoiceRecording.ts`, `lib/voice-recording.ts`, `lib/transcription.ts` |
| SQL | `supabase/*.sql` |

---

## Memory pipeline

1. Сообщение пользователя сохраняется в `messages` (с `user_id`).
2. Backend загружает память из `facts`, `entities`, `tasks`, документов.
3. Контекст передаётся в OpenAI.
4. Ответ сохраняется; **background memory extraction** обновляет память асинхронно.
5. `/api/chat` поддерживает request profiling (`lib/request-profile.ts`).

---

## Документация релизов

- [CHANGELOG.md](docs/CHANGELOG.md) — история изменений
- [RELEASE_NOTES.md](docs/RELEASE_NOTES.md) — подробности текущего beta-релиза и known issues

---

## Known issues (кратко)

См. полный список в [docs/RELEASE_NOTES.md#known-issues](docs/RELEASE_NOTES.md#known-issues):

- RLS может включаться отдельным этапом после проверки `user_id` filtering
- production env variables нужно добавлять в Vercel вручную
- voice input на iPhone требует HTTPS
- audio recordings хранятся временно до транскрибации
- multi-user требует проверки на тестовых аккаунтах

---

## Текущие ограничения (beta)

- Retrieval простой: в основном последние записи из таблиц памяти, без сложного semantic search.
- Extractor не дедуплицирует память агрессивно.
- Экспорт/import памяти ещё не реализованы.
- RLS подготовлен в SQL, но финальное включение — после регрессии `user_id` filtering.
- Голос и микрофон на iPhone только по HTTPS.

Эти ограничения осознанны для beta: сначала рабочий продукт для малого круга пользователей, затем усиление памяти и безопасности.
