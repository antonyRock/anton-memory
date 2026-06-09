export const VOICE_RECORDING_DB_NAME = "tbrain-voice-recordings";
export const VOICE_RECORDING_STORE_NAME = "pending";

/** OpenAI Transcriptions API file size limit. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const AUDIO_SIZE_WARN_BYTES = Math.floor(MAX_AUDIO_BYTES * 0.8);
export const AUDIO_SIZE_CRITICAL_BYTES = Math.floor(MAX_AUDIO_BYTES * 0.95);

export type RecordingSizeStatus = "ok" | "near" | "critical" | "over";

const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/aac",
  "audio/ogg;codecs=opus"
];

export function pickRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  for (const candidate of RECORDING_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

export function buildRecordingFileName(mimeType: string) {
  if (mimeType.includes("mp4") || mimeType.includes("aac")) return "voice.m4a";
  if (mimeType.includes("ogg")) return "voice.ogg";
  return "voice.webm";
}

export function getBlobPartSize(part: BlobPart) {
  if (part instanceof Blob) return part.size;
  if (typeof part === "string") return part.length;
  if (part instanceof ArrayBuffer) return part.byteLength;
  return part.byteLength;
}

export function getRecordingPartsSize(parts: BlobPart[]) {
  return parts.reduce((total, part) => total + getBlobPartSize(part), 0);
}

export function getRecordingSizeStatus(bytes: number): RecordingSizeStatus {
  if (bytes >= MAX_AUDIO_BYTES) return "over";
  if (bytes >= AUDIO_SIZE_CRITICAL_BYTES) return "critical";
  if (bytes >= AUDIO_SIZE_WARN_BYTES) return "near";
  return "ok";
}

export function formatRecordingDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatAudioSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} КБ`;
  }
  return `${bytes} Б`;
}

export function isAudioTooLarge(bytes: number) {
  return bytes > MAX_AUDIO_BYTES;
}

export function recordingSizeLimitMessage(bytes: number) {
  return `Запись слишком большая (${formatAudioSize(bytes)}). Лимит OpenAI — ${formatAudioSize(MAX_AUDIO_BYTES)}. Завершите запись раньше или разделите на несколько сообщений.`;
}

export function recordingSizeApproachingMessage(bytes: number) {
  return `Приближаетесь к лимиту OpenAI: ${formatAudioSize(bytes)} из ${formatAudioSize(MAX_AUDIO_BYTES)}. Скоро нажмите Send.`;
}

export function recordingSizeCriticalMessage(bytes: number) {
  return `Почти лимит OpenAI: ${formatAudioSize(bytes)} из ${formatAudioSize(MAX_AUDIO_BYTES)}. Завершите запись сейчас.`;
}

export function recordingStoppedAtSizeLimitMessage(bytes: number) {
  return `Запись остановлена: достигнут лимит OpenAI (${formatAudioSize(MAX_AUDIO_BYTES)}). Сейчас ${formatAudioSize(bytes)} — распознавание недоступно. Удалите запись и начните новую короче.`;
}
