import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatGoldenExamplesPromptBlock, loadGoldenExamplesForDrafting } from "./golden-recall.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("golden-recall", () => {
  it("loads matching golden drafts for prompt injection", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-gold-"));
    dirs.push(ws);
    const gdir = path.join(ws, "golden");
    fs.mkdirSync(gdir, { recursive: true });
    const entry = {
      taskId: "task-g1",
      promotedAt: new Date().toISOString(),
      hasReasoningSnapshot: false,
      draft: {
        taskId: "task-g1",
        title: "合同审查意见样例",
        deliverableType: "contract.review",
        templateId: "contract-review",
        sections: [
          { heading: "审查结论", body: "整体风险中等，建议修订付款与违约条款。" },
          { heading: "主要风险", body: "管辖约定不明。" },
        ],
      },
    };
    fs.writeFileSync(path.join(gdir, "task-g1.golden.json"), JSON.stringify(entry), "utf8");
    fs.writeFileSync(
      path.join(gdir, "golden.jsonl"),
      `${JSON.stringify({ taskId: "task-g1", promotedAt: entry.promotedAt, templateId: "contract-review" })}\n`,
      "utf8",
    );
    const hints = loadGoldenExamplesForDrafting({
      workspaceDir: ws,
      instruction: "请审查本合同付款与违约",
      deliverableType: "contract.review",
      limit: 2,
    });
    expect(hints.length).toBe(1);
    expect(formatGoldenExamplesPromptBlock(hints)).toContain("质量范例");
  });

  it("prefers body-matched golden over title-only noise", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-gold-w-"));
    dirs.push(ws);
    const gdir = path.join(ws, "golden");
    fs.mkdirSync(gdir, { recursive: true });
    const bodyHit = {
      taskId: "task-body",
      promotedAt: new Date().toISOString(),
      hasReasoningSnapshot: false,
      draft: {
        taskId: "task-body",
        title: "通用意见",
        deliverableType: "contract.review",
        templateId: "x",
        sections: [
          { heading: "审查结论", body: "付款节点与违约金上限需修订，建议增加催告解除条款。" },
        ],
      },
    };
    const titleOnly = {
      taskId: "task-title",
      promotedAt: new Date().toISOString(),
      hasReasoningSnapshot: false,
      draft: {
        taskId: "task-title",
        title: "付款违约审查备忘",
        deliverableType: "memo",
        templateId: "y",
        sections: [{ heading: "摘要", body: "无关劳动争议处理流程。" }],
      },
    };
    for (const entry of [bodyHit, titleOnly]) {
      fs.writeFileSync(
        path.join(gdir, `${entry.taskId}.golden.json`),
        JSON.stringify(entry),
        "utf8",
      );
    }
    fs.writeFileSync(
      path.join(gdir, "golden.jsonl"),
      `${JSON.stringify({ taskId: "task-title" })}\n${JSON.stringify({ taskId: "task-body" })}\n`,
      "utf8",
    );
    const hints = loadGoldenExamplesForDrafting({
      workspaceDir: ws,
      instruction: "请审查付款节点与违约金上限",
      deliverableType: "contract.review",
      limit: 2,
    });
    expect(hints[0]?.taskId).toBe("task-body");
  });
});
