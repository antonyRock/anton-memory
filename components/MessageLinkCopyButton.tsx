"use client";

import { Check, Copy } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

type MessageLinkRowProps = {
  url: string;
  label?: string;
  onNotify?: (message: string) => void;
};

export function MessageLinkRow({ url, label, onNotify }: MessageLinkRowProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (!copyTextToClipboard(url)) {
      onNotify?.("Не удалось скопировать");
      return;
    }

    setCopied(true);
    onNotify?.("Ссылка скопирована");
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <span className="message-link-row">
      <a className="message-link" href={url} rel="noopener noreferrer" target="_blank">
        {label ?? url}
      </a>
      <button
        aria-label={copied ? "Ссылка скопирована" : "Копировать ссылку"}
        className={`message-link-copy-button ${copied ? "is-copied" : ""}`}
        onClick={handleCopy}
        onMouseDown={(event) => event.stopPropagation()}
        title={copied ? "Ссылка скопирована" : "Копировать ссылку"}
        type="button"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </span>
  );
}
