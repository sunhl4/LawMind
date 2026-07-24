import { useCallback, useEffect, useRef, useState } from "react";
import type { TruthSourceContextPin } from "../../../../src/lawmind/platform/compose-context-pin.ts";
import { makeContextPinId } from "../../../../src/lawmind/platform/compose-context-pin.ts";

const MAX_TRUTH_PINS = 8;

export type ComposeTruthPinScope = {
  assistantId: string;
  sessionId?: string | null;
};

export function composeTruthScopeKey(scope: ComposeTruthPinScope): string {
  const assistantId = scope.assistantId.trim() || "default";
  const sessionId = scope.sessionId?.trim() || "__pending__";
  return `${assistantId}::${sessionId}::truth`;
}

export function useComposeTruthPins(
  setError: (message: string | null) => void,
  scope: ComposeTruthPinScope,
) {
  const [byScope, setByScope] = useState<Record<string, TruthSourceContextPin[]>>({});
  const scopeKey = composeTruthScopeKey(scope);
  const composeTruthPins = byScope[scopeKey] ?? [];
  const itemsRef = useRef(composeTruthPins);
  itemsRef.current = composeTruthPins;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  useEffect(() => {
    const sessionId = scope.sessionId?.trim();
    if (!sessionId) {
      return;
    }
    const pendingKey = composeTruthScopeKey({ assistantId: scope.assistantId, sessionId: null });
    const realKey = composeTruthScopeKey({ assistantId: scope.assistantId, sessionId });
    setByScope((prev) => {
      const pending = prev[pendingKey];
      if (!pending?.length) {
        return prev;
      }
      const existing = prev[realKey];
      const next = { ...prev };
      delete next[pendingKey];
      if (!existing?.length) {
        next[realKey] = pending;
      }
      return next;
    });
  }, [scope.assistantId, scope.sessionId]);

  const addComposeTruthPin = useCallback(
    (pin: TruthSourceContextPin) => {
      const key = scopeKeyRef.current;
      const prev = itemsRef.current;
      const id = makeContextPinId(pin);
      if (prev.some((x) => makeContextPinId(x) === id)) {
        return;
      }
      if (prev.length >= MAX_TRUTH_PINS) {
        setError(`最多同时钉选 ${MAX_TRUTH_PINS} 个真源，请先移除部分。`);
        return;
      }
      setError(null);
      const nextItems = [...prev, pin];
      itemsRef.current = nextItems;
      setByScope((map) => ({ ...map, [key]: nextItems }));
    },
    [setError],
  );

  const removeComposeTruthPin = useCallback((id: string) => {
    const key = scopeKeyRef.current;
    setByScope((map) => {
      const prev = map[key] ?? [];
      const nextItems = prev.filter((x) => makeContextPinId(x) !== id);
      itemsRef.current = nextItems;
      return { ...map, [key]: nextItems };
    });
  }, []);

  const clearComposeTruthPins = useCallback(() => {
    const key = scopeKeyRef.current;
    itemsRef.current = [];
    setByScope((map) => ({ ...map, [key]: [] }));
  }, []);

  return {
    composeTruthPins,
    addComposeTruthPin,
    removeComposeTruthPin,
    clearComposeTruthPins,
  };
}
