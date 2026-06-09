export function buildDocumentInlineUrl(documentId: string | number) {
  return `/api/documents/${documentId}/download?inline=1`;
}
