import { NextResponse } from "next/server";
import {
  assignConversationToProject,
  deleteProject,
  getProjectView,
  updateProject
} from "@/lib/projects";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return handleAuthenticatedRoute(request, async () => {
    const { id } = await context.params;
    return NextResponse.json(await getProjectView(id));
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleAuthenticatedRoute(request, async () => {
    const { id } = await context.params;
    const body = await request.json();

    if (body.title != null) {
      const project = await updateProject(id, { title: String(body.title) });
      return NextResponse.json({ project });
    }

    if (body.conversationId == null) {
      return NextResponse.json(
        { error: "title or conversationId is required." },
        { status: 400 }
      );
    }

    const conversation = await assignConversationToProject(
      body.conversationId,
      body.projectId === null ? null : body.projectId ?? id
    );
    return NextResponse.json({ conversation });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return handleAuthenticatedRoute(request, async () => {
    const { id } = await context.params;
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  });
}
