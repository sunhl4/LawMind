import { useEffect } from "react";
import type { HistoryItem, TaskRow } from "./lawmind-app-data";

const STORAGE_PREFIX = "lawmind-lawyer-review-sig:";

function readSig(key: string): string | null {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + key);
  } catch {
    return null;
  }
}

function writeSig(key: string, sig: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, sig);
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * When running in Electron, nudges the lawyer for in-app review via OS notifications.
 * Dedupes per browser session using `status:updatedAt` signatures.
 */
export function useLawyerReviewDesktopNotify(args: {
  tasks: TaskRow[];
  history: HistoryItem[];
  enabled: boolean;
}): void {
  const { tasks, history, enabled } = args;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const desk = window.lawmindDesktop;
    if (!desk?.showNotification) {
      return;
    }

    void (async () => {
      const notifyOne = async (opts: {
        storageKey: string;
        sig: string;
        title: string;
        body: string;
        reviewTaskId: string;
        reviewMatterId: string | null | undefined;
      }) => {
        if (readSig(opts.storageKey) === opts.sig) {
          return;
        }
        const res = await desk.showNotification({
          title: opts.title,
          body: opts.body,
          openReviewOnClick: true,
          reviewTaskId: opts.reviewTaskId,
          reviewMatterId: opts.reviewMatterId ?? undefined,
        });
        if (res?.ok) {
          writeSig(opts.storageKey, opts.sig);
        }
      };

      for (const task of tasks) {
        if (task.status !== "awaiting_lawyer_review") {
          continue;
        }
        const sig = `${task.status}:${task.updatedAt}`;
        await notifyOne({
          storageKey: `task:${task.taskId}`,
          sig,
          title: "LawMind · 任务待您审核",
          body: `${task.title || task.summary || task.taskId}：请到「审核」处理。`,
          reviewTaskId: task.taskId,
          reviewMatterId: task.matterId,
        });
      }

      for (const item of history) {
        if (item.kind !== "draft") {
          continue;
        }
        const st = (item.status ?? "pending").toLowerCase();
        if (st !== "pending" && st !== "modified") {
          continue;
        }
        const sig = `${st}:${item.updatedAt}`;
        await notifyOne({
          storageKey: `draft:${item.id}`,
          sig,
          title: "LawMind · 文书待审核",
          body: `${item.label || item.id}：签批未完成，通过后可在审核台渲染交付物。`,
          reviewTaskId: item.id,
          reviewMatterId: item.matterId,
        });
      }
    })();
  }, [tasks, history, enabled]);
}
