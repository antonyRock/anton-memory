export const USER_STATS_CACHE_KEY = "tbrainUserStatsCache";
export const DISPLAY_NAME_OVERRIDE_PREFIX = "tbrainDisplayNameOverride:";

export function readDisplayNameOverride(userId: string | undefined): string | null {
  if (!userId || typeof window === "undefined") return null;
  const value = window.localStorage.getItem(`${DISPLAY_NAME_OVERRIDE_PREFIX}${userId}`);
  return value?.trim() ? value : null;
}

export function writeDisplayNameOverride(userId: string, displayName: string) {
  if (typeof window === "undefined") return;
  const trimmed = displayName.trim();
  const key = `${DISPLAY_NAME_OVERRIDE_PREFIX}${userId}`;
  if (trimmed) {
    window.localStorage.setItem(key, trimmed);
  } else {
    window.localStorage.removeItem(key);
  }
}

export function userStatsCacheKey(userId: string) {
  return `${USER_STATS_CACHE_KEY}:${userId}`;
}

export function clearUserClientState(userId?: string) {
  if (typeof window === "undefined") return;
  if (userId) {
    window.sessionStorage.removeItem(userStatsCacheKey(userId));
  }
  window.sessionStorage.removeItem(USER_STATS_CACHE_KEY);
  window.localStorage.removeItem("activeConversationId");
}
