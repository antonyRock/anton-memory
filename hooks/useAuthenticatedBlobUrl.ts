"use client";

import { useEffect, useState } from "react";
import { shouldAuthFetchAssetUrl } from "@/lib/attachment-client";

const blobCache = new Map<string, string>();

export function useAuthenticatedBlobUrl(
  src: string | null | undefined,
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
) {
  const [blobUrl, setBlobUrl] = useState<string | null>(() => {
    if (!src) return null;
    if (!shouldAuthFetchAssetUrl(src)) return src;
    return blobCache.get(src) ?? null;
  });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(() => {
    if (!src) return "idle";
    if (!shouldAuthFetchAssetUrl(src)) return "ready";
    return blobCache.has(src) ? "ready" : "loading";
  });

  useEffect(() => {
    if (!src) {
      setBlobUrl(null);
      setStatus("idle");
      return;
    }

    if (!shouldAuthFetchAssetUrl(src)) {
      setBlobUrl(src);
      setStatus("ready");
      return;
    }

    const cached = blobCache.get(src);
    if (cached) {
      setBlobUrl(cached);
      setStatus("ready");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    void (async () => {
      try {
        const response = await authFetch(src);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        blobCache.set(src, url);
        setBlobUrl(url);
        setStatus("ready");
      } catch {
        if (!cancelled) {
          setBlobUrl(null);
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authFetch, src]);

  return { blobUrl, status };
}
