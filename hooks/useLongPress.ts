"use client";

import { useCallback, useRef } from "react";

type LongPressPoint = {
  x: number;
  y: number;
};

type UseLongPressOptions = {
  delayMs?: number;
  moveTolerancePx?: number;
  disabled?: boolean;
};

export function useLongPress(
  onLongPress: (point: LongPressPoint) => void,
  options: UseLongPressOptions = {}
) {
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<LongPressPoint | null>(null);
  const longPressTriggeredRef = useRef(false);
  const delayMs = options.delayMs ?? 550;
  const moveTolerancePx = options.moveTolerancePx ?? 14;

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      if (options.disabled) return;
      const touch = event.touches[0];
      if (!touch) return;

      longPressTriggeredRef.current = false;
      startRef.current = { x: touch.clientX, y: touch.clientY };
      clearTimer();

      timerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        onLongPress({ x: touch.clientX, y: touch.clientY });
      }, delayMs);
    },
    [clearTimer, delayMs, onLongPress, options.disabled]
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      const start = startRef.current;
      if (!touch || !start) return;

      const distance = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
      if (distance > moveTolerancePx) clearTimer();
    },
    [clearTimer, moveTolerancePx]
  );

  const onTouchEnd = useCallback(() => {
    clearTimer();
    startRef.current = null;
  }, [clearTimer]);

  const onTouchCancel = useCallback(() => {
    clearTimer();
    startRef.current = null;
  }, [clearTimer]);

  const consumeLongPressClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!longPressTriggeredRef.current) return false;
    event.preventDefault();
    event.stopPropagation();
    longPressTriggeredRef.current = false;
    return true;
  }, []);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    consumeLongPressClick
  };
}
