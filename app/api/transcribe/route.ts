import { NextResponse } from "next/server";
import { storeAudioFile } from "@/lib/documents";
import { transcribeAudio } from "@/lib/transcription";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Audio file is required." },
        { status: 400 }
      );
    }

    const text = await transcribeAudio(audio);
    const document = await storeAudioFile({ file: audio, transcript: text });
    return NextResponse.json({ text, documentId: document.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected transcription error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
