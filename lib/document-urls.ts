export function buildDocumentDownloadUrl(documentId: string | number, inline = false) {
  return inline
    ? `/api/documents/${documentId}/download?inline=1`
    : `/api/documents/${documentId}/download`;
}

export function buildDocumentInlineUrl(documentId: string | number) {
  return buildDocumentDownloadUrl(documentId, true);
}
