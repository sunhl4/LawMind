import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { splitWordCheckMarkers, type WordCheckRef } from "../../../../src/lawmind/drafts/word-review-marker.ts";
import { openDeliverableInWps, revealDeliverableInFolder } from "./canvas/host-actions";
import { renderLegalMarkdown } from "./lawmind-chat-markdown";
import { openContractRevisionForTask } from "./lawmind-open-contract-revision";

type Props = {
  text: string;
  modelFailure?: boolean;
  className?: string;
  apiBase?: string;
  workspaceDir?: string;
  onOpenDraft?: (taskId: string) => void;
  onOpenError?: (message: string) => void;
};

type FileMenu = { x: number; y: number; relPath: string };

function fileLabel(relPath: string): string {
  const name = relPath.split("/").pop() || relPath;
  return name.length > 42 ? `${name.slice(0, 20)}…${name.slice(-18)}` : name;
}

/** 正文里已经写出的那份 docx，和这条核对记到一起。旧消息只有任务号时也能点。 */
function bindReviewPaths(body: string, checks: WordCheckRef[]): WordCheckRef[] {
  const paths = [
    ...body.matchAll(
      /(?:^|[\s：:（(])((?:[^\s/\\[\]()<>"'`，。；：、]+\/)*[^\s/\\[\]()<>"'`，。；：、]+\.docx)/giu,
    ),
  ]
    .map((match) => match[1] ?? "")
    .filter((path, index, all) => path && all.indexOf(path) === index);
  if (checks.length === 1 && !checks[0]?.relPath && paths.length === 1) {
    return [{ taskId: checks[0].taskId, relPath: paths[0] }];
  }
  return checks;
}

export function LawmindMsgAssistant({
  text,
  modelFailure,
  className,
  apiBase,
  workspaceDir,
  onOpenDraft,
  onOpenError,
}: Props): ReactNode {
  const [menu, setMenu] = useState<FileMenu | null>(null);
  useEffect(() => {
    if (!menu) {
      return undefined;
    }
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!text.trim()) {
    return null;
  }
  const { body, checks } = splitWordCheckMarkers(text);
  const reviewFiles = bindReviewPaths(body, checks);
  const reviewByPath = new Map(
    reviewFiles.flatMap((check) => (check.relPath ? [[check.relPath, check.taskId] as const] : [])),
  );
  const openReview = (taskId: string) => {
    if (onOpenDraft) {
      onOpenDraft(taskId);
      return;
    }
    if (!apiBase?.trim()) {
      onOpenError?.("本地服务未就绪，请稍后再打开审核。");
      return;
    }
    void openContractRevisionForTask({ apiBase, taskId, workspaceDir }).then((result) => {
      if (!result.ok) {
        onOpenError?.(result.error);
      }
    });
  };
  const shownChecks = reviewFiles.filter((check) => !check.relPath || !body.includes(check.relPath));
  return (
    <div
      className={`lm-msg lm-msg-ai${modelFailure ? " lm-msg-model-failure" : ""}${className ? ` ${className}` : ""}`}
    >
      {body
        ? renderLegalMarkdown(body, {
            apiBase,
            workspaceDir,
            onOpenDraft,
            onOpenError,
            reviewByPath,
            onOpenReviewTask: openReview,
            onReviewFileMenu: (x, y, relPath) => setMenu({ x, y, relPath }),
          })
        : null}
      {shownChecks.map((check) => (
        <WordCheckLink
          key={check.taskId}
          check={check}
          onOpenReview={() => openReview(check.taskId)}
          onContextMenu={(event, relPath) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY, relPath });
          }}
        />
      ))}
      {menu
        ? createPortal(
            <div
              className="lm-word-selection-menu lm-word-selection-menu-stack"
              role="menu"
              data-testid="lm-word-check-menu"
              style={{ left: menu.x, top: menu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                data-testid="lm-word-check-reveal"
                onClick={() => {
                  const relPath = menu.relPath;
                  setMenu(null);
                  void revealDeliverableInFolder(relPath).then((result) => {
                    if (!result.ok && result.error) {
                      onOpenError?.(result.error);
                    }
                  });
                }}
              >
                去本机文件所在目录
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="lm-word-check-wps"
                onClick={() => {
                  const relPath = menu.relPath;
                  setMenu(null);
                  void openDeliverableInWps(relPath).then((result) => {
                    if (!result.ok && result.error) {
                      onOpenError?.(result.error);
                    }
                  });
                }}
              >
                用本机应用打开
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function WordCheckLink(props: {
  check: WordCheckRef;
  onOpenReview: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, relPath: string) => void;
}): ReactNode {
  const { check, onOpenReview, onContextMenu } = props;
  const label = check.relPath ? fileLabel(check.relPath) : "去核对";
  return (
    <div className="lm-word-check-file" data-testid="lm-word-check-file">
      <button
        type="button"
        className="lm-md-session-link"
        data-testid="lm-word-check-open"
        title={check.relPath ? "打开核对。右键可以去本机目录，或用本机应用打开。" : "打开核对"}
        onClick={onOpenReview}
        onContextMenu={
          check.relPath
            ? (event) => {
                const relPath = check.relPath;
                if (relPath) {
                  onContextMenu(event, relPath);
                }
              }
            : undefined
        }
      >
        {label}
      </button>
    </div>
  );
}
