import { getDocumentsForMessages } from "@/lib/documents";
import { getOpenAI, chatModel } from "@/lib/openai";
import { searchProjects } from "@/lib/projects";
import { getSupabase } from "@/lib/supabase";

export type Conversation = {
  id: string | number;
  title: string | null;
  summary: string | null;
  project_id?: string | number | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type SearchResultItem = {
  type: string;
  typeLabel: string;
  id: string | number;
  conversationId?: string | number | null;
  title: string;
  snippet: string;
};

const DEFAULT_TITLE = "Новый чат";
const CONVERSATION_SELECT_WITH_PROJECT =
  "id, title, summary, metadata, created_at, updated_at, project_id";
const CONVERSATION_SELECT_BASE = "id, title, summary, metadata, created_at, updated_at";
const LEGACY_CONVERSATION: Conversation = {
  id: "legacy",
  title: "История",
  summary: null,
  metadata: { legacy: true },
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};

export async function listConversations(search = "", projectId?: string | number | null) {
  const supabase = getSupabase();
  const query = search.trim();

  if (!query) {
    const { data, error } = await queryRecentConversations(projectId, 40);

    if (isMissingConversationSchema(error?.message)) {
      return { conversations: [LEGACY_CONVERSATION], results: [] };
    }
    if (error) throw new Error(`Could not load conversations: ${error.message}`);

    return {
      conversations: (data ?? []) as Conversation[],
      results: []
    };
  }

  const pattern = `%${query}%`;
  const [
    conversationMatches,
    messageMatches,
    documentMatches,
    factMatches,
    entityMatches,
    taskMatches,
    projectMatches
  ] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, title, summary, metadata, created_at, updated_at")
        .or(`title.ilike.${pattern},summary.ilike.${pattern}`)
        .order("updated_at", { ascending: false })
        .limit(20),
      supabase
        .from("messages")
        .select("id, conversation_id, content, created_at")
        .ilike("content", pattern)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("documents")
        .select("id, file_name, extracted_text, summary, created_at")
        .or(`file_name.ilike.${pattern},extracted_text.ilike.${pattern},summary.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("facts")
        .select("id, content, fact, created_at")
        .or(`content.ilike.${pattern},fact.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("entities")
        .select("id, name, description, created_at")
        .or(`name.ilike.${pattern},description.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("tasks")
        .select("id, title, description, created_at")
        .or(`title.ilike.${pattern},description.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(10),
      searchProjects(pattern, 10)
    ]);

  if (isMissingConversationSchema(conversationMatches.error?.message)) {
    return {
      conversations: [LEGACY_CONVERSATION],
      results: [
        ...toResults("message", messageMatches.data, "content"),
        ...toResults("document", documentMatches.data, "extracted_text", "file_name"),
        ...toResults("fact", factMatches.data, "content", "fact"),
        ...toResults("entity", entityMatches.data, "description", "name"),
        ...toResults("task", taskMatches.data, "description", "title")
      ] as SearchResultItem[]
    };
  }

  if (conversationMatches.error) {
    throw new Error(`Could not search conversations: ${conversationMatches.error.message}`);
  }

  const documentConversationIds = await getConversationIdsForDocuments(
    (documentMatches.data ?? []).map((document) => document.id as string | number)
  );
  const conversationIds = new Set<string | number>();
  const conversations: Conversation[] = [];

  for (const conversation of conversationMatches.data ?? []) {
    conversationIds.add(conversation.id);
    conversations.push(conversation as Conversation);
  }

  for (const message of messageMatches.data ?? []) {
    if (message.conversation_id) conversationIds.add(message.conversation_id);
  }

  for (const conversationId of documentConversationIds.values()) {
    if (conversationId) conversationIds.add(conversationId);
  }

  const missingIds = [...conversationIds].filter(
    (id) => !conversations.some((conversation) => String(conversation.id) === String(id))
  );

  if (missingIds.length > 0) {
    const missingWithProject = await supabase
      .from("conversations")
      .select(CONVERSATION_SELECT_WITH_PROJECT)
      .in("id", missingIds)
      .order("updated_at", { ascending: false });

    const missingResult =
      missingWithProject.error && /project_id/i.test(missingWithProject.error.message)
        ? await supabase
            .from("conversations")
            .select(CONVERSATION_SELECT_BASE)
            .in("id", missingIds)
            .order("updated_at", { ascending: false })
        : missingWithProject;

    conversations.push(...((missingResult.data ?? []) as Conversation[]));
  }

  const conversationTitleById = new Map(
    conversations.map((conversation) => [String(conversation.id), conversation.title ?? "Чат"])
  );

  const results = [
    ...toResults("conversation", conversationMatches.data, "summary", "title"),
    ...toResults("message", messageMatches.data, "content"),
    ...toResults(
      "document",
      documentMatches.data,
      "extracted_text",
      "file_name",
      documentConversationIds
    ),
    ...toResults("fact", factMatches.data, "content", "fact"),
    ...toResults("entity", entityMatches.data, "description", "name"),
    ...toResults("task", taskMatches.data, "description", "title"),
    ...toResults("project", projectMatches, "description", "title")
  ].map((result) => {
    if (result.type !== "message" || !result.conversationId) return result;
    const chatTitle = conversationTitleById.get(String(result.conversationId));
    return chatTitle ? { ...result, snippet: `Чат: ${chatTitle}` } : result;
  }) as SearchResultItem[];

  return {
    conversations: conversations
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, 40),
    results
  };
}

export async function createConversation(
  title = DEFAULT_TITLE,
  projectId?: string | number | null
) {
  const supabase = getSupabase();
  const basePayload: Record<string, unknown> = { title };
  const payload =
    projectId != null && projectId !== ""
      ? { ...basePayload, project_id: projectId }
      : basePayload;

  let { data, error } = await supabase
    .from("conversations")
    .insert(payload)
    .select(CONVERSATION_SELECT_BASE)
    .single();

  if (error && projectId != null && /project_id/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("conversations")
      .insert(basePayload)
      .select(CONVERSATION_SELECT_BASE)
      .single());
  }

  if (isMissingConversationSchema(error?.message)) return LEGACY_CONVERSATION;
  if (error) throw new Error(`Could not create conversation: ${error.message}`);
  return data as Conversation;
}

export async function getConversationMessages(conversationId: string | number) {
  const supabase = getSupabase();
  const query =
    String(conversationId) === "legacy"
      ? supabase
          .from("messages")
          .select("id, role, content, metadata, created_at")
          .order("created_at", { ascending: true })
          .limit(200)
      : supabase
          .from("messages")
          .select("id, role, content, metadata, created_at")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(200);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load messages: ${error.message}`);

  const messages = data ?? [];
  const documentsByMessage = await getDocumentsForMessages(messages);

  return messages.map((message) => {
    const attachments = documentsByMessage.get(String(message.id)) ?? [];
    const generatedImage = attachments.find(
      (attachment) => attachment.metadata?.kind === "generated_image"
    );

    return {
      ...message,
      attachments,
      imageUrl: generatedImage?.previewUrl ?? generatedImage?.fullUrl ?? null
    };
  });
}

export async function getShortTermContext(conversationId?: string | number) {
  if (!conversationId) return [];
  const messages = await getConversationMessages(conversationId);
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12)
    .map((message) => ({
      role: message.role as "user" | "assistant",
      content: String(message.content ?? "")
    }));
}

export type ChatContextMessage = {
  role: "user" | "assistant";
  content: string;
};

export function mergeShortTermContext(
  dbMessages: ChatContextMessage[],
  clientMessages: ChatContextMessage[] = []
) {
  const merged: ChatContextMessage[] = [];
  const seen = new Set<string>();

  for (const message of [...dbMessages, ...clientMessages]) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const content = String(message.content ?? "").trim();
    if (!content) continue;
    const key = `${role}:${content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ role, content });
  }

  return merged.slice(-12);
}

export async function touchConversation(conversationId?: string | number) {
  if (!conversationId || String(conversationId) === "legacy") return;
  const supabase = getSupabase();
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}

export async function maybeGenerateConversationTitle(input: {
  conversationId?: string | number;
  userMessage: string;
  assistantAnswer: string;
}) {
  if (!input.conversationId || String(input.conversationId) === "legacy") return;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("conversations")
    .select("title")
    .eq("id", input.conversationId)
    .single();

  if (error) return;
  const currentTitle = String(data?.title ?? "").trim();
  if (currentTitle && currentTitle !== DEFAULT_TITLE) return;

  try {
    const result = await getOpenAI().chat.completions.create({
      model: chatModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Create a short Russian chat title, 3-6 words. No quotes, no punctuation at the end."
        },
        {
          role: "user",
          content: `User: ${input.userMessage}\nAssistant: ${input.assistantAnswer}`
        }
      ]
    });
    const title = result.choices[0]?.message.content?.trim().replace(/^["«]|["»]$/g, "");
    if (!title) return;
    await supabase
      .from("conversations")
      .update({ title: title.slice(0, 80), updated_at: new Date().toISOString() })
      .eq("id", input.conversationId);
  } catch (error) {
    console.error("Conversation title generation failed:", error);
  }
}

function isMissingConversationSchema(message?: string) {
  if (!message) return false;
  if (/project_id/i.test(message)) return false;
  return (
    /relation .*conversations.* does not exist/i.test(message) ||
    /could not find the table .*conversations/i.test(message) ||
    /table .*conversations.* does not exist/i.test(message) ||
    /schema cache.*conversations/i.test(message)
  );
}

async function queryRecentConversations(
  projectId?: string | number | null,
  limit = 40
) {
  const supabase = getSupabase();

  if (!projectId) {
    const withProject = await supabase
      .from("conversations")
      .select(CONVERSATION_SELECT_WITH_PROJECT)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (!withProject.error || !/project_id/i.test(withProject.error.message)) {
      return withProject;
    }

    return supabase
      .from("conversations")
      .select(CONVERSATION_SELECT_BASE)
      .order("updated_at", { ascending: false })
      .limit(limit);
  }

  let request = supabase
    .from("conversations")
    .select(CONVERSATION_SELECT_WITH_PROJECT)
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  const primary = await request;
  if (!primary.error || !/project_id/i.test(primary.error.message)) {
    return primary;
  }

  return supabase
    .from("conversations")
    .select(CONVERSATION_SELECT_BASE)
    .order("updated_at", { ascending: false })
    .limit(limit);
}

function toResults(
  type: string,
  rows: Record<string, unknown>[] | null,
  textKey: string,
  nameKey?: string,
  conversationIdsByRowId?: Map<string, string | number | null>
): SearchResultItem[] {
  return (rows ?? []).map((row) => {
    const resolvedType = resolveResultType(type, row);
    const typeLabel = resultTypeLabel(resolvedType);
    const textValue = String(row[textKey] ?? "").trim();
    const nameValue = nameKey ? String(row[nameKey] ?? "").trim() : "";

    let title = nameValue;
    let snippet = textValue;

    if (resolvedType === "message") {
      title = textValue.slice(0, 120) || "Сообщение";
      snippet = "";
    } else if (resolvedType === "conversation") {
      title = nameValue || "Чат";
      snippet = textValue;
    } else if (resolvedType === "entity") {
      title = nameValue || "Сущность";
      snippet = textValue;
    } else if (resolvedType === "fact") {
      title = nameValue || textValue.slice(0, 120) || "Факт";
      snippet = nameValue && textValue && nameValue !== textValue ? textValue : "";
    } else if (resolvedType === "task") {
      title = nameValue || "Задача";
      snippet = textValue;
    } else if (resolvedType === "project") {
      title = nameValue || "Проект";
      snippet = textValue;
    } else if (resolvedType === "image" || resolvedType === "document") {
      title = nameValue || "Файл";
      snippet = textValue.slice(0, 180);
    }

    const conversationId =
      (row.conversation_id as string | number | null | undefined) ??
      conversationIdsByRowId?.get(String(row.id ?? "")) ??
      (resolvedType === "conversation" ? (row.id as string | number) : null);

    return {
      type: resolvedType,
      typeLabel,
      id: (row.id ?? row.conversation_id ?? crypto.randomUUID()) as string | number,
      conversationId,
      title,
      snippet: snippet.slice(0, 180)
    };
  });
}

function resolveResultType(type: string, row: Record<string, unknown>) {
  if (type !== "document") return type;
  const fileType = String(row.file_type ?? "");
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  if (
    fileType.startsWith("image/") ||
    metadata.kind === "image" ||
    metadata.kind === "generated_image"
  ) {
    return "image";
  }
  return "document";
}

async function getConversationIdsForDocuments(documentIds: Array<string | number>) {
  const result = new Map<string, string | number | null>();
  if (documentIds.length === 0) return result;

  const supabase = getSupabase();
  const links = await supabase
    .from("message_documents")
    .select("document_id, message_id")
    .in("document_id", documentIds);

  if (links.error || !links.data?.length) return result;

  const messageIds = [...new Set(links.data.map((link) => link.message_id))];
  const messages = await supabase
    .from("messages")
    .select("id, conversation_id")
    .in("id", messageIds);

  if (messages.error || !messages.data?.length) return result;

  const conversationByMessageId = new Map(
    messages.data.map((message) => [String(message.id), message.conversation_id ?? null])
  );

  for (const link of links.data) {
    const conversationId = conversationByMessageId.get(String(link.message_id)) ?? null;
    if (conversationId) result.set(String(link.document_id), conversationId);
  }

  return result;
}

function resultTypeLabel(type: string) {
  if (type === "message") return "Сообщение";
  if (type === "conversation") return "Чат";
  if (type === "document") return "Файл";
  if (type === "image") return "Изображение";
  if (type === "fact") return "Факт";
  if (type === "entity") return "Сущность";
  if (type === "task") return "Задача";
  if (type === "project") return "Проект";
  return "Результат";
}
