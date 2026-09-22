/**
 * Rewrite expired stock MEMORY.md policy without wiping lawyer-written notes.
 * Installed workspaces still ship the 2025 dual-model / confirm-every-file template.
 */

import fs from "node:fs";
import path from "node:path";
import { defaultMemoryMarkdown } from "./templates.js";

const STALE_MARKERS = [
  "发送邮件、修改文件、外发文书",
  "调用外部模型前告知预估消耗",
  "禁止将案件材料、客户信息发送至外部服务",
  "两种模型都返回结果时",
  "通用模型：用于背景整理",
  "专用法律模型：用于法条提取",
] as const;

const LINE_RULES: Array<{ re: RegExp; replace: string | null }> = [
  {
    re: /发送邮件、修改文件、外发文书/,
    replace:
      "- 待拍板只拦「从律师这边发出去」的操作（`send_email`、危险工具）。写合同、审合同、本地导出直接做。",
  },
  {
    re: /调用外部模型前告知预估消耗/,
    replace: "- 云端推理不是把案件材料另送到一个未授权渠道；不要把「调用模型」写成外泄。",
  },
  {
    re: /禁止将案件材料、客户信息发送至外部服务/,
    replace: "- 云端推理不是把案件材料另送到一个未授权渠道；不要把「调用模型」写成外泄。",
  },
  { re: /通用模型：用于背景整理/, replace: null },
  { re: /专用法律模型：用于法条提取/, replace: null },
  { re: /两种模型都返回结果时/, replace: null },
];

const TOPIC_INDEX_RE = /^-\s+\[[^\]]+\]\([^)]+\)/;

export function staleMemoryMarkerCount(text: string): number {
  return STALE_MARKERS.filter((marker) => text.includes(marker)).length;
}

function extractCustomAccumulation(text: string): string[] {
  const start = text.search(/^##\s+[五六七]、/m);
  if (start < 0) {
    return [];
  }
  const slice = text.slice(start);
  const bullets: string[] = [];
  for (const line of slice.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      continue;
    }
    if (TOPIC_INDEX_RE.test(trimmed)) {
      continue;
    }
    if (STALE_MARKERS.some((marker) => trimmed.includes(marker))) {
      continue;
    }
    if (trimmed.includes("_此节") || trimmed.includes("（例：")) {
      continue;
    }
    if (trimmed.length < 8) {
      continue;
    }
    bullets.push(trimmed);
  }
  return bullets;
}

function dedupeConsecutiveLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (out.length > 0 && out[out.length - 1] === line && line.trim().startsWith("- ")) {
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function dropEmptyModelSection(text: string): string {
  return text.replace(
    /##\s+五、模型使用规则\n(?:\n|-[^\n]*\n|_[^\n]*\n)*?(?=\n## |\n---|\n_最后更新|$)/,
    "",
  );
}

export function sanitizeStaleMemoryPolicy(raw: string): { text: string; changed: boolean } {
  const source = raw.replace(/^\uFEFF/, "");
  if (!source.trim() || staleMemoryMarkerCount(source) === 0) {
    return { text: source, changed: false };
  }

  const hasTopicIndex = source.split("\n").some((line) => TOPIC_INDEX_RE.test(line.trim()));
  if (!hasTopicIndex && staleMemoryMarkerCount(source) >= 3) {
    const extras = extractCustomAccumulation(source);
    let next = defaultMemoryMarkdown();
    if (extras.length > 0) {
      next = next.replace(
        "_此节由系统或律师补充已验证的工作方法。_\n",
        `_此节由系统或律师补充已验证的工作方法。_\n\n${extras.join("\n")}\n`,
      );
    }
    return { text: next, changed: next !== source };
  }

  let text = source.replace(
    /每次任务启动时必须加载此文件。/,
    "相关记忆召回可能把本文件注入当轮提示词。",
  );
  text = text
    .split("\n")
    .flatMap((line) => {
      for (const rule of LINE_RULES) {
        if (rule.re.test(line)) {
          return rule.replace ? [rule.replace] : [];
        }
      }
      return [line];
    })
    .join("\n");
  text = dropEmptyModelSection(text);
  text = dedupeConsecutiveLines(text);
  if (!text.endsWith("\n")) {
    text += "\n";
  }
  return { text, changed: text !== source };
}

export function migrateWorkspaceMemoryMarkdown(workspaceDir: string): {
  text: string;
  changed: boolean;
} {
  const filePath = path.join(path.resolve(workspaceDir), "MEMORY.md");
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { text: "", changed: false };
  }
  const next = sanitizeStaleMemoryPolicy(raw);
  if (next.changed) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmp, next.text, "utf8");
    fs.renameSync(tmp, filePath);
  }
  return next;
}
