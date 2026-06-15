import "server-only";

import { createConversation } from "@/lib/conversations";
import { getCurrentUserId } from "@/lib/current-user";
import { getSupabase } from "@/lib/supabase";

const TELEGRAM_CHAT_TITLE = "📱 Telegram";

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readUserMetadata(userId: string) {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("users")
    .select("metadata")
    .eq("id", userId)
    .maybeSingle();
  return normalizeMetadata(data?.metadata);
}

async function writeTelegramConversationId(userId: string, conversationId: string | number) {
  const supabase = getSupabase();
  const metadata = await readUserMetadata(userId);
  await supabase
    .from("users")
    .update({
      metadata: {
        ...metadata,
        telegram_conversation_id: conversationId
      },
      updated_at: new Date().toISOString()
    })
    .eq("id", userId);
}

export async function getOrCreateTelegramConversation(options: { forceNew?: boolean } = {}) {
  const userId = getCurrentUserId();
  const metadata = await readUserMetadata(userId);
  const storedId = metadata.telegram_conversation_id;

  if (!options.forceNew && storedId != null && String(storedId) !== "legacy") {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", storedId)
      .eq("user_id", userId)
      .maybeSingle();
    if (data?.id != null) return data.id;
  }

  const conversation = await createConversation(TELEGRAM_CHAT_TITLE);
  const conversationId = conversation.id;
  if (conversationId != null && String(conversationId) !== "legacy") {
    const supabase = getSupabase();
    await supabase
      .from("conversations")
      .update({
        metadata: { source: "telegram" },
        updated_at: new Date().toISOString()
      })
      .eq("id", conversationId)
      .eq("user_id", userId);
    await writeTelegramConversationId(userId, conversationId);
  }

  return conversationId;
}
