"use client";

import { useEffect, useState } from "react";
import { FileBrowserPanel } from "@/components/FileBrowserPanel";
import { useAuthFetch } from "@/hooks/useAuthFetch";
import type { FileNavItem } from "@/lib/file-nav-shared";

type ChatFilesPanelProps = {
  conversationId: string | number;
  conversationTitle: string;
  kind?: "files" | "images";
  onClose: () => void;
  onOpenFile: (file: FileNavItem) => void;
  onDownloadFile?: (file: FileNavItem) => void;
};

export function ChatFilesPanel({
  conversationId,
  conversationTitle,
  kind = "files",
  onClose,
  onOpenFile,
  onDownloadFile
}: ChatFilesPanelProps) {
  const { authFetch } = useAuthFetch();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<FileNavItem[]>([]);

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ kind, search });
        const response = await authFetch(
          `/api/conversations/${conversationId}/files?${params.toString()}`
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить файлы чата");
        setFiles(data.files ?? []);
      } catch {
        setFiles([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => window.clearTimeout(handle);
  }, [authFetch, conversationId, kind, search]);

  return (
    <div className="chat-files-overlay" role="presentation">
      <button aria-label="Закрыть" className="chat-files-backdrop" onClick={onClose} type="button" />
      <div className="chat-files-panel" role="dialog" aria-modal="true">
        <FileBrowserPanel
          emptyText={
            kind === "images"
              ? "В этом чате пока нет изображений"
              : "В этом чате пока нет файлов"
          }
          files={files}
          layout={kind === "images" ? "grid" : "list"}
          loading={loading}
          onClose={onClose}
          onDownloadFile={onDownloadFile}
          onOpenFile={onOpenFile}
          onSearchChange={setSearch}
          authFetch={authFetch}
          search={search}
          title={
            kind === "images"
              ? `Изображения чата: ${conversationTitle}`
              : `Файлы чата: ${conversationTitle}`
          }
        />
      </div>
    </div>
  );
}
