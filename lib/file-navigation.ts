import "server-only";

import { getDocumentAttachments, type DocumentAttachment } from "@/lib/documents";
import { isImageDocument } from "@/lib/projects";
import { getSupabase } from "@/lib/supabase";
import { getCurrentUserId } from "@/lib/current-user";
import type { FileNavGroup, FileNavItem } from "@/lib/file-nav-shared";

export type { FileNavGroup, FileNavItem } from "@/lib/file-nav-shared";
export { resolveFileNavPreviewUrl } from "@/lib/file-nav-shared";

type FileKind = "files" | "images" | "all";

type ListOptions = {
  search?: string;
  kind?: FileKind;
};

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function matchesKind(item: FileNavItem, kind: FileKind) {
  if (kind === "all") return true;
  if (kind === "images") return item.isImage;
  return !item.isImage;
}

function matchesSearch(item: FileNavItem, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  if (item.fileName.toLowerCase().includes(query)) return true;
  if (item.summary?.toLowerCase().includes(query)) return true;
  if (item.extractedText?.toLowerCase().includes(query)) return true;
  return false;
}

function sortFiles(files: FileNavItem[]) {
  return [...files].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

async function collectDocumentSourcesForMessages(
  messages: Array<{ id: string | number; conversation_id?: string | number | null; metadata?: unknown }>
) {
  const supabase = getSupabase();
  const messageIds = messages.map((message) => Number(message.id)).filter(Number.isFinite);
  const documentSources = new Map<
    string,
    { messageId: string | number | null; conversationId: string | number | null }
  >();

  for (const message of messages) {
    const metadata = normalizeMetadata(message.metadata);
    const ids = [
      ...(Array.isArray(metadata.document_ids) ? metadata.document_ids : []),
      ...(metadata.generated_document_id != null ? [metadata.generated_document_id] : [])
    ];
    for (const documentId of ids) {
      documentSources.set(String(documentId), {
        messageId: message.id,
        conversationId: message.conversation_id ?? null
      });
    }
  }

  if (messageIds.length > 0) {
    const { data: links } = await supabase
      .from("message_documents")
      .select("message_id, document_id")
      .in("message_id", messageIds);

    const messageConversation = new Map(
      messages.map((message) => [String(message.id), message.conversation_id ?? null])
    );

    for (const link of links ?? []) {
      documentSources.set(String(link.document_id), {
        messageId: link.message_id,
        conversationId: messageConversation.get(String(link.message_id)) ?? null
      });
    }
  }

  return documentSources;
}

async function buildFileNavItems(input: {
  documentRows: Array<Record<string, unknown>>;
  documentSources: Map<string, { messageId: string | number | null; conversationId: string | number | null }>;
  conversationTitles: Map<string, string>;
}) {
  const ids = input.documentRows.map((row) => row.id as string | number);
  const attachments = await getDocumentAttachments(ids);
  const attachmentById = new Map(attachments.map((item) => [String(item.id), item]));
  const createdAtById = new Map(
    input.documentRows.map((row) => [String(row.id), String(row.created_at ?? "")])
  );

  const items: FileNavItem[] = [];

  for (const row of input.documentRows) {
    const attachment = attachmentById.get(String(row.id));
    if (!attachment) continue;

    const source = input.documentSources.get(String(row.id));
    const conversationId = source?.conversationId ?? null;
    const metadata = normalizeMetadata(row.metadata);
    const isImage = isImageDocument({
      file_type: attachment.fileType,
      file_name: attachment.fileName,
      metadata
    });
    const isGeneratedImage = metadata.kind === "generated_image";

    items.push({
      ...attachment,
      createdAt: createdAtById.get(String(row.id)) ?? "",
      conversationId,
      conversationTitle:
        conversationId != null
          ? input.conversationTitles.get(String(conversationId)) ?? `Чат ${conversationId}`
          : null,
      messageId: source?.messageId ?? null,
      isImage,
      isGeneratedImage,
      extractedText: String(row.extracted_text ?? "")
    });
  }

  return items;
}

export async function listConversationDocuments(
  conversationId: string | number,
  options: ListOptions = {}
) {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const kind = options.kind ?? "all";

  const [{ data: conversation }, { data: messages }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("id, conversation_id, metadata")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(500)
  ]);

  const documentSources = await collectDocumentSourcesForMessages(messages ?? []);
  const documentIds = [...documentSources.keys()];
  if (documentIds.length === 0) {
    return {
      conversation: {
        id: conversationId,
        title: String(conversation?.title ?? "Чат")
      },
      files: [] as FileNavItem[]
    };
  }

  const { data: documentRows } = await supabase
    .from("documents")
    .select("id, file_name, file_type, file_size, storage_path, summary, extracted_text, metadata, created_at")
    .in(
      "id",
      documentIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    )
    .order("created_at", { ascending: false });

  const conversationTitles = new Map([[String(conversationId), String(conversation?.title ?? "Чат")]]);
  const items = await buildFileNavItems({
    documentRows: documentRows ?? [],
    documentSources,
    conversationTitles
  });

  return {
    conversation: {
      id: conversationId,
      title: String(conversation?.title ?? "Чат")
    },
    files: sortFiles(items.filter((item) => matchesKind(item, kind) && matchesSearch(item, options.search ?? "")))
  };
}

export async function listProjectDocuments(projectId: string | number, options: ListOptions = {}) {
  const supabase = getSupabase();
  const userId = getCurrentUserId();
  const kind = options.kind ?? "all";

  const [{ data: project }, { data: conversations }] = await Promise.all([
    supabase.from("projects").select("id, title").eq("id", projectId).eq("user_id", userId).single(),
    supabase
      .from("conversations")
      .select("id, title")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(100)
  ]);

  const conversationTitles = new Map(
    (conversations ?? []).map((conversation) => [String(conversation.id), String(conversation.title ?? "Чат")])
  );
  const conversationIds = (conversations ?? []).map((conversation) => conversation.id);

  let documentSources = new Map<
    string,
    { messageId: string | number | null; conversationId: string | number | null }
  >();

  if (conversationIds.length > 0) {
    const { data: messages } = await supabase
      .from("messages")
      .select("id, conversation_id, metadata")
      .eq("user_id", userId)
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(2000);

    documentSources = await collectDocumentSourcesForMessages(messages ?? []);
  }

  const { data: projectDocuments } = await supabase
    .from("documents")
    .select("id, file_name, file_type, file_size, storage_path, summary, extracted_text, metadata, created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(300);

  for (const document of projectDocuments ?? []) {
    if (!documentSources.has(String(document.id))) {
      documentSources.set(String(document.id), {
        messageId: null,
        conversationId: conversationIds[0] ?? null
      });
    }
  }

  const documentIds = [...documentSources.keys()];
  if (documentIds.length === 0) {
    return {
      project: { id: projectId, title: String(project?.title ?? "Проект") },
      files: [] as FileNavItem[],
      groups: [] as FileNavGroup[]
    };
  }

  const { data: linkedDocuments } = await supabase
    .from("documents")
    .select("id, file_name, file_type, file_size, storage_path, summary, extracted_text, metadata, created_at")
    .in(
      "id",
      documentIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
    )
    .order("created_at", { ascending: false });

  const rowsById = new Map<string, Record<string, unknown>>();
  for (const row of linkedDocuments ?? []) {
    rowsById.set(String(row.id), row as Record<string, unknown>);
  }
  for (const row of projectDocuments ?? []) {
    rowsById.set(String(row.id), row as Record<string, unknown>);
  }

  const items = await buildFileNavItems({
    documentRows: [...rowsById.values()],
    documentSources,
    conversationTitles
  });

  const filtered = sortFiles(
    items.filter((item) => matchesKind(item, kind) && matchesSearch(item, options.search ?? ""))
  );

  const groupsMap = new Map<string, FileNavGroup>();
  for (const file of filtered) {
    if (file.conversationId == null) continue;
    const key = String(file.conversationId);
    const existing = groupsMap.get(key) ?? {
      conversationId: file.conversationId,
      conversationTitle: file.conversationTitle ?? conversationTitles.get(key) ?? `Чат ${key}`,
      files: []
    };
    existing.files.push(file);
    groupsMap.set(key, existing);
  }

  const groups = [...groupsMap.values()].sort((a, b) =>
    a.conversationTitle.localeCompare(b.conversationTitle, "ru")
  );

  return {
    project: { id: projectId, title: String(project?.title ?? "Проект") },
    files: filtered,
    groups
  };
}
