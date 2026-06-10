import { NextResponse } from "next/server";
import { getDocumentAttachments } from "@/lib/documents";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleAuthenticatedRoute(request, async (_user) => {
    const { id } = await context.params;
    const attachments = await getDocumentAttachments([id]);
    const file = attachments[0] ?? null;
    if (!file) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    return NextResponse.json({ file });
  });
}
