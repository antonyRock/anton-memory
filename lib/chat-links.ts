export function buildChatUrl(conversationId: string | number, origin?: string) {
  const base =
    origin ??
    (typeof window !== "undefined" ? window.location.origin : "") ??
    "";
  const url = new URL(base || "http://localhost");
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("chat", String(conversationId));
  return url.toString();
}

export function parseChatIdFromText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const fromQuery = url.searchParams.get("chat");
    if (fromQuery) return fromQuery;

    const pathMatch = url.pathname.match(/\/c\/([^/]+)/i);
    if (pathMatch?.[1]) return pathMatch[1];
  } catch {
    // Not a full URL — try query fragment patterns below.
  }

  const queryMatch = trimmed.match(/[?&]chat=([^&\s#]+)/i);
  if (queryMatch?.[1]) return decodeURIComponent(queryMatch[1]);

  return null;
}

export function extractChatIdsFromText(value: string) {
  const ids = new Set<string>();
  const direct = parseChatIdFromText(value);
  if (direct) ids.add(direct);

  const urlPattern = /https?:\/\/[^\s]+/gi;
  for (const match of value.match(urlPattern) ?? []) {
    const id = parseChatIdFromText(match);
    if (id) ids.add(id);
  }

  return [...ids];
}

export function syncChatQueryParam(conversationId: string | number | null) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (conversationId) url.searchParams.set("chat", String(conversationId));
  else url.searchParams.delete("chat");

  window.history.replaceState({}, "", url);
}
