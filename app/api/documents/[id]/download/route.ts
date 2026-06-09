import { getDocumentDownloadPayload } from "@/lib/documents";

export const runtime = "nodejs";

function contentDisposition(fileName: string, inline: boolean) {
  const encoded = encodeURIComponent(fileName);
  const mode = inline ? "inline" : "attachment";
  return `${mode}; filename="${fileName.replace(/"/g, "")}"; filename*=UTF-8''${encoded}`;
}

function resolveDownloadContentType(fileName: string, fileType: string) {
  const normalized = fileType.trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return fileType;

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  return fileType || "application/octet-stream";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const payload = await getDocumentDownloadPayload(id);
    if (!payload) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const url = new URL(request.url);
    const inline = url.searchParams.get("inline") === "1";
    const contentType = resolveDownloadContentType(payload.fileName, payload.fileType);
    const body = new Uint8Array(payload.buffer);

    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(body.byteLength),
        "Content-Disposition": contentDisposition(payload.fileName, inline),
        "Cache-Control":
          inline && contentType.startsWith("image/")
            ? "private, max-age=3600"
            : "private, no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected document download error.";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
