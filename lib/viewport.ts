const MOBILE_MEDIA_QUERY = "(max-width: 800px)";

export function isMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

export { MOBILE_MEDIA_QUERY };
