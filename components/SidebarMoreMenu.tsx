"use client";

import { FolderOpen, Image as ImageIcon, MoreHorizontal, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type SidebarMoreMenuProps = {
  onFiles: () => void;
  onImages: () => void;
  onSettings: () => void;
};

export function SidebarMoreMenu({ onFiles, onImages, onSettings }: SidebarMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="sidebar-more-menu" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Ещё"
        className="sidebar-action sidebar-action-icon"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <MoreHorizontal size={18} />
      </button>
      {open ? (
        <div className="sidebar-more-dropdown" role="menu">
          <button className="sidebar-more-item" onClick={() => { onFiles(); setOpen(false); }} role="menuitem" type="button">
            <FolderOpen size={16} />
            Файлы
          </button>
          <button className="sidebar-more-item" onClick={() => { onImages(); setOpen(false); }} role="menuitem" type="button">
            <ImageIcon size={16} />
            Изображения
          </button>
          <button className="sidebar-more-item" onClick={() => { onSettings(); setOpen(false); }} role="menuitem" type="button">
            <Settings size={16} />
            Настройки
          </button>
        </div>
      ) : null}
    </div>
  );
}
