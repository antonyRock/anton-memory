import OpenAI from "openai";

export const chatModel = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
export const transcriptionModel =
  process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";

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
