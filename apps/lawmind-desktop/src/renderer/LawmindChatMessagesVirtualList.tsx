import { useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const VIRTUAL_THRESHOLD = 100;
const ESTIMATE_ROW_PX = 120;

type Props = {
  count: number;
  enabled: boolean;
  children: (virtualIndex: number) => ReactNode;
  endRef?: React.RefObject<HTMLDivElement | null>;
};

export function LawmindChatMessagesVirtualList({
  count,
  enabled,
  children,
  endRef,
}: Props): ReactNode {
  const parentRef = useRef<HTMLDivElement>(null);
  const useVirtual = enabled && count > VIRTUAL_THRESHOLD;

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATE_ROW_PX,
    overscan: 8,
    enabled: useVirtual,
  });

  if (!useVirtual) {
    return (
      <>
        {Array.from({ length: count }, (_, i) => children(i))}
        {endRef ? <div ref={endRef} /> : null}
      </>
    );
  }

  return (
    <div ref={parentRef} className="lm-messages-virtual-scroll">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {children(virtualRow.index)}
          </div>
        ))}
      </div>
      {endRef ? <div ref={endRef} /> : null}
    </div>
  );
}
