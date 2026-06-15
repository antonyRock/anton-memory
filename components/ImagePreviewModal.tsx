"use client";

import { Download, Loader2, X } from "lucide-react";
import {
  resolveAttachmentAssetSources,
  resolveAttachmentDownloadSources
} from "@/lib/attachment-client";
import type { ClientAttachment } from "@/lib/attachment-client";
import { useAuthenticatedAssetSources } from "@/hooks/useAuthenticatedAssetSources";

type ImagePreviewModalProps = {
  attachment: ClientAttachment;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onDownload: (attachment: ClientAttachment) => void | Promise<void>;
};

export function ImagePreviewModal({
  attachment,
  authFetch,
  onClose,
  onDownload
}: ImagePreviewModalProps) {
  const sources = resolveAttachmentAssetSources(attachment, "full");
  const downloadSources = resolveAttachmentDownloadSources(attachment);
  const { blobUrl, status } = useAuthenticatedAssetSources(sources, authFetch);

  return (
    <div className="image-modal" role="dialog" aria-modal="true">
      <button aria-label="Закрыть" className="image-modal-backdrop" onClick={onClose} type="button" />
      <div className="image-modal-content">
        <div className="image-modal-toolbar">
          <button
            aria-label="Скачать изображение"
            className="image-modal-download"
            disabled={downloadSources.length === 0}
            onClick={() => void onDownload(attachment)}
            type="button"
          >
            <Download size={18} />
            Скачать
          </button>
          <button aria-label="Закрыть" className="image-modal-close" onClick={onClose} type="button">
            <X size={20} />
          </button>
        </div>
        <div className="image-modal-preview">
          {status === "loading" ? (
            <div className="image-modal-loading">
              <Loader2 className="spin" size={28} />
              <span>Загрузка изображения...</span>
            </div>
          ) : blobUrl ? (
            <img alt={attachment.fileName} src={blobUrl} />
          ) : (
            <div className="image-modal-error">
              <p>Не удалось загрузить изображение</p>
              {downloadSources.length > 0 ? (
                <button onClick={() => void onDownload(attachment)} type="button">
                  Скачать файл
                </button>
              ) : null}
            </div>
          )}
        </div>
        <div className="image-modal-caption">{attachment.fileName}</div>
      </div>
    </div>
  );
}
