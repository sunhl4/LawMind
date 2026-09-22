// TODO(renderer-fetch-proxy): migrate remaining fetch calls to fetchApi / api-client-proxy.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";
import { apiAuthHeaders } from "./lawmind-api-auth.ts";
import type { FileChatContextItem } from "./lawmind-app-shell";
import type { WorkflowTemplateItem } from "./lawmind-workflow-types";
import {
  buildComposeContextPickerItems,
  filterContextPickerItems,
  groupContextPickerItems,
  readRecentFileContextPaths,
  truthPinToPayload,
  type ComposeContextMatterOption,
  type ComposeContextPickerCategory,
  type ComposeContextPickerItem,
} from "./lawmind-compose-context";
import type { TruthSourceContextPin } from "../../../../src/lawmind/platform/compose-context-pin.ts";
import { apiListFleetPlaybooks } from "./lawmind-review-campaign-api";

type Props = {
  open: boolean;
  query: string;
  apiBase?: string;
  contextMatterId: string | null;
  pinnedFiles: FileChatContextItem[];
  pinnedTruthPins?: TruthSourceContextPin[];
  matters: ComposeContextMatterOption[];
  onSelectFile: (payload: Pick<FileChatContextItem, "root" | "relPath" | "kind">) => void;
  onSelectTruthPin?: (pin: TruthSourceContextPin) => void;
  onSelectMatter: (matterId: string) => void;
  onSelectTemplate: (template: { id: string; starterPrompt?: string }) => void;
  onClose: () => void;
  /** When set, show a search field (meeting desk / standalone use). */
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;
  /** Limit visible categories (meeting materials → files only). */
  categories?: ComposeContextPickerCategory[];
};

export function LawmindComposeContextPicker(props: Props): ReactNode {
  const {
    open,
    query,
    apiBase,
    contextMatterId,
    pinnedFiles,
    pinnedTruthPins = [],
    matters,
    onSelectFile,
    onSelectTruthPin,
    onSelectMatter,
    onSelectTemplate,
    onClose,
    onQueryChange,
    searchPlaceholder = "搜索文件名（至少 2 字）",
    categories,
  } = props;

  const filesOnly = Boolean(categories?.length === 1 && categories[0] === "files");
  const includeTemplates = !categories?.length || categories.includes("templates");

  const [templates, setTemplates] = useState<WorkflowTemplateItem[]>([]);
  const [fleetPlaybooks, setFleetPlaybooks] = useState<Array<{ id: string; label: string }>>([]);
  const [matterEvidencePaths, setMatterEvidencePaths] = useState<
    Array<{ relPath: string; label?: string; hint?: string }>
  >([]);
  const [workspaceMatches, setWorkspaceMatches] = useState<
    Array<Pick<FileChatContextItem, "root" | "relPath" | "kind">>
  >([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open || !apiBase?.trim() || !includeTemplates) {
      if (!includeTemplates) {
        setTemplates([]);
      }
      return;
    }
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; templates?: WorkflowTemplateItem[] }>(
      apiBase,
      "/api/collaboration/workflow-templates",
    )
      .then((r) => {
        if (!cancelled) {
          setTemplates(r.templates ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplates([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, includeTemplates]);

  useEffect(() => {
    if (!open || !apiBase?.trim() || categories?.length === 1 && categories[0] === "files") {
      setFleetPlaybooks([]);
      return;
    }
    let cancelled = false;
    void apiListFleetPlaybooks(apiBase)
      .then((r) => {
        if (!cancelled) {
          setFleetPlaybooks(
            (r.playbooks ?? []).map((pb) => ({ id: pb.id, label: pb.label || pb.id })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFleetPlaybooks([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, categories]);

  useEffect(() => {
    const matterId = contextMatterId?.trim();
    if (!open || !apiBase?.trim() || !matterId) {
      setMatterEvidencePaths([]);
      return;
    }
    let cancelled = false;
    void fetch(
      `${apiBase.replace(/\/$/, "")}/api/fs/tree?root=workspace&path=${encodeURIComponent(`cases/${matterId}`)}`,
      { headers: apiAuthHeaders() },
    )
      .then((r) => r.json())
      .then((payload: { ok?: boolean; entries?: Array<{ path?: string; kind?: string }> }) => {
        if (cancelled || !payload.ok || !Array.isArray(payload.entries)) {
          return;
        }
        const skip = new Set(["CASE.md", "MATTER_STRATEGY.md", "team-meeting.jsonl"]);
        const paths = payload.entries
          .filter(
            (e) =>
              typeof e.path === "string" &&
              e.kind === "file" &&
              !skip.has(e.path.split("/").pop() ?? ""),
          )
          .slice(0, 12)
          .map((e) => ({
            relPath: e.path ?? "",
            label: e.path?.split("/").pop() ?? e.path,
            hint: "案件材料",
          }));
        setMatterEvidencePaths(paths);
      })
      .catch(() => {
        if (!cancelled) {
          setMatterEvidencePaths([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, contextMatterId]);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!open || !apiBase?.trim() || q.length < 2) {
      setWorkspaceMatches([]);
      return;
    }
    let cancelled = false;
    void fetch(
      `${apiBase.replace(/\/$/, "")}/api/fs/tree?root=workspace&path=`,
      { headers: apiAuthHeaders() },
    )
      .then((r) => r.json())
      .then((payload: { ok?: boolean; entries?: Array<{ path?: string; kind?: string }> }) => {
        if (cancelled || !payload.ok || !Array.isArray(payload.entries)) {
          return;
        }
        const matches = payload.entries
          .filter(
            (e) =>
              typeof e.path === "string" &&
              (e.path.toLowerCase().includes(q) || e.path.split("/").pop()?.toLowerCase().includes(q)),
          )
          .slice(0, 8)
          .map((e) => ({
            root: "workspace" as const,
            relPath: e.path ?? "",
            kind: e.kind === "directory" ? ("directory" as const) : ("file" as const),
          }));
        setWorkspaceMatches(matches);
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceMatches([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, query]);

  const flatItems = useMemo(() => {
    const recent = readRecentFileContextPaths();
    const mergedRecent = [...workspaceMatches, ...recent];
    const built = buildComposeContextPickerItems({
      pinnedFiles,
      pinnedTruthPins,
      recentFiles: mergedRecent,
      matters: filesOnly ? [] : matters,
      contextMatterId,
      templates: includeTemplates ? templates : [],
      evidencePaths: matterEvidencePaths,
      fleetPlaybooks,
      categories,
    });
    return filterContextPickerItems(built, query);
  }, [
    pinnedFiles,
    pinnedTruthPins,
    matters,
    contextMatterId,
    templates,
    workspaceMatches,
    matterEvidencePaths,
    fleetPlaybooks,
    query,
    categories,
    filesOnly,
    includeTemplates,
  ]);

  const groups = useMemo(() => groupContextPickerItems(flatItems), [flatItems]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const runSelect = useCallback(
    (item: ComposeContextPickerItem) => {
      if (item.kind === "file") {
        if (!item.alreadyPinned) {
          onSelectFile({ root: item.root, relPath: item.relPath, kind: item.fileKind });
        }
      } else if (
        item.kind === "evidence" ||
        item.kind === "clause" ||
        item.kind === "playbook" ||
        item.kind === "theory"
      ) {
        if (!item.alreadyPinned) {
          const pin = truthPinToPayload(item);
          if (pin) {
            onSelectTruthPin?.(pin);
          }
        }
      } else if (item.kind === "matter") {
        onSelectMatter(item.matterId);
      } else if (item.kind === "template") {
        onSelectTemplate({ id: item.templateId, starterPrompt: item.starterPrompt });
      }
      onClose();
    },
    [onSelectFile, onSelectTruthPin, onSelectMatter, onSelectTemplate, onClose],
  );

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
        setActiveIndex((i) => Math.min(i + 1, Math.max(0, flatItems.length - 1)));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && flatItems[activeIndex]) {
        e.preventDefault();
        runSelect(flatItems[activeIndex]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flatItems, activeIndex, onClose, runSelect]);

  if (!open) {
    return null;
  }

  let rowIndex = 0;

  return (
    <div className="lm-compose-context-picker-backdrop" role="presentation" onClick={onClose}>
      <div
        className="lm-compose-context-picker"
        role="listbox"
        aria-label="添加上下文"
        onClick={(e) => e.stopPropagation()}
      >
        {onQueryChange ? (
          <label className="lm-compose-context-picker-search">
            <span className="lm-sr-only">搜索材料</span>
            <input
              type="search"
              className="lm-input"
              value={query}
              placeholder={searchPlaceholder}
              autoFocus
              data-testid="lm-compose-context-search"
              onChange={(e) => onQueryChange(e.target.value)}
            />
          </label>
        ) : (
          <p className="lm-compose-context-picker-hint">
            {query.trim()
              ? `搜索「${query}」`
              : filesOnly
                ? "选择工作区文件"
                : "选择文件、证据、Playbook、本案理论、案件或模板"}
          </p>
        )}
        {groups.length === 0 ? (
          <p className="lm-meta">
            {filesOnly
              ? "无匹配文件。继续输入文件名（至少 2 字）。"
              : "无匹配项。继续输入文件名、案件名、Playbook 或模板名。"}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.category} className="lm-compose-context-picker-group">
              <h4 className="lm-compose-context-picker-group-title">{group.label}</h4>
              <ul className="lm-compose-context-picker-list">
                {group.items.map((item) => {
                  const idx = rowIndex;
                  rowIndex += 1;
                  const active = idx === activeIndex;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        className={`lm-compose-context-picker-item${active ? " lm-compose-context-picker-item-active" : ""}`}
                        onClick={() => runSelect(item)}
                        disabled={
                          (item.kind === "file" && item.alreadyPinned) ||
                          ((item.kind === "evidence" ||
                            item.kind === "clause" ||
                            item.kind === "playbook" ||
                            item.kind === "theory") &&
                            item.alreadyPinned)
                        }
                      >
                        <span className="lm-compose-context-picker-label">{item.label}</span>
                        {item.hint ? (
                          <span className="lm-meta lm-compose-context-picker-hint-line">{item.hint}</span>
                        ) : null}
                        {item.kind === "file" && item.alreadyPinned ? (
                          <span className="lm-tag lm-compose-context-picker-tag">已引用</span>
                        ) : null}
                        {(item.kind === "evidence" ||
                          item.kind === "clause" ||
                          item.kind === "playbook" ||
                          item.kind === "theory") &&
                        item.alreadyPinned ? (
                          <span className="lm-tag lm-compose-context-picker-tag">已钉选</span>
                        ) : null}
                        {item.kind === "matter" && item.isCurrent ? (
                          <span className="lm-tag lm-compose-context-picker-tag">当前</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
