import { NextResponse } from "next/server";
import { assignConversationToProject } from "@/lib/projects";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();

    if (!("projectId" in body)) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    const conversation = await assignConversationToProject(
      id,
      body.projectId === null || body.projectId === undefined ? null : body.projectId
    );
    return NextResponse.json({ conversation });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected conversation update error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
