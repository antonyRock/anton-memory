import { NextResponse } from "next/server";
import { getDocumentAttachments } from "@/lib/documents";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const attachments = await getDocumentAttachments([id]);
    const file = attachments[0] ?? null;
    if (!file) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    return NextResponse.json({ file });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected document error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
