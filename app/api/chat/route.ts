import { NextResponse } from "next/server";
import { chatModel, getOpenAI } from "@/lib/openai";
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
    const { message } = (await request.json()) as { message?: string };
    const userMessage = message?.trim();

    if (!userMessage) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const memory = await retrieveMemory(userMessage);
    const memoryPrompt = formatMemoryForPrompt(memory);
    const userMessageId = await saveMessage("user", userMessage);

    const completion = await getOpenAI().chat.completions.create({
      model: chatModel,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: [
            "You are a warm, concise assistant for a personal second-brain app.",
            "Use the provided memory and recent user messages when they are relevant.",
            "When the user asks you to remember, save, note, or record new information, acknowledge it naturally and do not claim that memory has no data about it.",
            "If the user asks about their personal data, subscriptions, tasks, projects, people, preferences, or history, rely only on the provided memory.",
            "If the provided memory does not contain the answer, say that there is no data in memory. Do not invent personal facts.",
            "Respond in the user's language."
          ].join(" ")
        },
        {
          role: "system",
          content: `Current long-term memory:\n${memoryPrompt}`
        },
        { role: "user", content: userMessage }
      ]
    });

    const answer =
      completion.choices[0]?.message.content?.trim() ??
      "Не удалось сформировать ответ.";

    await saveMessage("assistant", answer);

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
            "Extract durable personal memory from the user's latest message.",
            "Only extract information that may be useful across future chats.",
            "Facts are stable preferences, personal data, constraints, or context.",
            "Entities are people, companies, subscriptions, projects, products, or technologies.",
            "Tasks are commitments, todos, reminders, or agreements.",
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
