import "server-only";

import { getSupabase } from "@/lib/supabase";
import { isTelegramUserAllowed } from "@/lib/telegram-config";

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readUserRow(userId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("users")
    .select("id, metadata, telegram_user_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function telegramIdFromRow(row: {
  telegram_user_id?: unknown;
  metadata?: unknown;
} | null) {
  if (!row) return null;
  if (row.telegram_user_id != null && Number(row.telegram_user_id) > 0) {
    return Number(row.telegram_user_id);
  }
  const metadata = normalizeMetadata(row.metadata);
  if (metadata.telegram_user_id != null && Number(metadata.telegram_user_id) > 0) {
    return Number(metadata.telegram_user_id);
  }
  return null;
}

async function findUserByTelegramId(telegramUserId: number) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("users")
    .select("id, metadata, telegram_user_id")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (!error && data?.id) return String(data.id);

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, metadata, telegram_user_id");

  if (usersError) throw new Error(usersError.message);

  const match = (users ?? []).find((row) => telegramIdFromRow(row) === telegramUserId);
  return match?.id ? String(match.id) : null;
}

export async function resolveTbrainUserIdForTelegram(telegramUserId: number) {
  if (!isTelegramUserAllowed(telegramUserId)) return null;
  return findUserByTelegramId(telegramUserId);
}

export async function getTelegramLinkStatus(tbrainUserId: string) {
  const row = await readUserRow(tbrainUserId);
  const metadata = normalizeMetadata(row?.metadata);
  const linkedTelegramId = telegramIdFromRow(row);

  return {
    linked: linkedTelegramId != null,
    telegramUserId: linkedTelegramId,
    pendingCode:
      typeof metadata.telegram_link_code === "string" ? metadata.telegram_link_code : null,
    pendingExpiresAt:
      typeof metadata.telegram_link_expires_at === "string"
        ? metadata.telegram_link_expires_at
        : null
  };
}

export async function linkTelegramUserToAccount(
  tbrainUserId: string,
  telegramUserId: number
) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("users")
    .update({
      telegram_user_id: telegramUserId,
      updated_at: new Date().toISOString()
    })
    .eq("id", tbrainUserId);

  if (error && /telegram_user_id|column .* does not exist/i.test(error.message)) {
    const existing = await readUserRow(tbrainUserId);
    const metadata = normalizeMetadata(existing?.metadata);
    const { error: metadataError } = await supabase
      .from("users")
      .update({
        metadata: { ...metadata, telegram_user_id: telegramUserId },
        updated_at: new Date().toISOString()
      })
      .eq("id", tbrainUserId);
    if (metadataError) throw new Error(metadataError.message);
    return;
  }

  if (error) throw new Error(error.message);
}

export async function createTelegramLinkCode(tbrainUserId: string) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const supabase = getSupabase();
  const existing = await readUserRow(tbrainUserId);
  const metadata = normalizeMetadata(existing?.metadata);

  const { error } = await supabase
    .from("users")
    .update({
      metadata: {
        ...metadata,
        telegram_link_code: code,
        telegram_link_expires_at: expiresAt
      },
      updated_at: new Date().toISOString()
    })
    .eq("id", tbrainUserId);

  if (error) throw new Error(error.message);
  return { code, expiresAt };
}

export async function linkTelegramByCode(telegramUserId: number, rawCode: string) {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false as const, error: "Укажите код: /link AB12CD" };

  const existingOwner = await findUserByTelegramId(telegramUserId);

  const supabase = getSupabase();
  const { data: users, error } = await supabase
    .from("users")
    .select("id, metadata, telegram_user_id");

  if (error) throw new Error(error.message);

  const now = Date.now();
  const match = (users ?? []).find((user) => {
    const metadata = normalizeMetadata(user.metadata);
    const storedCode = String(metadata.telegram_link_code ?? "").toUpperCase();
    const expiresAt = Date.parse(String(metadata.telegram_link_expires_at ?? ""));
    return storedCode === code && Number.isFinite(expiresAt) && expiresAt > now;
  });

  if (!match) {
    return {
      ok: false as const,
      error: "Код не найден или истёк. В TBrain нажмите «Подключить Telegram» и получите новый."
    };
  }

  if (existingOwner && existingOwner !== String(match.id)) {
    return {
      ok: false as const,
      error: "Этот Telegram уже привязан к другому аккаунту TBrain."
    };
  }

  const metadata = normalizeMetadata(match.metadata);
  await linkTelegramUserToAccount(String(match.id), telegramUserId);

  await supabase
    .from("users")
    .update({
      metadata: {
        ...metadata,
        telegram_link_code: null,
        telegram_link_expires_at: null,
        telegram_user_id: telegramUserId
      },
      updated_at: new Date().toISOString()
    })
    .eq("id", match.id);

  return { ok: true as const, userId: String(match.id) };
}

export function getTelegramBotUsername() {
  const raw = process.env.TELEGRAM_BOT_USERNAME?.trim();
  return raw ? raw.replace(/^@/, "") : "antonyRock_bot";
}
