import { NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/projects";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleAuthenticatedRoute(request, async () => {
    const projects = await listProjects();
    return NextResponse.json({ projects });
  });
}

export async function POST(request: Request) {
  return handleAuthenticatedRoute(request, async () => {
    const body = await request.json().catch(() => ({}));
    const project = await createProject({
      title: typeof body?.title === "string" ? body.title : undefined,
      description: typeof body?.description === "string" ? body.description : body?.description
    });
    return NextResponse.json({ project });
  });
}
