import { NextResponse } from "next/server";
import { createConversation, listConversations } from "@/lib/conversations";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const projectId = url.searchParams.get("projectId");
    return NextResponse.json(
      await listConversations(search, projectId ? projectId : undefined)
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected conversations error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const projectId =
      body && typeof body === "object" && body.projectId != null ? body.projectId : undefined;
    const conversation = await createConversation(undefined, projectId);
    return NextResponse.json({ conversation });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected conversation create error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
