import { NextResponse } from "next/server";
import {
  assignConversationToProject,
  deleteProject,
  getProjectView,
  updateProject
} from "@/lib/projects";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getProjectView(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected project error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected project update error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteProject(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected project delete error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
