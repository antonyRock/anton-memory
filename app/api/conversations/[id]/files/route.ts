import { NextResponse } from "next/server";
import { listConversationDocuments } from "@/lib/file-navigation";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const kindParam = url.searchParams.get("kind");
    const kind =
      kindParam === "files" || kindParam === "images" || kindParam === "all" ? kindParam : "all";

    return NextResponse.json(await listConversationDocuments(id, { search, kind }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected conversation files error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
