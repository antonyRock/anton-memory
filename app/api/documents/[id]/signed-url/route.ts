import { NextResponse } from "next/server";
import { getDocumentSignedDownloadUrl } from "@/lib/documents";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleAuthenticatedRoute(request, async (user) => {
    const { id } = await context.params;
    const signed = await getDocumentSignedDownloadUrl(id, user.id);
    if (!signed) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json(signed);
  });
}
