/**
 * 面板左上/左边缘的「拖出到新窗口」抓手。
 *
 * 交互与 Cursor 一致：按住拖出超过阈值就开独立窗口；不方便拖时直接点也开。
 * 只负责手势，开哪一块 pane、开完是否在主窗口隐藏，由父组件决定。
 */

import {
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { paneDetachDragExceeded } from "./lawmind-pane-window";

type Props = {
  pane: "chat" | "middle";
  label: string;
  onDetach: () => void | Promise<void>;
  disabled?: boolean;
};

export function LawmindPaneDetachGrip(props: Props): ReactNode {
  const { pane, label, onDetach, disabled = false } = props;
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const busyRef = useRef(false);

  const trigger = useCallback(async () => {
    if (disabled || busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      await onDetach();
    } catch {
      /* 父级负责提示；这里只保证抓手不会卡死 */
    } finally {
      window.setTimeout(() => {
        busyRef.current = false;
      }, 600);
    }
  }, [disabled, onDetach]);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) {
      return;
    }
    startRef.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
    draggingRef.current = false;
    suppressClickRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* jsdom / 老内核没有 pointer capture */
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = startRef.current;
    if (!start || draggingRef.current) {
      return;
    }
    if (paneDetachDragExceeded(start, { x: event.clientX, y: event.clientY })) {
      // 到释放时再开窗：主进程读的是松开时的鼠标位置，窗口会落在拖到的屏幕上。
      draggingRef.current = true;
    }
  };

  const endPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const wasDragging = draggingRef.current;
    startRef.current = null;
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    if (!wasDragging) {
      return;
    }
    suppressClickRef.current = true;
    void trigger();
    // 在按钮外松开时不一定紧跟 click；别让 suppress 卡住下一次点击。
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const cancelPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    startRef.current = null;
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    void trigger();
  };

  return (
    <button
      type="button"
      className="lm-pane-detach-grip"
      data-testid={`lm-pane-detach-grip-${pane}`}
      aria-label={`拖出${label}到新窗口（点击也可）`}
      title={`拖出${label}到新窗口（点击也可）`}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={cancelPointer}
      onKeyDown={onKeyDown}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        void trigger();
      }}
    >
      <svg width="8" height="18" viewBox="0 0 8 18" fill="currentColor" aria-hidden>
        <circle cx="2" cy="3" r="1.1" />
        <circle cx="6" cy="3" r="1.1" />
        <circle cx="2" cy="9" r="1.1" />
        <circle cx="6" cy="9" r="1.1" />
        <circle cx="2" cy="15" r="1.1" />
        <circle cx="6" cy="15" r="1.1" />
      </svg>
    </button>
  );
}
