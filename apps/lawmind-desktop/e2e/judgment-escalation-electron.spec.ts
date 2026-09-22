import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { launchLawMindElectron, prepareE2EUserData } from "./helpers/app-driver";
import { bootstrapE2ePage, openReviewDraft } from "./e2e-helpers";

/**
 * G3 欠账一：**真机 Electron + 真实本地服务**下的待定夺卡。
 *
 * 与 `judgment-escalation.spec.ts`（preload stub + mock API）的分工：
 *
 * | spec | 覆盖 |
 * | ----------------------------- | -------------------------------------------------------- |
 * | `judgment-escalation.spec.ts` | 渲染与文案口径（姿态 → 措辞），快，跑在 PR 套件里 |
 * | 本 spec | **引擎读 sidecar → 真实 HTTP 路由 → 界面** 的整条链 |
 *
 * 为什么必须有一条真机链：那条链上任何一段断掉（`stripRaw` 白名单漏字段、路由没注册、
 * 组件没挂），stub 套件都照样全绿——因为它测的是 mock 自己返回的 JSON。
 * 这一条往工作区里写**真实形状**的 Guardian sidecar，让真实的读取端去读它。
 *
 * ## 同时覆盖 D6「三 edition 界面对等性」（2026-09-22 补）
 *
 * D6 的验收原本只有「三 edition 姿态**单测**」+「**solo** 路径真机 e2e」，
 * firm / private_deploy 的**界面对等性**一直标着「仍待补」。
 * 本文件用**同一份种子**跑三档 edition，断言界面拿到的姿态确实不同 ——
 * 这正是「对等性」该测的东西：同一输入在各自档位上表现正确，而不是各测一半。
 *
 * ## ⚠️ 三档用例守的是 **env 那条路**，不守「策略文件」那条路（变异验证过）
 *
 * 三档用例通过 **env**（`LAWMIND_EDITION`）指定档位。实测把它们要守的
 * 「策略接线」撤掉（`resolveEscalationPosture()` 改回无参调用）后，**三条照样通过** ——
 * 因为无参调用仍能从 `process.env` 读到档位，差异只在**策略文件**那一档。
 * 所以：**这三条是真机 edition 对等性覆盖，不是策略文件接线的守卫。**
 * 真正守策略文件那条路的是最后一条用例（posture 写进 `lawmind.policy.json`）。
 */

/** 与 `guardian/types.ts` 的 `escalationItems` 同形（真实落盘的字段）。 */
const ESCALATION_ITEMS = [
  { itemKey: "pr.cap", label: "责任上限的水平", reason: "属商业风险分配" },
  { itemKey: "contract.force_majeure", label: "不可抗力的范围", reason: "取决于行业惯例与谈判地位" },
];

type Posture = "advisory" | "block";

/**
 * 铺一份工作区（真实形状的 Guardian sidecar），按指定 edition 启动真机应用，
 * 打开改稿台，返回待定夺卡上读到的**姿态与文案**。
 */
async function runEscalationScenario(input: {
  edition: "solo" | "firm" | "private_deploy";
  expectPosture: Posture;
  /**
   * 把姿态写进**工作区策略文件**而不是 env（用于验证「policy 显式」那一档真的接上了）。
   * 不设时姿态完全由 edition 缺省推出。
   */
  policyFile?: Record<string, unknown>;
}): Promise<void> {
  const fixture = await prepareE2EUserData();

  // macOS 的 os.tmpdir() 在 /var（→ /private/var 符号链接）下；把 desktop-config
  // 与种子文件统一改写到 realpath 后的工作区，否则 fs-bridge 会判「symlink escapes root」。
  // 与 `electron-file-deeplink.spec.ts` 同一处理。
  const workspaceDir = await fs.realpath(fixture.workspaceDir);
  await fs.writeFile(
    path.join(fixture.userDataDir, "LawMind", "desktop-config.json"),
    JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
    "utf8",
  );

  if (input.policyFile) {
    await fs.writeFile(
      path.join(workspaceDir, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, ...input.policyFile }, null, 2),
      "utf8",
    );
  }

  // 真实形状的 Guardian sidecar：`readLatestGuardian` 要求 `latest` + `rounds`。
  const record = {
    taskId: "e2e-draft-1",
    at: "2026-09-21T00:00:00.000Z",
    verdict: "pass",
    round: 1,
    maxRounds: 2,
    gaps: [],
    escalationItems: ESCALATION_ITEMS,
  };
  await fs.writeFile(
    path.join(workspaceDir, "drafts", "e2e-draft-1.guardian.json"),
    JSON.stringify({ taskId: "e2e-draft-1", latest: record, rounds: [record] }, null, 2),
    "utf8",
  );

  // 升级通道**必须打开**：通道关着时主观项由模型判，侧车里根本没有待定夺项，
  // 这条用例会「绿得毫无意义」。
  // 姿态**刻意不设**：要由 edition 缺省推出（见文件头说明）。
  const electronApp = await launchLawMindElectron(
    { ...fixture, workspaceDir, lawMindRoot: path.join(fixture.userDataDir, "LawMind") },
    {
      LAWMIND_EDITION: input.edition,
      LAWMIND_JUDGMENT_ESCALATION: "on",
    },
  );

  try {
    const window = await electronApp.firstWindow();
    await expect(window.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
    await bootstrapE2ePage(window);
    await openReviewDraft(window, "e2e-draft-1");

    const card = window.getByTestId("lm-judgment-escalation");
    await expect(card).toBeVisible({ timeout: 60_000 });

    // 真实读取端读出来的是**侧车里那两条**（不是 mock 里编的）。
    await expect(card).toContainText("责任上限的水平");
    await expect(card).toContainText("属商业风险分配");
    await expect(card).toContainText("不可抗力的范围");

    // 姿态来自真实服务端的策略解析（edition 缺省），不是界面自己推的。
    await expect(card).toHaveAttribute("data-posture", input.expectPosture);
    if (input.expectPosture === "block") {
      // firm / private_deploy：已在对话里停下等确认，文案必须这么说。
      await expect(card).toContainText("不会替您选一条路继续");
    } else {
      // solo（advisory）：**不打断**当前流程，文案必须这么说——说反了会让律师以为被卡住。
      await expect(card).toContainText("不打断当前流程");
    }

    // 内部判定表键**不得**出现在律师可见面（只显示 label / reason）。
    await expect(card).not.toContainText("pr.cap");
    await expect(card).not.toContainText("contract.force_majeure");
  } finally {
    await electronApp.close();
  }
}

test.describe("G3 待定夺卡 · 真机 Electron（引擎 → 路由 → 界面）", () => {
  test("solo（advisory 缺省）下改稿台读得到侧车里的待定夺项，且不打断流程", async () => {
    await runEscalationScenario({ edition: "solo", expectPosture: "advisory" });
  });

  /**
   * D6 缺口：firm 档在**真机**下从未验过。同一份种子，只换 edition ——
   * 若姿态仍停在 advisory，说明 edition 那一档没接上（正是 2026-09-22 修的那个洞）。
   */
  test("firm（block 缺省）下同一份种子给出相反口径：已停下等确认", async () => {
    await runEscalationScenario({ edition: "firm", expectPosture: "block" });
  });

  test("private_deploy 与 firm 对等（同一块硬墙，不因档位不同而少说一句）", async () => {
    await runEscalationScenario({ edition: "private_deploy", expectPosture: "block" });
  });

  /**
   * **唯一**能区分「策略文件那一档接没接上」的真机用例（变异验证过）。
   *
   * 场景：律所版（firm，缺省 block）由**律所自行调回不打断** —— 这是 policy 的既有能力。
   * 姿态**只**写在 `lawmind.policy.json`，env 里不设 `LAWMIND_JUDGMENT_ESCALATION_POSTURE`
   * （且 `applyLawMindPolicyToEnv` 本就不投影 judgment 族键）。
   *
   * 于是：调用方若用无参 `resolveEscalationPosture()`（2026-09-22 修复前就是如此），
   * 策略文件被整条丢掉 → 回落到 edition 缺省 → **block** → 本用例失败；
   * 只有真的把工作区策略读进来，才会得到 advisory。
   */
  test("策略文件里的姿态真的生效：firm 也能被所内调回「不打断」", async () => {
    await runEscalationScenario({
      edition: "firm",
      expectPosture: "advisory",
      policyFile: { judgmentEscalationPosture: "advisory" },
    });
  });
});
