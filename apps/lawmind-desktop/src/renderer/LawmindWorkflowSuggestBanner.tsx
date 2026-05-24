import { useEffect, useState, type ReactNode } from "react";
import { apiGetJson } from "./api-client";

type WorkflowListItem = {
  id: string;
  name: string;
  description?: string;
  triggerPaths?: string[];
};

type Props = {
  apiBase?: string;
  /** Pinned paths (relative) from file chat context */
  pinnedRelPaths: string[];
  onRunWorkflow?: (workflowId: string, starterPrompt?: string) => void;
};

function pathMatchesTrigger(relPath: string, pattern: string): boolean {
  const norm = relPath.replace(/\\/g, "/").toLowerCase();
  const pat = pattern.replace(/\\/g, "/").toLowerCase();
  if (pat.includes("*")) {
    const re = new RegExp(
      `^${pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*")}$`,
    );
    return re.test(norm) || norm.endsWith(pat.replace(/^\*\//, ""));
  }
  return norm.includes(pat) || norm.endsWith(pat);
}

export function LawmindWorkflowSuggestBanner(props: Props): ReactNode {
  const { apiBase, pinnedRelPaths, onRunWorkflow } = props;
  const [match, setMatch] = useState<WorkflowListItem | null>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    if (!apiBase?.trim() || pinnedRelPaths.length === 0) {
      setMatch(null);
      return;
    }
    let cancelled = false;
    void apiGetJson<{ ok?: boolean; templates?: WorkflowListItem[] }>(
      apiBase,
      "/api/collaboration/workflow-templates",
    )
      .then((r) => {
        if (cancelled) {
          return;
        }
        const raw = r as { templates?: WorkflowListItem[] };
        const templates = Array.isArray(raw.templates) ? raw.templates : [];
        for (const t of templates) {
          const triggers = t.triggerPaths ?? [];
          if (triggers.length === 0) {
            continue;
          }
          for (const rel of pinnedRelPaths) {
            if (triggers.some((p) => pathMatchesTrigger(rel, p))) {
              setMatch(t);
              return;
            }
          }
        }
        setMatch(null);
      })
      .catch(() => {
        if (!cancelled) {
          setMatch(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, pinnedRelPaths.join("|")]);

  if (!match || dismissedId === match.id) {
    return null;
  }

  return (
    <div className="lm-workflow-suggest-banner" role="status">
      <span>
        检测到材料路径，可运行工作流「{match.name}」
        {match.description ? ` — ${match.description}` : ""}
      </span>
      <div className="lm-workflow-suggest-actions">
        {onRunWorkflow ? (
          <button
            type="button"
            className="lm-btn lm-btn-small"
            onClick={() => onRunWorkflow(match.id, match.description)}
          >
            运行
          </button>
        ) : null}
        <button
          type="button"
          className="lm-btn lm-btn-ghost lm-btn-small"
          onClick={() => setDismissedId(match.id)}
        >
          暂不
        </button>
      </div>
    </div>
  );
}
