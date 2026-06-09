import { buildDocumentInlineUrl } from "@/lib/documents";

export const HEAVY_METADATA_KEYS = [
  "inline_base64",
  "preview_thumbnail_base64",
  "preview_image_base64",
  "chat_image_preview"
] as const;

export function normalizeRecordMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function metadataHasHeavyPayload(metadata: Record<string, unknown>) {
  return HEAVY_METADATA_KEYS.some((key) => typeof metadata[key] === "string" && metadata[key].length > 0);
}

export function sanitizeDocumentMetadataForClient(metadata: Record<string, unknown>) {
  const safe = { ...metadata };
  for (const key of HEAVY_METADATA_KEYS) {
    delete safe[key];
  }
  return safe;
}

export function sanitizeMessageMetadataForClient(metadata: Record<string, unknown>) {
  return sanitizeDocumentMetadataForClient(metadata);
}

export function resolveStoredImageUrl(input: {
  generatedDocumentId?: string | number | null;
  imagePreviewUrl?: string | null;
  attachmentPreviewUrl?: string | null;
  attachmentFullUrl?: string | null;
}) {
  return (
    input.attachmentPreviewUrl ??
    input.attachmentFullUrl ??
    input.imagePreviewUrl ??
    (input.generatedDocumentId != null
      ? buildDocumentInlineUrl(input.generatedDocumentId)
      : null)
  );
}
