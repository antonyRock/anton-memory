export function inferMimeTypeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export function resolveDocumentMimeType(fileType: string, fileName: string) {
  const normalized = fileType.trim().toLowerCase();
  if (normalized && normalized !== "application/octet-stream") return fileType;
  return inferMimeTypeFromName(fileName);
}

export function isImageFileName(fileName: string) {
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(fileName);
}

export function isImageDocument(input: {
  file_type?: string;
  fileType?: string;
  file_name?: string;
  fileName?: string;
  metadata?: { kind?: string } | null;
}) {
  const fileType = input.file_type ?? input.fileType ?? "";
  const fileName = input.file_name ?? input.fileName ?? "";
  const metadata = input.metadata;
  const mime = resolveDocumentMimeType(fileType, fileName);

  return (
    mime.startsWith("image/") ||
    metadata?.kind === "image" ||
    metadata?.kind === "generated_image" ||
    isImageFileName(fileName)
  );
}
