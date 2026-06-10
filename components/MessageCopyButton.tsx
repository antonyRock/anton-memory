"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

type MessageCopyButtonProps = {
  text: string;
  onNotify?: (message: string) => void;
  className?: string;
  copyLabel?: string;
  copiedLabel?: string;
  notifyMessage?: string;
};

export function MessageCopyButton({
  text,
  onNotify,
  className = "",
  copyLabel = "Копировать ответ",
  copiedLabel = "Скопировано",
  notifyMessage = "Ответ скопирован"
}: MessageCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!text.trim()) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onNotify?.(notifyMessage);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify?.("Не удалось скопировать");
    }
  }

  return (
    <button
      aria-label={copied ? copiedLabel : copyLabel}
      className={`message-action-button ${copied ? "is-copied" : ""} ${className}`.trim()}
      onClick={() => {
        void handleCopy();
      }}
      title={copied ? copiedLabel : copyLabel}
      type="button"
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
