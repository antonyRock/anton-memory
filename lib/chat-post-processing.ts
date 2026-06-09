import { after } from "next/server";
import { maybeGenerateConversationTitle } from "@/lib/conversations";
import {
  logBackgroundMemoryExtractionFailed,
  logBackgroundMemoryExtractionFinished,
  logBackgroundMemoryExtractionStarted,
  type RequestProfileContext
} from "@/lib/request-profile";

type ChatPostProcessingInput = {
  conversationId?: string | number;
  userMessage: string;
  assistantAnswer: string;
  userMessageId?: string | number;
  runMemoryExtraction: (
    userMessage: string,
    assistantAnswer: string,
    sourceMessageId?: string | number
  ) => Promise<void>;
};

export function scheduleChatPostProcessing(input: ChatPostProcessingInput) {
  const context: RequestProfileContext = {
    conversationId: input.conversationId,
    route: "chat"
  };

  const task = async () => {
    logBackgroundMemoryExtractionStarted(context);
    const startedAt = performance.now();

    try {
      await maybeGenerateConversationTitle({
        conversationId: input.conversationId,
        userMessage: input.userMessage,
        assistantAnswer: input.assistantAnswer
      });
      await input.runMemoryExtraction(
        input.userMessage,
        input.assistantAnswer,
        input.userMessageId
      );
      logBackgroundMemoryExtractionFinished(performance.now() - startedAt, context);
    } catch (error) {
      logBackgroundMemoryExtractionFailed(error, context);
    }
  };

  try {
    after(task);
  } catch {
    void task();
  }
}
