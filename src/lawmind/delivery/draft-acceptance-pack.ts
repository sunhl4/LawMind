/**
 * Per-draft Acceptance Pack — 单份草稿对外的"放心交付包"。
 *
 * 与 `acceptance-pack.ts`（工作区级别给采购/IT 用）不同，本模块面向
 * 单个草稿，输出可与 .docx 一同发给客户的 Markdown 包，包含：
 *   - 草稿标题/章节摘要
 *   - 验收报告（Acceptance Gate）
 *   - 引用完整性校验结果
 *   - 与该任务相关的审计事件子集
 *
 * 设计取舍：
 *   - Markdown 而非 PDF：生成快、易嵌入到客户邮件、可二次裁剪。
 *   - 不嵌入草稿正文（章节纯文本），避免与 .docx 重复且控制大小。
 *   - 引用完整性校验复用 `resolveDraftCitationIntegrity`（已存在）。
 */

import path from "node:path";
import { readAllAuditLogs } from "../audit/index.js";
import { validateDraftAgainstSpec } from "../deliverables/index.js";
import { resolveDraftCitationIntegrity } from "../drafts/index.js";
import type { ArtifactDraft, AuditEvent } from "../types.js";

export type DraftAcceptancePackOptions = {
  /** 限制审计事件最多多少条（按时间倒序保留最近，默认 200） */
  maxAuditEvents?: number;
  /** 报告生成时间，可注入便于测试稳定 */
  generatedAt?: string;
};

const TASK_RELATED_AUDIT_KINDS: ReadonlySet<string> = new Set([
  "task.created",
  "task.confirmed",
  "task.rejected",
  "research.started",
  "research.completed",
  "draft.created",
  "draft.citation_integrity",
  "draft.reviewed",
  "draft.review_labeled",
  "artifact.rendered",
]);

function escapeMd(s: string | undefined): string {
  if (!s) {
    return "";
  }
  return s.replace(/\|/g, "\\|").replace(/\r\n/g, "\n").replace(/\n/g, " / ");
}

/**
 * 渲染单份草稿的验收交付包 Markdown。
 *
 * @param workspaceDir 工作区根目录（用于读取审计日志和 sources 校验）
 * @param draft 已经持久化的草稿
 * @param opts 可选参数
 */
export async function buildDraftAcceptancePackMarkdown(
  workspaceDir: string,
  draft: ArtifactDraft,
  opts: DraftAcceptancePackOptions = {},
): Promise<string> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const acceptance = validateDraftAgainstSpec(draft);
  const citation = resolveDraftCitationIntegrity(workspaceDir, draft);

  const auditDir = path.join(workspaceDir, "audit");
  const allEvents = await readAllAuditLogs(auditDir).catch(() => [] as AuditEvent[]);
  const taskEvents = allEvents
    .filter((e) => e.taskId === draft.taskId && TASK_RELATED_AUDIT_KINDS.has(e.kind))
    .toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
  const cap = opts.maxAuditEvents ?? 200;
  const trimmedEvents = taskEvents.length > cap ? taskEvents.slice(-cap) : taskEvents;

  const sectionLines: string[] = [];
  for (const section of draft.sections) {
    const wordCount = section.body.replace(/\s+/g, "").length;
    sectionLines.push(`- **${section.heading || "(无标题)"}** — 字数 ${wordCount}`);
  }

  const checkLines = acceptance.checks.map((c) => {
    const icon = c.passed ? "✅" : c.severity === "blocker" ? "⛔" : "⚠️";
    const hint = c.passed ? "" : `\n    - ${escapeMd(c.hint ?? "")}`;
    return `- ${icon} **${c.label}** [${c.severity}]${hint}`;
  });

  const citationLines: string[] = [];
  if (!citation.checked) {
    citationLines.push("- 跳过：未找到对应的检索快照（reason: `no_research_snapshot`）");
    citationLines.push("- 建议：重新运行检索后再生成本验收包，以获得引用核对结果。");
  } else {
    citationLines.push(`- 总体: ${citation.ok ? "✅ 全部引用可对齐" : "⚠️ 存在未对齐引用"}`);
    citationLines.push(`- 缺失来源 ID 数量: ${citation.missingSourceIds.length}`);
    citationLines.push(`- 出现问题的章节: ${citation.sectionsWithIssues.length}`);
    if (citation.missingSourceIds.length > 0) {
      citationLines.push(`- 缺失来源 ID 明细:`);
      for (const id of citation.missingSourceIds.slice(0, 10)) {
        citationLines.push(`  - \`${id}\``);
      }
      if (citation.missingSourceIds.length > 10) {
        citationLines.push(`  - …其余 ${citation.missingSourceIds.length - 10} 条`);
      }
    }
    for (const sec of citation.sectionsWithIssues.slice(0, 5)) {
      citationLines.push(
        `- 章节 **${escapeMd(sec.heading)}** 缺失: ${sec.missing.map((m) => `\`${m}\``).join(", ")}`,
      );
    }
  }

  const auditLines: string[] =
    trimmedEvents.length === 0
      ? ["_未找到与本任务相关的审计事件_"]
      : [
          "| 时间 | 事件 | 操作者 | 备注 |",
          "| --- | --- | --- | --- |",
          ...trimmedEvents.map(
            (e) =>
              `| ${e.timestamp} | \`${e.kind}\` | ${escapeMd(
                e.actor + (e.actorId ? `(${e.actorId})` : ""),
              )} | ${escapeMd(e.detail ?? "")} |`,
          ),
        ];

  const placeholderLines =
    acceptance.placeholderCount === 0
      ? ["_无待补充占位符_"]
      : [
          `共 ${acceptance.placeholderCount} 个待补充占位符，样例：`,
          ...acceptance.placeholderSamples.map((p) => `- \`${p}\``),
        ];

  return [
    `# LawMind 交付验收包`,
    "",
    `> 本验收包随交付物（${draft.output.toUpperCase()}）一同发出，记录了草稿在 LawMind 内的合规、引用、审计与验收状态。`,
    "",
    `- **任务 ID**: \`${draft.taskId}\``,
    `- **关联案件**: ${draft.matterId ? `\`${draft.matterId}\`` : "无"}`,
    `- **标题**: ${escapeMd(draft.title)}`,
    `- **交付物类型**: ${acceptance.deliverableType ?? "(未识别)"}`,
    `- **交付物格式**: ${draft.output}`,
    `- **审核状态**: \`${draft.reviewStatus}\``,
    `- **生成时间**: ${generatedAt}`,
    "",
    `## 1. 验收门禁`,
    "",
    `- **总体结论**: ${acceptance.ready ? "✅ 已通过（可交付）" : "⛔ 未通过（仍有阻断项）"}`,
    `- 阻断项: ${acceptance.blockerCount}　提示项: ${acceptance.warningCount}　占位符: ${acceptance.placeholderCount}`,
    "",
    ...checkLines,
    "",
    `### 占位符`,
    "",
    ...placeholderLines,
    "",
    `## 2. 引用完整性`,
    "",
    ...citationLines,
    "",
    `## 3. 草稿章节速览`,
    "",
    ...(sectionLines.length > 0 ? sectionLines : ["_草稿无章节_"]),
    "",
    `## 4. 与本任务相关的审计事件`,
    "",
    ...auditLines,
    "",
    `## 5. 律师签收`,
    "",
    `- [ ] 已核对验收门禁结论与本所交付标准一致`,
    `- [ ] 已检查引用完整性，缺失/多余引用已确认`,
    `- [ ] 已审阅审计事件，无未授权动作`,
    `- [ ] 同意将本交付包随交付物提供给客户`,
    "",
    `_本验收包仅供律师及客户内部使用；不构成对法规、案例或第三方主张的独立法律意见。_`,
    "",
  ].join("\n");
}
