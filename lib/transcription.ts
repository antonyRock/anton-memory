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

  console.info(
    "[TRANSCRIPT_QUALITY]",
    JSON.stringify(
      {
        stage: "stt",
        model,
        rawTranscript: text
      },
      null,
      2
    )
  );

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
  const rawTranscript = await transcribeAudio(file);
  const { cleanedTranscript, appliedCorrections, transcriptStatus } =
    await cleanupTranscript(rawTranscript);

  if (transcriptStatus === "cleaned" && cleanedTranscript) {
    logTranscriptQuality({
      rawTranscript,
      cleanedTranscript,
      appliedCorrections,
      transcriptStatus: "cleaned"
    });

    return {
      text: cleanedTranscript,
      rawTranscript,
      cleanedTranscript,
      appliedCorrections,
      transcriptStatus: "cleaned"
    };
  }

  logTranscriptQuality({
    rawTranscript,
    cleanedTranscript: null,
    appliedCorrections: [],
    transcriptStatus: "cleanup_failed"
  });

  return {
    text: rawTranscript,
    rawTranscript,
    cleanedTranscript: null,
    appliedCorrections: [],
    transcriptStatus: "cleanup_failed"
  };
}
