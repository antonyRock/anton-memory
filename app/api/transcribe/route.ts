import { NextResponse } from "next/server";
import { MAX_AUDIO_BYTES, formatAudioSize } from "@/lib/voice-recording";
import { transcribeAudio } from "@/lib/transcription";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
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

    const text = await transcribeAudio(audio);
    return NextResponse.json({ text });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Не удалось распознать аудио.";

    const status = message.toLowerCase().includes("сеть")
      ? 503
      : message.toLowerCase().includes("слишком большой")
        ? 413
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
