import { normalizeRecordMetadata } from "@/lib/client-payload";

type SidebarConversation = {
  metadata?: Record<string, unknown> | null;
  updated_at?: string;
};

export function isConversationPinned(conversation: {
  metadata?: Record<string, unknown> | null;
}) {
  const metadata = normalizeRecordMetadata(conversation.metadata);
  return metadata.pinned === true;
}

export function sortConversationsForSidebar<T extends SidebarConversation>(conversations: T[]) {
  return [...conversations].sort((a, b) => {
    const aPinned = isConversationPinned(a);
    const bPinned = isConversationPinned(b);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    if (aPinned && bPinned) {
      const aPinnedAt = String(normalizeRecordMetadata(a.metadata).pinned_at ?? "");
      const bPinnedAt = String(normalizeRecordMetadata(b.metadata).pinned_at ?? "");
      if (aPinnedAt !== bPinnedAt) {
        return bPinnedAt.localeCompare(aPinnedAt);
      }
    }

    return String(b.updated_at ?? "").localeCompare(String(b.updated_at ?? ""));
  });
}
