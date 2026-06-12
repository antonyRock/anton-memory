/** Domain terms often used in voice notes (payments, terminals, banking software). */
export const TRANSCRIPTION_DOMAIN_TERMS = [
  "EMV",
  "INPAS",
  "PINPAD",
  "POS",
  "ККТ",
  "ККМ",
  "ЕНВД",
  "Т-Банк",
  "T6D",
  "NFC",
  "SDK",
  "API",
  "BOM",
  "MediaTek",
  "MT8766V",
  "RR88916-31",
  "Pay2Phone",
  "Supabase",
  "OpenAI",
  "PostgreSQL",
  "Vercel"
] as const;

export function buildTranscriptionPrompt() {
  return [
    "Русская речь.",
    "Контекст: платёжные решения, платёжные терминалы, эквайринг, банковское ПО, фискализация.",
    "Сохраняй технические термины, аббревиатуры, модели и названия продуктов в правильном написании.",
    `Частые термины: ${TRANSCRIPTION_DOMAIN_TERMS.join(", ")}.`
  ].join(" ");
}

export const CLEANUP_SYSTEM_PROMPT = `Ты редактор голосовой расшифровки. Исправь текст минимально.

Нужно:
- исправить явные ошибки распознавания;
- расставить пунктуацию и заглавные буквы;
- нормализовать известные термины и аббревиатуры.

Нельзя:
- удалять слова;
- добавлять новые слова или факты;
- менять смысл;
- менять порядок мыслей;
- переписывать стиль;
- раскрывать или переводить аббревиатуры.

Термины:
EMV, INPAS, ЦКТ, ККТ, ККМ, ЕНВД, ГОСУХА, NFC, SDK, API, POS, SoftPOS, PINPAD, tBrain, ТБанк, PostgreSQL, Supabase, Vercel, Минпромторг.

Верни только очищенный текст, без комментариев.`;
