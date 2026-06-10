"use client";

import { useEffect, useState } from "react";

export type ThinkingPhase =
  | "thinking"
  | "memory"
  | "file"
  | "image"
  | "transcription";

const LABELS: Record<ThinkingPhase, string> = {
  thinking: "Думаю...",
  memory: "Ищу в памяти...",
  file: "Обрабатываю файл...",
  image: "Создаю изображение...",
  transcription: "Расшифровываю и редактирую..."
};

function useSmoothVisible(active: boolean, delayMs = 400, fadeMs = 450) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (active) {
      setMounted(true);
      const showTimer = window.setTimeout(() => setVisible(true), delayMs);
      return () => window.clearTimeout(showTimer);
    }

    setVisible(false);
    const hideTimer = window.setTimeout(() => setMounted(false), fadeMs);
    return () => window.clearTimeout(hideTimer);
  }, [active, delayMs, fadeMs]);

  return { mounted, visible };
}

type ThinkingIndicatorProps = {
  phase: ThinkingPhase;
  layout?: "message" | "compact";
  active: boolean;
  delayMs?: number;
};

export function ThinkingIndicator({
  phase,
  layout = "message",
  active,
  delayMs = 400
}: ThinkingIndicatorProps) {
  const { mounted, visible } = useSmoothVisible(active, delayMs);
  const label = LABELS[phase];
  const visibilityClass = visible ? "is-visible" : "is-hidden";

  if (!mounted) return null;

  if (layout === "compact") {
    return (
      <div aria-live="polite" className={`thinking-compact ${visibilityClass}`}>
        <span className="thinking-shimmer">{label}</span>
      </div>
    );
  }

  return (
    <article
      aria-live="polite"
      className={`message-row assistant thinking-row ${visibilityClass}`}
    >
      <div className="avatar avatar-assistant">T</div>
      <div className="bubble">
        <span className="thinking-shimmer">{label}</span>
      </div>
    </article>
  );
}
