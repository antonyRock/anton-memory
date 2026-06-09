"use client";

import { X } from "lucide-react";

type ComposerReplyBannerProps = {
  role: "user" | "assistant";
  content: string;
  onCancel: () => void;
};

function previewText(text: string, maxLength = 160) {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function ComposerReplyBanner({ role, content, onCancel }: ComposerReplyBannerProps) {
  const author = role === "assistant" ? "TBrain" : "Вы";

  return (
    <div className="composer-reply-banner" aria-live="polite">
      <div className="composer-reply-banner-body">
        <span className="composer-reply-banner-label">Ответ на {author}</span>
        <p className="composer-reply-banner-text">{previewText(content)}</p>
      </div>
      <button
        aria-label="Отменить ответ"
        className="composer-reply-banner-close"
        onClick={onCancel}
        title="Отменить ответ"
        type="button"
      >
        <X size={16} />
      </button>
    </div>
  );
}
