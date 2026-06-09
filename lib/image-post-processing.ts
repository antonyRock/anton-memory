import { after } from "next/server";
import { touchConversation } from "@/lib/conversations";
import { linkDocumentsToMessage } from "@/lib/documents";
import { persistGeneratedImageBytes } from "@/lib/generated-image-storage";
import { patchMessageMetadata } from "@/lib/memory";
import { runWithRequestUser } from "@/lib/request-context";

type ImagePostProcessingInput = {
  userId: string;
  conversationId?: string | number;
  assistantMessageId: string | number;
  documentId: string | number;
  imageBytes: Buffer;
};

export function scheduleImageStorage(input: ImagePostProcessingInput) {
  const task = async () => {
    await runWithRequestUser(input.userId, async () => {
    const startedAt = performance.now();
    console.log(
      `[tBrain background] image storage started conversation=${input.conversationId ?? "unknown"} document=${input.documentId}`
    );

    try {
      await persistGeneratedImageBytes({
        documentId: input.documentId,
        imageBytes: input.imageBytes
      });

      await patchMessageMetadata(input.assistantMessageId, {
        generated_document_id: input.documentId,
        image_preview_url: `/api/documents/${input.documentId}/download?inline=1`,
        image_pending: false
      });

      await linkDocumentsToMessage({
        messageId: input.assistantMessageId,
        documentIds: [input.documentId],
        relationType: "generated_output"
      });
      await touchConversation(input.conversationId);

      console.log(
        `[tBrain background] image storage finished: ${Math.round(performance.now() - startedAt)} ms conversation=${input.conversationId ?? "unknown"} document=${input.documentId}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[tBrain background] image storage failed: ${message} conversation=${input.conversationId ?? "unknown"} document=${input.documentId}`
      );
    }
    });
  };

  try {
    after(task);
  } catch {
    void task();
  }
}
