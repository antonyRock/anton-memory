"use client";

import { useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";

export function appendAccessToken(url: string, accessToken?: string | null) {
  if (!accessToken?.trim()) return url;

  const parsed = new URL(url, "http://local");
  parsed.searchParams.set("access_token", accessToken.trim());
  return `${parsed.pathname}${parsed.search}`;
}

export function useAuthFetch() {
  const { session } = useAuth();
  const accessToken = session?.access_token;

  const authFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (accessToken) {
        headers.set("Authorization", `Bearer ${accessToken}`);
      }
      return fetch(input, { ...init, headers });
    },
    [accessToken]
  );

  const authUrl = useCallback(
    (url: string) => appendAccessToken(url, accessToken),
    [accessToken]
  );

  return { authFetch, authUrl, accessToken };
}
