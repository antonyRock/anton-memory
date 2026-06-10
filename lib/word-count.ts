const MEANINGFUL_WORD_STOP = new Set([
  "и",
  "а",
  "но",
  "с",
  "со",
  "в",
  "во",
  "на",
  "за",
  "по",
  "из",
  "от",
  "до",
  "к",
  "ко",
  "у",
  "о",
  "об",
  "я",
  "ты",
  "мы",
  "вы",
  "он",
  "она",
  "оно",
  "они",
  "не",
  "ни",
  "же",
  "ли",
  "бы",
  "то",
  "как",
  "так",
  "что",
  "это",
  "где",
  "или",
  "для",
  "при",
  "без",
  "ещё",
  "eще",
  "уже",
  "там",
  "тут",
  "вот"
]);

export function normalizeWordToken(raw: string) {
  return raw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function isMeaningfulWord(raw: string) {
  const word = normalizeWordToken(raw);
  if (!word) return false;
  if (word.length < 2) return false;
  if (MEANINGFUL_WORD_STOP.has(word)) return false;
  return true;
}

/** Count user words for stats: skip particles, pronouns, and one-letter tokens. */
export function countWordsInText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).filter(isMeaningfulWord).length;
}
