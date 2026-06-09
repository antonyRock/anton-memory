"use client";

import { useEffect, useState, type ReactNode } from "react";

const DISPLAY_MS = 3400;
const FADE_MS = 520;

const WELCOME_MESSAGE_SEQUENCE = [0, 1, 2, 0] as const;

const WELCOME_MESSAGES: Array<() => ReactNode> = [
  () => (
    <>
      Добро пожаловать в <span className="brand-accent">T</span>Brain
    </>
  ),
  () => <>Это твой Notion, Obsidian и второй мозг</>,
  () => <>Будущее зависит от того, что ты делаешь сегодня</>
];

export function WelcomeRotatingText() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let fadeTimeoutId = 0;
    let displayTimeoutId = 0;

    const showStep = (stepIndex: number) => {
      const messageIndex = WELCOME_MESSAGE_SEQUENCE[stepIndex];
      setIndex(messageIndex);
      setVisible(true);

      if (stepIndex >= WELCOME_MESSAGE_SEQUENCE.length - 1) {
        return;
      }

      displayTimeoutId = window.setTimeout(() => {
        if (cancelled) return;
        setVisible(false);

        fadeTimeoutId = window.setTimeout(() => {
          if (cancelled) return;
          showStep(stepIndex + 1);
        }, FADE_MS);
      }, DISPLAY_MS);
    };

    showStep(0);

    return () => {
      cancelled = true;
      window.clearTimeout(displayTimeoutId);
      window.clearTimeout(fadeTimeoutId);
    };
  }, []);

  const Message = WELCOME_MESSAGES[index];

  return (
    <div aria-live="polite" className="welcome-rotating-text-wrap">
      <h1 className={`welcome-rotating-text ${visible ? "is-visible" : "is-hidden"}`}>
        <Message />
      </h1>
    </div>
  );
}
