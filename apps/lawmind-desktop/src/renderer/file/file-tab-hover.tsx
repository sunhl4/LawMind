import { useEffect, useRef, useState } from "react";
import type { RootKey } from "./file-workbench-types";

export const FILE_TAB_HOVER_DELAY_MS = 380;

export type FileTabHoverState = {
  id: string;
  top: number;
  left: number;
};

export function useFileTabHover() {
  const [hover, setHover] = useState<FileTabHoverState | null>(null);
  const showTimer = useRef(0);
  const hideTimer = useRef(0);

  useEffect(() => {
    return () => {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
    };
  }, []);

  const cancelHide = () => {
    window.clearTimeout(hideTimer.current);
  };

  const queueShow = (id: string, anchor: HTMLElement) => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => {
      const rect = anchor.getBoundingClientRect();
      const width = 300;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setHover({ id, top: rect.bottom + 6, left });
    }, FILE_TAB_HOVER_DELAY_MS);
  };

  const queueHide = () => {
    window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(() => setHover(null), 140);
  };

  return { hover, queueShow, queueHide, cancelHide, dismiss: () => setHover(null) };
}

export function FileTabHoverCard({
  hover,
  name,
  address,
  canAdd,
  onAdd,
  onPointerEnter,
  onPointerLeave,
}: {
  hover: FileTabHoverState;
  name: string;
  address: string;
  canAdd: boolean;
  onAdd: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  return (
    <div
      className="lm-file-tab-hover"
      style={{ top: hover.top, left: hover.left }}
      role="region"
      aria-label={name}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <div className="lm-file-tab-hover-name">{name}</div>
      {address ? <div className="lm-file-tab-hover-path">{address}</div> : null}
      {canAdd ? (
        <button type="button" className="lm-file-tab-hover-add" onClick={onAdd}>
          带入到对话
        </button>
      ) : null}
    </div>
  );
}

export function fileTabHoverTarget(
  tabs: ReadonlyArray<{ id: string; root: RootKey; path: string; name: string }>,
  hover: FileTabHoverState | null,
) {
  if (!hover) {
    return null;
  }
  return tabs.find((tab) => tab.id === hover.id) ?? null;
}
