import {
  getOpenAI,
  transcriptionFallbackModel,
  transcriptionModel
} from "@/lib/openai";
import {
  cleanupTranscript,
  logTranscriptQuality,
  type TranscriptStatus
} from "@/lib/transcript-cleanup";
import { buildTranscriptionPrompt } from "@/lib/transcript-prompt";

export type TranscriptionResult = {
  /** Text shown to the user and saved as message content. */
  text: string;
  rawTranscript: string;
  cleanedTranscript: string | null;
  appliedCorrections: string[];
  transcriptStatus: TranscriptStatus;
  profile: {
    sttMs: number;
    cleanupMs: number;
  };
};

export type VoiceTranscriptMeta = {
  rawTranscript: string;
  cleanedTranscript: string | null;
  appliedCorrections?: string[];
  transcriptStatus: TranscriptStatus;
};

function uniqueModels(models: string[]) {
  return [...new Set(models.filter(Boolean))];
}

function getTranscriptionModels() {
  return uniqueModels([transcriptionModel, transcriptionFallbackModel]);
}

function mapTranscriptionError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes("api key")) {
      return new Error("OpenAI API недоступен: проверьте OPENAI_API_KEY.");
    }

    if (message.includes("timeout") || message.includes("timed out")) {
      return new Error("OpenAI не ответил вовремя. Попробуйте ещё раз.");
    }

    if (message.includes("network") || message.includes("failed")) {
      return new Error("Сеть недоступна. Запись сохранена локально — нажмите «Повторить».");
    }

    if (message.includes("too large") || message.includes("25mb")) {
      return new Error("Файл слишком большой для OpenAI (максимум 25 МБ).");
    }

    return error;
  }

  return new Error("Не удалось распознать аудио.");
}

const TRAILING_COMMAND_PATTERNS = [
  /перевед[иь]\s+на\s+английск(?:ий|ом)\b[.!?…]*$/i,
  /translate\s+(?:it|this)?\s*(?:to\s+english|into\s+english)\b[.!?…]*$/i,
  /сделай\s+кратко\b[.!?…]*$/i,
  /кратк(?:о|ий)\s+итог\b[.!?…]*$/i,
  /напомни\s+завтра\b[.!?…]*$/i
] as const;

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function preserveTrailingCommand(rawTranscript: string, cleanedTranscript: string) {
  const rawTrimmed = rawTranscript.trim();
  const cleanedTrimmed = cleanedTranscript.trim();

  for (const pattern of TRAILING_COMMAND_PATTERNS) {
    const match = rawTrimmed.match(pattern);
    const command = match?.[0]?.trim();
    if (!command) continue;

    const cleanedNormalized = normalizeForMatch(cleanedTrimmed);
    const commandNormalized = normalizeForMatch(command);
    if (cleanedNormalized.includes(commandNormalized)) {
      return cleanedTrimmed;
    }

    const separator = /[.!?…]$/.test(cleanedTrimmed) ? " " : ". ";
    return `${cleanedTrimmed}${separator}${command}`;
  }

  return cleanedTrimmed;
}

function getWordTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .match(/[a-zа-я0-9]+/gi) ?? [];
}

function shouldFallbackToRawTranscript(rawTranscript: string, cleanedTranscript: string) {
  const rawTokens = getWordTokens(rawTranscript);
  const cleanedTokens = getWordTokens(cleanedTranscript);

  if (rawTokens.length === 0 || cleanedTokens.length === 0) return true;

  const cleanedCounts = new Map<string, number>();
  for (const token of cleanedTokens) {
    cleanedCounts.set(token, (cleanedCounts.get(token) ?? 0) + 1);
  }

  let kept = 0;
  for (const token of rawTokens) {
    const count = cleanedCounts.get(token) ?? 0;
    if (count > 0) {
      cleanedCounts.set(token, count - 1);
      kept += 1;
    }
  }

  const keptRatio = kept / rawTokens.length;
  const minAcceptableRatio = 0.92;
  return keptRatio < minAcceptableRatio;
}

async function createTranscription(file: File, model: string) {
  const transcription = await getOpenAI().audio.transcriptions.create({
    file,
    model,
    language: "ru",
    prompt: buildTranscriptionPrompt()
  });

  const text = transcription.text?.trim();
  if (!text) {
    throw new Error("Пустой результат распознавания.");
  }

  console.info(`[TRANSCRIPT_QUALITY] stage=stt model=${model} textLength=${text.length}`);

  return text;
}

export async function transcribeAudio(file: File) {
  const models = getTranscriptionModels();
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      return await createTranscription(file, model);
    } catch (error) {
      lastError = mapTranscriptionError(error);
      console.warn(`[TRANSCRIPT_QUALITY] STT failed for model ${model}:`, lastError.message);
    }
  }

  throw lastError ?? new Error("Не удалось распознать аудио.");
}

export async function transcribeAudioWithCleanup(file: File): Promise<TranscriptionResult> {
  const sttStartedAt = Date.now();
  const rawTranscript = await transcribeAudio(file);
  const sttMs = Date.now() - sttStartedAt;
  const cleanupStartedAt = Date.now();
  const { cleanedTranscript, appliedCorrections, transcriptStatus } =
    await cleanupTranscript(rawTranscript);
  const cleanupMs = Date.now() - cleanupStartedAt;

  if (transcriptStatus === "cleaned" && cleanedTranscript) {
    const finalCleanedTranscript = preserveTrailingCommand(rawTranscript, cleanedTranscript);
    if (shouldFallbackToRawTranscript(rawTranscript, finalCleanedTranscript)) {
      logTranscriptQuality({
        rawTranscriptLength: rawTranscript.length,
        cleanedTranscriptLength: finalCleanedTranscript.length,
        appliedCorrectionsCount: appliedCorrections.length,
        transcriptStatus: "cleanup_failed"
      });

      return {
        text: rawTranscript,
        rawTranscript,
        cleanedTranscript: null,
        appliedCorrections: [],
        transcriptStatus: "cleanup_failed",
        profile: {
          sttMs,
          cleanupMs
        }
      };
    }

    logTranscriptQuality({
      rawTranscriptLength: rawTranscript.length,
      cleanedTranscriptLength: finalCleanedTranscript.length,
      appliedCorrectionsCount: appliedCorrections.length,
      transcriptStatus: "cleaned"
    });

    return {
      text: finalCleanedTranscript,
      rawTranscript,
      cleanedTranscript: finalCleanedTranscript,
      appliedCorrections,
      transcriptStatus: "cleaned",
      profile: {
        sttMs,
        cleanupMs
      }
    };
  }

  logTranscriptQuality({
    rawTranscriptLength: rawTranscript.length,
    cleanedTranscriptLength: null,
    appliedCorrectionsCount: 0,
    transcriptStatus: "cleanup_failed"
  });

  return {
    text: rawTranscript,
    rawTranscript,
    cleanedTranscript: null,
    appliedCorrections: [],
    transcriptStatus: "cleanup_failed",
    profile: {
      sttMs,
      cleanupMs
    }
  };
}
