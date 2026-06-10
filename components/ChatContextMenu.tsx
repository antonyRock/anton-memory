"use client";

import { FolderPlus, FileText, Link2, Pencil } from "lucide-react";
import { useEffect, useRef } from "react";

type ChatContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onCreateProject: () => void;
  onCopyLink: () => void;
  onOpenFiles: () => void;
};

export function ChatContextMenu({
  x,
  y,
  onClose,
  onRename,
  onCreateProject,
  onCopyLink,
  onOpenFiles
}: ChatContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let dismissEnabled = false;
    const enableDismissTimer = window.setTimeout(() => {
      dismissEnabled = true;
    }, 350);

    const onPointerDown = (event: PointerEvent) => {
      if (!dismissEnabled) return;
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.clearTimeout(enableDismissTimer);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const padding = 8;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - padding) {
      left = window.innerWidth - rect.width - padding;
    }
    if (top + rect.height > window.innerHeight - padding) {
      top = window.innerHeight - rect.height - padding;
    }
    menu.style.left = `${Math.max(padding, left)}px`;
    menu.style.top = `${Math.max(padding, top)}px`;
  }, [x, y]);

  return (
    <div className="chat-context-menu" ref={menuRef} role="menu" style={{ left: x, top: y }}>
      <button
        onClick={() => {
          onRename();
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        <Pencil size={15} />
        Переименовать
      </button>
      <button
        onClick={() => {
          onCopyLink();
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        <Link2 size={15} />
        Копировать ссылку
      </button>
      <button
        onClick={() => {
          onOpenFiles();
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        <FileText size={15} />
        Файлы чата
      </button>
      <button
        onClick={() => {
          onCreateProject();
          onClose();
        }}
        role="menuitem"
        type="button"
      >
        <FolderPlus size={15} />
        Создать проект
      </button>
    </div>
  );
}
