"use client";

import { useEffect, useRef, useState } from "react";

type ComposerTextareaProps = {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

const PLACEHOLDER = "Спросите что-нибудь...";

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
}

export function ComposerTextarea({
  value,
  disabled = false,
  onChange,
  onSubmit
}: ComposerTextareaProps) {
  const [mounted, setMounted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !textareaRef.current) return;
    resizeTextarea(textareaRef.current);
  }, [value, mounted]);

  if (!mounted) {
    return (
      <textarea
        aria-label="Сообщение"
        autoComplete="off"
        className="composer-textarea"
        placeholder={PLACEHOLDER}
        readOnly
        rows={1}
        suppressHydrationWarning
        tabIndex={-1}
        value=""
      />
    );
  }

  return (
    <textarea
      ref={textareaRef}
      aria-label="Сообщение"
      autoCapitalize="sentences"
      autoComplete="off"
      autoCorrect="off"
      className="composer-textarea"
      disabled={disabled}
      inputMode="text"
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSubmit();
        }
      }}
      placeholder={PLACEHOLDER}
      rows={1}
      spellCheck={false}
      suppressHydrationWarning
      value={value}
    />
  );
}
