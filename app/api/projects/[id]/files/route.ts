import { NextResponse } from "next/server";
import { listProjectDocuments } from "@/lib/file-navigation";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return handleAuthenticatedRoute(request, async (_user) => {
    const { id } = await context.params;
    const url = new URL(request.url);
    const search = url.searchParams.get("search") ?? "";
    const kindParam = url.searchParams.get("kind");
    const kind =
      kindParam === "files" || kindParam === "images" || kindParam === "all" ? kindParam : "all";

    return NextResponse.json(await listProjectDocuments(id, { search, kind }));
  });
}
