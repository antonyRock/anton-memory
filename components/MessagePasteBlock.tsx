"use client";

import type { ReactNode } from "react";
import { MessageCopyButton } from "@/components/MessageCopyButton";

type MessagePasteBlockProps = {
  content: string;
  children: ReactNode;
  onNotify?: (message: string) => void;
};

export function MessagePasteBlock({ content, children, onNotify }: MessagePasteBlockProps) {
  return (
    <div className="message-paste-block-wrap">
      <pre className="message-paste-block">
        <code>{children}</code>
      </pre>
      <MessageCopyButton
        className="message-paste-copy-button"
        copyLabel="Копировать текст"
        copiedLabel="Скопировано"
        notifyMessage="Текст скопирован"
        onNotify={onNotify}
        text={content}
      />
    </div>
  );
}
