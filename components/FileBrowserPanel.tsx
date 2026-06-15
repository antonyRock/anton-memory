"use client";

import {
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Search,
  Sparkles,
  X
} from "lucide-react";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import type { FileNavGroup, FileNavItem } from "@/lib/file-nav-shared";
import { resolveFileNavPreviewUrl } from "@/lib/file-nav-shared";

export function formatNavFileSize(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

export function formatNavFileDate(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function fileTypeLabel(item: FileNavItem) {
  if (item.isGeneratedImage) return "Сгенерировано";
  if (item.isImage) return "Изображение";
  const lower = item.fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "Excel";
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".pdf")) return "PDF";
  if (lower.endsWith(".docx")) return "Word";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "Текст";
  return item.fileType || "Файл";
}

export function FileNavIcon({ item }: { item: FileNavItem }) {
  if (item.isGeneratedImage) return <Sparkles size={18} />;
  if (item.isImage) return <ImageIcon size={18} />;
  const lower = item.fileName.toLowerCase();
  if (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv") ||
    item.metadata?.kind === "spreadsheet"
  ) {
    return <FileSpreadsheet size={18} />;
  }
  return <FileText size={18} />;
}

type FileBrowserPanelProps = {
  title: string;
  emptyText: string;
  files: FileNavItem[];
  groups?: FileNavGroup[];
  grouped?: boolean;
  layout?: "list" | "grid";
  loading?: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  onOpenFile: (file: FileNavItem) => void;
  onDownloadFile?: (file: FileNavItem) => void;
  onClose?: () => void;
  authFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

export function FileBrowserPanel({
  title,
  emptyText,
  files,
  groups = [],
  grouped = false,
  layout = "list",
  loading = false,
  search,
  onSearchChange,
  onOpenFile,
  onDownloadFile,
  onClose,
  authFetch
}: FileBrowserPanelProps) {
  const isGrid = layout === "grid";

  return (
    <div className="file-browser-panel">
      <div className="file-browser-header">
        <div>
          <h2>{title}</h2>
        </div>
        {onClose ? (
          <button aria-label="Закрыть" className="file-browser-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        ) : null}
      </div>

      <label className="file-browser-search">
        <Search size={16} />
        <input
          aria-label="Поиск файлов"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Поиск по имени или содержимому"
          value={search}
        />
      </label>

      {loading ? (
        <div className="file-browser-empty">
          <Loader2 className="spin" size={22} />
          <span>Загрузка файлов...</span>
        </div>
      ) : grouped ? (
        groups.length > 0 ? (
          <div className="file-browser-groups">
            {groups.map((group) => (
              <section className="file-browser-group" key={String(group.conversationId)}>
                <h3>{group.conversationTitle}</h3>
                {isGrid ? (
                  <div className="file-browser-grid">
                    {group.files.map((file) => (
                      <FileNavImageCard
                        authFetch={authFetch}
                        file={file}
                        key={String(file.id)}
                        onOpen={onOpenFile}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="file-browser-list">
                    {group.files.map((file) => (
                      <FileNavRow
                        authFetch={authFetch}
                        file={file}
                        key={String(file.id)}
                        onDownload={onDownloadFile}
                        onOpen={onOpenFile}
                        showChat={false}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="file-browser-empty">{emptyText}</div>
        )
      ) : files.length > 0 ? (
        isGrid ? (
          <div className="file-browser-grid">
            {files.map((file) => (
              <FileNavImageCard
                authFetch={authFetch}
                file={file}
                key={String(file.id)}
                onOpen={onOpenFile}
              />
            ))}
          </div>
        ) : (
          <div className="file-browser-list">
            {files.map((file) => (
              <FileNavRow
                authFetch={authFetch}
                file={file}
                key={String(file.id)}
                onDownload={onDownloadFile}
                onOpen={onOpenFile}
                showChat
              />
            ))}
          </div>
        )
      ) : (
        <div className="file-browser-empty">{emptyText}</div>
      )}
    </div>
  );
}

function FileNavRow({
  file,
  onOpen,
  onDownload,
  showChat,
  authFetch
}: {
  file: FileNavItem;
  onOpen: (file: FileNavItem) => void;
  onDownload?: (file: FileNavItem) => void;
  showChat: boolean;
  authFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const previewUrl = resolveFileNavPreviewUrl(file);

  return (
    <div className="file-browser-item-row">
      <button className="file-browser-item" onClick={() => onOpen(file)} type="button">
        <div className="file-browser-item-icon">
          {previewUrl && authFetch ? (
            <AuthenticatedImage
              alt=""
              authFetch={authFetch}
              loading="lazy"
              src={previewUrl}
            />
          ) : previewUrl ? (
            <img alt="" loading="lazy" src={previewUrl} />
          ) : (
            <FileNavIcon item={file} />
          )}
        </div>
        <div className="file-browser-item-meta">
          <strong>{file.fileName}</strong>
          <span>
            {fileTypeLabel(file)} · {formatNavFileSize(file.fileSize)}
            {file.createdAt ? ` · ${formatNavFileDate(file.createdAt)}` : ""}
          </span>
          {showChat && file.conversationTitle ? (
            <span className="file-browser-item-source">Чат: {file.conversationTitle}</span>
          ) : null}
        </div>
      </button>
      {onDownload ? (
        <button
          aria-label={`Скачать ${file.fileName}`}
          className="file-browser-item-download"
          onClick={() => onDownload(file)}
          title="Скачать"
          type="button"
        >
          <Download size={16} />
        </button>
      ) : null}
    </div>
  );
}

function FileNavImageCard({
  file,
  onOpen,
  authFetch
}: {
  file: FileNavItem;
  onOpen: (file: FileNavItem) => void;
  authFetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const previewUrl = resolveFileNavPreviewUrl(file);

  return (
    <button
      aria-label={file.fileName}
      className="file-browser-image-card"
      onClick={() => onOpen(file)}
      title={file.fileName}
      type="button"
    >
      <div className="file-browser-image-card-preview">
        {previewUrl && authFetch ? (
          <AuthenticatedImage
            alt={file.fileName}
            authFetch={authFetch}
            loading="lazy"
            src={previewUrl}
          />
        ) : previewUrl ? (
          <img alt={file.fileName} loading="lazy" src={previewUrl} />
        ) : (
          <div className="file-browser-image-card-fallback">
            <FileNavIcon item={file} />
          </div>
        )}
        {file.isGeneratedImage ? (
          <span className="file-browser-image-card-badge">
            <Sparkles size={12} />
          </span>
        ) : null}
      </div>
      <div className="file-browser-image-card-meta">
        <strong>{file.fileName}</strong>
        <span>{formatNavFileDate(file.createdAt)}</span>
      </div>
    </button>
  );
}
