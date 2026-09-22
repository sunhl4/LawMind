/**
 * Light observational hooks for turn phases (Pi-style extension points without YOLO).
 * Hooks must not mutate session/turn state or bypass lawyer approval.
 */

export type TurnLifecyclePhase =
  | "before_model_round"
  | "after_compact"
  | "model_error"
  | "tool_delta";

export type TurnLifecycleEvent = {
  phase: TurnLifecyclePhase;
  sessionId: string;
  turnId?: string;
  detail?: Record<string, unknown>;
};

export type TurnLifecycleHook = (event: TurnLifecycleEvent) => void;

const hooks = new Set<TurnLifecycleHook>();

/** Register a hook; returns unsubscribe. */
export function registerTurnLifecycleHook(hook: TurnLifecycleHook): () => void {
  hooks.add(hook);
  return () => {
    hooks.delete(hook);
  };
}

/** Test helper — clear all hooks. */
export function clearTurnLifecycleHooks(): void {
  hooks.clear();
}

export function emitTurnLifecycle(event: TurnLifecycleEvent): void {
  for (const hook of hooks) {
    try {
      hook(event);
    } catch {
      /* observational only; never fail the turn */
    }
  }
}
