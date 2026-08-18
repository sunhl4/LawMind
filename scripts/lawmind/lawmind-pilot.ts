/**
 * Desk 试点包：三场景门禁与绑定。
 *
 * 无真实 API key 时走 keyword/规则。不断言模型质量分。
 *
 *   pnpm lawmind:pilot
 */

import { assertDeskPilot, runDeskPilot } from "../../src/lawmind/integration/desk-pilot.js";

async function main(): Promise<void> {
  console.log("[Desk Pilot] keyword/rules path; no model quality score");
  const result = await runDeskPilot();
  for (const item of result.checks) {
    const mark = item.ok ? "✓" : "✗";
    console.log(`  ${mark} ${item.name}: ${item.detail}`);
  }
  assertDeskPilot(result);
  console.log("\n✅ Desk pilot gates passed. Real lawyer week still pending customers.");
}

main().catch((err) => {
  console.error("[Desk Pilot] failed:", err);
  process.exitCode = 1;
});
