"use client";

import { Pin } from "lucide-react";
import { useCallback, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useLongPress } from "@/hooks/useLongPress";
import { triggerHapticPulse } from "@/lib/haptics";

type SidebarConversationItemProps = {
  conversationId: string | number;
  title: string;
  active: boolean;
  pinned: boolean;
  dragging: boolean;
  nested?: boolean;
  draggable?: boolean;
  onOpen: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onLongPress: (point: { x: number; y: number }) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

export function SidebarConversationItem({
  conversationId,
  title,
  active,
  pinned,
  dragging,
  nested = false,
  draggable = true,
  onOpen,
  onContextMenu,
  onLongPress,
  onDragStart,
  onDragEnd
}: SidebarConversationItemProps) {
  const [longPressFlash, setLongPressFlash] = useState(false);

  const handleLongPress = useCallback(
    (point: { x: number; y: number }) => {
      triggerHapticPulse();
      setLongPressFlash(true);
      window.setTimeout(() => setLongPressFlash(false), 220);
      onLongPress(point);
    },
    [onLongPress]
  );

  const longPress = useLongPress(handleLongPress);

  return (
    <button
      className={`conversation-item ${nested ? "nested" : ""} ${
        active ? "active" : ""
      } ${dragging ? "is-dragging" : ""} ${pinned ? "is-pinned" : ""} ${
        longPressFlash ? "long-press-flash" : ""
      }`}
      draggable={draggable}
      onClick={(event) => {
        if (longPress.consumeLongPressClick(event)) return;
        onOpen();
      }}
      onContextMenu={onContextMenu}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      onTouchCancel={longPress.onTouchCancel}
      onTouchEnd={longPress.onTouchEnd}
      onTouchMove={longPress.onTouchMove}
      onTouchStart={longPress.onTouchStart}
      type="button"
    >
      <span className="conversation-item-title">{title}</span>
      {pinned ? <Pin aria-hidden className="conversation-pin-icon" size={11} strokeWidth={2} /> : null}
    </button>
  );
}
