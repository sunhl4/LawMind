import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWorkspaceAgentPresets, loadWorkspaceAgentPreset } from "./agent-presets.js";

describe("agent-presets", () => {
  let workspaceDir = "";

  afterEach(() => {
    if (workspaceDir) {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
      workspaceDir = "";
    }
  });

  it("parses lawmind/agents/*.md presets", () => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-agents-"));
    const dir = path.join(workspaceDir, "lawmind", "agents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "contract-reviewer.md"),
      `# 合同审查员
roleId: contract_reviewer
deliverableType: contract.review
riskLevel: high
description: 逐条审查合同风险

请对以下合同进行逐条审查：
`,
      "utf8",
    );

    const presets = listWorkspaceAgentPresets(workspaceDir);
    expect(presets).toHaveLength(1);
    expect(presets[0]?.id).toBe("contract-reviewer");
    expect(presets[0]?.roleId).toBe("contract_reviewer");
    expect(loadWorkspaceAgentPreset(workspaceDir, "contract-reviewer")?.title).toBe("合同审查员");
  });
});
