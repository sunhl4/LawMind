import fs from "node:fs/promises";
import path from "node:path";
import { createLegalToolRegistry } from "../src/lawmind/agent/tools/legal-tools.js";
import type { AgentContext } from "../src/lawmind/agent/types.js";

async function main() {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  const caseDir = path.join(workspaceDir, "cases", "demo-matter-001");
  await fs.mkdir(caseDir, { recursive: true });
  await fs.writeFile(
    path.join(caseDir, "CASE.md"),
    "# 案件信息\n\n## 1. 案件基本信息\n- matter: demo-matter-001\n\n## 2. 事实摘要\n- 客户提交了一份待审查合同。\n",
    "utf8",
  );
  const registry = createLegalToolRegistry();
  const workflowTool = registry.get("execute_workflow");
  if (!workflowTool) {
    throw new Error("execute_workflow tool not found");
  }

  const ctx: AgentContext = {
    workspaceDir,
    sessionId: "demo-session",
    actorId: "lawyer:demo",
    matterId: "demo-matter-001",
  };

  const result = await workflowTool.execute(
    {
      instruction: "请整理合同审查意见并生成法律备忘录，重点标注风险与待确认事项。",
      title: "客户合同审查备忘录",
      audience: "客户",
      matter_id: "demo-matter-001",
      auto_approve: true,
    },
    ctx,
  );

  if (!result.ok) {
    throw new Error(result.error ?? "demo workflow failed");
  }

  const data = (result.data ?? {}) as {
    taskId?: string;
    status?: string;
    outputPath?: string;
    steps?: string[];
  };

  console.log("[LawMind Demo] success");
  console.log(`taskId=${data.taskId ?? "unknown"}`);
  console.log(`status=${data.status ?? "unknown"}`);
  if (data.outputPath) {
    console.log(`output=${data.outputPath}`);
  }
  if (Array.isArray(data.steps)) {
    console.log("steps:");
    for (const step of data.steps) {
      console.log(`- ${step}`);
    }
  }
}

main().catch((err) => {
  console.error("[LawMind Demo] failed:", err);
  process.exitCode = 1;
});
