import OpenAI from "openai";

export const chatModel = process.env.OPENAI_CHAT_MODEL ?? "gpt-5.5";
export const transcriptionModel =
  process.env.OPENAI_TRANSCRIBE_MODEL ??
  process.env.OPENAI_TRANSCRIPTION_MODEL ??
  "gpt-4o-transcribe";
export const transcriptionFallbackModel =
  process.env.OPENAI_TRANSCRIBE_FALLBACK_MODEL ?? "gpt-4o-mini-transcribe";
export const imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
export const imageSize = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024";
export const imageQuality = process.env.OPENAI_IMAGE_QUALITY ?? "medium";

const REASONING_CHAT_MODEL = /^(gpt-5|o[0-9])/i;
const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

export function isReasoningChatModel(model = chatModel) {
  return REASONING_CHAT_MODEL.test(model);
}

export function getChatCompletionParams(options: { temperature?: number } = {}) {
  if (isReasoningChatModel()) {
    const effort = process.env.OPENAI_REASONING_EFFORT?.trim();
    if (effort && REASONING_EFFORTS.has(effort)) {
      return { reasoning_effort: effort as "low" | "medium" | "high" };
    }
    return {};
  }

  if (typeof options.temperature === "number") {
    return { temperature: options.temperature };
  }

  return {};
}

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
