import { NextResponse } from "next/server";
import { toFile } from "openai";
import { touchConversation } from "@/lib/conversations";
import {
  getImageFilesForEdit,
  linkDocumentsToMessage,
  buildDocumentInlineUrl
} from "@/lib/documents";
import { createGeneratedImageDocument } from "@/lib/generated-image-storage";
import { scheduleImageStorage } from "@/lib/image-post-processing";
import { getOpenAI, getImageModelOptions, imageModel } from "@/lib/openai";
import { patchMessageMetadata, saveMessage } from "@/lib/memory";
import { createRequestProfiler } from "@/lib/request-profile";
import { getCurrentUserId } from "@/lib/current-user";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleAuthenticatedRoute(request, async () => {
  const profiler = createRequestProfiler();

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

    const userMessageId = await profiler.measure("databaseWriteMs", () =>
      saveMessage(
        "user",
        imagePrompt,
        {
          document_ids: sourceDocumentIds,
          intent: "image"
        },
        conversationId
      )
    );
    await profiler.measure("databaseWriteMs", () => touchConversation(conversationId));

    const inputImages = await getImageFilesForEdit(sourceDocumentIds);
    await profiler.measure("databaseWriteMs", () =>
      linkDocumentsToMessage({
        messageId: userMessageId,
        documentIds: sourceDocumentIds,
        relationType: "image_input"
      })
    );

    const modelOptions = getImageModelOptions();
    const editImages =
      inputImages.length > 0
        ? inputImages.length === 1
          ? [await toUploadable(inputImages[0])]
          : await Promise.all(inputImages.map(toUploadable))
        : [];

    const result = await profiler.measure("openAiRequestMs", () =>
      editImages.length > 0
        ? getOpenAI().images.edit({
            model: imageModel,
            prompt: imagePrompt,
            image: editImages.length === 1 ? editImages[0] : editImages,
            ...modelOptions
          })
        : getOpenAI().images.generate({
            model: imageModel,
            prompt: imagePrompt,
            ...modelOptions
          })
    );

    const imageBytes = await imageResponseToBuffer(result.data?.[0]);
    if (!imageBytes) {
      throw new Error("Image generation returned no image.");
    }

    const imageUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;
    const answer = "Готово.";

    let assistantMessageId: string | number | undefined;
    try {
      assistantMessageId = await profiler.measure("databaseWriteMs", () =>
        saveMessage(
          "assistant",
          answer,
          {
            reply_to_message_id: userMessageId,
            source_document_ids: sourceDocumentIds,
            intent: editImages.length > 0 ? "image_edit" : "image_generation",
            image_pending: true
          },
          conversationId
        )
      );
    } catch (saveError) {
      console.error("Generated image assistant message save failed:", saveError);
    }

    let documentId: string | number | null = null;

    if (assistantMessageId) {
      try {
        const { document } = await profiler.measure("databaseWriteMs", () =>
          createGeneratedImageDocument({
            prompt: imagePrompt,
            imageBytes,
            sourceDocumentIds
          })
        );
        documentId = document.id;

        await profiler.measure("databaseWriteMs", () =>
          patchMessageMetadata(assistantMessageId!, {
            generated_document_id: document.id,
            image_preview_url: buildDocumentInlineUrl(document.id),
            image_pending: true
          })
        );

        await profiler.measure("databaseWriteMs", () =>
          linkDocumentsToMessage({
            messageId: assistantMessageId,
            documentIds: [document.id],
            relationType: "generated_output"
          })
        );

        scheduleImageStorage({
          userId: getCurrentUserId(),
          conversationId,
          assistantMessageId,
          documentId: document.id,
          imageBytes
        });
      } catch (documentError) {
        console.error("Generated image document save failed:", documentError);
      }
    } else {
      console.error("Generated image was created but assistant message was not saved.");
    }

    profiler.finish({ conversationId, route: "images" });

    return NextResponse.json({
      answer,
      imageUrl,
      documentId,
      storagePath: null,
      storageSaved: false,
      storagePending: Boolean(documentId)
    });
  } catch (error) {
    profiler.finish({ route: "images" });
    const message =
      error instanceof Error ? error.message : "Unexpected image generation error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  });
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

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(image.url);
      if (!response.ok) {
        throw new Error(`Could not download generated image (${response.status}).`);
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  throw new Error(
    lastError instanceof Error ? lastError.message : "Could not download generated image."
  );
}
