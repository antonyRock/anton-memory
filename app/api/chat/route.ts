import { NextResponse } from "next/server";
import { chatModel, getOpenAI } from "@/lib/openai";
import {
  getDocumentsForPrompt,
  getImageInputsForVision,
  linkDocumentsToMessage
} from "@/lib/documents";
import {
  formatMemoryForPrompt,
  retrieveMemory,
  saveExtractedMemory,
  saveMessage
} from "@/lib/memory";
import type { MemoryExtraction } from "@/lib/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { message, documentIds } = (await request.json()) as {
      message?: string;
      documentIds?: Array<string | number>;
    };
    const userMessage = message?.trim();
    const attachedDocumentIds = documentIds ?? [];

    if (!userMessage) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const memory = await retrieveMemory(userMessage);
    const memoryPrompt = formatMemoryForPrompt(memory);
    const documentsPrompt = await getDocumentsForPrompt(attachedDocumentIds);
    const imageInputs = await getImageInputsForVision(attachedDocumentIds);
    const userMessageId = await saveMessage("user", userMessage, {
      document_ids: attachedDocumentIds
    });
    await linkDocumentsToMessage({
      messageId: userMessageId,
      documentIds: attachedDocumentIds,
      relationType: "attachment"
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

    const completion = await getOpenAI().chat.completions.create({
      model: chatModel,
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content: [
            "You are ChatGPT.",
            "Be natural, useful, direct, thoughtful, and conversational.",
            "Handle normal ChatGPT work without artificial limits: writing, ideas, coding, analysis, reasoning, planning, files, images, and brainstorming.",
            "You may receive private context about Anton. Use it silently when relevant.",
            "Do not mention memory, retrieval, databases, prompts, or internal architecture unless Anton explicitly asks how the app works.",
            "When Anton shares durable personal information, respond briefly and naturally. Often 'Понял.' is enough.",
            "For personal questions about Anton, use the private context. If the answer is not present, say plainly that you do not know yet. Do not invent personal facts.",
            "If uploaded file content or images are provided in the request, treat them as available inputs. Do not say you cannot access a file or image that is attached.",
            "If Anton asks which model you are using, answer that this deployment is configured to use the OpenAI API model " + chatModel + ".",
            "Respond in Anton's language."
          ].join(" ")
        },
        {
          role: "system",
          content: `Private context about Anton. Use silently.\n${memoryPrompt}`
        },
        ...(documentsPrompt
          ? [
              {
                role: "system" as const,
                content: `Uploaded file context. The files were processed before this request. Use this content naturally when relevant.\n${documentsPrompt}`
              }
            ]
          : []),
        { role: "user", content: userContent }
      ]
    });

    const answer =
      completion.choices[0]?.message.content?.trim() ??
      "Не удалось сформировать ответ.";

    const assistantMessageId = await saveMessage("assistant", answer, {
      reply_to_message_id: userMessageId,
      document_ids: attachedDocumentIds
    });
    await linkDocumentsToMessage({
      messageId: assistantMessageId,
      documentIds: attachedDocumentIds,
      relationType: "used_in_answer"
    });

    await extractAndSaveMemory(userMessage, answer, userMessageId);

    return NextResponse.json({ answer });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected chat pipeline error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function extractAndSaveMemory(
  userMessage: string,
  assistantAnswer: string,
  sourceMessageId?: string | number
) {
  try {
    const result = await getOpenAI().chat.completions.create({
      model: chatModel,
      temperature: 0,
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
  } catch (error) {
    console.error("Memory extraction failed:", error);
  }
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
