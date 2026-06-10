"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

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

  function handleCopy() {
    if (!text.trim()) return;

    if (copyTextToClipboard(text)) {
      setCopied(true);
      onNotify?.(notifyMessage);
      window.setTimeout(() => setCopied(false), 1800);
      return;
    }

    onNotify?.("Не удалось скопировать");
  }

  return (
    <button
      aria-label={copied ? copiedLabel : copyLabel}
      className={`message-action-button ${copied ? "is-copied" : ""} ${className}`.trim()}
      onClick={handleCopy}
      title={copied ? copiedLabel : copyLabel}
      type="button"
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
