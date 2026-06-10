import { NextResponse } from "next/server";
import { updateConversationPinned, updateConversationTitle } from "@/lib/conversations";
import { assignConversationToProject } from "@/lib/projects";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  return handleAuthenticatedRoute(request, async (_user) => {
    const { id } = await context.params;
    const body = await request.json();

    if (typeof body.title === "string") {
      const conversation = await updateConversationTitle(id, body.title);
      return NextResponse.json({ conversation });
    }

    if (typeof body.pinned === "boolean") {
      const conversation = await updateConversationPinned(id, body.pinned);
      return NextResponse.json({ conversation });
    }

    if ("projectId" in body) {
      const conversation = await assignConversationToProject(
        id,
        body.projectId === null || body.projectId === undefined ? null : body.projectId
      );
      return NextResponse.json({ conversation });
    }

    return NextResponse.json({ error: "title, pinned, or projectId is required." }, { status: 400 });
  });
}
