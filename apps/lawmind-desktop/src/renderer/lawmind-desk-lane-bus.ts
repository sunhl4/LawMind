/**
 * 办件面板 → 输入栏上方快车道（合同 / 邮件 / 研究）。
 * 合同仍走 lawmind-contract-fast-lane-bus（文件台「送审本合同」共用）。
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
