"use client";

import { Loader2 } from "lucide-react";

type PullToRefreshIndicatorProps = {
  pullDistance: number;
  isRefreshing: boolean;
  threshold?: number;
};

export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold = 72
}: PullToRefreshIndicatorProps) {
  if (pullDistance <= 0 && !isRefreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);
  const label = isRefreshing
    ? "Обновление..."
    : progress >= 1
      ? "Отпустите для обновления"
      : "Потяните вниз";

  return (
    <div
      aria-hidden={!isRefreshing}
      aria-live="polite"
      className="pull-to-refresh-indicator"
      style={{
        height: `${Math.max(pullDistance, isRefreshing ? threshold : 0)}px`,
        opacity: isRefreshing ? 1 : 0.35 + progress * 0.65
      }}
    >
      <div className="pull-to-refresh-indicator-inner">
        <Loader2
          className={`pull-to-refresh-spinner ${isRefreshing ? "is-spinning" : ""}`}
          size={18}
          style={{
            transform: isRefreshing ? undefined : `rotate(${progress * 320}deg)`
          }}
        />
        <span>{label}</span>
      </div>
    </div>
  );
}
