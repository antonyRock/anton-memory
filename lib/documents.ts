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

const MAX_EXTRACTED_TEXT = 80_000;
const MAX_ROWS_PER_SHEET = 200;

export async function processAndStoreFile(file: File): Promise<StoredDocument> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const storagePath = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const extracted = await extractFileText(file, bytes);
  const summary = summarizeExtractedText(extracted.text);
  const supabase = getSupabase();

  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });

  if (uploadError) {
    throw new Error(`Could not upload file to storage: ${uploadError.message}`);
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      file_name: file.name,
      file_type: file.type || inferTypeFromName(file.name),
      file_size: file.size,
      storage_path: storagePath,
      extracted_text: extracted.text,
      summary,
      metadata: extracted.metadata
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not save document metadata: ${error.message}`);
  }

  return data as StoredDocument;
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
    .map((document) =>
      [
        `Document: ${document.file_name} (${document.file_type})`,
        document.summary ? `Summary: ${document.summary}` : null,
        "Extracted content:",
        String(document.extracted_text ?? "").slice(0, MAX_EXTRACTED_TEXT)
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n---\n\n");
}

export async function getImageInputsForVision(ids: Array<string | number>) {
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

  const images = [];
  for (const document of data ?? []) {
    const metadata = document.metadata as { kind?: string } | null;
    const fileType = String(document.file_type ?? "");
    if (metadata?.kind !== "image" && !fileType.startsWith("image/")) continue;

    const downloaded = await supabase.storage
      .from("documents")
      .download(String(document.storage_path));

    if (downloaded.error) {
      console.error("Image download failed:", downloaded.error.message);
      continue;
    }

    const buffer = Buffer.from(await downloaded.data.arrayBuffer());
    images.push({
      fileName: String(document.file_name ?? "image"),
      fileType: fileType || "image/png",
      dataUrl: `data:${fileType || "image/png"};base64,${buffer.toString("base64")}`
    });
  }

  return images;
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

  if (isTextLike(type, lowerName)) {
    return {
      text: bytes.toString("utf8").slice(0, MAX_EXTRACTED_TEXT),
      metadata: { kind: "text" }
    };
  }

  if (type.startsWith("image/")) {
    return {
      text: `[Image file: ${file.name}. The image is stored, but vision analysis is handled in chat requests later.]`,
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
      sheets: sheets.map((sheet) => ({
        name: sheet.sheetName,
        headers: sheet.headers,
        row_count: sheet.rowCount
      }))
    }
  };
}

async function extractPdf(bytes: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  const parsed = await parser.getText();
  return {
    text: String(parsed.text ?? "").slice(0, MAX_EXTRACTED_TEXT),
    metadata: {
      kind: "pdf",
      page_count: parsed.pages?.length
    }
  };
}

function summarizeExtractedText(text: string) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.slice(0, 500);
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function inferTypeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  return "application/octet-stream";
}

function isTextLike(type: string, lowerName: string) {
  return (
    type.startsWith("text/") ||
    /\.(txt|md|csv|json|xml|html|css|js|ts|tsx|jsx|py|sql|log)$/i.test(lowerName)
  );
}
