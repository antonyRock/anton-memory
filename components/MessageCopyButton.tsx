"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

type MessageCopyButtonProps = {
  text: string;
  onNotify?: (message: string) => void;
};

export function MessageCopyButton({ text, onNotify }: MessageCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!text.trim()) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onNotify?.("Ответ скопирован");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify?.("Не удалось скопировать");
    }
  }

  return (
    <button
      aria-label={copied ? "Скопировано" : "Копировать ответ"}
      className={`message-copy-button ${copied ? "is-copied" : ""}`}
      onClick={() => {
        void handleCopy();
      }}
      title={copied ? "Скопировано" : "Копировать"}
      type="button"
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}
