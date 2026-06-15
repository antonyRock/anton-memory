import "server-only";

import { scheduleChatPostProcessing } from "@/lib/chat-post-processing";
import { extractAndSaveChatMemory } from "@/lib/chat-memory-extraction";
import { getShortTermContext, touchConversation } from "@/lib/conversations";
import { buildDocumentsPromptForChat, linkDocumentsToMessage } from "@/lib/documents";
import { getCurrentUserId } from "@/lib/current-user";
import {
  formatMemoryForPrompt,
  retrieveMemory,
  saveExplicitProfileFromMessage,
  saveMessage
} from "@/lib/memory";
import {
  chatModel,
  getChatCompletionParams,
  getOpenAI,
  resolveChatModel
} from "@/lib/openai";
import type { VoiceTranscriptMeta } from "@/lib/transcription";

export async function generateTelegramChatReply(input: {
  conversationId: string | number;
  userMessage: string;
  documentIds?: Array<string | number>;
  skipUserMessage?: boolean;
  existingUserMessageId?: string | number;
  voiceTranscript?: VoiceTranscriptMeta;
}) {
  const userMessage = input.userMessage.trim();
  if (!userMessage) throw new Error("Empty message.");

  const documentIds = input.documentIds ?? [];
  const conversationId = input.conversationId;
  const selectedChatModel = resolveChatModel("smart");

  const [memory, documentsPrompt, shortTermMessages] = await Promise.all([
    retrieveMemory(userMessage, conversationId),
    buildDocumentsPromptForChat(documentIds, userMessage),
    getShortTermContext(conversationId)
  ]);

  let userMessageId = input.existingUserMessageId;
  if (!input.skipUserMessage) {
    userMessageId = await saveMessage(
      "user",
      userMessage,
      {
        document_ids: documentIds,
        source: input.voiceTranscript ? "voice" : "telegram",
        ...(input.voiceTranscript
          ? {
              raw_transcript: input.voiceTranscript.rawTranscript,
              cleaned_transcript: input.voiceTranscript.cleanedTranscript,
              transcript_status: input.voiceTranscript.transcriptStatus
            }
          : {})
      },
      conversationId
    );

    await saveExplicitProfileFromMessage(userMessage, userMessageId);

    await linkDocumentsToMessage({
      messageId: userMessageId,
      documentIds,
      relationType: "attachment"
    });
    await touchConversation(conversationId);
  }

  const memoryPrompt = formatMemoryForPrompt(memory);
  const completion = await getOpenAI().chat.completions.create({
    model: selectedChatModel,
    ...getChatCompletionParams({ temperature: 0.5, model: selectedChatModel }),
    stream: false,
    messages: [
      {
        role: "system",
        content: [
          "You are tBrain — a personal AI assistant with long-term memory.",
          "The user sent this message from Telegram. Reply concisely and usefully.",
          "Respond in the user's language.",
          "Do not use Markdown decoration unless sharing code.",
          `Model: ${selectedChatModel} (${chatModel}).`
        ].join(" ")
      },
      {
        role: "system",
        content: `Retrieved memory:\n${memoryPrompt}`
      },
      ...(documentsPrompt
        ? [{ role: "system" as const, content: `File context:\n${documentsPrompt}` }]
        : []),
      ...shortTermMessages,
      { role: "user", content: userMessage }
    ]
  });

  const answer = String(completion.choices[0]?.message?.content ?? "").trim();
  if (!answer) {
    return { answer: "Не удалось получить ответ.", userMessageId };
  }

  const assistantMessageId = await saveMessage(
    "assistant",
    answer,
    {
      reply_to_message_id: userMessageId,
      document_ids: documentIds,
      source: "telegram"
    },
    conversationId
  );

  await linkDocumentsToMessage({
    messageId: assistantMessageId,
    documentIds,
    relationType: "used_in_answer"
  });
  await touchConversation(conversationId);

  scheduleChatPostProcessing({
    userId: getCurrentUserId(),
    conversationId,
    userMessage,
    assistantAnswer: answer,
    userMessageId,
    runMemoryExtraction: extractAndSaveChatMemory
  });

  return { answer, userMessageId };
}
