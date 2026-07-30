import { useEffect } from "react";
import type { ReactNode } from "react";

export type LawmindMatterContextMenuProps = {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
};

/** 固定定位的简易右键菜单；点击外部或滚动时关闭。 */
export function LawmindMatterContextMenu(props: LawmindMatterContextMenuProps) {
  const { x, y, onClose, children } = props;

  useEffect(() => {
    const close = () => {
      onClose();
    };
    window.addEventListener("click", close, false);
    window.addEventListener("contextmenu", close, true);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close, false);
      window.removeEventListener("contextmenu", close, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  return (
    <div
      className="lm-context-menu lm-matter-context-menu"
      style={{ position: "fixed", top: y, left: x, zIndex: "var(--z-popover)" }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>
  );
}
