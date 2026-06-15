"use client";

import { Loader2 } from "lucide-react";
import type { ImgHTMLAttributes, ReactNode } from "react";
import { useAuthenticatedBlobUrl } from "@/hooks/useAuthenticatedBlobUrl";
import { shouldAuthFetchAssetUrl } from "@/lib/attachment-client";

type AuthenticatedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  fallback?: ReactNode;
};

export function AuthenticatedImage({
  src,
  authFetch,
  alt = "",
  className,
  fallback = null,
  onLoad,
  ...props
}: AuthenticatedImageProps) {
  const needsFetch = shouldAuthFetchAssetUrl(src);
  const { blobUrl, status } = useAuthenticatedBlobUrl(needsFetch ? src : src, authFetch);

  if (!needsFetch && src) {
    return <img alt={alt} className={className} onLoad={onLoad} src={src} {...props} />;
  }

  if (status === "loading") {
    return (
      <div aria-hidden="true" className={`authenticated-image-loading ${className ?? ""}`}>
        <Loader2 className="spin" size={18} />
      </div>
    );
  }

  if (status === "error" || !blobUrl) {
    return fallback ? <>{fallback}</> : null;
  }

  return <img alt={alt} className={className} onLoad={onLoad} src={blobUrl} {...props} />;
}
