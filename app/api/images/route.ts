import { NextResponse } from "next/server";
import { getOpenAI, imageModel } from "@/lib/openai";
import { saveMessage } from "@/lib/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { prompt } = (await request.json()) as { prompt?: string };
    const imagePrompt = prompt?.trim();

    if (!imagePrompt) {
      return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
    }

    await saveMessage("user", imagePrompt);

    const result = await getOpenAI().images.generate({
      model: imageModel,
      prompt: imagePrompt,
      size: "1024x1024"
    });

    const b64 = result.data?.[0]?.b64_json;
    const url = result.data?.[0]?.url;
    const imageUrl = b64 ? `data:image/png;base64,${b64}` : url;

    if (!imageUrl) {
      throw new Error("Image generation returned no image.");
    }

    const answer = "Готово.";
    await saveMessage("assistant", `${answer} Сгенерировано изображение по запросу: ${imagePrompt}`);

    return NextResponse.json({ answer, imageUrl });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected image generation error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
