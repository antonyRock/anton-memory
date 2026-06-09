import {
  getOpenAI,
  transcriptionFallbackModel,
  transcriptionModel
} from "@/lib/openai";

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

    if (message.includes("network") || message.includes("fetch failed")) {
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
    model
  });

  const text = transcription.text?.trim();
  if (!text) {
    throw new Error("Пустой результат распознавания.");
  }

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
    }
  }

  throw lastError ?? new Error("Не удалось распознать аудио.");
}
