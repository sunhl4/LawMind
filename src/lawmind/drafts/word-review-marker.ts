/** 对话里「去核对 / 用 WPS 打开」的标记。不含磁盘读写，渲染进程也能用。 */

const MARKER_RE = /\[\[word-check:([A-Za-z0-9._-]+)(?:\|([^\]\s]+))?\]\]/g;

export type WordCheckRef = {
  taskId: string;
  /** 审阅稿相对路径。有则对话里可以交给本机 WPS。 */
  relPath?: string;
};

export function wordCheckMarker(taskId: string, relPath?: string): string {
  const id = taskId.trim();
  const path = safeReviewRel(relPath);
  if (!path) {
    return `[[word-check:${id}]]`;
  }
  return `[[word-check:${id}|${path}]]`;
}

/** 审阅稿和原件在同一目录。用原件的相对目录加上审阅稿文件名。 */
export function reviewFileRel(baselineRel: string, reviewAbs: string): string | undefined {
  const base = baselineRel.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  const name = reviewAbs.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/")) : "";
  return safeReviewRel(dir ? `${dir}/${name}` : name);
}

export function splitWordCheckMarkers(text: string): { body: string; checks: WordCheckRef[] } {
  const checks: WordCheckRef[] = [];
  const body = text
    .replace(new RegExp(MARKER_RE.source, "g"), (_all, id: string, rawPath: string | undefined) => {
      if (!checks.some((row) => row.taskId === id)) {
        const relPath = safeReviewRel(rawPath);
        checks.push(relPath ? { taskId: id, relPath } : { taskId: id });
      }
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, checks };
}

function safeReviewRel(relPath: string | undefined): string | undefined {
  const raw = relPath?.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!raw || raw.startsWith("/") || raw.includes("..") || raw.includes(":") || /\s/.test(raw)) {
    return undefined;
  }
  if (!/\.docx$/i.test(raw)) {
    return undefined;
  }
  const parts = raw.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    return undefined;
  }
  return parts.join("/");
}
