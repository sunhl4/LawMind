/**
 * Simple CLI review gate for draft approval.
 *
 * 第一版目标：在终端里人工确认草稿是否通过，阻断未审核直接渲染。
 */

import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { resolveDraftCitationIntegrity } from "../drafts/index.js";
import type { ArtifactDraft } from "../types.js";

export type CliReviewResult =
  | { ok: true; draft: ArtifactDraft }
  | { ok: false; reason: "rejected" | "aborted" };

export async function reviewDraftInCli(
  draft: ArtifactDraft,
  opts?: { workspaceDir?: string },
): Promise<CliReviewResult> {
  const rl = readline.createInterface({ input, output });
  try {
    output.write("\n=== LawMind 草稿审核 ===\n");
    output.write(`标题: ${draft.title}\n`);
    output.write(`模板: ${draft.templateId}\n`);
    output.write(`章节数: ${draft.sections.length}\n`);
    output.write(`摘要: ${draft.summary}\n\n`);

    const ws = opts?.workspaceDir?.trim();
    if (ws) {
      const cit = resolveDraftCitationIntegrity(ws, draft);
      if (!cit.checked) {
        output.write("引用校验：无检索快照，跳过与 bundle 对照。\n\n");
      } else if (!cit.ok) {
        output.write(
          `⚠ 引用校验：以下来源 ID 不在检索 bundle：${cit.missingSourceIds.join(", ")}\n请人工核对后再决定。\n\n`,
        );
      } else {
        output.write("引用校验：章节引用 ID 均在检索 bundle 内。\n\n");
      }
    }

    const answer = (await rl.question("是否通过该草稿？(y/n): ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      return { ok: false, reason: "rejected" };
    }

    const reviewer = (await rl.question("审核人标识(默认 lawyer:cli): ")).trim() || "lawyer:cli";
    draft.reviewStatus = "approved";
    draft.reviewedBy = reviewer;
    draft.reviewedAt = new Date().toISOString();
    return { ok: true, draft };
  } catch {
    return { ok: false, reason: "aborted" };
  } finally {
    rl.close();
  }
}
