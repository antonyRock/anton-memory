import OpenAI from "openai";

export const chatModel = process.env.OPENAI_CHAT_MODEL ?? "gpt-5.5";
export type ChatMode = "fast" | "smart" | "analytics";
const CHAT_MODES = new Set<ChatMode>(["fast", "smart", "analytics"]);
const chatModelFast = process.env.OPENAI_CHAT_MODEL_FAST?.trim() || null;
const chatModelSmart = process.env.OPENAI_CHAT_MODEL_SMART?.trim() || null;
const chatModelAnalytics = process.env.OPENAI_CHAT_MODEL_ANALYTICS?.trim() || null;
export const transcriptionModel =
  process.env.OPENAI_TRANSCRIBE_MODEL ??
  process.env.OPENAI_TRANSCRIPTION_MODEL ??
  "gpt-4o-transcribe";
export const transcriptionFallbackModel =
  process.env.OPENAI_TRANSCRIBE_FALLBACK_MODEL ?? "gpt-4o-mini-transcribe";
export const transcriptCleanupModel =
  process.env.OPENAI_TRANSCRIPT_CLEANUP_MODEL ?? "gpt-4o-mini";
export const imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
export const imageSize = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024";
export const imageQuality = process.env.OPENAI_IMAGE_QUALITY ?? "medium";

const REASONING_CHAT_MODEL = /^(gpt-5|o[0-9])/i;
const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

export function isReasoningChatModel(model = chatModel) {
  return REASONING_CHAT_MODEL.test(model);
}

export function normalizeChatMode(value: unknown): ChatMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CHAT_MODES.has(normalized as ChatMode) ? (normalized as ChatMode) : null;
}

export const CHAT_MODE_LABELS: Record<ChatMode, string> = {
  fast: "Быстро",
  smart: "Умно",
  analytics: "Аналитика"
};

const CHAT_MODE_FALLBACK_MODELS: Record<ChatMode, string> = {
  fast: "gpt-4o-mini",
  smart: "gpt-5.4",
  analytics: chatModel
};

export function getChatModeLabel(mode?: unknown) {
  const normalizedMode = normalizeChatMode(mode);
  return normalizedMode ? CHAT_MODE_LABELS[normalizedMode] : null;
}

export function resolveChatModel(mode?: unknown) {
  const normalizedMode = normalizeChatMode(mode);
  if (normalizedMode === "fast") return chatModelFast ?? CHAT_MODE_FALLBACK_MODELS.fast;
  if (normalizedMode === "smart") return chatModelSmart ?? CHAT_MODE_FALLBACK_MODELS.smart;
  if (normalizedMode === "analytics") {
    return chatModelAnalytics ?? CHAT_MODE_FALLBACK_MODELS.analytics;
  }
  return chatModel;
}

export function getChatCompletionParams(options: { temperature?: number; model?: string } = {}) {
  if (isReasoningChatModel(options.model ?? chatModel)) {
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
