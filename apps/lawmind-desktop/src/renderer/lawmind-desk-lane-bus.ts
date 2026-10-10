/**
 * Fast-lane bus: e2e / slash → mail / research cards above compose.
 */

export type DeskLane = "mail" | "research";

type Listener = (lane: DeskLane) => void;

const listeners = new Set<Listener>();

export function subscribeDeskLaneOpen(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestDeskLaneOpen(lane: DeskLane): void {
  for (const listener of listeners) {
    try {
      listener(lane);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Playwright：打开邮件/研究快车道，不经过分类菜单。 */
export function installDeskLaneE2eHook(): void {
  if (typeof window === "undefined") {
    return;
  }
  (
    window as Window & {
      __lmRequestDeskLane?: typeof requestDeskLaneOpen;
    }
  ).__lmRequestDeskLane = requestDeskLaneOpen;
}
