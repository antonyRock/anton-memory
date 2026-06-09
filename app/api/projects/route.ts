import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ projects: await listProjects() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected projects error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = await createProject({
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : null
    });
    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected project create error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
