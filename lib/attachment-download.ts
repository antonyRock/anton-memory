import {
  resolveAttachmentDownloadSources,
  shouldAuthFetchAssetUrl,
  type ClientAttachment
} from "@/lib/attachment-client";
import {
  sanitizeDownloadFileName,
  toAsciiDownloadFileName
} from "@/lib/download-filename";

function triggerBlobDownload(blobUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = sanitizeDownloadFileName(fileName);
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function downloadFromDataOrBlobUrl(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Download failed: empty file");
  const blobUrl = URL.createObjectURL(blob);
  try {
    triggerBlobDownload(blobUrl, fileName);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

async function downloadFromRemoteUrl(
  url: string,
  fileName: string,
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
) {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("Download failed: empty file");
  }

  const contentType = response.headers.get("content-type") ?? blob.type;
  const typedBlob =
    contentType && contentType !== blob.type
      ? new Blob([blob], { type: contentType })
      : blob;
  const blobUrl = URL.createObjectURL(typedBlob);
  try {
    triggerBlobDownload(blobUrl, fileName);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

async function downloadFromSignedUrl(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = toAsciiDownloadFileName(fileName);
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function downloadViaSignedUrlEndpoint(
  attachment: ClientAttachment,
  options: {
    authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    authUrl: (url: string) => string;
  }
) {
  if (attachment.id == null) return false;

  const response = await options.authFetch(
    options.authUrl(`/api/documents/${attachment.id}/signed-url`)
  );
  if (!response.ok) return false;

  const data = (await response.json()) as { url?: string; fileName?: string; downloadFileName?: string };
  if (!data.url) return false;

  await downloadFromSignedUrl(
    data.url,
    data.downloadFileName ?? data.fileName ?? attachment.fileName
  );
  return true;
}

export async function downloadClientAttachment(
  attachment: ClientAttachment,
  options: {
    authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    authUrl: (url: string) => string;
  }
) {
  const sources = resolveAttachmentDownloadSources(attachment);
  let lastError: unknown = null;

  for (const source of sources) {
    try {
      if (!shouldAuthFetchAssetUrl(source)) {
        await downloadFromDataOrBlobUrl(source, attachment.fileName);
        return;
      }

      await downloadFromRemoteUrl(
        options.authUrl(source),
        attachment.fileName,
        options.authFetch
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  if (await downloadViaSignedUrlEndpoint(attachment, options)) {
    return;
  }

  if (sources.length === 0 && attachment.id != null) {
    if (await downloadViaSignedUrlEndpoint(attachment, options)) {
      return;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Download failed");
}
