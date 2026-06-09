"use client";

import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Plus
} from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

type Conversation = {
  id: string | number;
  title: string | null;
  project_id?: string | number | null;
  summary?: string | null;
  created_at?: string;
  updated_at?: string;
};

type Project = {
  id: string | number;
  title: string;
};

type ProjectFolderListProps = {
  projects: Project[];
  conversations: Conversation[];
  activeConversationId: string | number | null;
  expandedProjectIds: Record<string, boolean>;
  openMenuProjectId: string | number | null;
  draggingConversationId: string | number | null;
  dropTargetProjectId: string | "general" | null;
  onCreateProject: () => void;
  onToggleProject: (projectId: string | number) => void;
  onOpenMenu: (projectId: string | number) => void;
  onCloseMenu: () => void;
  onRenameProject: (projectId: string | number, title: string) => void;
  onDeleteProject: (projectId: string | number) => void;
  onOpenConversation: (conversationId: string | number) => void;
  onDragConversationStart: (conversationId: string | number) => void;
  onDragConversationEnd: () => void;
  onDragOverProject: (projectId: string | number) => void;
  onDropOnProject: (projectId: string | number) => void;
  onConversationContextMenu: (
    event: ReactMouseEvent,
    conversationId: string | number
  ) => void;
  conversationTitle: (
    conversation: { id: string | number; title: string | null },
    list: { id: string | number; title: string | null }[],
    index: number
  ) => string;
};

export function ProjectFolderList({
  projects,
  conversations,
  activeConversationId,
  expandedProjectIds,
  openMenuProjectId,
  draggingConversationId,
  dropTargetProjectId,
  onCreateProject,
  onToggleProject,
  onOpenMenu,
  onCloseMenu,
  onRenameProject,
  onDeleteProject,
  onOpenConversation,
  onDragConversationStart,
  onDragConversationEnd,
  onDragOverProject,
  onDropOnProject,
  onConversationContextMenu,
  conversationTitle
}: ProjectFolderListProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (renamingProjectId == null) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingProjectId]);

  useEffect(() => {
    if (openMenuProjectId == null) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        onCloseMenu();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseMenu();
    };

    window.addEventListener("click", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenuProjectId, onCloseMenu]);

  function beginRename(project: Project) {
    setRenamingProjectId(project.id);
    setRenameValue(project.title);
    onCloseMenu();
  }

  function cancelRename() {
    setRenamingProjectId(null);
    setRenameValue("");
  }

  function submitRename(projectId: string | number) {
    const title = renameValue.trim();
    setRenamingProjectId(null);
    setRenameValue("");
    if (title) onRenameProject(projectId, title);
  }

  return (
    <div className="sidebar-section-block">
      <button className="sidebar-inline-action" onClick={onCreateProject} type="button">
        <Plus size={15} />
        Новый проект
      </button>

      <div className="project-folder-list">
        {projects.map((project) => {
          const projectKey = String(project.id);
          const isExpanded = expandedProjectIds[projectKey] ?? false;
          const projectConversations = conversations.filter(
            (conversation) => String(conversation.project_id) === projectKey
          );
          const isDropTarget = dropTargetProjectId === projectKey;

          return (
            <div
              className={`project-folder ${isExpanded ? "is-expanded" : ""} ${
                isDropTarget ? "is-drop-target" : ""
              }`}
              key={project.id}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggingConversationId != null) onDragOverProject(project.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingConversationId != null) onDropOnProject(project.id);
              }}
            >
              <div className="project-folder-header">
                <button
                  className="project-folder-toggle"
                  onClick={() => {
                    if (renamingProjectId === project.id) return;
                    onToggleProject(project.id);
                  }}
                  type="button"
                >
                  {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  <span className="project-folder-icon">
                    {isExpanded ? <FolderOpen size={16} /> : <Folder size={16} />}
                  </span>
                  {renamingProjectId === project.id ? (
                    <input
                      aria-label="Название проекта"
                      className="project-folder-rename-input"
                      onBlur={() => submitRename(project.id)}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          submitRename(project.id);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRename();
                        }
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                      ref={renameInputRef}
                      value={renameValue}
                    />
                  ) : (
                    <span>{project.title}</span>
                  )}
                </button>

                <div className="project-folder-menu-wrap" ref={openMenuProjectId === project.id ? menuRef : null}>
                  <button
                    aria-label="Меню проекта"
                    className="project-folder-menu-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenMenu(project.id);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    type="button"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                  {openMenuProjectId === project.id ? (
                    <div
                      className="project-folder-menu"
                      onMouseDown={(event) => event.stopPropagation()}
                      role="menu"
                    >
                      <button
                        onClick={() => beginRename(project)}
                        role="menuitem"
                        type="button"
                      >
                        Переименовать
                      </button>
                      <button
                        className="danger"
                        onClick={() => onDeleteProject(project.id)}
                        role="menuitem"
                        type="button"
                      >
                        Удалить проект
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="project-folder-chats">
                <div className="project-folder-chats-inner">
                  {projectConversations.length ? (
                    projectConversations.map((conversation, index) => (
                      <button
                        className={`conversation-item nested ${
                          String(conversation.id) === String(activeConversationId) ? "active" : ""
                        } ${String(draggingConversationId) === String(conversation.id) ? "is-dragging" : ""}`}
                        draggable
                        key={conversation.id}
                        onClick={() => onOpenConversation(conversation.id)}
                        onContextMenu={(event) =>
                          onConversationContextMenu(event, conversation.id)
                        }
                        onDragEnd={onDragConversationEnd}
                        onDragStart={() => onDragConversationStart(conversation.id)}
                        type="button"
                      >
                        <span>
                          {conversationTitle(conversation, projectConversations, index)}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="project-folder-empty">Перетащите чат сюда</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
