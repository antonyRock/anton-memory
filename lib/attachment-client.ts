import { buildDocumentInlineUrl, buildDocumentDownloadUrl } from "@/lib/document-urls";
import { isImageDocument, resolveDocumentMimeType } from "@/lib/mime-types";

export type ClientAttachment = {
  id?: string | number;
  batchId?: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  status?: "uploading" | "ready" | "error";
  error?: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  previewUrl?: string | null;
  fullUrl?: string | null;
};

export function normalizeClientAttachment(raw: Record<string, unknown>): ClientAttachment {
  const fileName = String(raw.fileName ?? raw.file_name ?? "file");
  const fileType = resolveDocumentMimeType(String(raw.fileType ?? raw.file_type ?? ""), fileName);
  const metadata =
    typeof raw.metadata === "object" && raw.metadata != null && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : {};
  const id =
    (raw.id as string | number | undefined) ??
    (raw.document_id as string | number | undefined) ??
    (raw.documentId as string | number | undefined);
  const isImage = isImageDocument({ fileType, fileName, metadata });
  const inlineUrl = id != null && isImage ? buildDocumentInlineUrl(id) : null;
  const previewUrl =
    (typeof raw.previewUrl === "string" ? raw.previewUrl : null) ??
    (typeof raw.preview_url === "string" ? raw.preview_url : null) ??
    inlineUrl;
  const fullUrl =
    (typeof raw.fullUrl === "string" ? raw.fullUrl : null) ??
    (typeof raw.full_url === "string" ? raw.full_url : null) ??
    (id != null ? buildDocumentDownloadUrl(id, false) : previewUrl);

  return {
    id,
    batchId: typeof raw.batchId === "string" ? raw.batchId : undefined,
    fileName,
    fileType,
    fileSize: Number(raw.fileSize ?? raw.file_size ?? 0),
    status: raw.status as ClientAttachment["status"],
    error: typeof raw.error === "string" ? raw.error : undefined,
    summary:
      typeof raw.summary === "string" || raw.summary === null
        ? (raw.summary as string | null)
        : undefined,
    metadata,
    previewUrl,
    fullUrl
  };
}

export function isImageAttachment(attachment: Pick<ClientAttachment, "fileName" | "fileType" | "metadata">) {
  return isImageDocument({
    fileType: attachment.fileType,
    fileName: attachment.fileName,
    metadata: attachment.metadata ?? null
  });
}

function isDataOrBlobUrl(url: string) {
  return url.startsWith("data:") || url.startsWith("blob:");
}

export function resolveAttachmentPreviewUrl(
  attachment: Pick<ClientAttachment, "id" | "fileName" | "fileType" | "metadata" | "previewUrl" | "fullUrl">
) {
  if (!isImageAttachment(attachment)) return null;

  const inlineUrl = attachment.id != null ? buildDocumentInlineUrl(attachment.id) : null;
  const previewUrl = attachment.previewUrl ?? null;

  if (previewUrl && isDataOrBlobUrl(previewUrl)) return previewUrl;
  if (previewUrl) return previewUrl;
  return inlineUrl ?? attachment.fullUrl ?? null;
}

export function resolveAttachmentFullImageUrl(
  attachment: Pick<ClientAttachment, "id" | "fileName" | "fileType" | "metadata" | "previewUrl" | "fullUrl">
) {
  if (!isImageAttachment(attachment)) return null;

  const inlineUrl = attachment.id != null ? buildDocumentInlineUrl(attachment.id) : null;
  return inlineUrl ?? attachment.fullUrl ?? attachment.previewUrl ?? null;
}

export function resolveAttachmentDownloadUrl(
  attachment: Pick<ClientAttachment, "id" | "fileName" | "fileType" | "metadata" | "fullUrl" | "previewUrl">
) {
  if (attachment.id == null) {
    return attachment.fullUrl ?? attachment.previewUrl ?? null;
  }

  return buildDocumentDownloadUrl(attachment.id, false);
}

export function resolveAttachmentAssetSources(
  attachment: Pick<ClientAttachment, "id" | "fileName" | "fileType" | "metadata" | "previewUrl" | "fullUrl">,
  mode: "preview" | "full" | "download"
) {
  const previewUrl = resolveAttachmentPreviewUrl(attachment);
  const fullUrl = resolveAttachmentFullImageUrl(attachment);
  const downloadUrl = resolveAttachmentDownloadUrl(attachment);

  if (mode === "download") {
    return resolveAttachmentDownloadSources(attachment);
  }

  const ordered = mode === "full" ? [fullUrl, previewUrl] : [previewUrl, fullUrl];
  return [...new Set(ordered.filter((url): url is string => typeof url === "string" && url.length > 0))];
}

export function resolveAttachmentDownloadSources(
  attachment: Pick<ClientAttachment, "id" | "fileName" | "fileType" | "metadata" | "previewUrl" | "fullUrl">
) {
  const sources: string[] = [];
  const downloadUrl = resolveAttachmentDownloadUrl(attachment);
  const inlineUrl =
    attachment.id != null && isImageAttachment(attachment)
      ? buildDocumentInlineUrl(attachment.id)
      : null;

  if (downloadUrl && shouldAuthFetchAssetUrl(downloadUrl)) {
    sources.push(downloadUrl);
  }

  const fullUrl = attachment.fullUrl ?? null;
  if (
    fullUrl &&
    fullUrl !== downloadUrl &&
    shouldAuthFetchAssetUrl(fullUrl)
  ) {
    sources.push(fullUrl);
  }

  if (inlineUrl && inlineUrl !== downloadUrl && inlineUrl !== fullUrl) {
    sources.push(inlineUrl);
  }

  const previewUrl = attachment.previewUrl ?? null;
  if (previewUrl?.startsWith("blob:")) {
    sources.push(previewUrl);
  }

  return [...new Set(sources)];
}

export function shouldAuthFetchAssetUrl(url: string) {
  if (url.startsWith("blob:") || url.startsWith("data:")) return false;
  return url.startsWith("/api/") || url.startsWith("http://") || url.startsWith("https://");
}
