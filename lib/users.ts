import { getSupabase } from "@/lib/supabase";
import { countWordsInText } from "@/lib/word-count";

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

export type UserKnowledgeStats = {
  links: number;
  documents: number;
  facts: number;
  entities: number;
  tasks: number;
};

export const DEFAULT_USER_ID = "f224756a-d4ae-4f09-a315-9991c03ebe84";
const KNOWLEDGE_STATS_CACHE_TTL_MS = 60_000;
const KNOWLEDGE_LINK_SCAN_LIMIT = 1200;
const knowledgeStatsCache = new Map<
  string,
  { value: UserKnowledgeStats; expiresAt: number }
>();

export function getDefaultUserProfile(): UserProfile {
  return {
    id: process.env.DEFAULT_USER_ID?.trim() ?? DEFAULT_USER_ID,
    displayName: process.env.DEFAULT_USER_NAME?.trim() || "Антон",
    avatarUrl: null,
    tagline: "Ты можешь всё!"
  };
}

export function deriveDisplayName(email?: string | null, explicit?: string) {
  if (explicit?.trim()) return explicit.trim();
  const fromEmail = email?.split("@")[0]?.trim();
  if (fromEmail) return fromEmail;
  return "Пользователь";
}

function emptyProfileForUser(userId: string, displayName = "Пользователь"): UserProfile {
  return {
    id: userId,
    displayName,
    avatarUrl: null,
    tagline: "Ты можешь всё!"
  };
}

export async function ensureUserProfile(
  userId: string,
  options: { displayName?: string; email?: string | null } = {}
): Promise<UserProfile> {
  const supabase = getSupabase();
  const displayName = deriveDisplayName(options.email, options.displayName);

  const { data: existing, error: existingError } = await supabase
    .from("users")
    .select("id, display_name, avatar_url, tagline")
    .eq("id", userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existing) {
    return mapUserProfileRow(existing, emptyProfileForUser(userId, displayName));
  }

  const { data: inserted, error: insertError } = await supabase
    .from("users")
    .insert({
      id: userId,
      display_name: displayName,
      tagline: "Ты можешь всё!"
    })
    .select("id, display_name, avatar_url, tagline")
    .single();

  if (insertError) {
    if (/duplicate|unique/i.test(insertError.message)) {
      const { data: retry, error: retryError } = await supabase
        .from("users")
        .select("id, display_name, avatar_url, tagline")
        .eq("id", userId)
        .maybeSingle();
      if (retryError) throw new Error(retryError.message);
      if (retry) return mapUserProfileRow(retry, emptyProfileForUser(userId, displayName));
    }
    throw new Error(insertError.message);
  }

  return mapUserProfileRow(inserted, emptyProfileForUser(userId, displayName));
}

export async function getUserProfile(
  userId: string,
  options: { email?: string | null } = {}
): Promise<UserProfile> {
  const fallback = emptyProfileForUser(userId, deriveDisplayName(options.email));
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("users")
    .select("id, display_name, avatar_url, tagline")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (/relation .*users.* does not exist/i.test(error.message)) {
      return getDefaultUserProfile();
    }
    console.error("Could not load user profile:", error.message);
    return fallback;
  }

  if (!data) {
    return ensureUserProfile(userId, { email: options.email });
  }

  return mapUserProfileRow(data, fallback);
}

function mapUserProfileRow(
  row: { id: unknown; display_name: unknown; avatar_url: unknown; tagline: unknown },
  fallback: UserProfile
): UserProfile {
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? fallback.displayName),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    tagline: String(row.tagline ?? fallback.tagline)
  };
}

export async function updateUserDisplayName(
  userId: string,
  displayName: string
): Promise<UserProfile> {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new Error("Имя не может быть пустым");
  }

  const fallback = emptyProfileForUser(userId, trimmed);
  const supabase = getSupabase();
  const updatedAt = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("users")
    .update({
      display_name: trimmed,
      updated_at: updatedAt
    })
    .eq("id", userId)
    .select("id, display_name, avatar_url, tagline")
    .maybeSingle();

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (updated) {
    return mapUserProfileRow(updated, fallback);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("users")
    .insert({
      id: userId,
      display_name: trimmed,
      tagline: fallback.tagline
    })
    .select("id, display_name, avatar_url, tagline")
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return mapUserProfileRow(inserted, fallback);
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

export async function getUserKnowledgeStats(userId = DEFAULT_USER_ID): Promise<UserKnowledgeStats> {
  const cached = knowledgeStatsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const empty: UserKnowledgeStats = {
    links: 0,
    documents: 0,
    facts: 0,
    entities: 0,
    tasks: 0
  };

  const [documentsCount, factsCount, entitiesCount, tasksCount, links] = await Promise.all([
    safeKnowledgeCount("documents", userId),
    safeKnowledgeCount("facts", userId),
    safeKnowledgeCount("entities", userId),
    safeKnowledgeCount("tasks", userId),
    safeKnowledgeLinksCount(userId)
  ]);

  const value = {
    links,
    documents: documentsCount,
    facts: factsCount,
    entities: entitiesCount,
    tasks: tasksCount
  };
  knowledgeStatsCache.set(userId, {
    value,
    expiresAt: Date.now() + KNOWLEDGE_STATS_CACHE_TTL_MS
  });
  return value;
}

async function countRowsForUser(
  table: "documents" | "facts" | "entities" | "tasks",
  userId: string
) {
  const supabase = getSupabase();
  const withUser = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (!withUser.error) {
    const scopedCount = withUser.count ?? 0;
    if (scopedCount > 0) return scopedCount;

    const legacy = await supabase.from(table).select("id", { count: "exact", head: true });
    if (!legacy.error) return legacy.count ?? 0;
    throw new Error(legacy.error.message);
  }

  if (/user_id/i.test(withUser.error.message)) {
    const fallback = await supabase.from(table).select("id", { count: "exact", head: true });
    if (!fallback.error) return fallback.count ?? 0;
    throw new Error(fallback.error.message);
  }

  throw new Error(withUser.error.message);
}

async function collectUniqueLinksForUser(userId: string) {
  const supabase = getSupabase();
  const scoped = await collectUniqueLinks(() =>
    supabase
      .from("messages")
      .select("content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(KNOWLEDGE_LINK_SCAN_LIMIT)
  );

  if (scoped.count > 0) return scoped.count;
  if (scoped.error && !/user_id|timeout/i.test(scoped.error.message)) {
    throw new Error(scoped.error.message);
  }

  const legacy = await collectUniqueLinks(() =>
    supabase
      .from("messages")
      .select("content, created_at")
      .order("created_at", { ascending: false })
      .limit(KNOWLEDGE_LINK_SCAN_LIMIT)
  );
  if (legacy.error) throw new Error(legacy.error.message);
  return legacy.count;
}

async function safeKnowledgeCount(
  table: "documents" | "facts" | "entities" | "tasks",
  userId: string
) {
  try {
    return await countRowsForUser(table, userId);
  } catch (error) {
    console.error(`Could not count ${table}:`, error);
    return 0;
  }
}

async function safeKnowledgeLinksCount(userId: string) {
  try {
    return await collectUniqueLinksForUser(userId);
  } catch (error) {
    console.error("Could not count links:", error);
    return 0;
  }
}

function extractHttpLinks(value: string) {
  return (value.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).map((item) =>
    item.trim().replace(/[),.;!?]+$/g, "")
  );
}

async function collectUniqueLinks(
  buildQuery: () => PromiseLike<{
    data: Array<{ content?: unknown }> | null;
    error: { message: string } | null;
  }>
) {
  const links = new Set<string>();
  const result = await buildQuery();
  if (result.error) {
    return { count: 0, error: { message: result.error.message } };
  }
  const rows = result.data ?? [];
  for (const row of rows) {
    const text = String(row.content ?? "");
    for (const link of extractHttpLinks(text)) {
      links.add(link);
    }
  }

  return { count: links.size, error: null as { message: string } | null };
}
