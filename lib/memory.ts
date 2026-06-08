import { getSupabase } from "@/lib/supabase";

export type MemoryContext = {
  facts: Record<string, unknown>[];
  entities: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  recentMessages: Record<string, unknown>[];
};

export type MemoryExtraction = {
  facts?: { content: string }[];
  entities?: { name: string; type?: string; description?: string }[];
  tasks?: { title: string; status?: string; description?: string }[];
};

const SEARCH_LIMIT = 8;
const SEARCH_POOL_LIMIT = 50;

function compactRecord(record: Record<string, unknown>) {
  return Object.entries(record)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("; ");
}

async function safeSelect(table: "facts" | "entities" | "tasks") {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(SEARCH_POOL_LIMIT);

  if (error) {
    console.error(`Memory select failed for ${table}:`, error.message);
    return [];
  }

  return data ?? [];
}

async function safeSelectRecentMessages() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(SEARCH_POOL_LIMIT);

  if (error) {
    console.error("Memory select failed for messages:", error.message);
    return [];
  }

  return data ?? [];
}

export async function retrieveMemory(query: string): Promise<MemoryContext> {
  const [facts, entities, tasks, recentMessages] = await Promise.all([
    safeSelect("facts"),
    safeSelect("entities"),
    safeSelect("tasks"),
    safeSelectRecentMessages()
  ]);

  return {
    facts: rankRecords(facts, query),
    entities: rankRecords(entities, query),
    tasks: rankRecords(tasks, query),
    recentMessages: rankRecords(recentMessages, query, { requireMatch: true })
  };
}

export function formatMemoryForPrompt(memory: MemoryContext) {
  const sections = [
    ["Facts", memory.facts],
    ["Entities", memory.entities],
    ["Tasks", memory.tasks],
    ["Recent user messages", memory.recentMessages]
  ] as const;

  const formatted = sections
    .map(([title, records]) => {
      if (records.length === 0) return `${title}: none`;
      return `${title}:\n${records
        .map((record, index) => `${index + 1}. ${compactRecord(record)}`)
        .join("\n")}`;
    })
    .join("\n\n");

  return formatted;
}

function rankRecords(
  records: Record<string, unknown>[],
  query: string,
  options: { requireMatch?: boolean } = {}
) {
  const terms = query
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((term) => term.length >= 3);

  const ranked = records
    .map((record, index) => {
      const text = compactRecord(record).toLowerCase();
      const score = terms.reduce(
        (sum, term) => sum + (text.includes(term) ? 1 : 0),
        0
      );
      return { record, score, index };
    })
    .filter(({ score }) => !options.requireMatch || score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, SEARCH_LIMIT)
    .map(({ record }) => record);

  return ranked;
}

export async function saveMessage(role: "user" | "assistant", content: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .insert({ role, content })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Could not save ${role} message: ${error.message}`);
  }

  return data?.id as string | number | undefined;
}

export async function saveExtractedMemory(
  extraction: MemoryExtraction,
  sourceMessageId?: string | number
) {
  if (extraction.facts?.length) {
    const facts = await filterNewFacts(extraction.facts);
    await insertWithFallbacks(
      "facts",
      facts.map((fact) => ({
        content: fact.content,
        source_message_id: sourceMessageId
      })),
      facts.map((fact) => ({
        content: fact.content
      })),
      facts.map((fact) => ({
        fact: fact.content,
        source_message_id: sourceMessageId
      })),
      facts.map((fact) => ({
        fact: fact.content
      }))
    );
  }

  if (extraction.entities?.length) {
    const entities = await filterNewEntities(extraction.entities);
    await insertWithFallbacks(
      "entities",
      entities.map((entity) => ({
        name: entity.name,
        type: entity.type ?? "unknown",
        description: entity.description ?? null,
        source_message_id: sourceMessageId
      })),
      entities.map((entity) => ({
        name: entity.name,
        type: entity.type ?? "unknown",
        source_message_id: sourceMessageId
      })),
      entities.map((entity) => ({
        name: entity.name,
        type: entity.type ?? "unknown"
      })),
      entities.map((entity) => ({
        name: entity.name
      }))
    );
  }

  if (extraction.tasks?.length) {
    await insertWithFallbacks(
      "tasks",
      extraction.tasks.map((task) => ({
        title: task.title,
        status: task.status ?? "open",
        description: task.description ?? null,
        source_message_id: sourceMessageId
      })),
      extraction.tasks.map((task) => ({
        title: task.title,
        status: task.status ?? "open",
        source_message_id: sourceMessageId
      })),
      extraction.tasks.map((task) => ({
        title: task.title,
        status: task.status ?? "open"
      })),
      extraction.tasks.map((task) => ({
        title: task.title
      }))
    );
  }
}

async function insertWithFallbacks(
  table: "facts" | "entities" | "tasks",
  ...payloads: Record<string, unknown>[][]
) {
  const supabase = getSupabase();
  let lastError: string | undefined;

  for (const payload of payloads) {
    if (payload.length === 0) return;
    const { error } = await supabase.from(table).insert(payload);
    if (!error) return;
    lastError = error.message;
  }

  if (lastError) {
    console.error(`Memory write failed for ${table}:`, lastError);
  }
}

async function filterNewFacts(facts: { content: string }[]) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("facts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(SEARCH_POOL_LIMIT);
  const existing = new Set(
    (data ?? []).map((record) =>
      normalizeMemoryText(String(record.fact ?? record.content ?? ""))
    )
  );

  return facts.filter((fact) => {
    const normalized = normalizeMemoryText(fact.content);
    if (!normalized || existing.has(normalized)) return false;
    existing.add(normalized);
    return true;
  });
}

async function filterNewEntities(
  entities: { name: string; type?: string; description?: string }[]
) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("entities")
    .select("name, type")
    .order("created_at", { ascending: false })
    .limit(SEARCH_POOL_LIMIT);
  const existing = new Set(
    (data ?? []).map((record) =>
      `${normalizeMemoryText(String(record.name ?? ""))}:${normalizeMemoryText(String(record.type ?? ""))}`
    )
  );

  return entities.filter((entity) => {
    const key = `${normalizeMemoryText(entity.name)}:${normalizeMemoryText(entity.type ?? "")}`;
    if (!entity.name.trim() || existing.has(key)) return false;
    existing.add(key);
    return true;
  });
}

function normalizeMemoryText(value: string) {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}
