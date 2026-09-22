import { useEffect, useRef } from "react";

/**
 * Single interval for periodic background ticks (replaces multiple independent setInterval loops).
 */
export function useAppPolling(opts: {
  enabled: boolean;
  intervalMs?: number;
  onTick: () => void;
}) {
  const { enabled, intervalMs = 3500, onTick } = opts;
  const tickRef = useRef(onTick);
  tickRef.current = onTick;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const id = window.setInterval(() => {
      tickRef.current();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);
}
