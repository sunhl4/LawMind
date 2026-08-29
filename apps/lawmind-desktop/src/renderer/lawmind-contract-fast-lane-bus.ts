/**
 * Cross-surface bus: file「送审」/ slash → open Solo 合同审查短路径芯片卡。
 * Compose / empty-state subscribe; avoid prefilling a fixed prompt that skips chips.
 */

export type ContractFastLaneOpenRequest = {
  materialsHint?: string;
  /** Prefer compact strip above compose when chat already has messages */
  preferCompact?: boolean;
};

type Listener = (req: ContractFastLaneOpenRequest) => void;

const listeners = new Set<Listener>();

export function subscribeContractFastLaneOpen(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestContractFastLaneOpen(req: ContractFastLaneOpenRequest = {}): void {
  for (const listener of listeners) {
    try {
      listener(req);
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** Playwright / DEV：与「送审本合同」共用同一 bus 入口。 */
export function installContractFastLaneE2eHook(): void {
  if (typeof window === "undefined") {
    return;
  }
  (
    window as Window & {
      __lmRequestContractFastLane?: typeof requestContractFastLaneOpen;
    }
  ).__lmRequestContractFastLane = requestContractFastLaneOpen;
}
