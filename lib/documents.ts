import * as XLSX from "xlsx";
import { getSupabase } from "@/lib/supabase";

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

const DOCUMENTS_BUCKET = "documents";
const MAX_EXTRACTED_TEXT = 80_000;
const MAX_ROWS_PER_SHEET = 200;
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
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

async function uploadStorageFile(storagePath: string, bytes: Buffer, contentType: string) {
  const clientError = await uploadWithSupabaseClient(storagePath, bytes, contentType);
  if (!clientError) return;

  const restError = await uploadWithRestApi(storagePath, bytes, contentType);
  if (!restError) return;

  throw new Error(`Could not upload file to storage: ${restError || clientError}`);
}

async function uploadWithSupabaseClient(
  storagePath: string,
  bytes: Buffer,
  contentType: string
) {
  const supabase = getSupabase();
  const body = new Uint8Array(bytes);
  let lastMessage = "unknown error";

  for (let attempt = 0; attempt < 3; attempt += 1) {
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

async function uploadWithRestApi(storagePath: string, bytes: Buffer, contentType: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return "Supabase env is not configured.";
  }

  const encodedPath = storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${DOCUMENTS_BUCKET}/${encodedPath}`;
  let lastMessage = "unknown error";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": contentType,
          "x-upsert": attempt > 0 ? "true" : "false"
        },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(30_000)
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

function canStoreImageInline(fileType: string, bytes: Buffer) {
  return fileType.startsWith("image/") && bytes.length <= MAX_INLINE_IMAGE_BYTES;
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
  const summary = summarizeExtractedText(extractedText);
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

  return data as StoredDocument;
}

export async function storeGeneratedImage(input: {
  prompt: string;
  imageBytes: Buffer;
  sourceDocumentIds?: Array<string | number>;
}) {
  const storagePath = `generated/${Date.now()}-${randomId()}.png`;
  await uploadStorageFile(storagePath, input.imageBytes, "image/png");

  const summary = `Generated image for prompt: ${input.prompt.slice(0, 500)}`;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("documents")
    .insert({
      file_name: `generated-${Date.now()}.png`,
      file_type: "image/png",
      file_size: input.imageBytes.length,
      storage_path: storagePath,
      extracted_text: summary,
      summary,
      metadata: {
        kind: "generated_image",
        prompt: input.prompt,
        source_document_ids: input.sourceDocumentIds ?? []
      }
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not save generated image metadata: ${error.message}`);
  }

  return data as StoredDocument;
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
      }
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

export async function getDocumentAttachments(ids: Array<string | number>) {
  if (ids.length === 0) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, file_type, file_size, storage_path, summary, metadata")
    .in("id", ids);

  if (error) {
    console.error("Document attachment retrieval failed:", error.message);
    return [];
  }

  return Promise.all((data ?? []).map(toDocumentAttachment));
}

export async function getDocumentsForMessages(
  messages: Array<{ id: string | number; metadata?: unknown }>
) {
  if (messages.length === 0) return new Map<string, DocumentAttachment[]>();

  const supabase = getSupabase();
  const messageIds = messages.map((message) => Number(message.id)).filter(Number.isFinite);
  const byMessage = new Map<string, DocumentAttachment[]>();
  const idsFromMetadata = new Map<string, Array<string | number>>();

  for (const message of messages) {
    const metadata = message.metadata as { document_ids?: Array<string | number>; generated_document_id?: string | number } | null;
    const ids = [
      ...(metadata?.document_ids ?? []),
      ...(metadata?.generated_document_id ? [metadata.generated_document_id] : [])
    ];
    if (ids.length > 0) idsFromMetadata.set(String(message.id), ids);
  }

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
    .in("id", ids);

  if (error) {
    console.error("Document retrieval failed:", error.message);
    return "";
  }

  return (data ?? [])
    .map((document) => {
      const extractedText = String(document.extracted_text ?? "");
      const isImage = extractedText.startsWith("[Image file:");
      return [
        `Document: ${document.file_name} (${document.file_type})`,
        document.summary ? `Summary: ${document.summary}` : null,
        isImage ? "Image attachment: available as vision input for the model." : "Extracted content:",
        isImage ? null : extractedText.slice(0, MAX_EXTRACTED_TEXT)
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
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
    .in("id", ids);

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

async function toDocumentAttachment(document: Record<string, unknown>): Promise<DocumentAttachment> {
  const fileType = String(document.file_type ?? "application/octet-stream");
  const metadata = normalizeMetadata(document.metadata);
  const storagePath = String(document.storage_path ?? "");
  const isImage = isImageDocument(fileType, metadata);
  const inlineBase64 =
    typeof metadata.inline_base64 === "string" ? metadata.inline_base64 : null;
  const inlineDataUrl =
    isImage && inlineBase64 ? `data:${fileType};base64,${inlineBase64}` : null;
  const signedUrl =
    isImage && storagePath && !inlineDataUrl ? await createSignedUrl(storagePath) : null;

  return {
    id: document.id as string | number,
    fileName: String(document.file_name ?? "file"),
    fileType,
    fileSize: Number(document.file_size ?? 0),
    summary: document.summary ? String(document.summary) : null,
    metadata,
    previewUrl: inlineDataUrl ?? signedUrl,
    fullUrl: inlineDataUrl ?? signedUrl
  };
}

async function createSignedUrl(storagePath: string) {
  const supabase = getSupabase();
  // Temporary view link; a fresh one is created each time messages are loaded.
  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24);

  if (error) {
    console.error("Could not create signed URL:", error.message);
    return null;
  }

  return data.signedUrl;
}

async function extractFileText(file: File, bytes: Buffer) {
  const type = file.type || inferTypeFromName(file.name);
  const lowerName = file.name.toLowerCase();

  if (
    type.includes("spreadsheet") ||
    type.includes("excel") ||
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls")
  ) {
    return extractSpreadsheet(bytes);
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
    return {
      text: decodeTextBytes(bytes).slice(0, MAX_EXTRACTED_TEXT),
      metadata: { kind: "text" }
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

function extractSpreadsheet(bytes: Buffer) {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const sheets = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: "",
      raw: false
    });
    const compactRows = rows.slice(0, MAX_ROWS_PER_SHEET);
    const headers = rows[0] ? Object.keys(rows[0]) : [];

    return {
      sheetName,
      headers,
      rowCount: rows.length,
      rows: compactRows
    };
  });

  return {
    text: JSON.stringify({ sheets }, null, 2).slice(0, MAX_EXTRACTED_TEXT),
    metadata: {
      kind: "spreadsheet",
      sheet_count: sheets.length,
      row_count: sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0),
      sheets: sheets.map((sheet) => ({
        name: sheet.sheetName,
        headers: sheet.headers,
        row_count: sheet.rowCount
      }))
    }
  };
}

async function extractPdf(bytes: Buffer) {
  await ensurePdfWorker();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bytes) });

  try {
    const parsed = await parser.getText();
    return {
      text: sanitizeStorageText(String(parsed.text ?? "")).slice(0, MAX_EXTRACTED_TEXT),
      metadata: {
        kind: "pdf",
        page_count: parsed.pages?.length
      }
    };
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(bytes: Buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  return {
    text: String(result.value ?? "").slice(0, MAX_EXTRACTED_TEXT),
    metadata: {
      kind: "docx",
      warnings: result.messages?.map((message) => message.message).slice(0, 10) ?? []
    }
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
