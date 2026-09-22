import { useEffect, useMemo, useState, type ReactNode } from "react";

export type CommandPaletteAction = {
  id: string;
  label: string;
  hint?: string;
  slash: string;
  run: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
  query: string;
  onQueryChange: (q: string) => void;
};

export function LawmindCommandPalette({
  open,
  onClose,
  actions,
  query,
  onQueryChange,
}: Props): ReactNode {
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\//, "");
    if (!q) {
      return actions;
    }
    return actions.filter(
      (a) =>
        a.slash.toLowerCase().includes(q) ||
        a.label.toLowerCase().includes(q) ||
        (a.hint ?? "").toLowerCase().includes(q),
    );
  }, [actions, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[activeIndex]) {
        e.preventDefault();
        filtered[activeIndex].run();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, activeIndex, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="lm-command-palette-backdrop" role="presentation" onClick={onClose}>
      <div
        className="lm-command-palette"
        role="dialog"
        aria-label="律师命令"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className="lm-input lm-command-palette-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="输入 / 命令或搜索…"
          autoFocus
          aria-label="命令搜索"
        />
        <ul className="lm-command-palette-list">
          {filtered.map((action, i) => (
            <li key={action.id}>
              <button
                type="button"
                className={`lm-command-palette-item${i === activeIndex ? " lm-command-palette-item-active" : ""}`}
                onClick={() => {
                  action.run();
                  onClose();
                }}
              >
                <span className="lm-command-palette-slash">{action.slash}</span>
                <span className="lm-command-palette-label">{action.label}</span>
                {action.hint ? <span className="lm-meta">{action.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
        {filtered.length === 0 ? <p className="lm-meta">无匹配命令</p> : null}
      </div>
    </div>
  );
}
