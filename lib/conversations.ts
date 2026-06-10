import { getDocumentsForMessages, type DocumentAttachment } from "@/lib/documents";
import { getCurrentUserId } from "@/lib/current-user";
import {
  metadataHasHeavyPayload,
  normalizeRecordMetadata,
  resolveStoredImageUrl,
  sanitizeMessageMetadataForClient
} from "@/lib/client-payload";
import { getOpenAI, chatModel, getChatCompletionParams } from "@/lib/openai";
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
  documentId?: string | number | null;
  title: string;
  snippet: string;
  fileName?: string;
  conversationTitle?: string;
  projectTitle?: string;
  matchText?: string;
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
  const userId = getCurrentUserId();
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
        .eq("user_id", userId)
        .or(`title.ilike.${pattern},summary.ilike.${pattern}`)
        .order("updated_at", { ascending: false })
        .limit(20),
      supabase
        .from("messages")
        .select("id, conversation_id, content, created_at")
        .eq("user_id", userId)
        .ilike("content", pattern)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("documents")
        .select("id, file_name, file_type, metadata, extracted_text, summary, created_at")
        .eq("user_id", userId)
        .or(`file_name.ilike.${pattern},extracted_text.ilike.${pattern},summary.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("facts")
        .select("id, content, fact, created_at")
        .eq("user_id", userId)
        .or(`content.ilike.${pattern},fact.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("entities")
        .select("id, name, description, created_at")
        .eq("user_id", userId)
        .or(`name.ilike.${pattern},description.ilike.${pattern}`)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("tasks")
        .select("id, title, description, created_at")
        .eq("user_id", userId)
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
      .eq("user_id", userId)
      .in("id", missingIds)
      .order("updated_at", { ascending: false });

    const missingResult =
      missingWithProject.error && /project_id/i.test(missingWithProject.error.message)
        ? await supabase
            .from("conversations")
            .select(CONVERSATION_SELECT_BASE)
            .eq("user_id", userId)
            .in("id", missingIds)
            .order("updated_at", { ascending: false })
        : missingWithProject;

    conversations.push(...((missingResult.data ?? []) as Conversation[]));
  }

  const conversationTitleById = new Map(
    conversations.map((conversation) => [String(conversation.id), conversation.title ?? "Чат"])
  );
  const conversationProjectIdById = new Map(
    conversations.map((conversation) => [String(conversation.id), conversation.project_id ?? null])
  );

  const projectIds = [
    ...new Set(
      conversations
        .map((conversation) => conversation.project_id)
        .filter((id) => id != null && id !== "")
        .map(String)
    )
  ];
  const projectTitleById = new Map<string, string>();
  if (projectIds.length > 0) {
    const { data: projectRows } = await supabase
      .from("projects")
      .select("id, title")
      .eq("user_id", userId)
      .in("id", projectIds);
    for (const project of projectRows ?? []) {
      projectTitleById.set(String(project.id), String(project.title ?? "Проект"));
    }
  }

  const results = [
    ...toResults("conversation", conversationMatches.data, "summary", "title"),
    ...toResults("message", messageMatches.data, "content"),
    ...toResults(
      "document",
      documentMatches.data,
      "extracted_text",
      "file_name",
      documentConversationIds,
      query,
      conversationTitleById,
      conversationProjectIdById,
      projectTitleById
    ),
    ...toResults("fact", factMatches.data, "content", "fact"),
    ...toResults("entity", entityMatches.data, "description", "name"),
    ...toResults("task", taskMatches.data, "description", "title"),
    ...toResults("project", projectMatches, "description", "title")
  ].map((result) => {
    if (result.type !== "message" || !result.conversationId) return result;
    const chatTitle = conversationTitleById.get(String(result.conversationId));
    return chatTitle
      ? { ...result, conversationTitle: chatTitle, title: chatTitle, snippet: `Чат: ${chatTitle}` }
      : result;
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
  const userId = getCurrentUserId();
  const basePayload: Record<string, unknown> = { title, user_id: userId };
  const payload =
    projectId != null && projectId !== ""
      ? { ...basePayload, project_id: projectId }
      : basePayload;

  let { data, error } = await supabase
    .from("conversations")
    .insert(payload)
    .select(CONVERSATION_SELECT_WITH_PROJECT)
    .single();

  if (error && /user_id/i.test(error.message)) {
    const legacyPayload: Record<string, unknown> =
      projectId != null && projectId !== ""
        ? { title, project_id: projectId }
        : { title };
    ({ data, error } = await supabase
      .from("conversations")
      .insert(legacyPayload)
      .select(CONVERSATION_SELECT_WITH_PROJECT)
      .single());
  }

  if (error && projectId != null && /project_id/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("conversations")
      .insert({ title, user_id: userId })
      .select(CONVERSATION_SELECT_BASE)
      .single());
  }

  if (error && projectId != null && /project_id|user_id/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("conversations")
      .insert({ title })
      .select(CONVERSATION_SELECT_BASE)
      .single());
  }

  if (isMissingConversationSchema(error?.message)) return LEGACY_CONVERSATION;
  if (error) throw new Error(`Could not create conversation: ${error.message}`);
  return data as Conversation;
}

export async function updateConversationTitle(
  conversationId: string | number,
  title: string
) {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const trimmed = title.trim().slice(0, 80);
  if (!trimmed) throw new Error("Title is required.");

  let { data, error } = await supabase
    .from("conversations")
    .update({ title: trimmed, updated_at: new Date().toISOString() })
    .select(CONVERSATION_SELECT_WITH_PROJECT)
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single();

  if (error && /project_id/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("conversations")
      .update({ title: trimmed, updated_at: new Date().toISOString() })
      .select(CONVERSATION_SELECT_BASE)
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single());
  }

  if (error) throw new Error(`Could not rename conversation: ${error.message}`);
  return data as Conversation;
}

export async function updateConversationPinned(
  conversationId: string | number,
  pinned: boolean
) {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const { data: current, error: readError } = await supabase
    .from("conversations")
    .select("metadata")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single();

  if (readError) throw new Error(`Could not read conversation metadata: ${readError.message}`);

  const metadata = normalizeRecordMetadata(current?.metadata);
  const nextMetadata = { ...metadata };

  if (pinned) {
    nextMetadata.pinned = true;
    nextMetadata.pinned_at = new Date().toISOString();
  } else {
    delete nextMetadata.pinned;
    delete nextMetadata.pinned_at;
  }

  let { data, error } = await supabase
    .from("conversations")
    .update({
      metadata: nextMetadata,
      updated_at: new Date().toISOString()
    })
    .select(CONVERSATION_SELECT_WITH_PROJECT)
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single();

  if (error && /project_id/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("conversations")
      .update({
        metadata: nextMetadata,
        updated_at: new Date().toISOString()
      })
      .select(CONVERSATION_SELECT_BASE)
      .eq("id", conversationId)
      .eq("user_id", userId)
      .single());
  }

  if (error) throw new Error(`Could not update conversation pin: ${error.message}`);
  return data as Conversation;
}

export async function getConversationMessageTexts(conversationId: string | number) {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const query =
    String(conversationId) === "legacy"
      ? supabase
          .from("messages")
          .select("role, content")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(200)
      : supabase
          .from("messages")
          .select("role, content")
          .eq("user_id", userId)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(200);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load messages: ${error.message}`);
  return data ?? [];
}

async function cleanupHeavyMessageMetadata(
  messages: Array<{ id: string | number; metadata?: unknown }>
) {
  const supabase = getSupabase();

  for (const message of messages) {
    const metadata = normalizeRecordMetadata(message.metadata);
    if (!metadataHasHeavyPayload(metadata)) continue;

    void supabase
      .from("messages")
      .update({ metadata: sanitizeMessageMetadataForClient(metadata) })
      .eq("id", message.id)
      .then(({ error }) => {
        if (error) {
          console.error("Could not cleanup heavy message metadata:", error.message);
        }
      });
  }
}

export async function getConversationMessages(conversationId: string | number) {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const query =
    String(conversationId) === "legacy"
      ? supabase
          .from("messages")
          .select("id, role, content, metadata, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(200)
      : supabase
          .from("messages")
          .select("id, role, content, metadata, created_at")
          .eq("user_id", userId)
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(200);

  const { data, error } = await query;
  if (error) throw new Error(`Could not load messages: ${error.message}`);

  const messages = (data ?? []).map((message) => ({
    ...message,
    metadata: sanitizeMessageMetadataForClient(normalizeRecordMetadata(message.metadata))
  }));
  void cleanupHeavyMessageMetadata(messages);

  let documentsByMessage = new Map<string, DocumentAttachment[]>();
  try {
    documentsByMessage = await getDocumentsForMessages(messages);
  } catch (error) {
    console.error("Could not load message attachments:", error);
  }

  return messages.map((message) => {
    const attachments = documentsByMessage.get(String(message.id)) ?? [];
    const generatedImage = attachments.find(
      (attachment) => attachment.metadata?.kind === "generated_image"
    );
    const metadata = normalizeRecordMetadata(message.metadata) as {
      generated_document_id?: string | number;
      image_preview_url?: string;
    };

    const imageUrl = resolveStoredImageUrl({
      generatedDocumentId: metadata.generated_document_id,
      imagePreviewUrl:
        typeof metadata.image_preview_url === "string" ? metadata.image_preview_url : null,
      attachmentPreviewUrl: generatedImage?.previewUrl ?? null,
      attachmentFullUrl: generatedImage?.fullUrl ?? null
    });

    return {
      id: message.id,
      role: message.role,
      content: message.content,
      created_at: message.created_at,
      attachments,
      imageUrl,
      metadata: sanitizeMessageMetadataForClient(metadata)
    };
  });
}

export async function getShortTermContext(conversationId?: string | number) {
  if (!conversationId) return [];
  const messages = await getConversationMessageTexts(conversationId);
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

export async function getReferencedConversationsContext(ids: Array<string | number>) {
  if (ids.length === 0) return "";

  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const uniqueIds = [...new Set(ids.map((id) => String(id)))];
  const blocks: string[] = [];

  for (const id of uniqueIds) {
    const [{ data: conversation }, messages] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, title")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle(),
      getConversationMessageTexts(id)
    ]);

    const title = String(conversation?.title ?? `Чат ${id}`).trim() || `Чат ${id}`;
    const excerpt = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-16)
      .map((message) => `${message.role}: ${String(message.content ?? "").slice(0, 800)}`)
      .join("\n");

    if (!excerpt) continue;

    blocks.push(`Чат #${id} «${title}»:\n${excerpt}`);
  }

  return blocks.join("\n\n---\n\n");
}

export async function touchConversation(conversationId?: string | number) {
  if (!conversationId || String(conversationId) === "legacy") return;
  const supabase = getSupabase();
  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", getCurrentUserId());
}

export async function maybeGenerateConversationTitle(input: {
  conversationId?: string | number;
  userMessage: string;
  assistantAnswer: string;
}) {
  if (!input.conversationId || String(input.conversationId) === "legacy") return;
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const { data, error } = await supabase
    .from("conversations")
    .select("title")
    .eq("id", input.conversationId)
    .eq("user_id", userId)
    .single();

  if (error) return;
  const currentTitle = String(data?.title ?? "").trim();
  if (currentTitle && currentTitle !== DEFAULT_TITLE) return;

  try {
    const result = await getOpenAI().chat.completions.create({
      model: chatModel,
      ...getChatCompletionParams({ temperature: 0.2 }),
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
      .eq("id", input.conversationId)
      .eq("user_id", userId);
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
  const userId = getCurrentUserId();

  if (!projectId) {
    const withProject = await supabase
      .from("conversations")
      .select(CONVERSATION_SELECT_WITH_PROJECT)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (!withProject.error || !/project_id/i.test(withProject.error.message)) {
      return withProject;
    }

    return supabase
      .from("conversations")
      .select(CONVERSATION_SELECT_BASE)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(limit);
  }

  let request = supabase
    .from("conversations")
    .select(CONVERSATION_SELECT_WITH_PROJECT)
    .eq("user_id", userId)
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
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);
}

function toResults(
  type: string,
  rows: Record<string, unknown>[] | null,
  textKey: string,
  nameKey?: string,
  conversationIdsByRowId?: Map<string, string | number | null>,
  query = "",
  conversationTitleById?: Map<string, string>,
  conversationProjectIdById?: Map<string, string | number | null>,
  projectTitleById?: Map<string, string>
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

    const base: SearchResultItem = {
      type: resolvedType,
      typeLabel,
      id: (row.id ?? row.conversation_id ?? crypto.randomUUID()) as string | number,
      conversationId,
      title,
      snippet: snippet.slice(0, 180)
    };

    if (resolvedType !== "document" && resolvedType !== "image") {
      return base;
    }

    const conversationTitle =
      conversationId != null
        ? conversationTitleById?.get(String(conversationId)) ?? undefined
        : undefined;
    const projectId =
      conversationId != null
        ? conversationProjectIdById?.get(String(conversationId)) ?? null
        : null;
    const projectTitle =
      projectId != null ? projectTitleById?.get(String(projectId)) ?? undefined : undefined;
    const fileName = nameValue || "Файл";
    const queryLower = query.trim().toLowerCase();
    const nameMatches = queryLower.length > 0 && fileName.toLowerCase().includes(queryLower);
    const contentMatches =
      queryLower.length > 0 && textValue.toLowerCase().includes(queryLower);
    const matchText =
      contentMatches && textValue ? extractMatchSnippet(textValue, query) : undefined;

    const snippetParts: string[] = [];
    if (projectTitle) snippetParts.push(`Проект: ${projectTitle}`);
    if (conversationTitle) snippetParts.push(`Чат: ${conversationTitle}`);
    if (matchText && !nameMatches) snippetParts.push(`Совпадение: ${matchText}`);
    else if (matchText && nameMatches && contentMatches) {
      snippetParts.push(`Совпадение: ${matchText}`);
    }

    return {
      ...base,
      documentId: row.id as string | number,
      fileName,
      conversationTitle,
      projectTitle,
      matchText,
      title: fileName,
      snippet: snippetParts.join(" · ") || base.snippet
    };
  });
}

function extractMatchSnippet(text: string, query: string, radius = 48) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return text.slice(0, 120);

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmedQuery.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return text.slice(0, 120);

  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + trimmedQuery.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
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
    .eq("user_id", getCurrentUserId())
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
