import { getSupabase } from "@/lib/supabase";

export type UserProfile = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  tagline: string;
};

export type UserStats = {
  chats: number;
  words: number;
  days: number;
};

export const DEFAULT_USER_ID = "f224756a-d4ae-4f09-a315-9991c03ebe84";

export function getDefaultUserProfile(): UserProfile {
  return {
    id: process.env.DEFAULT_USER_ID?.trim() ?? DEFAULT_USER_ID,
    displayName: process.env.DEFAULT_USER_NAME?.trim() || "Антон",
    avatarUrl: null,
    tagline: "Ты можешь всё!"
  };
}

export function countWordsInText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export async function getUserProfile(userId = DEFAULT_USER_ID): Promise<UserProfile> {
  const fallback = getDefaultUserProfile();
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("users")
    .select("id, display_name, avatar_url, tagline")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (/relation .*users.* does not exist/i.test(error.message)) {
      return fallback;
    }
    console.error("Could not load user profile:", error.message);
    return fallback;
  }

  if (!data) return fallback;

  return {
    id: String(data.id),
    displayName: String(data.display_name ?? fallback.displayName),
    avatarUrl: data.avatar_url ? String(data.avatar_url) : null,
    tagline: String(data.tagline ?? fallback.tagline)
  };
}

async function getUserStatsViaRpc(userId: string): Promise<UserStats | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("get_user_stats", { p_user_id: userId });

  if (error) {
    if (/get_user_stats|function .* does not exist/i.test(error.message)) {
      return null;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { chats: 0, words: 0, days: 0 };
  }

  return {
    chats: Number((row as { chats?: number }).chats ?? 0),
    words: Number((row as { words?: number }).words ?? 0),
    days: Number((row as { days?: number }).days ?? 0)
  };
}

async function conversationIdsForUser(userId: string) {
  const supabase = getSupabase();
  const withUser = await supabase.from("conversations").select("id").eq("user_id", userId);

  if (!withUser.error) {
    return (withUser.data ?? []).map((row) => row.id as string | number);
  }

  if (/user_id/i.test(withUser.error.message)) {
    const all = await supabase.from("conversations").select("id");
    if (all.error) throw new Error(all.error.message);
    return (all.data ?? []).map((row) => row.id as string | number);
  }

  throw new Error(withUser.error.message);
}

async function getUserStatsFallback(userId: string): Promise<UserStats> {
  const supabase = getSupabase();
  const conversationIds = await conversationIdsForUser(userId);

  let chats = conversationIds.length;
  if (conversationIds.length === 0) {
    const countResult = await supabase
      .from("conversations")
      .select("id", { count: "exact", head: true });
    if (!countResult.error) {
      chats = countResult.count ?? 0;
    }
  }

  let words = 0;
  const dayKeys = new Set<string>();
  const pageSize = 500;
  let offset = 0;

  while (true) {
    let query = supabase
      .from("messages")
      .select("content, created_at, conversation_id")
      .eq("role", "user")
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (conversationIds.length > 0) {
      query = query.in("conversation_id", conversationIds);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data?.length) break;

    for (const message of data) {
      words += countWordsInText(String(message.content ?? ""));
      const createdAt = String(message.created_at ?? "");
      if (createdAt) dayKeys.add(createdAt.slice(0, 10));
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return { chats, words, days: dayKeys.size };
}

export async function getUserStats(userId = DEFAULT_USER_ID): Promise<UserStats> {
  try {
    const viaRpc = await getUserStatsViaRpc(userId);
    if (viaRpc) return viaRpc;
    return await getUserStatsFallback(userId);
  } catch (error) {
    console.error("Could not load user stats:", error);
    return { chats: 0, words: 0, days: 0 };
  }
}
