import { NextResponse } from "next/server";
import { createConversation, listConversations } from "@/lib/conversations";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    return NextResponse.json(await listConversations(search));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected conversations error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const conversation = await createConversation();
    return NextResponse.json({ conversation });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected conversation create error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
