import { NextResponse } from "next/server";
import { MAX_AUDIO_BYTES, formatAudioSize } from "@/lib/voice-recording";
import { transcribeAudioWithCleanup } from "@/lib/transcription";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleAuthenticatedRoute(request, async (_user) => {
    const formData = await request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return NextResponse.json(
        { error: "Нужен аудиофайл в поле audio." },
        { status: 400 }
      );
    }

    if (audio.size === 0) {
      return NextResponse.json(
        { error: "Пустой аудиофайл. Запишите сообщение ещё раз." },
        { status: 400 }
      );
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        {
          error: `Файл слишком большой (${formatAudioSize(audio.size)}). Максимум ${formatAudioSize(MAX_AUDIO_BYTES)}.`
        },
        { status: 413 }
      );
    }

    const result = await transcribeAudioWithCleanup(audio);
    return NextResponse.json({
      text: result.text,
      rawTranscript: result.rawTranscript,
      cleanedTranscript: result.cleanedTranscript,
      appliedCorrections: result.appliedCorrections,
      transcriptStatus: result.transcriptStatus
    });
  });
}
