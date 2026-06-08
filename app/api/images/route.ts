import { NextResponse } from "next/server";
import { toFile } from "openai";
import { touchConversation } from "@/lib/conversations";
import {
  getImageFilesForEdit,
  linkDocumentsToMessage,
  storeGeneratedImage
} from "@/lib/documents";
import { getOpenAI, imageModel } from "@/lib/openai";
import { saveMessage } from "@/lib/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { prompt, documentIds, conversationId } = (await request.json()) as {
      prompt?: string;
      documentIds?: Array<string | number>;
      conversationId?: string | number;
    };
    const imagePrompt = prompt?.trim();
    const sourceDocumentIds = documentIds ?? [];

    if (!imagePrompt) {
      return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
    }

    const userMessageId = await saveMessage(
      "user",
      imagePrompt,
      {
        document_ids: sourceDocumentIds,
        intent: "image"
      },
      conversationId
    );
    await touchConversation(conversationId);
    await linkDocumentsToMessage({
      messageId: userMessageId,
      documentIds: sourceDocumentIds,
      relationType: "image_input"
    });

    const inputImages = await getImageFilesForEdit(sourceDocumentIds);
    const result =
      inputImages.length > 0
        ? await getOpenAI().images.edit({
            model: imageModel,
            prompt: imagePrompt,
            image:
              inputImages.length === 1
                ? await toUploadable(inputImages[0])
                : await Promise.all(inputImages.map(toUploadable)),
            size: "1024x1024"
          })
        : await getOpenAI().images.generate({
            model: imageModel,
            prompt: imagePrompt,
            size: "1024x1024"
          });

    const imageBytes = await imageResponseToBuffer(result.data?.[0]);
    if (!imageBytes) {
      throw new Error("Image generation returned no image.");
    }

    const document = await storeGeneratedImage({
      prompt: imagePrompt,
      imageBytes,
      sourceDocumentIds
    });

    const imageUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;
    const answer = "Готово.";

    const assistantMessageId = await saveMessage(
      "assistant",
      answer,
      {
        reply_to_message_id: userMessageId,
        generated_document_id: document.id,
        source_document_ids: sourceDocumentIds,
        intent: inputImages.length > 0 ? "image_edit" : "image_generation"
      },
      conversationId
    );
    await touchConversation(conversationId);
    await linkDocumentsToMessage({
      messageId: assistantMessageId,
      documentIds: [document.id],
      relationType: "generated_output"
    });

    return NextResponse.json({
      answer,
      imageUrl,
      documentId: document.id,
      storagePath: document.storage_path
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected image generation error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function toUploadable(image: {
  fileName: string;
  fileType: string;
  buffer: Buffer;
}) {
  return toFile(image.buffer, image.fileName, { type: image.fileType });
}

async function imageResponseToBuffer(image?: { b64_json?: string; url?: string }) {
  if (!image) return null;
  if (image.b64_json) return Buffer.from(image.b64_json, "base64");
  if (!image.url) return null;

  const response = await fetch(image.url);
  if (!response.ok) {
    throw new Error("Could not download generated image.");
  }
  return Buffer.from(await response.arrayBuffer());
}
