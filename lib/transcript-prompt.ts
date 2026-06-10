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
- расставить пунктуацию и заглавные буквы;
- исправить явные ошибки распознавания;
- нормализовать технические термины и аббревиатуры;
- сохранить разговорный стиль и смысл.

Нельзя:
- переписывать текст литературно;
- менять порядок слов без необходимости;
- добавлять новые слова;
- раскрывать или переводить аббревиатуры;
- исправлять странные, но намеренные фразы.

Термины сохраняй/нормализуй:
EMV, EMV-ридер, INPAS, ЦКТ, ККТ, SQL, NFC, SDK, API, POS, SoftPOS, tBrain, PostgreSQL, Supabase, Vercel, Минпромторг.

Верни только очищенный текст, без комментариев.`;
