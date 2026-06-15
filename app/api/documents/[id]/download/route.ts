import { getDocumentDownloadPayload } from "@/lib/documents";
import { toAsciiDownloadFileName } from "@/lib/download-filename";
import { resolveDocumentMimeType } from "@/lib/mime-types";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

function contentDisposition(fileName: string, inline: boolean) {
  const asciiName = toAsciiDownloadFileName(fileName);
  const encoded = encodeURIComponent(fileName);
  const mode = inline ? "inline" : "attachment";
  return `${mode}; filename="${asciiName.replace(/"/g, "")}"; filename*=UTF-8''${encoded}`;
}

function resolveDownloadContentType(fileName: string, fileType: string) {
  return resolveDocumentMimeType(fileType, fileName);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleAuthenticatedRoute(request, async (user) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const inline = url.searchParams.get("inline") === "1";
    const payload = await getDocumentDownloadPayload(id, user.id, {
      allowPreviewFallback: inline
    });
    if (!payload) {
      return new Response(JSON.stringify({ error: "Document not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

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
  });
}
