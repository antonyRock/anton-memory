import { buildDocumentInlineUrl } from "@/lib/document-urls";

export type FileNavItem = {
  id: string | number;
  fileName: string;
  fileType: string;
  fileSize: number;
  summary: string | null;
  metadata: Record<string, unknown>;
  previewUrl?: string | null;
  fullUrl?: string | null;
  createdAt: string;
  conversationId: string | number | null;
  conversationTitle: string | null;
  messageId: string | number | null;
  isImage: boolean;
  isGeneratedImage: boolean;
  extractedText?: string;
};

export type FileNavGroup = {
  conversationId: string | number;
  conversationTitle: string;
  files: FileNavItem[];
};

export function resolveFileNavPreviewUrl(
  file: Pick<FileNavItem, "id" | "previewUrl" | "fullUrl" | "isImage">
) {
  if (!file.isImage) return null;
  return file.previewUrl ?? file.fullUrl ?? buildDocumentInlineUrl(file.id);
}
