import "server-only";

function readList(value: string | undefined) {
  return (value ?? "")
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getTelegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
}

export function getTelegramWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
}

export function getTelegramDefaultUserId() {
  return (
    process.env.TELEGRAM_DEFAULT_USER_ID?.trim() ??
    process.env.DEFAULT_USER_ID?.trim() ??
    ""
  );
}

export function getTelegramAllowedUserIds() {
  return readList(process.env.TELEGRAM_ALLOWED_USER_IDS).map((id) => Number(id));
}

export function isTelegramConfigured() {
  return Boolean(getTelegramBotToken() && getTelegramWebhookSecret());
}

export function isTelegramUserAllowed(telegramUserId: number) {
  const allowed = getTelegramAllowedUserIds();
  if (allowed.length === 0) return true;
  return allowed.includes(telegramUserId);
}
