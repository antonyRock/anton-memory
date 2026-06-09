"use client";

import { FolderPlus } from "lucide-react";
import { useEffect, useRef } from "react";

type ChatContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  onCreateProject: () => void;
};

export function ChatContextMenu({ x, y, onClose, onCreateProject }: ChatContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onScroll = () => onClose();

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
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
