import { expect, test } from "@playwright/test";
import {
  e2eMockApiBase,
  gotoShell,
  installE2eBrowserPrefs,
  installE2eDesktopBridge,
  openDeskWork,
  openWorkspaceChat,
} from "./e2e-helpers";

/**
 * Solo 商业入口黄金路径证据：
 * E1′ 交办登记新 draft；E2′ 文件台真点「送审本合同」；E3′ 默认自动导出；E4′ click 导出审阅稿。
 */
test.describe("Solo 合同审查黄金路径", () => {
  test.beforeEach(async ({ page }) => {
    await installE2eBrowserPrefs(page);
    await page.request.post(`${e2eMockApiBase()}/__e2e__/reset`);
  });

  test("连续路径：新建空会话→芯片交办→打开结果→改稿", async ({ page }) => {
    await gotoShell(page);
    await openWorkspaceChat(page);

    await page.getByRole("button", { name: "新建对话" }).first().click();
    await expect(page.getByText("开始对话")).toBeVisible({ timeout: 20_000 });

    await openDeskWork(page);
    await page.getByTestId("lm-desk-work-contract").click();
    await expect(page.getByTestId("lm-contract-fast-lane")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("lm-contract-stance-neutral").click();
    await page.getByTestId("lm-contract-depth-quick").click();
    await page.getByTestId("lm-contract-fast-lane-materials").fill("e2e-nda.docx");

    const chatWait = page.waitForResponse(
      (res) =>
        res.url().includes("/api/chat") &&
        res.request().method() === "POST" &&
        res.ok(),
      { timeout: 30_000 },
    );
    await page.getByTestId("lm-contract-fast-lane-dispatch").click();
    const chatRes = await chatWait;
    const chatJson = (await chatRes.json()) as {
      linkedTaskId?: string;
      executionState?: { linkedTaskId?: string };
    };
    const linkedTaskId =
      chatJson.linkedTaskId || chatJson.executionState?.linkedTaskId || "";
    expect(linkedTaskId).toMatch(/^e2e-handoff-\d+$/);
    expect(linkedTaskId).not.toBe("e2e-draft-1");

    await expect(page.getByRole("region", { name: "对话消息" })).toContainText(/合同审查|结果|改稿/, {
      timeout: 20_000,
    });

    const openResult = page
      .getByTestId("lm-draft-status-signoff")
      .or(page.getByTestId("lm-commitment-signoff"))
      .or(page.getByRole("button", { name: "打开结果" }));
    await expect(openResult.first()).toBeVisible({ timeout: 30_000 });
    await openResult.first().click();

    await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
      timeout: 20_000,
    });
    expect(linkedTaskId).toBeTruthy();
  });

  test("送审同路径：文件台「送审本合同」出芯片卡且 compose 无预填交办", async ({ page }) => {
    await installE2eDesktopBridge(page);
    await gotoShell(page);
    await openWorkspaceChat(page);

    // 深链打开合同文件 → 文件台 office 面出现「送审本合同」（真 UI，非 bus hook）
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("lawmind:open-workspace-file", {
          detail: { relPath: "contracts/nda.docx" },
        }),
      );
    });

    const sendBtn = page.getByTestId("lm-editor-send-contract-review");
    await expect(sendBtn).toBeVisible({ timeout: 30_000 });
    await sendBtn.click();

    await expect(page.getByTestId("lm-contract-fast-lane")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("lm-word-revision-bar")).toHaveCount(0);
    await expect(page.getByTestId("lm-contract-fast-lane")).toContainText(/nda\.docx|已引用/, {
      timeout: 10_000,
    });

    const compose = page.getByRole("textbox", { name: "消息输入" });
    await expect(compose).toBeVisible({ timeout: 10_000 });
    await expect(compose).toHaveValue("");
    const value = await compose.inputValue();
    expect(value).not.toMatch(/【交办】/);
  });
});
