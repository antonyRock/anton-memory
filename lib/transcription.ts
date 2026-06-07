import { getOpenAI, transcriptionModel } from "@/lib/openai";

export async function transcribeAudio(file: File) {
  const transcription = await getOpenAI().audio.transcriptions.create({
    file,
    model: transcriptionModel
  });

  return transcription.text;
}
