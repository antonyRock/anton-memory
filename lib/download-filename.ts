export function sanitizeDownloadFileName(fileName: string) {
  const trimmed = fileName.trim() || "download";
  return trimmed.replace(/[\\/:*?"<>|]+/g, "_");
}

export function toAsciiDownloadFileName(fileName: string) {
  const trimmed = fileName.trim() || "file";
  const dot = trimmed.lastIndexOf(".");
  const ext = dot > 0 ? trimmed.slice(dot) : "";
  const base = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const asciiBase = base
    .replace(/[^\x20-\x7E]+/g, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  return `${asciiBase || "download"}${ext}`;
}
