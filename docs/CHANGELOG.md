# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).  
Версионирование — [Semantic Versioning](https://semver.org/lang/ru/).

---

## [Unreleased]

### Planned

- Полное включение RLS после финальной проверки изоляции
- Дополнительные beta-тестеры и сценарии регрессии multi-user

---

## [0.2.1-beta] — 2026-06-09

### Release: Voice auto-send & profile name fix

Production URL: [https://tbrain.vercel.app](https://tbrain.vercel.app)

### Added

- `PATCH /api/user` — сохранение `display_name` в Supabase (`public.users`)

### Changed

- Голосовые сообщения отправляются сразу после распознавания, без шага «проверьте и отправьте»
- Имя в sidebar сохраняется на сервере, а не только в `localStorage` браузера

### Fixed

- Имя профиля сбрасывалось после перезагрузки (перезапись частью email до `@`)
- Локальное переименование не синхронизировалось между устройствами

---

## [0.2.0-beta] — 2026-06-10

### Release: Beta multi-user & voice update

Production URL: [https://tbrain.vercel.app](https://tbrain.vercel.app)

### Added

- Supabase Auth / beta login (email + password)
- Поддержка нескольких пользователей
- Колонка `user_id` и фильтрация данных по пользователю
- Login / logout flow (`AuthProvider`, `AuthGate`, экран входа)
- Пользовательский footer в sidebar (профиль, статистика, выход)
- Статистика пользователя: чаты, слова пользователя, активные дни
- Голосовой ввод через OpenAI transcription (`POST /api/transcribe`)
- Pending voice recordings в IndexedDB
- Retry transcription после ошибки
- Fallback-модель распознавания речи
- Улучшенный Excel parsing
- Сохранение parsed file data в `documents`
- Поиск по названиям файлов и содержимому файлов
- Проекты как папки для чатов
- Файлы внутри проектов
- Drag & drop файлов
- Улучшенный sidebar
- Кнопка «в конец чата»
- Fullscreen preview для изображений
- Profiling `/api/chat` (`lib/request-profile.ts`)
- Background memory extraction после ответа модели

### Changed

- Картинки больше не хранятся как base64 в JSON metadata (performance fix)
- API routes требуют аутентификацию через JWT
- Канонический production-домен: `tbrain.vercel.app`

### Fixed

- Logout переводит на экран авторизации
- Разделение server-only auth-кода и client imports
- Legacy placeholder user repair (`supabase/multi_user_repair.sql`)

### Known issues

- RLS может быть включён отдельным этапом после проверки `user_id` filtering
- Production env variables нужно отдельно добавить в Vercel
- Voice input требует HTTPS на iPhone
- Audio recordings не хранятся постоянно — только временно до транскрибации
- Multi-user требует проверки на тестовых аккаунтах

---

## [0.1.0] — 2026-06-08

### Added

- MVP PWA: чат, память в Supabase, OpenAI chat
- Таблицы `messages`, `facts`, `entities`, `tasks`
- Memory extractor после пользовательских сообщений
- Базовый transcription provider
- Деплой на Vercel
