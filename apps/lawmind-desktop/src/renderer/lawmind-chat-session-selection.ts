import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Pointer selection for the conversation list.
 * Shift extends a range; Ctrl or Command toggles one row.
 */
export type ChatSessionPointerSelect = {
  orderedIds: readonly string[];
  selectedIds: readonly string[];
  anchorId: string | null;
  clickedId: string;
  shift: boolean;
  toggle: boolean;
};

export type ChatSessionPointerSelectResult = {
  selectedIds: string[];
  anchorId: string;
  /** Plain click opens the conversation. Modified clicks keep the one already open. */
  open: boolean;
};

export type ChatSessionListKeyAction = "select-all" | "collapse" | "delete" | "none";

function rangeIds(orderedIds: readonly string[], fromId: string, toId: string): string[] {
  const start = orderedIds.indexOf(fromId);
  const end = orderedIds.indexOf(toId);
  if (start < 0 || end < 0) {
    return [toId];
  }
  const [from, to] = start < end ? [start, end] : [end, start];
  return orderedIds.slice(from, to + 1);
}

function inListOrder(orderedIds: readonly string[], ids: Iterable<string>): string[] {
  const picked = new Set(ids);
  return orderedIds.filter((id) => picked.has(id));
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function applyChatSessionPointerSelect(
  input: ChatSessionPointerSelect,
): ChatSessionPointerSelectResult {
  const { orderedIds, selectedIds, anchorId, clickedId, shift, toggle } = input;
  if (shift) {
    const anchor =
      anchorId && orderedIds.includes(anchorId)
        ? anchorId
        : (selectedIds.find((id) => orderedIds.includes(id)) ?? clickedId);
    const range = rangeIds(orderedIds, anchor, clickedId);
    if (toggle) {
      return {
        selectedIds: inListOrder(orderedIds, [...selectedIds, ...range]),
        anchorId: anchor,
        open: false,
      };
    }
    return { selectedIds: range, anchorId: anchor, open: false };
  }
  if (toggle) {
    const next = new Set(selectedIds);
    if (next.has(clickedId)) {
      next.delete(clickedId);
    } else {
      next.add(clickedId);
    }
    return {
      selectedIds: inListOrder(orderedIds, next),
      anchorId: clickedId,
      open: false,
    };
  }
  return { selectedIds: [clickedId], anchorId: clickedId, open: true };
}

/** Right-click keeps a multi-selection when the row is already inside it. */
export function resolveChatSessionContextTarget(
  selectedIds: readonly string[],
  targetId: string,
): { actionIds: string[]; replaceSelection: boolean } {
  if (selectedIds.includes(targetId) && selectedIds.length > 1) {
    return { actionIds: [...selectedIds], replaceSelection: false };
  }
  return { actionIds: [targetId], replaceSelection: true };
}

export function chatSessionDeleteLabel(count: number): string {
  return count > 1 ? `删除 ${count} 条` : "删除";
}

/**
 * Drop ids that left the visible list. Follow an external active-session change,
 * but do not replace a deliberate single non-active selection when only the list refreshes.
 */
export function reconcileChatSessionSelection(input: {
  selectedIds: readonly string[];
  orderedIds: readonly string[];
  activeSessionId?: string;
  activeChanged: boolean;
}): string[] {
  const live = new Set(input.orderedIds);
  const pruned = input.selectedIds.filter((id) => live.has(id));
  if (input.activeChanged && input.activeSessionId && live.has(input.activeSessionId)) {
    if (pruned.length > 1 && pruned.includes(input.activeSessionId)) {
      return pruned;
    }
    return [input.activeSessionId];
  }
  if (pruned.length > 0) {
    return pruned;
  }
  if (input.activeSessionId && live.has(input.activeSessionId)) {
    return [input.activeSessionId];
  }
  return pruned;
}

export function chatSessionListKeyAction(
  event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    targetIsField: boolean;
  },
  selectionCount: number,
): ChatSessionListKeyAction {
  if (event.targetIsField) {
    return "none";
  }
  const modified = event.metaKey || event.ctrlKey;
  if (modified && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
    return "select-all";
  }
  if (event.key === "Escape" && selectionCount > 1 && !modified && !event.altKey) {
    return "collapse";
  }
  // Multi-select only — a focused row always counts as selected, so single-select
  // Delete/Backspace would otherwise delete the open conversation by accident.
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    selectionCount > 1 &&
    !modified &&
    !event.altKey
  ) {
    return "delete";
  }
  return "none";
}

export function useChatSessionMultiSelect(orderedIds: readonly string[], activeSessionId?: string) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    activeSessionId ? [activeSessionId] : [],
  );
  const [anchorId, setAnchorId] = useState<string | null>(activeSessionId ?? null);
  const selectedRef = useRef(selectedIds);
  const anchorRef = useRef(anchorId);
  const orderedRef = useRef(orderedIds);
  const prevActiveRef = useRef(activeSessionId);
  const suppressClickRef = useRef(false);
  selectedRef.current = selectedIds;
  anchorRef.current = anchorId;
  orderedRef.current = orderedIds;

  const orderedKey = orderedIds.join("\0");
  useEffect(() => {
    const activeChanged = prevActiveRef.current !== activeSessionId;
    prevActiveRef.current = activeSessionId;
    setSelectedIds((prev) => {
      const next = reconcileChatSessionSelection({
        selectedIds: prev,
        orderedIds: orderedRef.current,
        activeSessionId,
        activeChanged,
      });
      return sameIds(next, prev) ? prev : next;
    });
    setAnchorId((prev) => {
      const live = new Set(orderedRef.current);
      if (prev && live.has(prev)) {
        return prev;
      }
      return activeSessionId && live.has(activeSessionId) ? activeSessionId : null;
    });
  }, [activeSessionId, orderedKey]);

  const applyPointer = useCallback(
    (
      event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
      clickedId: string,
    ): ChatSessionPointerSelectResult => {
      const result = applyChatSessionPointerSelect({
        orderedIds,
        selectedIds: selectedRef.current,
        anchorId: anchorRef.current,
        clickedId,
        shift: event.shiftKey,
        toggle: event.metaKey || event.ctrlKey,
      });
      selectedRef.current = result.selectedIds;
      anchorRef.current = result.anchorId;
      setSelectedIds(result.selectedIds);
      setAnchorId(result.anchorId);
      return result;
    },
    [orderedIds],
  );

  const selectOnly = useCallback((sessionId: string) => {
    selectedRef.current = [sessionId];
    anchorRef.current = sessionId;
    setSelectedIds([sessionId]);
    setAnchorId(sessionId);
  }, []);

  const selectAll = useCallback(() => {
    const next = [...orderedIds];
    selectedRef.current = next;
    anchorRef.current = next[0] ?? null;
    setSelectedIds(next);
    setAnchorId(next[0] ?? null);
  }, [orderedIds]);

  const collapseTo = useCallback((sessionId: string | undefined) => {
    if (!sessionId) {
      selectedRef.current = [];
      anchorRef.current = null;
      setSelectedIds([]);
      setAnchorId(null);
      return;
    }
    selectedRef.current = [sessionId];
    anchorRef.current = sessionId;
    setSelectedIds([sessionId]);
    setAnchorId(sessionId);
  }, []);

  const markContextMenu = useCallback(() => {
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) {
      return false;
    }
    suppressClickRef.current = false;
    return true;
  }, []);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return {
    selectedIds,
    selectedSet,
    applyPointer,
    selectOnly,
    selectAll,
    collapseTo,
    markContextMenu,
    consumeSuppressedClick,
  };
}
