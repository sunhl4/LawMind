/**
 * 支持诊断包（脱敏 zip）。
 *
 * 用途：律师在遇到问题时一键导出，发给支持方定位；因此**必须**先脱敏。
 *
 * 严格排除：模型 API Key、邮件密钥、MCP secret、许可激活码、任何 `*.key`/`*.pem`、
 * `.env*`、工作区案件正文（CASE.md / drafts / materials 都不进包）。
 * 只包含：Doctor 状态（已过滤）、指标汇总、审计摘要、版本与平台信息。
 */

import path from "node:path";

/** 递归把疑似秘密的键删掉（键名匹配即删，值内容不再二次扫描）。 */
const SECRET_KEY_PATTERN =
  /(api[-_]?key|apikey|secret|token|password|passwd|credential|authorization|bearer|activation[-_]?code|private[-_]?key|envfile|env_file)/i;

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 12) {
    return "[depth-limit]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = redactSecrets(raw, depth + 1);
    }
    return out;
  }
  return value;
}

export type DiagnosticBundleInput = {
  workspaceDir: string;
  /** Doctor / health 载荷（会再脱敏一次）。 */
  health: unknown;
  /** 指标汇总（product metrics / north-star）。 */
  metrics: unknown;
  /** 交办成绩单。 */
  scorecard: unknown;
  /** 审计摘要 markdown（可选；由调用方生成，不得含案件正文）。 */
  auditSummaryMarkdown?: string;
  /** 版本与平台信息。 */
  build: Record<string, unknown>;
  now?: Date;
};

export type DiagnosticBundleFile = { name: string; content: string };

/**
 * 组装诊断包文件清单（不写盘；由路由压成 zip）。
 * 每个文件的内容都过一遍 `redactSecrets`，脱敏失败宁可少放。
 */
export function buildDiagnosticBundleFiles(input: DiagnosticBundleInput): DiagnosticBundleFile[] {
  const now = input.now ?? new Date();
  const files: DiagnosticBundleFile[] = [
    {
      name: "README.txt",
      content: [
        "LawMind 支持诊断包（已脱敏）",
        "",
        `生成时间：${now.toISOString()}`,
        `工作区：${path.basename(input.workspaceDir)}（仅目录名，不含路径）`,
        "",
        "本包不包含：模型 API Key、邮件密钥、许可激活码、案件正文（CASE.md / 草稿 / 材料）。",
        "键名疑似密钥的字段一律替换为 [redacted]。",
        "如仍需补充信息，请让律师手工确认后再提供。",
        "",
      ].join("\n"),
    },
    {
      name: "doctor.json",
      content: `${JSON.stringify(redactSecrets(input.health), null, 2)}\n`,
    },
    {
      name: "metrics.json",
      content: `${JSON.stringify(redactSecrets(input.metrics), null, 2)}\n`,
    },
    {
      name: "scorecard.json",
      content: `${JSON.stringify(redactSecrets(input.scorecard), null, 2)}\n`,
    },
    {
      name: "build.json",
      content: `${JSON.stringify(redactSecrets(input.build), null, 2)}\n`,
    },
  ];
  if (input.auditSummaryMarkdown?.trim()) {
    files.push({
      name: "audit-summary.md",
      content: `${input.auditSummaryMarkdown.trim()}\n`,
    });
  }
  return files;
}

/** 判断一个文件名是否允许进包（防目录穿越；本包不接受任意路径）。 */
export function isSafeBundleFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length < 128 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..") &&
    /^[A-Za-z0-9._-]+$/.test(name)
  );
}
