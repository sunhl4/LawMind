#!/usr/bin/env node
/**
 * 写入一套可点开的样例卷宗（传票、开庭、今日待办、待回复邮件）。
 *
 *   pnpm lawmind:seed:desk
 *   LAWMIND_WORKSPACE_DIR=/path pnpm lawmind:seed:desk
 *
 * 默认写入仓库 `workspace/`（桌面开发默认工作区）。可重复执行。
 */

import path from "node:path";
import {
  seedSampleDesk,
  SAMPLE_LITIGATION_MATTER_ID,
} from "../../src/lawmind/desk/seed-sample-desk.js";

const workspaceDir = path.resolve(
  process.env.LAWMIND_WORKSPACE_DIR?.trim() || path.join(process.cwd(), "workspace"),
);

const seeded = await seedSampleDesk(workspaceDir);
console.log(`[LawMind] 样例卷宗已写入 ${workspaceDir}`);
console.log(`  诉讼（请在工作台点开）：${seeded.litigationMatterId}`);
console.log(`  合同审查：${seeded.contractMatterId}`);
console.log(`  已结对照案：${seeded.closedMatterId}`);
console.log("");
console.log("请打开本机 LawMind 桌面应用 → 顶栏「工作台」。");
console.log(`在「在办案件」里点「星辉精密诉环宇科技」，不要用浏览器。`);
console.log(`案件 id：${SAMPLE_LITIGATION_MATTER_ID}`);
