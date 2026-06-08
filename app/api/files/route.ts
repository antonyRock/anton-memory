import { NextResponse } from "next/server";
import { getDocumentAttachments, processAndStoreFile } from "@/lib/documents";

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
    const attachments = await getDocumentAttachments(documents.map((document) => document.id));

    return NextResponse.json({
      documents: attachments
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected file upload error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
