import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { upsertAssistant } from "../assistants/store.js";
import { loadRoleReviewChecklist, roleReviewChecklistItems } from "./role-checklist.js";

describe("role review checklist", () => {
  it("turns preset lines into guardian items without a self-score instruction", () => {
    const items = roleReviewChecklistItems("contract_review", [
      "已区分「必须修改 / 建议优化 / 可选」",
    ]);
    expect(items).toEqual([
      {
        id: "role-contract_review-1",
        look: "已区分「必须修改 / 建议优化 / 可选」",
        stop: "正文未见该项且未缓办则 fail",
      },
    ]);
    expect(JSON.stringify(items)).not.toContain("逐项核对并在最终答复中体现");
  });

  it("loads the assistant preset checklist for the evidence pack", () => {
    const lawMindRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lm-role-check-"));
    const workspaceDir = path.join(lawMindRoot, "workspace");
    fs.mkdirSync(workspaceDir, { recursive: true });
    upsertAssistant(lawMindRoot, {
      assistantId: "contracts",
      displayName: "合同",
      introduction: "",
      presetKey: "contract_review",
    });
    const envFile = path.join(lawMindRoot, ".env.lawmind");
    fs.writeFileSync(envFile, "x=1\n", "utf8");
    const loaded = loadRoleReviewChecklist(workspaceDir, "contracts", envFile);
    expect(loaded?.roleId).toBe("contract_review");
    expect(loaded?.items.some((item) => item.look.includes("必须修改"))).toBe(true);
    fs.rmSync(lawMindRoot, { recursive: true, force: true });
  });
});
