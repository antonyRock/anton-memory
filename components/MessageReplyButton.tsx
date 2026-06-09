"use client";

import { Reply } from "lucide-react";

type MessageReplyButtonProps = {
  onReply: () => void;
  label?: string;
};

export function MessageReplyButton({ onReply, label = "Ответить" }: MessageReplyButtonProps) {
  return (
    <button
      aria-label={label}
      className="message-action-button"
      onClick={onReply}
      title={label}
      type="button"
    >
      <Reply size={15} />
    </button>
  );
}
