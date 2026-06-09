import OpenAI from "openai";

export const chatModel = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
export const transcriptionModel =
  process.env.OPENAI_TRANSCRIBE_MODEL ??
  process.env.OPENAI_TRANSCRIPTION_MODEL ??
  "gpt-4o-transcribe";
export const transcriptionFallbackModel =
  process.env.OPENAI_TRANSCRIBE_FALLBACK_MODEL ?? "gpt-4o-mini-transcribe";
export const imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
export const imageSize = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024";
export const imageQuality = process.env.OPENAI_IMAGE_QUALITY ?? "medium";

export function getImageModelOptions() {
  if (!imageModel.includes("gpt-image")) {
    return { size: imageSize as "256x256" | "512x512" | "1024x1024" };
  }

  return {
    size: imageSize as "1024x1024" | "1536x1024" | "1024x1536" | "auto",
    quality: imageQuality as "low" | "medium" | "high" | "auto"
  };
}

let cachedClient: OpenAI | null = null;

export function getOpenAI() {
  if (cachedClient) return cachedClient;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  cachedClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  return cachedClient;
}
