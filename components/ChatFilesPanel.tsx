"use client";

import { useEffect, useState } from "react";
import { FileBrowserPanel } from "@/components/FileBrowserPanel";
import type { FileNavItem } from "@/lib/file-navigation";

type ChatFilesPanelProps = {
  conversationId: string | number;
  conversationTitle: string;
  onClose: () => void;
  onOpenFile: (file: FileNavItem) => void;
};

export function ChatFilesPanel({
  conversationId,
  conversationTitle,
  onClose,
  onOpenFile
}: ChatFilesPanelProps) {
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [files, setFiles] = useState<FileNavItem[]>([]);

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ kind: "all", search });
        const response = await fetch(
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
  }, [conversationId, search]);

  return (
    <div className="chat-files-overlay" role="presentation">
      <button aria-label="Закрыть" className="chat-files-backdrop" onClick={onClose} type="button" />
      <div className="chat-files-panel" role="dialog" aria-modal="true">
        <FileBrowserPanel
          emptyText="В этом чате пока нет файлов"
          files={files}
          loading={loading}
          onClose={onClose}
          onOpenFile={onOpenFile}
          onSearchChange={setSearch}
          search={search}
          title={`Файлы чата: ${conversationTitle}`}
        />
      </div>
    </div>
  );
}
