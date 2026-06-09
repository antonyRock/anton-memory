import { NextResponse } from "next/server";
import { createConversation, listConversations } from "@/lib/conversations";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAuthenticatedRoute(request, async () => {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const projectId = url.searchParams.get("projectId");
    return NextResponse.json(
      await listConversations(search, projectId ? projectId : undefined)
    );
  });
}

export async function POST(request: Request) {
  return handleAuthenticatedRoute(request, async () => {
    const body = await request.json().catch(() => ({}));
    const projectId =
      body && typeof body === "object" && body.projectId != null ? body.projectId : undefined;
    const conversation = await createConversation(undefined, projectId);
    return NextResponse.json({ conversation });
  });
}
