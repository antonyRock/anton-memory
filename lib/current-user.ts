import "server-only";

import { getRequestUserId } from "@/lib/request-context";

export const DEFAULT_USER_ID = "f224756a-d4ae-4f09-a315-9991c03ebe84";

export function getCurrentUserId(): string {
  const userId = getRequestUserId();
  if (!userId) {
    throw new Error("Missing authenticated user context");
  }
  return userId;
}
