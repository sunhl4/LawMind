import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { ModelCatalogEntry } from "./lawmind-models-api";
import {
  filterModelCatalog,
  modelsOfferedInChatPicker,
  nextSelectableIndex,
  providerIconKey,
  providerIconLabel,
  resolveComposeModelSelectValue,
  modelPickerDisplayName,
  type ProviderIconKey,
} from "./lawmind-model-picker-utils";

type Props = {
  catalog: ModelCatalogEntry[];
  selectedModelId: string;
  onSelect: (modelId: string) => void | Promise<void>;
  /** Opens settings dialog (model wizard / custom models). */
  onOpenSettings?: () => void;
  /** Opens the first-run / API wizard (Credential registration). */
  onOpenApiWizard?: () => void;
  /** Triggers `POST /api/models/test` for current selection. */
  onTestCurrent?: () => void | Promise<void>;
  /** Disables "Test connection" while the request runs. */
  quickTestBusy?: boolean;
  /** When true, the trigger button is rendered disabled. */
  disabled?: boolean;
  /** Hover text while the trigger stays clickable. */
  title?: string;
  /** Shown when `disabled` is true (hover tooltip). */
  disabledTitle?: string;
};

function ProviderIcon({ kind }: { kind: ProviderIconKey }): ReactNode {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    "aria-hidden": true,
    focusable: false,
  } as const;
  switch (kind) {
    case "openai":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M14 7.2c.4-1.2-.1-2.6-1.2-3.4-.4-1.4-1.7-2.3-3.2-2.2-.9-1-2.2-1.4-3.5-1-1.4.3-2.4 1.4-2.7 2.8-1.4.4-2.3 1.7-2.2 3.1.1.6.3 1.2.7 1.7-.4 1.2.1 2.6 1.2 3.4.4 1.4 1.7 2.3 3.2 2.2.9 1 2.2 1.4 3.5 1 1.4-.3 2.4-1.4 2.7-2.8 1.4-.4 2.3-1.7 2.2-3.1-.1-.6-.3-1.2-.7-1.7z"
          />
        </svg>
      );
    case "dashscope":
      return (
        <svg {...common}>
          <path fill="currentColor" d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" />
        </svg>
      );
    case "deepseek":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="2.2" fill="currentColor" />
        </svg>
      );
    case "moonshot":
      return (
        <svg {...common}>
          <path fill="currentColor" d="M11 2a6 6 0 1 0 3 11 5 5 0 0 1-3-11z" />
        </svg>
      );
    case "zhipu":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M8 1l3 3-3 3-3-3zM2 8l3-3 3 3-3 3zM14 8l-3 3-3-3 3-3zM8 15l-3-3 3-3 3 3z"
          />
        </svg>
      );
    case "platform":
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M2 4h12v3H2zM2 9h12v3H2zM3 5.5h2v.5H3zM3 10.5h2v.5H3z"
          />
        </svg>
      );
    case "custom":
    default:
      return (
        <svg {...common}>
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            d="M3 8h10M8 3v10"
          />
        </svg>
      );
  }
}

export function LawmindModelPicker(props: Props): ReactNode {
  const {
    catalog,
    selectedModelId,
    onSelect,
    onOpenSettings,
    onOpenApiWizard,
    onTestCurrent,
    quickTestBusy,
    disabled,
    disabledTitle,
    title,
  } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const listboxId = useId().replace(/:/g, "");

  const offered = useMemo(() => modelsOfferedInChatPicker(catalog), [catalog]);
  const effectiveSelectedId = resolveComposeModelSelectValue(offered, selectedModelId);
  const selectedEntry = offered.find((m) => m.id === effectiveSelectedId);

  const visible = useMemo(() => filterModelCatalog(offered, query), [offered, query]);
  const flat = useMemo(() => visible.map((row) => ({ group: "", row })), [visible]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }
    const onDocPointer = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (triggerRef.current?.contains(target)) {
        return;
      }
      if (popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const width = Math.max(280, Math.min(340, Math.max(rect.width + 80, 280)));
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    const spaceAbove = rect.top - margin - gap;
    const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
    // Compose sits at the bottom of the window — pin to the trigger and grow upward.
    const openAbove = spaceAbove >= 120 || spaceAbove >= spaceBelow;
    if (openAbove) {
      setPosition({
        position: "fixed",
        left,
        width,
        bottom: Math.max(margin, window.innerHeight - rect.top + gap),
        maxHeight: Math.max(120, spaceAbove),
        top: "auto",
        zIndex: 9000,
      });
    } else {
      setPosition({
        position: "fixed",
        left,
        width,
        top: rect.bottom + gap,
        maxHeight: Math.max(120, spaceBelow),
        bottom: "auto",
        zIndex: 9000,
      });
    }
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }
    updatePosition();
    const onReposition = (): void => {
      updatePosition();
    };
    window.addEventListener("resize", onReposition);
    // Capture scroll from nested overflow containers (chat column).
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, query, flat.length, updatePosition]);

  useEffect(() => {
    if (!open || !position) {
      return;
    }
    searchRef.current?.focus();
  }, [open, position]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (flat.length === 0) {
      setFocusIndex(-1);
      return;
    }
    const idx = flat.findIndex((entry) => entry.row.id === effectiveSelectedId);
    setFocusIndex(idx >= 0 ? idx : 0);
  }, [open, flat, effectiveSelectedId]);

  const close = useCallback(() => setOpen(false), []);

  const selectRow = useCallback(
    (row: ModelCatalogEntry) => {
      if (!row.configured) {
        (onOpenApiWizard ?? onOpenSettings)?.();
        close();
        return;
      }
      void Promise.resolve(onSelect(row.id)).finally(() => {
        close();
      });
    },
    [close, onOpenApiWizard, onOpenSettings, onSelect],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement | HTMLInputElement>) => {
      if (event.key === "/" && document.activeElement !== searchRef.current) {
        const ae = document.activeElement as HTMLElement | null;
        if (ae?.tagName === "INPUT" || ae?.tagName === "TEXTAREA" || ae?.isContentEditable) {
          return;
        }
        event.preventDefault();
        queueMicrotask(() => searchRef.current?.focus());
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setFocusIndex((prev) => nextSelectableIndex(flat, prev, 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setFocusIndex((prev) => nextSelectableIndex(flat, prev, -1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const target = flat[focusIndex]?.row;
        if (target) {
          selectRow(target);
        }
      }
    },
    [flat, focusIndex, selectRow],
  );

  let runningIndex = 0;
  const renderRow = (row: ModelCatalogEntry): ReactNode => {
    const index = runningIndex;
    runningIndex += 1;
    const isFocused = focusIndex === index;
    const isSelected = row.id === effectiveSelectedId;
    const iconKey = providerIconKey(row);
    const name = modelPickerDisplayName(row);
    return (
      <button
        key={row.id}
        type="button"
        role="option"
        id={`${listboxId}-opt-${row.id}`}
        aria-selected={isSelected}
        className={`lm-model-picker-row ${isFocused ? "lm-model-picker-row-focused" : ""} ${
          !row.configured ? "lm-model-picker-row-disabled" : ""
        }`}
        onMouseEnter={() => setFocusIndex(index)}
        onClick={() => selectRow(row)}
        title={row.configured ? (row.verifiedAt ? name : `${name}（待验证）`) : "还没填密钥，将打开连接向导"}
      >
        <span
          className={`lm-model-picker-icon lm-model-picker-icon-${iconKey}`}
          aria-label={providerIconLabel(iconKey)}
        >
          <ProviderIcon kind={iconKey} />
        </span>
        <span className="lm-model-picker-label">
          {name}
          {isSelected ? <span className="lm-model-picker-check">✓</span> : null}
        </span>
      </button>
    );
  };

  const iconKeyForSelected = selectedEntry ? providerIconKey(selectedEntry) : "custom";
  const activeOptionId =
    open && focusIndex >= 0 && flat[focusIndex]
      ? `${listboxId}-opt-${flat[focusIndex].row.id}`
      : undefined;
  return (
    <div className="lm-model-picker">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={activeOptionId}
        className="lm-model-picker-trigger"
        disabled={disabled}
        title={
          disabled
            ? (disabledTitle ?? (offered.length === 0 ? "Loading models…" : "Model switching unavailable"))
            : title
        }
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className={`lm-model-picker-icon lm-model-picker-icon-${iconKeyForSelected}`}
          aria-hidden
        >
          <ProviderIcon kind={iconKeyForSelected} />
        </span>
        <span className="lm-model-picker-trigger-label">
          {selectedEntry ? modelPickerDisplayName(selectedEntry) : "选择模型"}
        </span>
        <span className="lm-model-picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && position
        ? createPortal(
            <div
              ref={popoverRef}
              className="lm-model-picker-popover"
              style={position}
              role="listbox"
              id={listboxId}
              aria-label="模型列表"
              onKeyDown={onKeyDown}
            >
              <div className="lm-model-picker-search-row">
                <input
                  ref={searchRef}
                  className="lm-model-picker-search"
                  type="search"
                  placeholder="搜索模型…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                />
              </div>
              <div className="lm-model-picker-body">
                {visible.length === 0 ? (
                  <div className="lm-model-picker-empty">暂无可用模型</div>
                ) : (
                  visible.map((row) => renderRow(row))
                )}
              </div>
              <div className="lm-model-picker-footer">
                {onOpenApiWizard || onOpenSettings ? (
                  <button
                    type="button"
                    className="lm-model-picker-footer-link"
                    onClick={() => {
                      (onOpenApiWizard ?? onOpenSettings)?.();
                      close();
                    }}
                  >
                    添加模型
                  </button>
                ) : null}
                {onOpenSettings ? (
                  <button
                    type="button"
                    className="lm-model-picker-footer-link"
                    onClick={() => {
                      onOpenSettings();
                      close();
                    }}
                  >
                    打开设置
                  </button>
                ) : null}
                {onTestCurrent ? (
                  <button
                    type="button"
                    className="lm-model-picker-footer-link lm-model-picker-footer-link-muted"
                    disabled={Boolean(quickTestBusy)}
                    onClick={() => {
                      void onTestCurrent();
                    }}
                  >
                    {quickTestBusy ? "测试中…" : "测试连接"}
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
