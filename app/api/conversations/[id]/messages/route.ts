import { NextResponse } from "next/server";
import { getConversationMessages } from "@/lib/conversations";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return handleAuthenticatedRoute(request, async (_user) => {
    const { id } = await context.params;
    const messages = await getConversationMessages(id);
    return NextResponse.json({ messages });
  });
}
