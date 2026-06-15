"use client";

import { useEffect, useMemo, useState } from "react";
import { shouldAuthFetchAssetUrl } from "@/lib/attachment-client";

const blobCache = new Map<string, string>();

async function loadRemoteAsset(
  src: string,
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
) {
  const cached = blobCache.get(src);
  if (cached) return cached;

  const response = await authFetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  blobCache.set(src, url);
  return url;
}

export function useAuthenticatedAssetSources(
  sources: string[],
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
) {
  const stableSources = useMemo(
    () => [...new Set(sources.filter((source) => source.length > 0))],
    [sources]
  );

  const [blobUrl, setBlobUrl] = useState<string | null>(() => {
    const first = stableSources[0];
    if (!first) return null;
    if (!shouldAuthFetchAssetUrl(first)) return first;
    return blobCache.get(first) ?? null;
  });
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(() => {
    const first = stableSources[0];
    if (!first) return "idle";
    if (!shouldAuthFetchAssetUrl(first)) return "ready";
    return blobCache.has(first) ? "ready" : "loading";
  });

  useEffect(() => {
    if (stableSources.length === 0) {
      setBlobUrl(null);
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    void (async () => {
      for (const source of stableSources) {
        if (cancelled) return;

        if (!shouldAuthFetchAssetUrl(source)) {
          setBlobUrl(source);
          setStatus("ready");
          return;
        }

        const cached = blobCache.get(source);
        if (cached) {
          setBlobUrl(cached);
          setStatus("ready");
          return;
        }

        try {
          const url = await loadRemoteAsset(source, authFetch);
          if (cancelled) return;
          setBlobUrl(url);
          setStatus("ready");
          return;
        } catch {
          // try next source
        }
      }

      if (!cancelled) {
        setBlobUrl(null);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authFetch, stableSources]);

  return { blobUrl, status };
}
