export const VOICE_RECORDING_DB_NAME = "tbrain-voice-recordings";
export const VOICE_RECORDING_STORE_NAME = "pending";

export const MAX_RECORDING_MS = 3 * 60 * 1000;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

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
