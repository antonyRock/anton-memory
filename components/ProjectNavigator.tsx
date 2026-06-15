"use client";

import { ArrowLeft, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { FileBrowserPanel } from "@/components/FileBrowserPanel";
import { useAuthFetch } from "@/hooks/useAuthFetch";
import type { FileNavGroup, FileNavItem } from "@/lib/file-nav-shared";

type ProjectTab = "chats" | "files" | "images";

type ProjectNavigatorProps = {
  projectId: string | number;
  projectTitle: string;
  initialTab?: ProjectTab;
  conversations: Array<{ id: string | number; title: string | null }>;
  onBack: () => void;
  onNewChat: () => void;
  onOpenConversation: (conversationId: string | number) => void;
  onOpenFile: (file: FileNavItem) => void;
  onDownloadFile?: (file: FileNavItem) => void;
};

export function ProjectNavigator({
  projectId,
  projectTitle,
  initialTab = "chats",
  conversations,
  onBack,
  onNewChat,
  onOpenConversation,
  onOpenFile,
  onDownloadFile
}: ProjectNavigatorProps) {
  const { authFetch } = useAuthFetch();
  const [tab, setTab] = useState<ProjectTab>(initialTab);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<FileNavItem[]>([]);
  const [groups, setGroups] = useState<FileNavGroup[]>([]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, projectId]);

  useEffect(() => {
    if (tab === "chats") return;

    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          kind: tab === "images" ? "images" : "files",
          search
        });
        const response = await authFetch(`/api/projects/${projectId}/files?${params.toString()}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить файлы проекта");
        setFiles(data.files ?? []);
        setGroups(data.groups ?? []);
      } catch {
        setFiles([]);
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => window.clearTimeout(handle);
  }, [authFetch, projectId, search, tab]);

  return (
    <div className="project-navigator">
      <div className="project-navigator-top">
        <button aria-label="Назад" className="project-navigator-back" onClick={onBack} type="button">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1>{projectTitle}</h1>
          <p>Проект</p>
        </div>
      </div>

      <div className="project-nav-tabs" role="tablist">
        <button
          aria-selected={tab === "chats"}
          className={tab === "chats" ? "is-active" : ""}
          onClick={() => setTab("chats")}
          role="tab"
          type="button"
        >
          Чаты
        </button>
        <button
          aria-selected={tab === "files"}
          className={tab === "files" ? "is-active" : ""}
          onClick={() => setTab("files")}
          role="tab"
          type="button"
        >
          Файлы
        </button>
        <button
          aria-selected={tab === "images"}
          className={tab === "images" ? "is-active" : ""}
          onClick={() => setTab("images")}
          role="tab"
          type="button"
        >
          Изображения
        </button>
      </div>

      {tab === "chats" ? (
        <div className="project-chat-list">
          <button className="project-new-chat-button" onClick={onNewChat} type="button">
            <Plus size={16} />
            Новый чат
          </button>
          {conversations.length > 0 ? (
            conversations.map((conversation, index) => (
              <button
                className="project-chat-item"
                key={String(conversation.id)}
                onClick={() => onOpenConversation(conversation.id)}
                type="button"
              >
                <strong>{conversation.title?.trim() || `Чат ${index + 1}`}</strong>
              </button>
            ))
          ) : (
            <div className="file-browser-empty">В проекте пока нет чатов</div>
          )}
        </div>
      ) : (
        <FileBrowserPanel
          emptyText={tab === "images" ? "В проекте пока нет изображений" : "В проекте пока нет файлов"}
          files={files}
          grouped
          groups={groups}
          layout={tab === "images" ? "grid" : "list"}
          loading={loading}
          onDownloadFile={onDownloadFile}
          onOpenFile={onOpenFile}
          onSearchChange={setSearch}
          authFetch={authFetch}
          search={search}
          title={tab === "images" ? "Изображения проекта" : "Файлы проекта"}
        />
      )}
    </div>
  );
}
