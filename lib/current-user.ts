import "server-only";

import { getRequestUserId } from "@/lib/request-context";

export const DEFAULT_USER_ID = "f224756a-d4ae-4f09-a315-9991c03ebe84";

export function getCurrentUserId() {
  return getRequestUserId() ?? process.env.DEFAULT_USER_ID?.trim() ?? DEFAULT_USER_ID;
}
