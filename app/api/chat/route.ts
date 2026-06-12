import { NextResponse } from "next/server";
import {
  getConversationLinksContext,
  getGlobalLinksContext,
  getShortTermContext,
  getReferencedConversationsContext,
  mergeShortTermContext,
  touchConversation,
  type ChatContextMessage
} from "@/lib/conversations";
import { extractChatIdsFromText } from "@/lib/chat-links";
import { chatModel, getChatCompletionParams, getOpenAI } from "@/lib/openai";
import {
  buildDocumentsPromptForChat,
  getImageInputsForVision,
  getRecentConversationImageInputs,
  linkDocumentsToMessage
} from "@/lib/documents";
import {
  detectNameFromTexts,
  formatMemoryForPrompt,
  getStoredUserName,
  isUserIdentityQuery,
  resolveUserNameFromMemory,
  retrieveMemory,
  saveExplicitProfileFromMessage,
  saveExtractedMemory,
  saveMessage
} from "@/lib/memory";
import type { MemoryExtraction } from "@/lib/memory";
import { scheduleChatPostProcessing } from "@/lib/chat-post-processing";
import { createRequestProfiler } from "@/lib/request-profile";
import { runWithRequestUser } from "@/lib/request-context";
import { ApiUnauthorizedError, resolveRequestUserId } from "@/lib/server-auth";
import { getCurrentUserId } from "@/lib/current-user";

export const runtime = "nodejs";
export const maxDuration = 60;
const LINK_QUERY_PATTERN = /(ссылк|url|urls|сайт|site|http|https|линк|link)/i;
const LINK_RESOURCE_QUERY_PATTERN =
  /(покажи|покаж|дай|скинь|кинь|где|нужн|открой|find|show|give|send).*(форм|заказ|терминал|sql|сервис|workspace|forge|helicopter)|(?:форм|заказ|терминал|sql|сервис|workspace|forge|helicopter).*(покажи|покаж|дай|скинь|кинь|где|нужн|открой|find|show|give|send)/i;
const SAVE_LINK_INTENT_PATTERN =
  /(запомн|сохрани|зафиксир|добавь в память|remember|save|store|pin).*(ссыл|url|link)|(?:ссыл|url|link).*(запомн|сохрани|зафиксир|remember|save|store|pin)/i;
const LINK_EXTRACTION_VISION_MODEL = process.env.OPENAI_LINK_EXTRACTION_MODEL ?? "gpt-4o-mini";

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await resolveRequestUserId(request);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    throw error;
  }

  let payload: {
    message?: string;
    documentIds?: Array<string | number>;
    conversationId?: string | number;
    recentMessages?: ChatContextMessage[];
    referencedConversationIds?: Array<string | number>;
    replyTo?: {
      role: "user" | "assistant";
      content: string;
    };
    voiceTranscript?: {
      rawTranscript: string;
      cleanedTranscript: string | null;
      transcriptStatus: "raw" | "cleaned" | "cleanup_failed";
    };
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userMessage = payload.message?.trim();
  const attachedDocumentIds = payload.documentIds ?? [];
  const conversationId = payload.conversationId;
  const replyTo =
    payload.replyTo &&
    (payload.replyTo.role === "user" || payload.replyTo.role === "assistant") &&
    String(payload.replyTo.content ?? "").trim()
      ? {
          role: payload.replyTo.role,
          content: String(payload.replyTo.content).trim().slice(0, 4000)
        }
      : null;
  const voiceTranscript =
    payload.voiceTranscript &&
    typeof payload.voiceTranscript.rawTranscript === "string" &&
    payload.voiceTranscript.rawTranscript.trim()
      ? {
          rawTranscript: payload.voiceTranscript.rawTranscript.trim().slice(0, 20000),
          cleanedTranscript:
            typeof payload.voiceTranscript.cleanedTranscript === "string" &&
            payload.voiceTranscript.cleanedTranscript.trim()
              ? payload.voiceTranscript.cleanedTranscript.trim().slice(0, 20000)
              : null,
          transcriptStatus:
            payload.voiceTranscript.transcriptStatus === "cleaned" ||
            payload.voiceTranscript.transcriptStatus === "cleanup_failed" ||
            payload.voiceTranscript.transcriptStatus === "raw"
              ? payload.voiceTranscript.transcriptStatus
              : ("raw" as const)
        }
      : null;
  const clientRecentMessages = (payload.recentMessages ?? []).filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      String(message.content ?? "").trim()
  );

  if (!userMessage) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const referencedConversationIds = [
    ...new Set(
      [...(payload.referencedConversationIds ?? []), ...extractChatIdsFromText(userMessage)]
        .map((id) => String(id))
        .filter(Boolean)
    )
  ].filter((id) => !conversationId || String(id) !== String(conversationId));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      await runWithRequestUser(userId, async () => {
      const profiler = createRequestProfiler();

      try {
        const identityQuery = isUserIdentityQuery(userMessage);
        const shouldLookupLinks = needsLinkLookup(userMessage);
        const [memory, documentsPrompt, imageInputs, dbShortTermMessages, referencedChatsPrompt, storedUserName, conversationLinksPrompt, globalLinksPrompt] =
          await profiler.measure("memoryRetrievalMs", () =>
            Promise.all([
              retrieveMemory(userMessage, conversationId),
              buildDocumentsPromptForChat(attachedDocumentIds, userMessage),
              getImageInputsForVision(attachedDocumentIds),
              getShortTermContext(conversationId),
              getReferencedConversationsContext(referencedConversationIds),
              identityQuery ? getStoredUserName() : Promise.resolve(null),
              shouldLookupLinks
                ? getConversationLinksContext(conversationId)
                : Promise.resolve(""),
              shouldLookupLinks
                ? getGlobalLinksContext({ excludeConversationId: conversationId })
                : Promise.resolve("")
            ])
          );
        let imageLinkHints = "";
        const asksForLinks = shouldLookupLinks;
        if (asksForLinks && conversationId) {
          imageLinkHints = await profiler.measure("memoryRetrievalMs", async () => {
            const conversationImages = await getRecentConversationImageInputs(conversationId, {
              messageLimit: 120,
              imageLimit: 4
            });
            if (conversationImages.length === 0) return "";
            return await extractUrlsFromImageInputs(conversationImages);
          });
        }

        const shortTermMessages = mergeShortTermContext(dbShortTermMessages, clientRecentMessages);
        const memoryPrompt = formatMemoryForPrompt(memory);
        const knownName =
          storedUserName ??
          resolveUserNameFromMemory(memory) ??
          detectNameFromTexts([
            ...shortTermMessages.map((message) => message.content),
            userMessage,
            ...memory.historicalMessages.map((record) => String(record.content ?? "")),
            ...memory.facts.map((record) => String(record.content ?? record.fact ?? ""))
          ]);
        const identityHint =
          identityQuery && knownName
            ? `Confirmed user name from saved memory: ${knownName}. The user is asking about their name — answer with this name directly and naturally. Do not say you do not know.`
            : identityQuery
              ? "The user is asking about their name. Check private context and conversation history for self-introductions like «меня зовут…» before saying you do not know."
              : "";

        const userMessageId = await profiler.measure("databaseWriteMs", async () => {
          const messageId = await saveMessage(
            "user",
            userMessage,
            {
              document_ids: attachedDocumentIds,
              referenced_conversation_ids: referencedConversationIds,
              ...(voiceTranscript
                ? {
                    source: "voice",
                    raw_transcript: voiceTranscript.rawTranscript,
                    cleaned_transcript: voiceTranscript.cleanedTranscript,
                    transcript_status: voiceTranscript.transcriptStatus
                  }
                : {}),
              ...(replyTo
                ? {
                    reply_to: {
                      role: replyTo.role,
                      content: replyTo.content.slice(0, 500)
                    }
                  }
                : {})
            },
            conversationId
          );
          await saveExplicitProfileFromMessage(userMessage, messageId);
          await touchConversation(conversationId);
          await linkDocumentsToMessage({
            messageId,
            documentIds: attachedDocumentIds,
            relationType: "attachment"
          });
          return messageId;
        });

        const userContent =
          imageInputs.length > 0
            ? [
                { type: "text" as const, text: userMessage },
                ...imageInputs.map((image) => ({
                  type: "image_url" as const,
                  image_url: { url: image.dataUrl }
                }))
              ]
            : userMessage;

        let answer = "";

        await profiler.measure("openAiRequestMs", async () => {
          const completion = await getOpenAI().chat.completions.create({
            model: chatModel,
            ...getChatCompletionParams({ temperature: 0.5 }),
            stream: true,
            messages: [
              {
                role: "system",
                content: [
                  "You are tBrain — a ChatGPT-like assistant with external long-term memory.",
                  "You do not have built-in persistent memory across requests. Before each reply, the app retrieves relevant context from external storage: facts, entities, tasks, documents, and messages from past chats.",
                  "Uploaded files are stored in file storage; their extracted text, summaries, and metadata are kept in the database and may appear in the memory context below.",
                  "Be natural, useful, direct, thoughtful, and conversational.",
                  "Write plain conversational text. Do not use Markdown asterisks for bold (**like this**) or other Markdown decoration in normal replies. Code blocks are fine only when sharing code.",
                  "Handle writing, ideas, coding, analysis, reasoning, planning, brainstorming, and questions about the user's saved history.",
                  "When the user asks about past chats, documents, or files, use the memory context, referenced chats, and any uploaded file context provided in this request.",
                  "When the context includes a list of links found in chat history or images, and the user asks for a saved link, return the found link(s) directly. Do not claim links are missing if such list is provided.",
                  "Do not say you cannot remember across sessions, that you forget after a chat ends, or that you have no access to past conversations when relevant data is present in the provided context.",
                  "Do not use generic ChatGPT limitation disclaimers about memory or file access.",
                  "If the answer is not in the provided context, say plainly in the user's language: «Я не нашёл этого в памяти». Do not invent facts, documents, or file contents.",
                  "Do not promise that any specific file has already been processed or is available unless its extracted text or summary is actually included in this request.",
                  "If the user asks about a document or file whose extracted text was not passed in this prompt, say that you do not have that document's data in the current context right now — do not guess its contents.",
                  "If file content or images are attached to this request, treat them as available inputs. Do not claim you cannot access an attached file or image.",
                  "Uploaded Excel (.xls/.xlsx) files are parsed into sheet names, headers, and rows. When spreadsheet extracted content appears in the file context below, answer using that data — describe sheets, columns, and values concretely.",
                  "For spreadsheet cell data, use exact cell addresses (e.g. B2, G7) and column letters from the extracted content. Never invent __EMPTY headers or guess column names from numeric values.",
                  "When the user asks about a previously uploaded spreadsheet or table, use retrieved document context from memory search. Do not say you cannot read Excel if extracted content is present in this prompt.",
                  "When the user shares durable personal information, respond briefly and naturally. Often a short acknowledgement is enough.",
                  "For personal questions, use the memory context and the visible conversation history above the latest user message.",
                  "If the user already stated their name or personal details in this chat or in the memory context, use them. Never claim they did not mention something that appears in the conversation or memory context.",
                  "Do not mention databases, storage backends, retrieval pipelines, prompts, or internal architecture to the user unless they explicitly ask how tBrain works.",
                  "This app can generate images through a separate image endpoint when the user asks to draw, create, or generate a picture. If they ask for image generation in plain chat without triggering it, suggest rephrasing with phrases like «нарисуй…» or «сгенерируй картинку…».",
                  "This app cannot create downloadable Excel or Word files for download in chat. Reading and analyzing uploaded spreadsheets is supported when their extracted content is included below.",
                  "If the user asks which model you are using, answer that this deployment uses the OpenAI API model " +
                    chatModel +
                    ".",
                  "Respond in the user's language."
                ].join(" ")
              },
              {
                role: "system",
                content: [
                  `Retrieved long-term memory context. Use when relevant.\n${memoryPrompt}`,
                  identityHint
                ]
                  .filter(Boolean)
                  .join("\n\n")
              },
              ...(documentsPrompt
                ? [
                    {
                      role: "system" as const,
                      content: `File context for this request (attached files and/or matching saved documents). Use when relevant.\n${documentsPrompt}`
                    }
                  ]
                : []),
              ...(imageLinkHints
                ? [
                    {
                      role: "system" as const,
                      content:
                        `Potential links extracted from images in this chat:\n${imageLinkHints}\n` +
                        "If user asks what links were saved/sent, prefer these links and mention when extraction confidence is limited."
                    }
                  ]
                : []),
              ...(referencedChatsPrompt
                ? [
                    {
                      role: "system" as const,
                      content: `Referenced chats linked by Anton. Use this history when answering about those conversations.\n${referencedChatsPrompt}`
                    }
                  ]
                : []),
              ...(conversationLinksPrompt
                ? [
                    {
                      role: "system" as const,
                      content: `Known links from the active chat history.\n${conversationLinksPrompt}`
                    }
                  ]
                : []),
              ...(globalLinksPrompt
                ? [
                    {
                      role: "system" as const,
                      content:
                        `Known links found in other chats.\n${globalLinksPrompt}\n` +
                        "If the user asks for a saved link and it is present here, return it and mention which chat it came from."
                    }
                  ]
                : []),
              ...(replyTo
                ? [
                    {
                      role: "system" as const,
                      content: [
                        "The user is replying to a specific earlier message in this chat.",
                        `Reply target (${replyTo.role}):`,
                        `"""${replyTo.content}"""`,
                        "Treat the next user message as a follow-up in that thread. Answer in direct response to both the quoted message and the new user text."
                      ].join("\n")
                    }
                  ]
                : []),
              ...shortTermMessages,
              { role: "user", content: userContent }
            ]
          });

          for await (const chunk of completion) {
            const token = chunk.choices[0]?.delta?.content ?? "";
            if (!token) continue;
            answer += token;
            controller.enqueue(encoder.encode(token));
          }
        });

        const finalAnswer = answer.trim();
        if (finalAnswer) {
          await profiler.measure("databaseWriteMs", async () => {
            const assistantMessageId = await saveMessage(
              "assistant",
              finalAnswer,
              {
                reply_to_message_id: userMessageId,
                document_ids: attachedDocumentIds
              },
              conversationId
            );
            await linkDocumentsToMessage({
              messageId: assistantMessageId,
              documentIds: attachedDocumentIds,
              relationType: "used_in_answer"
            });
            await touchConversation(conversationId);
          });
          if (SAVE_LINK_INTENT_PATTERN.test(userMessage)) {
            await profiler.measure("databaseWriteMs", async () => {
              await saveExtractedMemory(
                {
                  facts: extractLinkFactsFromAssistantAnswer(finalAnswer)
                },
                userMessageId
              );
            });
          }

          scheduleChatPostProcessing({
            userId: getCurrentUserId(),
            conversationId,
            userMessage,
            assistantAnswer: finalAnswer,
            userMessageId,
            runMemoryExtraction: extractAndSaveMemory
          });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected streaming error.";
        controller.enqueue(encoder.encode(`\n\nОшибка: ${message}`));
      } finally {
        profiler.finish({ conversationId, route: "chat" });
        controller.close();
      }
      });
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}

async function extractAndSaveMemory(
  userMessage: string,
  assistantAnswer: string,
  sourceMessageId?: string | number
) {
  const result = await getOpenAI().chat.completions.create({
      model: chatModel,
      ...getChatCompletionParams({ temperature: 0 }),
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Extract durable personal memory from Anton's latest message.",
            "Only extract information that may be useful across future chats.",
            "Facts are stable preferences, personal data, constraints, or context.",
            "Entities are people, companies, subscriptions, projects, products, or technologies.",
            "Tasks are commitments, todos, reminders, or agreements.",
            "Split profile facts into compact atomic facts, for example name, age, family status, workplace.",
            "Do not extract generic conversation filler. Do not infer beyond the text.",
            "Return valid JSON with arrays: facts [{content}], entities [{name,type,description}], tasks [{title,status,description}].",
            "Use empty arrays when there is nothing durable to save."
          ].join(" ")
        },
        {
          role: "user",
          content: `User message:\n${userMessage}\n\nAssistant answer:\n${assistantAnswer}`
        }
      ]
    });

  const raw = result.choices[0]?.message.content ?? "{}";
  const extraction = normalizeExtraction(JSON.parse(raw));
  if (extraction) await saveExtractedMemory(extraction, sourceMessageId);
}

function normalizeExtraction(value: unknown): MemoryExtraction {
  const input = isRecord(value) ? value : {};
  const facts = Array.isArray(input.facts)
    ? input.facts
        .filter(isRecord)
        .map((fact) => ({ content: String(fact.content ?? "").trim() }))
        .filter((fact) => fact.content.length > 0)
    : [];

  const entities = Array.isArray(input.entities)
    ? input.entities
        .filter(isRecord)
        .map((entity) => ({
          name: String(entity.name ?? "").trim(),
          type: optionalString(entity.type),
          description: optionalString(entity.description)
        }))
        .filter((entity) => entity.name.length > 0)
    : [];

  const tasks = Array.isArray(input.tasks)
    ? input.tasks
        .filter(isRecord)
        .map((task) => ({
          title: String(task.title ?? "").trim(),
          status: optionalString(task.status),
          description: optionalString(task.description)
        }))
        .filter((task) => task.title.length > 0)
    : [];

  return { facts, entities, tasks };
}

function optionalString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function needsLinkLookup(userMessage: string) {
  return LINK_QUERY_PATTERN.test(userMessage) || LINK_RESOURCE_QUERY_PATTERN.test(userMessage);
}

function extractLinkFactsFromAssistantAnswer(answer: string): Array<{ content: string }> {
  const lines = answer.split(/\r?\n/);
  const facts: Array<{ content: string }> = [];
  const seen = new Set<string>();
  const urlPattern = /(https?:\/\/[^\s<>"')\]]+)/gi;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) continue;
    const urls = [...line.matchAll(urlPattern)].map((match) => match[1]?.trim()).filter(Boolean) as string[];

    for (const url of urls) {
      const contextLine = lines[index - 1]?.trim() ?? "";
      const labelSource = contextLine && !/https?:\/\//i.test(contextLine) ? contextLine : line;
      const label = labelSource
        .replace(urlPattern, "")
        .replace(/^[-*•\d.)\s]+/, "")
        .replace(/[:\-–—]\s*$/, "")
        .trim();
      const content = label ? `Ссылка: ${label} — ${url}` : `Ссылка: ${url}`;
      if (seen.has(content)) continue;
      seen.add(content);
      facts.push({ content });
    }
  }

  return facts.slice(0, 12);
}

async function extractUrlsFromImageInputs(
  images: Array<{ fileName: string; fileType: string; dataUrl: string }>
) {
  if (images.length === 0) return "";

  try {
    const response = await getOpenAI().chat.completions.create({
      model: LINK_EXTRACTION_VISION_MODEL,
      ...getChatCompletionParams({ temperature: 0 }),
      messages: [
        {
          role: "system",
          content: [
            "Extract only explicit URLs visible in the provided images.",
            "Return one URL per line.",
            "If none are visible, return exactly NONE.",
            "Do not add explanations, bullets, or markdown."
          ].join(" ")
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Find visible links (http/https or clear www domains)." },
            ...images.map((image) => ({
              type: "image_url" as const,
              image_url: { url: image.dataUrl }
            }))
          ]
        }
      ]
    });

    const raw = response.choices[0]?.message?.content?.trim() ?? "";
    if (!raw || /^none$/i.test(raw)) return "";

    const links = [
      ...new Set(
        raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => /^(https?:\/\/|www\.)/i.test(line))
      )
    ];
    return links.join("\n");
  } catch (error) {
    console.error("Image URL extraction failed:", error);
    return "";
  }
}
