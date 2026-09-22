import { useCallback, useRef, useState, type DragEvent } from "react";
import { isChatFileDrop } from "./lawmind-file-drag";

export function useChatFileDropTarget(
  onDropFiles: ((dt: DataTransfer, event: DragEvent) => void | Promise<void>) | undefined,
  opts?: { stopPropagation?: boolean },
) {
  const [active, setActive] = useState(false);
  const depthRef = useRef(0);
  const stop = opts?.stopPropagation === true;

  const onDragEnter = useCallback(
    (e: DragEvent) => {
      if (!onDropFiles || !isChatFileDrop(e.dataTransfer)) {
        return;
      }
      e.preventDefault();
      if (stop) {
        e.stopPropagation();
      }
      depthRef.current += 1;
      setActive(true);
    },
    [onDropFiles, stop],
  );

  const onDragOver = useCallback(
    (e: DragEvent) => {
      if (!onDropFiles || !isChatFileDrop(e.dataTransfer)) {
        return;
      }
      e.preventDefault();
      if (stop) {
        e.stopPropagation();
      }
      e.dataTransfer.dropEffect = "copy";
    },
    [onDropFiles, stop],
  );

  const onDragLeave = useCallback(
    (e: DragEvent) => {
      if (!onDropFiles || !isChatFileDrop(e.dataTransfer)) {
        return;
      }
      if (stop) {
        e.stopPropagation();
      }
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) {
        setActive(false);
      }
    },
    [onDropFiles, stop],
  );

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!onDropFiles || !isChatFileDrop(e.dataTransfer)) {
        return;
      }
      e.preventDefault();
      if (stop) {
        e.stopPropagation();
      }
      depthRef.current = 0;
      setActive(false);
      void onDropFiles(e.dataTransfer, e);
    },
    [onDropFiles, stop],
  );

  return {
    active,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  };
}
