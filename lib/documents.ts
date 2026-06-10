import * as XLSX from "xlsx";
import { sanitizeDocumentMetadataForClient } from "@/lib/client-payload";
import { extractAndSaveDocumentMemory, getDocumentLinkedMemoryForPrompt, searchDocumentIdsByQuery } from "@/lib/document-memory";
import {
  parseSpreadsheetWorkbook,
  spreadsheetFileTypeFromName
} from "@/lib/spreadsheet-parse";
import { getSupabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/current-user";

export type StoredDocument = {
  id: string | number;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  extracted_text: string;
  summary: string | null;
  metadata: Record<string, unknown>;
};

export type DocumentAttachment = {
  id: string | number;
  fileName: string;
  fileType: string;
  fileSize: number;
  summary: string | null;
  metadata: Record<string, unknown>;
  previewUrl?: string | null;
  fullUrl?: string | null;
};

export type StoredImageFile = {
  fileName: string;
  fileType: string;
  buffer: Buffer;
};

import { buildDocumentDownloadUrl, buildDocumentInlineUrl } from "@/lib/document-urls";

export { buildDocumentInlineUrl };

const DOCUMENTS_BUCKET = "documents";
const MAX_EXTRACTED_TEXT = 80_000;
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_GENERATED_IMAGE_INLINE_BYTES = 3 * 1024 * 1024;

type UploadStorageOptions = {
  timeoutMs?: number;
  attempts?: number;
};
let pdfWorkerConfigured = false;

function sanitizeStorageText(text: string) {
  return text.replace(/\u0000/g, "");
}

function decodeTextBytes(bytes: Buffer) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return sanitizeStorageText(bytes.subarray(2).toString("utf16le"));
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.alloc(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1];
      swapped[index - 1] = bytes[index];
    }
    return sanitizeStorageText(swapped.toString("utf16le"));
  }

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return sanitizeStorageText(bytes.subarray(3).toString("utf8"));
  }

  const utf8 = bytes.toString("utf8");
  if (!utf8.includes("\u0000")) return utf8;

  return sanitizeStorageText(bytes.toString("utf16le"));
}

async function ensurePdfWorker() {
  if (pdfWorkerConfigured) return;

  const { PDFParse } = await import("pdf-parse");
  const { pathToFileURL } = await import("node:url");
  const path = await import("node:path");
  const workerPath = path.join(
    process.cwd(),
    "node_modules",
    "pdf-parse",
    "dist",
    "pdf-parse",
    "cjs",
    "pdf.worker.mjs"
  );

  PDFParse.setWorker(pathToFileURL(workerPath).href);
  pdfWorkerConfigured = true;
}

function encodeStoragePath(storagePath: string) {
  return storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getStorageObjectUrl(storagePath: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${DOCUMENTS_BUCKET}/${encodeStoragePath(storagePath)}`;
}

function getStorageUploadUrl(storagePath: string) {
  return getStorageObjectUrl(storagePath);
}

async function uploadStorageFile(
  storagePath: string,
  bytes: Buffer,
  contentType: string,
  options: UploadStorageOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const attempts = options.attempts ?? 3;

  const clientError = await uploadWithSupabaseClient(storagePath, bytes, contentType, attempts);
  if (!clientError) return;

  const restError = await uploadWithRestApi(storagePath, bytes, contentType, timeoutMs, attempts);
  if (!restError) return;

  const httpsError = await uploadWithNodeHttps(storagePath, bytes, contentType, timeoutMs);
  if (!httpsError) return;

  throw new Error(`Could not upload file to storage: ${httpsError || restError || clientError}`);
}

async function uploadWithSupabaseClient(
  storagePath: string,
  bytes: Buffer,
  contentType: string,
  attempts: number
) {
  const supabase = getSupabase();
  const body = new Uint8Array(bytes);
  let lastMessage = "unknown error";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(storagePath, body, {
        contentType,
        upsert: attempt > 0
      });
      if (!error) return null;
      lastMessage = error.message;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "upload failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  return lastMessage;
}

async function uploadWithRestApi(
  storagePath: string,
  bytes: Buffer,
  contentType: string,
  timeoutMs: number,
  attempts: number
) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = getStorageUploadUrl(storagePath);
  if (!url || !serviceRoleKey) {
    return "Supabase env is not configured.";
  }

  let lastMessage = "unknown error";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": contentType,
          "Content-Length": String(bytes.length),
          "x-upsert": attempt > 0 ? "true" : "false"
        },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (response.ok) return null;

      const payload = await response.text();
      lastMessage = payload || `HTTP ${response.status}`;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "upload failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }

  return lastMessage;
}

async function uploadWithNodeHttps(
  storagePath: string,
  bytes: Buffer,
  contentType: string,
  timeoutMs: number
) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const urlString = getStorageUploadUrl(storagePath);
  if (!urlString || !serviceRoleKey) {
    return "Supabase env is not configured.";
  }

  const { request: httpsRequest } = await import("node:https");
  const url = new URL(urlString);

  return new Promise<string | null>((resolve) => {
    const request = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": contentType,
          "Content-Length": String(bytes.length),
          "x-upsert": "true"
        },
        timeout: timeoutMs
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const status = response.statusCode ?? 500;
          if (status >= 200 && status < 300) {
            resolve(null);
            return;
          }
          const payload = Buffer.concat(chunks).toString("utf8");
          resolve(payload || `HTTP ${status}`);
        });
      }
    );

    request.on("error", (error) => {
      resolve(error instanceof Error ? error.message : "upload failed");
    });
    request.on("timeout", () => {
      request.destroy();
      resolve("upload timed out");
    });
    request.write(bytes);
    request.end();
  });
}

async function downloadStorageWithRestApi(storagePath: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = getStorageObjectUrl(storagePath);
  if (!url || !serviceRoleKey) return null;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`
      },
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.error("Storage REST download failed:", error);
    return null;
  }
}

async function downloadStorageWithNodeHttps(storagePath: string) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const urlString = getStorageObjectUrl(storagePath);
  if (!urlString || !serviceRoleKey) return null;

  const { request: httpsRequest } = await import("node:https");
  const url = new URL(urlString);

  return new Promise<Buffer | null>((resolve) => {
    const request = httpsRequest(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`
        },
        timeout: 60_000
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const status = response.statusCode ?? 500;
          if (status < 200 || status >= 300) {
            resolve(null);
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      }
    );

    request.on("error", () => resolve(null));
    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.end();
  });
}

async function downloadStorageFile(storagePath: string) {
  const supabase = getSupabase();

  try {
    const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(storagePath);
    if (!error && data) return Buffer.from(await data.arrayBuffer());
  } catch (error) {
    console.error("Storage client download failed:", error);
  }

  const restBuffer = await downloadStorageWithRestApi(storagePath);
  if (restBuffer) return restBuffer;

  return downloadStorageWithNodeHttps(storagePath);
}

function getDocumentImageBufferFromMetadata(
  metadata: Record<string, unknown>,
  fileType: string
) {
  const inlineBase64 =
    typeof metadata.inline_base64 === "string" ? metadata.inline_base64 : null;
  if (inlineBase64) {
    return {
      buffer: Buffer.from(inlineBase64, "base64"),
      fileType
    };
  }

  const thumbnailBase64 =
    typeof metadata.preview_thumbnail_base64 === "string"
      ? metadata.preview_thumbnail_base64
      : null;
  if (thumbnailBase64) {
    const thumbnailType =
      typeof metadata.preview_thumbnail_type === "string"
        ? metadata.preview_thumbnail_type
        : "image/jpeg";
    return {
      buffer: Buffer.from(thumbnailBase64, "base64"),
      fileType: thumbnailType
    };
  }

  return null;
}

function buildMetadataImageDataUrl(metadata: Record<string, unknown>, fileType: string) {
  const inlineBase64 =
    typeof metadata.inline_base64 === "string" ? metadata.inline_base64 : null;
  if (inlineBase64) {
    return `data:${fileType};base64,${inlineBase64}`;
  }

  const thumbnailBase64 =
    typeof metadata.preview_thumbnail_base64 === "string"
      ? metadata.preview_thumbnail_base64
      : null;
  if (thumbnailBase64) {
    const thumbnailType =
      typeof metadata.preview_thumbnail_type === "string"
        ? metadata.preview_thumbnail_type
        : "image/jpeg";
    return `data:${thumbnailType};base64,${thumbnailBase64}`;
  }

  return null;
}

function canStoreImageInline(fileType: string, bytes: Buffer) {
  return fileType.startsWith("image/") && bytes.length <= MAX_INLINE_IMAGE_BYTES;
}

function canStoreGeneratedImageInline(bytes: Buffer) {
  return bytes.length <= MAX_GENERATED_IMAGE_INLINE_BYTES;
}

export async function storedDocumentToAttachment(
  document: StoredDocument
): Promise<DocumentAttachment> {
  return toDocumentAttachment({
    id: document.id,
    file_name: document.file_name,
    file_type: document.file_type,
    file_size: document.file_size,
    storage_path: document.storage_path,
    summary: document.summary,
    metadata: document.metadata
  });
}

export async function processAndStoreFile(
  file: File,
  projectId?: string | number | null
): Promise<StoredDocument> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const fileType = file.type || inferTypeFromName(file.name);
  const storagePath = `uploads/${Date.now()}-${sanitizeFileName(file.name)}`;
  const extracted = await extractFileText(file, bytes);
  const extractedText = sanitizeStorageText(extracted.text);
  const summary = extracted.summary ?? summarizeExtractedText(extractedText);
  const supabase = getSupabase();
  let metadata: Record<string, unknown> = extracted.metadata;
  let savedStoragePath = storagePath;

  try {
    await uploadStorageFile(storagePath, bytes, fileType || "application/octet-stream");
  } catch (storageError) {
    if (!canStoreImageInline(fileType, bytes)) throw storageError;

    savedStoragePath = "";
    metadata = {
      ...metadata,
      inline_base64: bytes.toString("base64"),
      storage_fallback: "inline"
    };
    console.error("Storage upload failed, saved image inline:", storageError);
  }

  const insertPayload = {
    file_name: file.name,
    file_type: fileType,
    file_size: file.size,
    storage_path: savedStoragePath,
    extracted_text: extractedText,
    summary,
    metadata,
    user_id: getCurrentUserId(),
    ...(projectId ? { project_id: projectId } : {})
  };

  let { data, error } = await supabase.from("documents").insert(insertPayload).select("*").single();

  if (error && projectId && /project_id|foreign key|violates foreign key/i.test(error.message)) {
    const { project_id: _ignored, ...withoutProject } = insertPayload as Record<string, unknown> & {
      project_id?: string | number;
    };
    ({ data, error } = await supabase.from("documents").insert(withoutProject).select("*").single());
  }

  if (error) {
    throw new Error(`Could not save document metadata: ${error.message}`);
  }

  const stored = data as StoredDocument;
  void extractAndSaveDocumentMemory({
    id: stored.id,
    file_name: stored.file_name,
    file_type: stored.file_type,
    extracted_text: stored.extracted_text,
    summary: stored.summary,
    metadata: normalizeMetadata(stored.metadata)
  }).catch((memoryError) => {
    console.error("Document memory extraction failed:", memoryError);
  });

  return stored;
}

export async function uploadDocumentBytes(
  storagePath: string,
  bytes: Buffer,
  contentType: string,
  options: UploadStorageOptions = {}
) {
  return uploadStorageFile(storagePath, bytes, contentType, options);
}

export function mergeDocumentMetadata(
  current: unknown,
  patch: Record<string, unknown>
) {
  return { ...normalizeMetadata(current), ...patch };
}

export async function storeAudioFile(input: {
  file: File;
  transcript?: string;
}) {
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const storagePath = `audio/${Date.now()}-${sanitizeFileName(input.file.name)}`;
  const supabase = getSupabase();

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, {
      contentType: input.file.type || "audio/webm",
      upsert: false
    });

  if (uploadError) {
    throw new Error(`Could not upload audio file: ${uploadError.message}`);
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      file_name: input.file.name,
      file_type: input.file.type || "audio/webm",
      file_size: input.file.size,
      storage_path: storagePath,
      extracted_text: input.transcript ?? "",
      summary: input.transcript ? `Voice transcript: ${input.transcript.slice(0, 500)}` : null,
      metadata: {
        kind: "audio",
        has_transcript: Boolean(input.transcript)
      },
      user_id: getCurrentUserId()
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not save audio metadata: ${error.message}`);
  }

  return data as StoredDocument;
}

export async function linkDocumentsToMessage(input: {
  messageId?: string | number;
  documentIds: Array<string | number>;
  relationType?: string;
}) {
  if (!input.messageId || input.documentIds.length === 0) return;

  const supabase = getSupabase();
  const { error } = await supabase.from("message_documents").insert(
    input.documentIds.map((documentId) => ({
      message_id: Number(input.messageId),
      document_id: Number(documentId),
      relation_type: input.relationType ?? "attachment"
    }))
  );

  if (error) {
    console.error("Could not link documents to message:", error.message);
  }
}

export async function getDocumentDownloadPayload(documentId: string | number) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("documents")
    .select("file_name, file_type, storage_path, metadata")
    .eq("id", documentId)
    .eq("user_id", getCurrentUserId())
    .maybeSingle();

  if (error || !data) return null;

  const metadata = normalizeMetadata(data.metadata);
  const fileType = String(data.file_type ?? "application/octet-stream");
  const fromMetadata = getDocumentImageBufferFromMetadata(metadata, fileType);
  if (fromMetadata) {
    return {
      fileName: String(data.file_name ?? "file"),
      fileType: fromMetadata.fileType,
      buffer: fromMetadata.buffer
    };
  }

  const storagePath = String(data.storage_path ?? "");
  if (!storagePath) return null;

  const buffer = await downloadStorageFile(storagePath);

  if (!buffer) {
    console.error("Document download failed for storage path:", storagePath);
    return null;
  }

  return {
    fileName: String(data.file_name ?? "file"),
    fileType,
    buffer
  };
}

export async function getDocumentAttachments(ids: Array<string | number>) {
  if (ids.length === 0) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, file_type, file_size, storage_path, summary, metadata")
    .in("id", ids)
    .eq("user_id", getCurrentUserId());

  if (error) {
    console.error("Document attachment retrieval failed:", error.message);
    return [];
  }

  const sanitizedDocuments = (data ?? []).map((document) => ({
    ...document,
    metadata: sanitizeDocumentMetadataForClient(normalizeMetadata(document.metadata))
  }));

  return sanitizedDocuments.map(toDocumentAttachment);
}

export async function getDocumentsForMessages(
  messages: Array<{ id: string | number; metadata?: unknown }>
) {
  if (messages.length === 0) return new Map<string, DocumentAttachment[]>();

  const byMessage = new Map<string, DocumentAttachment[]>();
  const idsFromMetadata = new Map<string, Array<string | number>>();

  for (const message of messages) {
    const metadata = message.metadata as {
      document_ids?: Array<string | number>;
      generated_document_id?: string | number;
    } | null;
    const ids = [
      ...(metadata?.document_ids ?? []),
      ...(metadata?.generated_document_id ? [metadata.generated_document_id] : [])
    ];
    if (ids.length > 0) idsFromMetadata.set(String(message.id), ids);
  }

  if (idsFromMetadata.size === 0) {
    return byMessage;
  }

  const supabase = getSupabase();
  const messageIds = messages.map((message) => Number(message.id)).filter(Number.isFinite);

  const linked = messageIds.length
    ? await supabase
        .from("message_documents")
        .select("message_id, document_id")
        .in("message_id", messageIds)
    : { data: [], error: null };

  if (linked.error) {
    console.error("Message document links failed:", linked.error.message);
  }

  const docIdsByMessage = new Map<string, Set<string | number>>();
  for (const [messageId, ids] of idsFromMetadata) {
    docIdsByMessage.set(messageId, new Set(ids));
  }

  for (const link of linked.data ?? []) {
    const messageId = String(link.message_id);
    const set = docIdsByMessage.get(messageId) ?? new Set<string | number>();
    set.add(link.document_id);
    docIdsByMessage.set(messageId, set);
  }

  const allDocumentIds = [...new Set([...docIdsByMessage.values()].flatMap((set) => [...set]))];
  const attachments = await getDocumentAttachments(allDocumentIds);
  const attachmentById = new Map(attachments.map((attachment) => [String(attachment.id), attachment]));

  for (const [messageId, documentIds] of docIdsByMessage) {
    byMessage.set(
      messageId,
      [...documentIds]
        .map((documentId) => attachmentById.get(String(documentId)))
        .filter((attachment): attachment is DocumentAttachment => Boolean(attachment))
    );
  }

  return byMessage;
}

export async function getDocumentsForPrompt(ids: Array<string | number>) {
  if (ids.length === 0) return "";

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, file_type, extracted_text, summary, metadata")
    .in("id", ids)
    .eq("user_id", getCurrentUserId());

  if (error) {
    console.error("Document retrieval failed:", error.message);
    return "";
  }

  return formatDocumentsForPrompt(data ?? []);
}

export async function searchDocumentsForPrompt(
  query: string,
  options: { excludeIds?: Array<string | number>; limit?: number } = {}
) {
  const terms = buildDocumentSearchTerms(query);
  if (terms.length === 0) return "";

  const supabase = getSupabase();
  const excludeIds = new Set((options.excludeIds ?? []).map(String));
  const limit = options.limit ?? 3;
  const seen = new Set<string>();
  const matched: Array<Record<string, unknown>> = [];

  for (const term of terms) {
    if (matched.length >= limit) break;

    const pattern = `%${term}%`;
    const { data, error } = await supabase
      .from("documents")
      .select("id, file_name, file_type, extracted_text, summary, metadata")
      .eq("user_id", getCurrentUserId())
      .or(`file_name.ilike.${pattern},summary.ilike.${pattern},extracted_text.ilike.${pattern}`)
      .order("created_at", { ascending: false })
      .limit(limit * 2);

    if (error) {
      console.error("Document search failed:", error.message);
      continue;
    }

    for (const document of data ?? []) {
      const id = String(document.id);
      if (excludeIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      matched.push(document);
      if (matched.length >= limit) break;
    }
  }

  return formatDocumentsForPrompt(matched);
}

export async function buildDocumentsPromptForChat(
  attachedDocumentIds: Array<string | number>,
  userMessage: string
) {
  const searchedIds = await searchDocumentIdsByQuery(userMessage, 5);
  const allDocumentIds = [
    ...new Set([...attachedDocumentIds, ...searchedIds].map(String))
  ].map((id) => id);

  const [attachedPrompt, searchedPrompt, linkedMemory] = await Promise.all([
    getDocumentsForPrompt(attachedDocumentIds),
    searchDocumentsForPrompt(userMessage, { excludeIds: attachedDocumentIds, limit: 3 }),
    getDocumentLinkedMemoryForPrompt(allDocumentIds, userMessage)
  ]);

  return [attachedPrompt, searchedPrompt, linkedMemory].filter(Boolean).join("\n\n---\n\n");
}

function formatDocumentsForPrompt(documents: Array<Record<string, unknown>>) {
  return documents
    .map((document) => {
      const extractedText = String(document.extracted_text ?? "");
      const isImage = extractedText.startsWith("[Image file:");
      const metadata = normalizeMetadata(document.metadata);
      const spreadsheetHint =
        metadata.kind === "spreadsheet"
          ? `Spreadsheet metadata: sheets=${JSON.stringify(metadata.sheets ?? [])}; non_empty_cell_count=${Array.isArray(metadata.non_empty_cells) ? metadata.non_empty_cells.length : 0}; detected_tables=${Array.isArray(metadata.detected_tables) ? metadata.detected_tables.length : 0}`
          : null;

      return [
        `Document: ${document.file_name} (${document.file_type})`,
        document.summary ? `Summary: ${document.summary}` : null,
        spreadsheetHint,
        isImage ? "Image attachment: available as vision input for the model." : "Extracted content (use exact cell addresses and values; do not invent headers or columns):",
        isImage ? null : extractedText.slice(0, MAX_EXTRACTED_TEXT)
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}

function buildDocumentSearchTerms(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const terms = normalized
    .split(/[^a-zа-яё0-9]+/i)
    .filter((term) => term.length >= 2)
    .slice(0, 5);

  const numericTerms = normalized.match(/\d{2,}/g) ?? [];

  const documentHints = [
    "таблиц",
    "excel",
    "xlsx",
    "xls",
    "файл",
    "лист",
    "строк",
    "колон",
    "spreadsheet",
    "sheet"
  ];
  const asksAboutFiles = documentHints.some((hint) => normalized.includes(hint));

  if (asksAboutFiles) {
    return [...new Set([...terms, ...numericTerms, "sheet", "лист"])].slice(0, 8);
  }

  return [...new Set([...terms, ...numericTerms])].slice(0, 6);
}

export async function getImageInputsForVision(ids: Array<string | number>) {
  const imageFiles = await getImageFiles(ids);
  return imageFiles.map((image) => ({
    fileName: image.fileName,
    fileType: image.fileType,
    dataUrl: `data:${image.fileType};base64,${image.buffer.toString("base64")}`
  }));
}

export async function getImageFilesForEdit(ids: Array<string | number>) {
  return getImageFiles(ids);
}

async function getImageFiles(ids: Array<string | number>): Promise<StoredImageFile[]> {
  if (ids.length === 0) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("documents")
    .select("file_name, file_type, storage_path, metadata")
    .in("id", ids)
    .eq("user_id", getCurrentUserId());

  if (error) {
    console.error("Image document retrieval failed:", error.message);
    return [];
  }

  const images: StoredImageFile[] = [];
  for (const document of data ?? []) {
    const metadata = normalizeMetadata(document.metadata);
    const fileType = String(document.file_type ?? "");
    if (!isImageDocument(fileType, metadata)) continue;

    const inlineBase64 =
      typeof metadata.inline_base64 === "string" ? metadata.inline_base64 : null;
    if (inlineBase64) {
      images.push({
        fileName: String(document.file_name ?? "image.png"),
        fileType: fileType || "image/png",
        buffer: Buffer.from(inlineBase64, "base64")
      });
      continue;
    }

    const storagePath = String(document.storage_path ?? "");
    if (!storagePath) continue;

    const downloaded = await supabase.storage.from(DOCUMENTS_BUCKET).download(storagePath);

    if (downloaded.error) {
      console.error("Image download failed:", downloaded.error.message);
      continue;
    }

    images.push({
      fileName: String(document.file_name ?? "image.png"),
      fileType: fileType || "image/png",
      buffer: Buffer.from(await downloaded.data.arrayBuffer())
    });
  }

  return images;
}

function toDocumentAttachment(document: Record<string, unknown>): DocumentAttachment {
  const fileType = String(document.file_type ?? "application/octet-stream");
  const metadata = normalizeMetadata(document.metadata);
  const isImage = isImageDocument(fileType, metadata);
  const documentId = document.id as string | number | undefined;
  const fileUrl =
    documentId != null ? buildDocumentDownloadUrl(documentId, isImage) : null;

  return {
    id: documentId as string | number,
    fileName: String(document.file_name ?? "file"),
    fileType,
    fileSize: Number(document.file_size ?? 0),
    summary: document.summary ? String(document.summary) : null,
    metadata: sanitizeDocumentMetadataForClient(metadata),
    previewUrl: isImage ? fileUrl : null,
    fullUrl: fileUrl
  };
}

type ExtractedFileContent = {
  text: string;
  metadata: Record<string, unknown>;
  summary?: string | null;
};

async function extractFileText(file: File, bytes: Buffer): Promise<ExtractedFileContent> {
  const lowerName = file.name.toLowerCase();
  const type = file.type || inferTypeFromName(file.name);

  if (
    lowerName.endsWith(".csv") ||
    type === "text/csv" ||
    type === "application/csv"
  ) {
    return extractCsv(bytes, lowerName, file.name);
  }

  if (
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    (type === "application/vnd.ms-excel" && lowerName.endsWith(".xls")) ||
    type.includes("spreadsheet")
  ) {
    return extractSpreadsheet(bytes, lowerName, file.name);
  }

  if (type === "application/pdf" || lowerName.endsWith(".pdf")) {
    return extractPdf(bytes);
  }

  if (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lowerName.endsWith(".docx")
  ) {
    return extractDocx(bytes);
  }

  if (isTextLike(type, lowerName)) {
    const text = decodeTextBytes(bytes).slice(0, MAX_EXTRACTED_TEXT);
    return {
      text,
      metadata: { kind: "text", file_type: lowerName.split(".").pop() ?? "txt" },
      summary: summarizeExtractedText(text)
    };
  }

  if (type.startsWith("image/")) {
    return {
      text: `[Image file: ${file.name}.]`,
      metadata: { kind: "image", vision_ready: true }
    };
  }

  throw new Error(`Этот формат пока не поддержан: ${file.name}`);
}

async function extractPdf(bytes: Buffer) {
  await ensurePdfWorker();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bytes) });

  try {
    const parsed = await parser.getText();
    const text = sanitizeStorageText(String(parsed.text ?? "")).slice(0, MAX_EXTRACTED_TEXT);
    return {
      text,
      metadata: {
        kind: "pdf",
        file_type: "pdf",
        page_count: parsed.pages?.length
      },
      summary: summarizeExtractedText(text)
    };
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(bytes: Buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  const text = String(result.value ?? "").slice(0, MAX_EXTRACTED_TEXT);
  return {
    text,
    metadata: {
      kind: "docx",
      file_type: "docx",
      warnings: result.messages?.map((message) => message.message).slice(0, 10) ?? []
    },
    summary: summarizeExtractedText(text)
  };
}

function extractCsv(bytes: Buffer, lowerName: string, fileName: string): ExtractedFileContent {
  const decoded = decodeTextBytes(bytes);
  try {
    const workbook = XLSX.read(decoded, { type: "string", raw: false });
    const parsed = parseSpreadsheetWorkbook(workbook, fileName, "csv");
    return {
      text: parsed.text,
      metadata: parsed.metadata,
      summary: parsed.summary
    };
  } catch {
    return {
      text: decoded.slice(0, MAX_EXTRACTED_TEXT),
      metadata: { kind: "spreadsheet", file_type: "csv" },
      summary: summarizeExtractedText(decoded)
    };
  }
}

function extractSpreadsheet(bytes: Buffer, lowerName: string, fileName: string): ExtractedFileContent {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const fileType = spreadsheetFileTypeFromName(lowerName);
  const parsed = parseSpreadsheetWorkbook(workbook, fileName, fileType);
  return {
    text: parsed.text,
    metadata: parsed.metadata,
    summary: parsed.summary
  };
}

function summarizeExtractedText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact || compact.startsWith("[Image file:")) return null;
  return compact.slice(0, 500);
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

function inferTypeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function isTextLike(type: string, lowerName: string) {
  return (
    type.startsWith("text/") ||
    /\.(txt|md|csv|json|xml|html|css|js|ts|tsx|jsx|py|sql|log)$/i.test(lowerName)
  );
}

function isImageDocument(fileType: string, metadata?: { kind?: string } | null) {
  return (
    fileType.startsWith("image/") ||
    metadata?.kind === "image" ||
    metadata?.kind === "generated_image"
  );
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}
