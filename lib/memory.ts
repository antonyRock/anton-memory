import { getSupabase } from "@/lib/supabase";

export type MemoryContext = {
  facts: Record<string, unknown>[];
  entities: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  recentMessages: Record<string, unknown>[];
  historicalMessages: Record<string, unknown>[];
};

export type MemoryExtraction = {
  facts?: { content: string }[];
  entities?: { name: string; type?: string; description?: string }[];
  tasks?: { title: string; status?: string; description?: string }[];
};

const SEARCH_LIMIT = 8;
const SEARCH_POOL_LIMIT = 50;
const IDENTITY_QUERY =
  /(?:как\s+(?:меня\s+)?(?:зовут|звать)|мо[её]\s+имя|what(?:'s| is)\s+my\s+name|who\s+am\s+i)/i;

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
  const initial = await supabase
    .from("messages")
    .select("role, content, created_at, metadata")
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(SEARCH_POOL_LIMIT);
  let data: Record<string, unknown>[] | null = initial.data;
  let error = initial.error;

  if (error && error.message.toLowerCase().includes("metadata")) {
    const fallback = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(SEARCH_POOL_LIMIT);
    data = fallback.data as Record<string, unknown>[] | null;
    error = fallback.error;
  }

  if (error) {
    console.error("Memory select failed for messages:", error.message);
    return [];
  }

  return data ?? [];
}

function buildSearchTerms(query: string, identityQuery: boolean) {
  if (identityQuery) {
    return ["зовут", "звать", "имя", "антон", "anton"];
  }

  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-zа-яё0-9]+/i)
        .filter((term) => term.length >= 3)
    )
  ].slice(0, 4);
}

async function searchHistoricalMessages(terms: string[]) {
  if (terms.length === 0) return [];

  const supabase = getSupabase();
  const batches = await Promise.all(
    terms.map(async (term) => {
      const pattern = `%${term}%`;
      const initial = await supabase
        .from("messages")
        .select("id, role, content, created_at, conversation_id")
        .ilike("content", pattern)
        .order("created_at", { ascending: false })
        .limit(12);

      if (!initial.error) return initial.data ?? [];

      const fallback = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .ilike("content", pattern)
        .order("created_at", { ascending: false })
        .limit(12);

      if (fallback.error) {
        console.error("Historical message search failed:", fallback.error.message);
        return [];
      }

      return fallback.data ?? [];
    })
  );

  return mergeUniqueRecords(...batches);
}

async function searchFactsByTerms(terms: string[]) {
  if (terms.length === 0) return [];

  const supabase = getSupabase();
  const batches = await Promise.all(
    terms.map(async (term) => {
      const pattern = `%${term}%`;
      const { data, error } = await supabase
        .from("facts")
        .select("*")
        .or(`content.ilike.${pattern},fact.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(8);

      if (error) {
        console.error("Fact search failed:", error.message);
        return [];
      }

      return data ?? [];
    })
  );

  return mergeUniqueRecords(...batches);
}

async function searchEntitiesByTerms(terms: string[]) {
  if (terms.length === 0) return [];

  const supabase = getSupabase();
  const batches = await Promise.all(
    terms.map(async (term) => {
      const pattern = `%${term}%`;
      const { data, error } = await supabase
        .from("entities")
        .select("*")
        .or(`name.ilike.${pattern},description.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(8);

      if (error) {
        console.error("Entity search failed:", error.message);
        return [];
      }

      return data ?? [];
    })
  );

  return mergeUniqueRecords(...batches);
}

export async function retrieveMemory(query: string): Promise<MemoryContext> {
  const identityQuery = isIdentityQuery(query);
  const extraTerms = identityQuery ? ["имя", "зовут", "name", "антон", "anton"] : undefined;
  const searchTerms = buildSearchTerms(query, identityQuery);

  const [facts, entities, tasks, recentMessages, historicalMessages, searchedFacts, searchedEntities] =
    await Promise.all([
      safeSelect("facts"),
      safeSelect("entities"),
      safeSelect("tasks"),
      safeSelectRecentMessages(),
      searchHistoricalMessages(searchTerms),
      searchFactsByTerms(searchTerms),
      searchEntitiesByTerms(searchTerms)
    ]);

  let rankedFacts = rankRecords(facts, query, { extraTerms });
  let rankedEntities = rankRecords(entities, query, { extraTerms });
  const rankedTasks = rankRecords(tasks, query, { extraTerms });
  let rankedMessages = rankRecords(recentMessages, query, {
    extraTerms,
    requireMatch: !identityQuery
  });
  let rankedHistorical = rankRecords(historicalMessages, query, {
    extraTerms,
    requireMatch: false,
    limit: 12
  });

  rankedFacts = mergeUniqueRecords(searchedFacts, rankedFacts);
  rankedEntities = mergeUniqueRecords(searchedEntities, rankedEntities);

  if (identityQuery) {
    rankedFacts = mergeUniqueRecords(profileLikeRecords(facts), rankedFacts).slice(0, 12);
    rankedEntities = mergeUniqueRecords(
      entities.filter((record) => isPersonEntity(record) || isProfileLikeRecord(record)),
      rankedEntities
    ).slice(0, 12);
    rankedMessages = mergeUniqueRecords(
      recentMessages.filter((record) => isProfileLikeRecord(record)),
      rankRecords(recentMessages, query, { extraTerms, requireMatch: false })
    ).slice(0, 8);
    rankedHistorical = mergeUniqueRecords(
      historicalMessages.filter((record) => isProfileLikeRecord(record)),
      rankedHistorical
    ).slice(0, 12);
  } else {
    rankedFacts = rankedFacts.slice(0, 12);
    rankedEntities = rankedEntities.slice(0, 12);
    rankedHistorical = rankedHistorical.slice(0, 10);
  }

  return {
    facts: rankedFacts,
    entities: rankedEntities,
    tasks: rankedTasks,
    recentMessages: rankedMessages,
    historicalMessages: rankedHistorical
  };
}

export async function saveExplicitProfileFromMessage(
  message: string,
  sourceMessageId?: string | number
) {
  const trimmed = message.trim();
  const nameMatch = trimmed.match(
    /(?:меня\s+(?:зовут|звать)|my\s+name\s+is|call\s+me)\s+([A-Za-zА-Яа-яЁё\-]+)/iu
  );
  if (!nameMatch?.[1]) return;

  const name = nameMatch[1].trim();
  await saveExtractedMemory(
    {
      facts: [{ content: `Имя пользователя: ${name}` }],
      entities: [{ name, type: "person", description: "Пользователь TBrain" }]
    },
    sourceMessageId
  );
}

export function formatMemoryForPrompt(memory: MemoryContext) {
  const sections = [
    ["Facts", memory.facts],
    ["Entities", memory.entities],
    ["Tasks", memory.tasks],
    ["Recent user messages", memory.recentMessages],
    ["Matching messages from chat history", memory.historicalMessages]
  ] as const;

  return sections
    .map(([title, records]) => {
      if (records.length === 0) return `${title}: none`;
      return `${title}:\n${records
        .map((record, index) => `${index + 1}. ${compactRecord(record)}`)
        .join("\n")}`;
    })
    .join("\n\n");
}

function rankRecords(
  records: Record<string, unknown>[],
  query: string,
  options: { requireMatch?: boolean; extraTerms?: string[]; limit?: number } = {}
) {
  const terms = [
    ...query
      .toLowerCase()
      .split(/[^a-zа-яё0-9]+/i)
      .filter((term) => term.length >= 3),
    ...(options.extraTerms ?? []).map((term) => term.toLowerCase())
  ];

  return records
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
    .slice(0, options.limit ?? SEARCH_LIMIT)
    .map(({ record }) => record);
}

function isIdentityQuery(query: string) {
  return IDENTITY_QUERY.test(query.trim());
}

function isProfileLikeRecord(record: Record<string, unknown>) {
  const text = compactRecord(record).toLowerCase();
  return /имя|зовут|звать|фамил|name|call me|меня зовут|user name|пользователя/.test(text);
}

function isPersonEntity(record: Record<string, unknown>) {
  const type = String(record.type ?? "").toLowerCase();
  return /person|user|human|people|человек|пользов/.test(type);
}

function recordKey(record: Record<string, unknown>) {
  return String(record.id ?? compactRecord(record));
}

function mergeUniqueRecords(...groups: Record<string, unknown>[][]) {
  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const record of group) {
      const key = recordKey(record);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(record);
    }
  }

  return merged;
}

function profileLikeRecords(records: Record<string, unknown>[]) {
  return records.filter(isProfileLikeRecord);
}

export async function saveMessage(
  role: "user" | "assistant",
  content: string,
  metadata: Record<string, unknown> = {},
  conversationId?: string | number
) {
  const supabase = getSupabase();
  const payload: Record<string, unknown> = { role, content, metadata };
  if (conversationId && String(conversationId) !== "legacy") {
    payload.conversation_id = conversationId;
  }
  let { data, error } = await supabase
    .from("messages")
    .insert(payload)
    .select("id")
    .single();

  if (error && /metadata|conversation_id/i.test(error.message)) {
    const fallback = await supabase
      .from("messages")
      .insert({ role, content })
      .select("id")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

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
