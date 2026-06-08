import { NextResponse } from "next/server";
import { processAndStoreFile } from "@/lib/documents";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files").filter((file): file is File => file instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    const documents = [];
    for (const file of files) {
      documents.push(await processAndStoreFile(file));
    }

    return NextResponse.json({
      documents: documents.map((document) => ({
        id: document.id,
        fileName: document.file_name,
        fileType: document.file_type,
        fileSize: document.file_size,
        summary: document.summary,
        metadata: document.metadata
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected file upload error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
