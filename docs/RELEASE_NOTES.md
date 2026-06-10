# Release Notes

## Release: Beta multi-user & voice update

| | |
|---|---|
| **Версия** | `0.2.0-beta` |
| **Дата** | 2026-06-10 |
| **Production** | [https://tbrain.vercel.app](https://tbrain.vercel.app) |
| **Репозиторий** | [github.com/antonyRock/anton-memory](https://github.com/antonyRock/anton-memory) |

Это beta-релиз: auth и multi-user готовы для ограниченного тестирования на нескольких аккаунтах. Перед широким rollout проверьте изоляцию данных и env на Vercel.

---

## Что добавлено

### Auth & multi-user

- **Supabase Auth / beta login** — вход по email и паролю, JWT на всех `/api/*` запросах
- **Поддержка нескольких пользователей** — каждый пользователь видит только свои чаты, файлы и память
- **Подготовка `user_id`** — колонки и фильтрация в `conversations`, `messages`, `projects`, `documents`, `facts`, `entities`, `tasks`
- **Login / logout flow** — экран входа, выход возвращает на авторизацию
- **Пользовательский footer в sidebar** — аватар, имя (двойной тап для локального переименования), tagline, меню
- **Статистика пользователя** — чаты, слова пользователя, активные дни (кэш в sessionStorage)

SQL: `supabase/multi_user_migration.sql`, при необходимости `supabase/multi_user_repair.sql`.

### Voice

- **Голосовой ввод** через OpenAI transcription (`POST /api/transcribe`)
- **Pending voice recordings в IndexedDB** — запись не теряется при обрыве сети
- **Retry transcription** после ошибки
- **Fallback-модель** распознавания (`OPENAI_TRANSCRIBE_FALLBACK_MODEL`)

### Files & projects

- **Улучшенный Excel parsing** и сохранение parsed file data в `documents`
- **Поиск** по названиям файлов и содержимому
- **Проекты как папки** для чатов
- **Файлы внутри проектов**
- **Drag & drop** файлов в чат

### UI & UX

- **Улучшенный sidebar** — проекты, чаты, профиль
- **Кнопка «в конец чата»**
- **Fullscreen preview** для изображений

### Performance & backend

- **Картинки не хранятся base64 в JSON** — снижение размера metadata и ускорение загрузки
- **Profiling `/api/chat`** — замеры этапов запроса (`lib/request-profile.ts`)
- **Background memory extraction** — извлечение фактов/сущностей/задач после ответа без блокировки UI

---

## Known Issues

| # | Проблема | Обход / статус |
|---|----------|----------------|
| 1 | **RLS** может быть включён отдельным этапом | Сейчас изоляция через server-side `user_id` filtering; RLS policies в SQL подготовлены, но финальное включение — после регрессии |
| 2 | **Production env variables** | `NEXT_PUBLIC_SUPABASE_ANON_KEY` и остальные ключи нужно добавить в Vercel вручную; без anon key — «Auth не настроен» |
| 3 | **Voice input на iPhone** | Требует HTTPS; локальный `http://192.168.x.x` не даёт доступ к микрофону — используйте production или tunnel |
| 4 | **Audio recordings** | Не хранятся постоянно на сервере; только временно в IndexedDB до успешной транскрибации |
| 5 | **Multi-user beta** | Требует проверки на тестовых аккаунтах; запустите `node scripts/verify-multi-user.mjs` после миграции |

---

## Upgrade guide

### 1. Supabase

```text
1. supabase/multi_user_migration.sql
2. (опционально) supabase/multi_user_repair.sql — если была старая users_migration
3. Создайте пользователей: Authentication → Users → Add user
4. Добавьте строки в public.users для каждого UID
```

### 2. Локально

```bash
cp .env.example .env.local
# заполните NEXT_PUBLIC_SUPABASE_ANON_KEY и остальные ключи
npm install
npm run dev
```

### 3. Vercel

В [Environment Variables](https://vercel.com/antonyrocks-projects/tbrain/settings/environment-variables) должны быть:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL`
- `OPENAI_TRANSCRIPTION_MODEL`
- `OPENAI_TRANSCRIBE_MODEL`
- `OPENAI_TRANSCRIBE_FALLBACK_MODEL`

В [Domains](https://vercel.com/antonyrocks-projects/tbrain/settings/domains) — только **`tbrain.vercel.app`**.

После изменений env — **Redeploy** production.

### 4. Smoke test

- [ ] Login / logout на production
- [ ] Два аккаунта — данные не пересекаются
- [ ] Голосовой ввод (HTTPS)
- [ ] Загрузка файла и поиск по содержимому
- [ ] Проект → чат → файл в проекте

---

## Связанные документы

- [README.md](../README.md) — установка, env, auth, тестирование
- [CHANGELOG.md](./CHANGELOG.md) — полная история изменений
