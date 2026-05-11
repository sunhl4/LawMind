/**
 * 案件在 UI 中的展示名：来自 CASE.md「基本信息」或回退规则。
 */

const DISPLAY_RE = /^案件名称（展示用）[:：]\s*(.+)$/i;
const MATTER_NAME_RE = /^案件名称[:：]\s*(.+)$/i;
const CAUSE_RE = /^案由[:：]\s*(.+)$/;

function stripItalicsPlaceholder(raw: string): string {
  return raw
    .replace(/^\s*_\s*/, "")
    .replace(/\s*_\s*$/, "")
    .trim();
}

/** 下划线占位提示（未填写） */
export function isMatterDisplayPlaceholder(value: string): boolean {
  const v = value.trim();
  if (!v) {
    return true;
  }
  if (v.startsWith("_（") || v.startsWith("_(")) {
    return true;
  }
  const hintPrefixes = ["（可选", "（可填写", "（留空", "（导入", "（侧栏"] as const;
  if (hintPrefixes.some((p) => v.startsWith(p))) {
    return true;
  }
  return false;
}

/** 由导入路径生成合法 matterId（ASCII 段 + 时间戳，避免与中文展示名混淆）。 */
export function suggestMatterIdForImport(
  filePath: string,
  salt = 0,
  opts?: { treatAsDirectory?: boolean },
): string {
  const base = displayNameFromImportBasename(filePath, opts);
  const ascii = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 48);
  const slug = ascii.length >= 2 && /^[a-zA-Z0-9]/.test(ascii) ? ascii : "import";
  const stamp = `${Date.now().toString(36).slice(-6)}${salt > 0 ? `x${salt.toString(36)}` : ""}`;
  const candidate = `${slug}-${stamp}`;
  return candidate.length <= 128 ? candidate : candidate.slice(0, 128);
}

/** 自导入路径推导展示名（去扩展名、简单规范化）；供导入流程写入 CASE 前调用。 */
export function displayNameFromImportBasename(
  fileName: string,
  opts?: { treatAsDirectory?: boolean },
): string {
  const trimmed = fileName.trim().replace(/^[./\\]+|[./\\]+$/g, "");
  const base = trimmed.split(/[/\\]/u).pop() ?? trimmed;
  const noExt = opts?.treatAsDirectory === true ? base : base.replace(/\.[^.]+$/u, "");
  const name = noExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return name || base || trimmed || "未命名案件";
}

function scanBasicInfoLines(caseMemory: string): string[] {
  const escaped = "## 1. 基本信息".replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}\\n\\n([\\s\\S]*?)(?:\\n##\\s+\\d+\\.|$)`);
  const match = pattern.exec(caseMemory);
  if (!match) {
    return [];
  }
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"));
}

/**
 * 从 CASE 正文解析律师填写的展示名称；若无则返回 undefined。
 */
export function parseMatterDisplayNameFromCase(caseMemory: string): string | undefined {
  for (const line of scanBasicInfoLines(caseMemory)) {
    const body = line.replace(/^-\s*/, "").trim();
    for (const re of [DISPLAY_RE, MATTER_NAME_RE]) {
      const m = re.exec(body);
      if (m) {
        const v = stripItalicsPlaceholder(m[1] ?? "");
        if (!isMatterDisplayPlaceholder(v)) {
          return v;
        }
      }
    }
  }
  for (const line of scanBasicInfoLines(caseMemory)) {
    const body = line.replace(/^-\s*/, "").trim();
    const m = CAUSE_RE.exec(body);
    if (m) {
      const v = stripItalicsPlaceholder(m[1] ?? "");
      if (!isMatterDisplayPlaceholder(v)) {
        return v;
      }
    }
  }
  return undefined;
}

/**
 * 侧栏最终展示名（必有值）：展示名 → matterId。
 */
export function resolveMatterSidebarLabel(
  caseMemory: string | undefined,
  matterId: string,
): string {
  if (caseMemory) {
    const named = parseMatterDisplayNameFromCase(caseMemory);
    if (named) {
      return named;
    }
  }
  return matterId.trim() || "未命名案件";
}

/** 概览主标题优先用展示名 */
export function resolveMatterHeadline(
  caseMemory: string,
  matterId: string,
  coreIssue?: string,
): string {
  const named = parseMatterDisplayNameFromCase(caseMemory);
  if (named) {
    return named;
  }
  if (coreIssue?.trim()) {
    return coreIssue.trim();
  }
  return `${matterId} · 可先填写「案件名称（展示用）」或补充核心争点`;
}

/** 任务在「建议下一步」中的可读一行（避免满屏路由模板） */
export function formatTaskLineForNextActions(task: {
  status: string;
  summary: string;
  title?: string;
}): string {
  const title = task.title?.trim();
  if (title) {
    return `${task.status}：${title}`;
  }
  const ins = task.summary.match(/原始指令：「([^」]{0,160})/);
  if (ins) {
    const snippet = ins[1].trim();
    return `${task.status}：${snippet}${snippet.length >= 160 ? "…" : ""}`;
  }
  const kind = task.summary.match(/任务类型：([^。]+)/);
  if (kind) {
    return `${task.status}：${kind[1].trim()}`;
  }
  const s = task.summary.trim().replace(/\s+/g, " ");
  return `${task.status}：${s.length > 100 ? `${s.slice(0, 100)}…` : s}`;
}
