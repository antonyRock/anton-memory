import { NextResponse } from "next/server";
import { processAndStoreFile, storedDocumentToAttachment } from "@/lib/documents";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleAuthenticatedRoute(request, async () => {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((file): file is File => file instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    const projectIdRaw = formData.get("projectId");
    const projectId =
      typeof projectIdRaw === "string" && projectIdRaw.trim() ? projectIdRaw.trim() : null;

    const documents = [];
    for (const file of files) {
      documents.push(await processAndStoreFile(file, projectId));
    }
    const attachments = await Promise.all(documents.map(storedDocumentToAttachment));

    if (attachments.length !== files.length) {
      return NextResponse.json(
        { error: "Файл сохранён, но не удалось подготовить ответ для интерфейса." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      documents: attachments
    });
  });
}
