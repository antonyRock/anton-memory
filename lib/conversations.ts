import { getOpenAI, chatModel } from "@/lib/openai";
import { getSupabase } from "@/lib/supabase";

export type Conversation = {
  id: string | number;
  title: string | null;
  summary: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_TITLE = "Новый чат";
const LEGACY_CONVERSATION: Conversation = {
  id: "legacy",
  title: "История",
  summary: null,
  metadata: { legacy: true },
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString()
};

export async function listConversations(search = "") {
  const supabase = getSupabase();
  const query = search.trim();

  if (!query) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, summary, metadata, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(40);

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
  const [conversationMatches, messageMatches, documentMatches, factMatches, entityMatches, taskMatches] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id, title, summary, metadata, created_at, updated_at")
        .or(`title.ilike.${pattern},summary.ilike.${pattern}`)
        .order("updated_at", { ascending: false })
        .limit(20),
      supabase
        .from("messages")
        .select("conversation_id, content, created_at")
        .ilike("content", pattern)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("documents")
        .select("id, file_name, extracted_text, created_at")
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
        .limit(10)
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
      ]
    };
  }

  const conversationIds = new Set<string | number>();
  const conversations: Conversation[] = [];

  for (const conversation of conversationMatches.data ?? []) {
    conversationIds.add(conversation.id);
    conversations.push(conversation as Conversation);
  }

  for (const message of messageMatches.data ?? []) {
    if (message.conversation_id) conversationIds.add(message.conversation_id);
  }

  const missingIds = [...conversationIds].filter(
    (id) => !conversations.some((conversation) => String(conversation.id) === String(id))
  );

  if (missingIds.length > 0) {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, summary, metadata, created_at, updated_at")
      .in("id", missingIds)
      .order("updated_at", { ascending: false });
    conversations.push(...((data ?? []) as Conversation[]));
  }

  return {
    conversations: conversations
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
      .slice(0, 40),
    results: [
      ...toResults("message", messageMatches.data, "content"),
      ...toResults("document", documentMatches.data, "extracted_text", "file_name"),
      ...toResults("fact", factMatches.data, "content", "fact"),
      ...toResults("entity", entityMatches.data, "description", "name"),
      ...toResults("task", taskMatches.data, "description", "title")
    ]
  };
}

export async function createConversation(title = DEFAULT_TITLE) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ title })
    .select("id, title, summary, metadata, created_at, updated_at")
    .single();

  if (isMissingConversationSchema(error?.message)) return LEGACY_CONVERSATION;
  if (error) throw new Error(`Could not create conversation: ${error.message}`);
  return data as Conversation;
}

export async function getConversationMessages(conversationId: string | number) {
  const supabase = getSupabase();
  if (String(conversationId) === "legacy") {
    const { data, error } = await supabase
      .from("messages")
      .select("id, role, content, metadata, created_at")
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(`Could not load messages: ${error.message}`);
    return data ?? [];
  }

  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, metadata, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw new Error(`Could not load messages: ${error.message}`);
  return data ?? [];
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
  return Boolean(
    message &&
      (/conversations/i.test(message) ||
        /conversation_id/i.test(message) ||
        /schema cache/i.test(message))
  );
}

function toResults(
  type: string,
  rows: Record<string, unknown>[] | null,
  textKey: string,
  fallbackKey?: string
) {
  return (rows ?? []).map((row) => ({
    type,
    id: row.id ?? row.conversation_id ?? crypto.randomUUID(),
    conversationId: row.conversation_id ?? null,
    title: fallbackKey ? String(row[fallbackKey] ?? type) : type,
    snippet: String(row[textKey] ?? row[fallbackKey ?? ""] ?? "").slice(0, 180)
  }));
}
