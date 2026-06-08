import { NextResponse } from "next/server";
import { getConversationMessages } from "@/lib/conversations";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const messages = await getConversationMessages(id);
    return NextResponse.json({ messages });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected messages load error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
