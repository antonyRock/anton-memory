# Anton Memory

MVP PWA приложения "Второй мозг": чат в стиле ChatGPT с собственной долговременной памятью в Supabase PostgreSQL.

## Что уже есть

- Next.js + TypeScript + App Router.
- PWA: `manifest.webmanifest`, service worker, installable browser app.
- Один экран чата: сообщения, ввод, отправка, микрофон, состояния записи и загрузки.
- Backend API на Next.js:
  - `POST /api/chat` сохраняет сообщение, подтягивает память, вызывает OpenAI, сохраняет ответ и запускает extractor.
  - `POST /api/transcribe` принимает аудио и возвращает transcription.
- Supabase tables:
  - `messages`
  - `facts`
  - `entities`
  - `tasks`
- OpenAI chat response.
- Базовый memory retrieval из `facts`, `entities`, `tasks`.
- Memory extractor после каждого пользовательского сообщения.
- Отдельный модуль transcription provider: `lib/transcription.ts`.

## Переменные окружения

Скопируйте `.env.example` в `.env.local` для локального запуска:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://slpnkzvetjhwchcobaig.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

Важно: `SUPABASE_SERVICE_ROLE_KEY` используется только на backend. Не добавляйте его в клиентский код и не называйте с префиксом `NEXT_PUBLIC_`.

## Ожидаемая схема Supabase

SQL для таблиц и индексов лежит в `supabase/schema.sql`. Его можно выполнить в Supabase SQL Editor.

Для MVP используется service role key, поэтому Row Level Security можно оставить включенным, но backend должен иметь доступ через server env. Для полноценного multi-user продукта следующим шагом стоит добавить `user_id`, auth и RLS policies.

## Локальный запуск

```bash
npm install
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

Микрофон в браузере работает на `localhost` и HTTPS. В production на Vercel будет HTTPS.

## Деплой на Vercel

1. Создайте GitHub repo `anton-memory`.
2. Запушьте проект в GitHub.
3. В Vercel выберите `New Project` и импортируйте `anton-memory`.
4. Добавьте env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `OPENAI_CHAT_MODEL`
   - `OPENAI_TRANSCRIPTION_MODEL`
5. Нажмите Deploy.
6. После деплоя откройте URL проекта и установите PWA через браузер.

## Memory pipeline

1. Пользовательское сообщение сохраняется в `messages`.
2. Backend загружает свежую память из `facts`, `entities`, `tasks`.
3. Память передается в system context модели.
4. Ответ OpenAI сохраняется в `messages`.
5. Отдельный extractor извлекает факты, сущности и задачи.
6. Извлеченная память сохраняется в соответствующие таблицы.

## Ограничения MVP

- Пока нет авторизации и разделения пользователей.
- Retrieval простой: берет последние записи из таблиц памяти.
- Extractor не дедуплицирует память.
- Экспорт/import памяти еще не реализованы.

Эти ограничения намеренно оставлены, чтобы быстрее получить первый рабочий продукт.
