"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UsePullToRefreshOptions = {
  enabled?: boolean;
  threshold?: number;
  onRefresh: () => Promise<void> | void;
  targetRef: React.RefObject<HTMLElement | null>;
};

export function usePullToRefresh({
  enabled = true,
  threshold = 72,
  onRefresh,
  targetRef
}: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartYRef = useRef(0);
  const isPullingRef = useRef(false);
  const pullEnabledRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const isRefreshingRef = useRef(false);

  const resetPull = useCallback(() => {
    isPullingRef.current = false;
    pullEnabledRef.current = false;
    pullDistanceRef.current = 0;
    setPullDistance(0);
  }, []);

  const triggerRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;

    isRefreshingRef.current = true;
    setIsRefreshing(true);
    setPullDistance(threshold);

    try {
      await onRefresh();
    } finally {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
      resetPull();
    }
  }, [onRefresh, resetPull, threshold]);

  useEffect(() => {
    pullDistanceRef.current = pullDistance;
  }, [pullDistance]);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    const element = targetRef.current;
    if (!element || !enabled) return;

    const canStartPull = () => {
      const hasScrollableContent = element.scrollHeight > element.clientHeight + 1;
      return element.scrollTop <= 0 || !hasScrollableContent;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (isRefreshingRef.current || !canStartPull()) return;
      touchStartYRef.current = event.touches[0]?.clientY ?? 0;
      pullEnabledRef.current = true;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!pullEnabledRef.current || isRefreshingRef.current) return;

      const currentY = event.touches[0]?.clientY ?? 0;
      const delta = currentY - touchStartYRef.current;

      if (delta <= 0) {
        if (isPullingRef.current) {
          pullDistanceRef.current = 0;
          setPullDistance(0);
        }
        return;
      }

      if (!canStartPull() && !isPullingRef.current) return;

      isPullingRef.current = true;
      event.preventDefault();

      const nextDistance = Math.min(delta * 0.42, threshold * 1.65);
      pullDistanceRef.current = nextDistance;
      setPullDistance(nextDistance);
    };

    const finishTouch = () => {
      if (!pullEnabledRef.current) return;

      if (pullDistanceRef.current >= threshold) {
        void triggerRefresh();
      } else {
        resetPull();
      }

      pullEnabledRef.current = false;
    };

    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", finishTouch);
    element.addEventListener("touchcancel", finishTouch);

    return () => {
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", finishTouch);
      element.removeEventListener("touchcancel", finishTouch);
    };
  }, [enabled, resetPull, targetRef, threshold, triggerRefresh]);

  return {
    pullDistance,
    isRefreshing,
    isActive: pullDistance > 0 || isRefreshing
  };
}
