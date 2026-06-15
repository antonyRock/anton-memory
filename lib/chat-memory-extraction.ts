import "server-only";

import {
  chatModel,
  getChatCompletionParams,
  getOpenAI
} from "@/lib/openai";
import { saveExtractedMemory, type MemoryExtraction } from "@/lib/memory";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

export async function extractAndSaveChatMemory(
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
          "Extract durable personal memory from the user's latest message.",
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
