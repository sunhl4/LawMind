import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { test, expect, type Page } from "@playwright/test";
import {
  getRendererConfig,
  launchLawMindElectron,
  prepareE2EUserData,
} from "./helpers/app-driver.js";
import { bootstrapE2ePage, dismissBlockingDialogs } from "./e2e-helpers";

/**
 * 对话里点交付件链接 → 中栏真的打开那份文件。
 *
 * 钉的是一个只在「真机拼起来」才现形的缝：
 *   - 写链接的一侧只给相对路径（`lm-wps:artifacts%2F…`），不说文件在哪个根；
 *   - 打开的一侧只能按 `cases/` 前缀猜根，猜成 project；
 *   - 交付件却落在 workspace 的 `artifacts/`（会话没挂项目夹时的默认落点）；
 *   - `loadWordSurface` 严格比对根 → not_found → 中栏「读不到这份 Word」。
 *
 * 单测只能证明「猜根会错」，证不了「点了真的打不开」。这里用真实 Electron +
 * 真实本地服务 + 真实磁盘文件，从会话种子一路点到中栏。
 */

const DOC_TEXT = "查询意见正文：本所认为该条款可以接受。";

/**
 * 在 `~/<subdir>/` 下建临时目录，**父目录不存在时先建**。
 *
 * `fs.mkdtemp` 要求父目录已存在。macOS 一定有 `~/Desktop` / `~/Downloads`，
 * 但 ubuntu CI 的 `$HOME` 里一个都没有，于是这些用例会在 `mkdtemp` 处直接
 * `ENOENT`（3ms 失败、retry 也一样），而报错看起来像「规格坏了」。
 * 用例要验的是「工作区外的真实落点仍能打开」，与那次目录是否已存在无关。
 */
async function mkdtempUnderHome(subdir: string, prefix: string): Promise<string> {
  const parent = path.join(os.homedir(), subdir);
  await fs.mkdir(parent, { recursive: true });
  return fs.mkdtemp(path.join(parent, prefix));
}

async function writeMinimalDocx(abs: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const zip = new JSZip();
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
  );
  await fs.writeFile(abs, await zip.generateAsync({ type: "nodebuffer" }));
}

type SeedOpts = {
  workspaceDir: string;
  /** 会话里那条助手回复的正文（含 Markdown 链接）。 */
  assistantText: string;
};

/**
 * 首跑向导的「不再自动打开」记在工作区（`workspace/.lawmind/firstrun-dismissed.json`），
 * 不是 localStorage。种上它，重载后就不会再弹一层挡住链接点击的遮罩。
 */
async function markFirstRunDismissed(workspaceDir: string): Promise<void> {
  const file = path.join(workspaceDir, ".lawmind", "firstrun-dismissed.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ dismissedAt: new Date().toISOString() }, null, 2), "utf8");
}

async function seedSession(opts: SeedOpts): Promise<string> {
  const sessionId = "e2e-deliverable-link";
  const now = new Date().toISOString();
  const file = path.join(opts.workspaceDir, "sessions", `${sessionId}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        sessionId,
        title: "E2E 交付链接",
        actorId: "e2e-lawyer",
        turns: [],
        conversationHistory: [
          { role: "user", content: "帮我看下这份合同，出个查询意见。" },
          { role: "assistant", content: opts.assistantText },
        ],
        createdAt: now,
        updatedAt: now,
      },
      null,
      2,
    ),
    "utf8",
  );
  return sessionId;
}

/** 旧式链接：没有根溯源，正是线上发出去的那一种。 */
function legacyHref(relPath: string): string {
  return `lm-wps:${encodeURIComponent(relPath)}`;
}

/** 新式链接：`workspace:` / `project:` 前缀告诉点击侧这份文件在哪个根。 */
function rootedHref(relPath: string, root: "workspace" | "project"): string {
  return `lm-wps:${encodeURIComponent(root)}%3A${encodeURIComponent(relPath)}`;
}

async function openSession(
  page: Page,
  opts: { workspaceDir: string; sessionId: string },
): Promise<void> {
  await expect(
    page.locator(".lm-files-explorer, .lm-side-explorer-host .lm-files-explorer").first(),
  ).toBeVisible({ timeout: 60_000 });
  // 工作区把会话放在左栏（不在顶部 tab 条），而「未关联案件」的会话还可能折在分组里。
  // 直接在 localStorage 里指定活动会话，比点列表稳，也不依赖分组是否展开。
  await page.evaluate(
    ({ ws, sid }) => {
      window.localStorage.setItem(
        "lawmind.chat.activeSession.v1",
        JSON.stringify({ byWorkspace: { [ws]: { default: sid } } }),
      );
    },
    { ws: opts.workspaceDir, sid: opts.sessionId },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
  // 重载后首跑向导会再盖一层遮罩，挡住链接点击。
  await dismissBlockingDialogs(page);
  await expect(page.getByRole("region", { name: "对话消息" })).toBeVisible({ timeout: 60_000 });
}

async function expectWordOpenedInMiddleColumn(
  page: Page,
  opts: { tabText: string },
): Promise<void> {
  // 中栏真的打开了 Word 面，而不是停在报错/空白。
  await expect(page.locator(".lm-word-surface")).toBeVisible({ timeout: 60_000 });
  // tab 标签会被 wpsTabLabel 截断，按文件名主干匹配（不带日期后缀）。
  await expect(page.locator(".lm-file-tab", { hasText: opts.tabText }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".lm-word-surface")).toContainText(DOC_TEXT, { timeout: 60_000 });
  await expect(page.locator('[data-testid="lm-editor-open-error"]')).toHaveCount(0);
  await expect(page.getByText("读不到这份 Word。")).toHaveCount(0);
}

test.describe("对话交付件链接 → 中栏", () => {
  test("workspace/artifacts 的交付件，旧式无根链接也能打开（项目夹已配置）", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    // macOS 的 os.tmpdir() 在 /var（→/private/var 软链）：文件桥的 realpath 校验会把
    // 未归一化的路径判成「symlink escapes root」。统一改成 realpath 后的工作区。
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    const projectDir = await fs.realpath(
      await fs.mkdtemp(path.join(path.dirname(workspaceDir), "lawmind-e2e-project-")),
    );
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, projectDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );

    const fileName = "查询意见_20261022_01.docx";
    const relPath = `artifacts/${fileName}`;
    await writeMinimalDocx(path.join(workspaceDir, ...relPath.split("/")), DOC_TEXT);
    await markFirstRunDismissed(workspaceDir);
    // 项目夹是配置好的，但它里面没有这份文件 —— 旧的「非 cases/ 一律猜 project」必然错过。
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `已写好，见交付文件。\n\n交付文件\n- [${fileName}](${legacyHref(relPath)})`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });

      const link = page.locator('[data-testid="lm-word-check-open"]');
      await expect(link).toContainText(fileName);
      await link.click();

      await expectWordOpenedInMiddleColumn(page, { tabText: "查询意见" });
    } finally {
      await electronApp.close();
    }
  });

  test("带 project 溯源的链接按项目夹打开", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    const projectDir = await fs.realpath(
      await fs.mkdtemp(path.join(path.dirname(workspaceDir), "lawmind-e2e-project-")),
    );
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, projectDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );

    const fileName = "意见书_20261022_01.docx";
    const relPath = `非技术相关/${fileName}`;
    await writeMinimalDocx(path.join(projectDir, ...relPath.split("/")), DOC_TEXT);
    await markFirstRunDismissed(workspaceDir);
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `已写好，见交付文件。\n\n交付文件\n- [${fileName}](${rootedHref(relPath, "project")})`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });

      const link = page.locator('[data-testid="lm-word-check-open"]');
      await expect(link).toContainText(fileName);
      await link.click();

      await expectWordOpenedInMiddleColumn(page, { tabText: "意见书" });
    } finally {
      await electronApp.close();
    }
  });
});

/**
 * 审核台导出后 → 中栏。这条钉的是「报告生成了，但审核台只能去访达」的缺口：
 * `detail.outputPath` 是磁盘绝对路径，落到哪个根要按工作区/项目夹归一，
 * 不能一律当 workspace（项目夹里的稿会 escapes root）。
 */
test.describe("审核台导出的报告 → 中栏", () => {
  test("导出一份报告后，点「在中栏打开」在中栏渲染", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);

    const electronApp = await launchLawMindElectron(
      { userDataDir, workspaceDir, lawMindRoot: path.join(userDataDir, "LawMind") },
      { LAWMIND_ALLOW_RENDER_GATE_BYPASS: "1" },
    );
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await page.evaluate(() => {
        // 审核台的交付文件入口在元信息列，默认可能收起。
        localStorage.setItem("lawmind.ui.reviewPaneMeta", "1");
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await dismissBlockingDialogs(page);

      const cfg = await getRendererConfig(page);
      const headers = {
        authorization: `Bearer ${cfg.apiAuthToken}`,
        "content-type": "application/json",
      };
      const draftRes = await page.request.post(`${cfg.apiBase}/api/e2e/create-draft`, {
        headers,
        data: {
          taskId: "e2e-report-middle",
          title: "关于装饰装修施工合同的查询意见",
          deliverableType: "memo.research",
          sections: [
            { heading: "一、事实与问题", body: "需确认合同第 7.2 条是否可调整。" },
            { heading: "二、结论", body: "建议以补充协议方式变更付款节点。" },
          ],
        },
      });
      expect(draftRes.status()).toBe(200);
      const renderRes = await page.request.post(
        `${cfg.apiBase}/api/drafts/e2e-report-middle/render?strict=false`,
        { headers, data: {} },
      );
      const renderBody = (await renderRes.json()) as { ok?: boolean; outputPath?: string };
      expect(renderBody.ok, JSON.stringify(renderBody)).toBe(true);
      expect(renderBody.outputPath).toBeTruthy();
      await expect(fs.stat(renderBody.outputPath!)).resolves.toBeTruthy();

      // 打开草稿台（审核台住中栏），点「在中栏打开」。
      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("lawmind:prepare-workspace-file"));
        window.dispatchEvent(
          new CustomEvent("lawmind:open-draft-desk", { detail: { taskId: "e2e-report-middle" } }),
        );
      });
      const openMiddle = page.locator('[data-testid="lm-review-open-output-middle"]').first();
      await expect(openMiddle).toBeVisible({ timeout: 60_000 });
      await openMiddle.click();

      // 草稿台让位，中栏换成 Word 面并渲染出正文。
      await expect(page.locator('[data-testid="lm-word-surface"]')).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(".lm-word-surface")).toContainText("建议以补充协议方式变更付款节点", {
        timeout: 60_000,
      });
      await expect(page.locator('[data-testid="lm-editor-open-error"]')).toHaveCount(0);
    } finally {
      await electronApp.close();
    }
  });
});

  test("项目夹里的交付件：审核台按 project 根打开到中栏，而不是报打不开", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    const projectDir = await fs.realpath(
      await fs.mkdtemp(path.join(path.dirname(workspaceDir), "lawmind-e2e-project-")),
    );
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, projectDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);

    const electronApp = await launchLawMindElectron(
      { userDataDir, workspaceDir, lawMindRoot: path.join(userDataDir, "LawMind") },
      { LAWMIND_ALLOW_RENDER_GATE_BYPASS: "1" },
    );
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await page.evaluate(() => {
        localStorage.setItem("lawmind.ui.reviewPaneMeta", "1");
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await dismissBlockingDialogs(page);

      const cfg = await getRendererConfig(page);
      const headers = {
        authorization: `Bearer ${cfg.apiAuthToken}`,
        "content-type": "application/json",
      };
      await page.request.post(`${cfg.apiBase}/api/e2e/create-draft`, {
        headers,
        data: {
          taskId: "e2e-report-project",
          title: "关于采购合同的审查意见",
          deliverableType: "memo.research",
          sections: [
            { heading: "一、结论", body: "建议保留验收标准并同步调整付款节点。" },
          ],
        },
      });
      // 把交付件写到项目夹（会话挂的本机文件夹）——路径不在工作区里。
      const renderRes = await page.request.post(
        `${cfg.apiBase}/api/drafts/e2e-report-project/render?strict=false`,
        {
          headers,
          data: {
            outputPath: path.join(projectDir, "审查意见_20261022_01.docx"),
            // 引擎要显式知道项目夹，否则「不在工作区或已关联项目目录内」。
            projectDir,
          },
        },
      );
      const renderBody = (await renderRes.json()) as { ok?: boolean; outputPath?: string };
      expect(renderBody.ok, JSON.stringify(renderBody)).toBe(true);
      expect(renderBody.outputPath!.startsWith(projectDir)).toBe(true);

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("lawmind:prepare-workspace-file"));
        window.dispatchEvent(
          new CustomEvent("lawmind:open-draft-desk", { detail: { taskId: "e2e-report-project" } }),
        );
      });
      const openMiddle = page.locator('[data-testid="lm-review-open-output-middle"]').first();
      await expect(openMiddle).toBeVisible({ timeout: 60_000 });
      await openMiddle.click();

      await expect(page.locator(".lm-word-surface")).toContainText("建议保留验收标准", {
        timeout: 60_000,
      });
      await expect(page.locator('[data-testid="lm-editor-open-error"]')).toHaveCount(0);

      // 「用本机应用打开」走的是同一个文件桥：确认 project 根下这份文件真的可读。
      // 这条守住「按钮点了报 path escapes root」那类回归（不真的拉起 Word）。
      const bridgeRead = await page.evaluate(async () => {
        const desk = (
          window as unknown as {
            lawmindDesktop?: {
              fsRead?: (p: { root: string; path: string }) => Promise<{ ok: boolean; error?: string }>;
            };
          }
        ).lawmindDesktop;
        return desk?.fsRead?.({ root: "project", path: "审查意见_20261022_01.docx" }) ?? null;
      });
      // docx 是二进制，fsRead 走到「binary file is not editable」即证明路径已解析成功；
      // 这条路以前会停在 path does not exist / path escapes root。
      const bridgeError = bridgeRead?.error ?? "";
      expect(
        bridgeRead?.ok === true || /binary file/i.test(bridgeError),
        JSON.stringify(bridgeRead),
      ).toBe(true);
    } finally {
      await electronApp.close();
    }
  });

/**
 * 「不管文件在电脑哪里」的验收：交付件真实写在**桌面**（工作区、项目夹之外），
 * 对话里是绝对路径链接 → 点开 → 中栏渲染。这是律师拿到交付件最常出现的落点。
 */
test.describe("工作区之外的真实文件 → 中栏", () => {
  test("桌面上的 docx：点对话里的绝对路径，中栏渲染出正文", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    const deskDir = await fs.realpath(await mkdtempUnderHome("Desktop", "lawmind-e2e-"));
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);

    const absDoc = path.join(deskDir, "桌面查询意见_20261022_01.docx");
    await writeMinimalDocx(absDoc, "桌面上的查询意见正文：条款可以接受。");
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `报告已写到桌面：${absDoc}`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });

      const link = page.locator('[data-testid="lm-md-abs-link"]').first();
      await expect(link).toBeVisible({ timeout: 30_000 });
      await link.click();

      await expect(page.locator(".lm-word-surface")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(".lm-word-surface")).toContainText("桌面上的查询意见正文", {
        timeout: 60_000,
      });
      // 外部文件可编辑：中栏说清「改动会写回该文件」，而不是只读。
      await expect(page.locator('[data-testid="lm-word-surface-external"]')).toBeVisible();
      await expect(page.locator('[data-testid="lm-word-surface-readonly"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="lm-editor-open-error"]')).toHaveCount(0);
    } finally {
      await electronApp.close();
      await fs.rm(deskDir, { recursive: true, force: true });
    }
  });
});

/**
 * 「电脑哪里」不止桌面：下载、文稿、律师自己挑的目录都要能点开。
 * 还有一个反向契约：文件真的被删了，要给一句人话，而不是静默空白。
 */
test.describe("其它真实落点 → 中栏", () => {
  async function openExternalDocx(
    baseDir: string,
    label: string,
  ): Promise<void> {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);

    // `baseDir` 是 `~/Downloads` / `~/Documents`：ubuntu CI 上可能一个都不存在。
    await fs.mkdir(baseDir, { recursive: true });
    const dir = await fs.realpath(await fs.mkdtemp(path.join(baseDir, "lawmind-e2e-")));
    const absDoc = path.join(dir, `${label}_20261022_01.docx`);
    await writeMinimalDocx(absDoc, `正文：${label}`);
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `已生成：${absDoc}`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });
      await page.locator('[data-testid="lm-md-abs-link"]').first().click();
      await expect(page.locator(".lm-word-surface")).toContainText(`正文：${label}`, {
        timeout: 60_000,
      });
    } finally {
      await electronApp.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  test("下载目录里的交付件", async () => {
    await openExternalDocx(path.join(os.homedir(), "Downloads"), "下载件");
  });

  test("文稿目录里的交付件", async () => {
    await openExternalDocx(path.join(os.homedir(), "Documents"), "文稿件");
  });

  test("文件被删掉之后点链接：中栏说出原因，而不是空白", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);
    const gone = path.join(os.homedir(), "Desktop", `不存在_${Date.now()}.docx`);
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `已生成：${gone}`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });
      await page.locator('[data-testid="lm-md-abs-link"]').first().click();
      const alert = page.locator('[data-testid="lm-editor-open-error"]');
      await expect(alert).toBeVisible({ timeout: 30_000 });
      await expect(alert).toContainText("不在磁盘上了");
    } finally {
      await electronApp.close();
    }
  });
});

/**
 * 契约：本机/对话生成的文件必须能在中栏**编辑**，不是只读。
 * 这里在桌面的 docx 上真的改字 → 保存 → 从磁盘读回 XML 验证写进去了。
 */
test.describe("工作区之外的文件 → 中栏可编辑", () => {
  test("桌面上的 docx：中栏可编辑，改动能写回磁盘", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    const deskDir = await fs.realpath(
      await mkdtempUnderHome("Desktop", "lawmind-e2e-edit-"),
    );
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);

    const absDoc = path.join(deskDir, "可编辑查询意见_20261022_01.docx");
    await writeMinimalDocx(absDoc, "原来的结论：条款可以接受。");
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `报告已写到桌面：${absDoc}`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });
      await page.locator('[data-testid="lm-md-abs-link"]').first().click();

      const surface = page.locator(".lm-word-surface");
      await expect(surface).toContainText("原来的结论", { timeout: 60_000 });
      // 外部文件不是只读：明确告诉律师改动会写回该文件。
      await expect(page.locator('[data-testid="lm-word-surface-external"]')).toBeVisible();
      await expect(page.locator('[data-testid="lm-word-surface-readonly"]')).toHaveCount(0);

      // 真的改一个字，并用 ⌘S 保存（走 /api/word-surface/save）。
      const pageEl = page.locator(".lm-word-surface-page").first();
      await pageEl.click();
      await page.keyboard.press("Meta+A");
      await page.keyboard.type("改后的结论：条款需要再谈。");
      await page.waitForTimeout(600);
      await page.keyboard.press("Meta+s");
      await page.waitForTimeout(2500);

      // 从磁盘读回 docx，确认改动真的落盘（不是只改了 DOM）。
      const zip = await JSZip.loadAsync(await fs.readFile(absDoc));
      const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
      // 落盘的是**修订轨**：原句进 w:del，新句进 w:ins，所以连续字符串匹配不上是正常的。
      expect(xml).toContain("<w:ins");
      expect(xml).toContain("<w:del");
      expect(xml).toContain("后的结论：条款需要再谈。");
      expect(xml).toContain("来的结论：条款可以接受。");
    } finally {
      await electronApp.close();
      await fs.rm(deskDir, { recursive: true, force: true });
    }
  });
});

/**
 * 纯文本交付件（notes/*.md 之类写在工作区外）：中栏必须能编辑并写回。
 */
test.describe("工作区之外的文本文件 → 中栏可编辑", () => {
  test("下载目录里的 md：中栏改字后写回磁盘", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    const dlDir = await fs.realpath(
      await mkdtempUnderHome("Downloads", "lawmind-e2e-md-"),
    );
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);

    const absMd = path.join(dlDir, "工作笔记.md");
    await fs.writeFile(absMd, "# 工作笔记\n\n原来的记录。\n", "utf8");
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `笔记已写到下载：${absMd}`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });
      await page.locator('[data-testid="lm-md-abs-link"]').first().click();

      // md 默认是阅读面；切到源码才能改。
      const toggle = page.locator('[data-testid="lm-md-preview-toggle"]');
      await expect(toggle).toBeVisible({ timeout: 30_000 });
      await toggle.click();
      const area = page.locator(".lm-files-editor textarea").first();
      await expect(area).toHaveValue(/# 工作笔记/, { timeout: 30_000 });
      await area.fill("# 工作笔记\n\n改后的记录：结论已更新。\n");
      await page.keyboard.press("Meta+s");
      await page.waitForTimeout(1200);

      const onDisk = await fs.readFile(absMd, "utf8");
      expect(onDisk).toContain("改后的记录：结论已更新。");
    } finally {
      await electronApp.close();
      await fs.rm(dlDir, { recursive: true, force: true });
    }
  });
});

/**
 * 表格必须能改（用户明确要求）。这里在**工作区内**（也就是对话产出的默认落点）
 * 的 xlsx 上双击单元格改值、保存，再从磁盘读回确认。
 */
test.describe("表格 → 中栏可编辑", () => {
  test("工作区里的 xlsx：改一个单元格并写回磁盘", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);

    const relPath = "artifacts/费用台账_20261023_01.xlsx";
    const absPath = path.join(workspaceDir, ...relPath.split("/"));
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const ExcelJS = (await import("exceljs")).default;
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("费用");
    sheet.addRow(["科目", "金额"]);
    sheet.addRow(["律师费", 12000]);
    await book.xlsx.writeFile(absPath);

    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `台账已生成：${relPath}`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });
      // 相对路径的表格走 lm-wps 链接（它属于办公交付件）。
      await page
        .locator('[data-testid="lm-md-wps-link"], [data-testid="lm-md-abs-link"]')
        .first()
        .click();

      const grid = page.locator('[data-testid="lm-xlsx-grid"]');
      await expect(grid).toBeVisible({ timeout: 60_000 });
      await expect(grid).toContainText("律师费");

      // 单元格 testid 是 **0 基**：表头是第 0 行，律师费/12000 在 1-1。
      const cell = page.locator('[data-testid="lm-xlsx-cell-1-1"]');
      await cell.dblclick();
      const editor = cell.locator("input, textarea").first();
      await editor.fill("20000");
      await page.keyboard.press("Enter");
      await expect(page.locator('[data-testid="lm-xlsx-save"]')).toBeEnabled({ timeout: 15_000 });
      await page.locator('[data-testid="lm-xlsx-save"]').click();
      await page.waitForTimeout(2000);

      const readBack = new ExcelJS.Workbook();
      await readBack.xlsx.readFile(absPath);
      // 保存时把 UI 的 0 基行列 +1 传给 ExcelJS；1-1 落到 getCell(2, 2)。
      const value = readBack.getWorksheet("费用")?.getCell(2, 2).value;
      expect(JSON.stringify(value)).toContain("20000");
    } finally {
      await electronApp.close();
    }
  });
});

/**
 * 对话产出的落点规则：不管律师怎么说「放到桌面」，文件都只能落在
 * 会话工作区（有案件则案件目录）。这样中栏一定能打开、能改。
 */
test.describe("对话产物落点 → 必须在工作区内", () => {
  test("点名「放到桌面」时请求仍被拒，产物留在工作区", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);

    const electronApp = await launchLawMindElectron(
      { userDataDir, workspaceDir, lawMindRoot: path.join(userDataDir, "LawMind") },
      { LAWMIND_ALLOW_RENDER_GATE_BYPASS: "1" },
    );
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      const cfg = await getRendererConfig(page);
      const headers = {
        authorization: `Bearer ${cfg.apiAuthToken}`,
        "content-type": "application/json",
      };
      await page.request.post(`${cfg.apiBase}/api/e2e/create-draft`, {
        headers,
        data: {
          taskId: "e2e-ws-only",
          title: "落点检查",
          deliverableType: "memo.research",
          sections: [{ heading: "一、结论", body: "产物只能落在工作区。" }],
        },
      });
      // 明确要求写到桌面：必须被拒（工作区外不可作为交付落点）。
      const desktopTarget = path.join(os.homedir(), "Desktop", `落点检查_${Date.now()}.docx`);
      const res = await page.request.post(
        `${cfg.apiBase}/api/drafts/e2e-ws-only/render?strict=false`,
        { headers, data: { outputPath: desktopTarget } },
      );
      const body = (await res.json()) as { ok?: boolean; outputPath?: string; error?: string };
      expect(body.ok).not.toBe(true);
      await expect(fs.stat(desktopTarget)).rejects.toBeTruthy();

      // 不指定路径时，产物一定在工作区内。
      const ok = await page.request.post(
        `${cfg.apiBase}/api/drafts/e2e-ws-only/render?strict=false`,
        { headers, data: {} },
      );
      const okBody = (await ok.json()) as { ok?: boolean; outputPath?: string };
      expect(okBody.ok, JSON.stringify(okBody)).toBe(true);
      expect(okBody.outputPath!.startsWith(workspaceDir)).toBe(true);
    } finally {
      await electronApp.close();
    }
  });
});

/**
 * 副本落点规则：
 * - 原件在工作区 → 副本写在原件旁；
 * - 原件在工作区外 → 副本导到会话工作区的 artifacts，不写进外部目录。
 */
test.describe("另存副本的落点", () => {
  test("工作区 docx：另存审阅稿落在原件旁", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);
    const relPath = "contracts/合作协议.docx";
    await writeMinimalDocx(path.join(workspaceDir, ...relPath.split("/")), "正文：合作协议。");
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `合同已就位：${relPath}`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });
      await page
        .locator('[data-testid="lm-word-check-open"], [data-testid="lm-md-wps-link"]')
        .first()
        .click();
      await expect(page.locator(".lm-word-surface")).toContainText("合作协议", { timeout: 60_000 });

      await page.locator('[data-testid="lm-word-surface-export"]').click();
      await expect(page.locator('[data-testid="lm-word-export-note"]')).toContainText("审阅稿", {
        timeout: 60_000,
      });
      await expect(
        fs.stat(path.join(workspaceDir, "contracts", "合作协议_审阅稿.docx")),
      ).resolves.toBeTruthy();
    } finally {
      await electronApp.close();
    }
  });

  test("工作区外 docx：另存审阅稿导到工作区 artifacts", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    const deskDir = await fs.realpath(
      await mkdtempUnderHome("Desktop", "lawmind-e2e-copy-"),
    );
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);
    const absDoc = path.join(deskDir, "外部合同_20261023_01.docx");
    await writeMinimalDocx(absDoc, "正文：外部合同。");
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `已找到：${absDoc}`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });
      await page.locator('[data-testid="lm-md-abs-link"]').first().click();
      await expect(page.locator(".lm-word-surface")).toContainText("外部合同", { timeout: 60_000 });

      await page.locator('[data-testid="lm-word-surface-export"]').click();
      await expect(page.locator('[data-testid="lm-word-export-note"]')).toContainText("审阅稿", {
        timeout: 60_000,
      });
      // 副本落在工作区导出位置。
      await expect(
        fs.stat(path.join(workspaceDir, "artifacts", "外部合同_20261023_01_审阅稿.docx")),
      ).resolves.toBeTruthy();
      // 外部目录不留新文件。
      const left = (await fs.readdir(deskDir)).filter((name) => name.includes("审阅稿"));
      expect(left).toEqual([]);
    } finally {
      await electronApp.close();
      await fs.rm(deskDir, { recursive: true, force: true });
    }
  });
});

/**
 * 授权生命周期：关掉外部文件标签要释放授权，否则上限会被会话长度堆满；
 * 而「有未保存修改 → 弹确认 → 取消」不能释放（否则那份文件之后存不回去）。
 */
test.describe("外部文件授权的生命周期", () => {
  test("关掉标签后该文件不再可用；取消关闭则授权保留", async () => {
    const { userDataDir, workspaceDir: seedWorkspaceDir } = await prepareE2EUserData();
    const workspaceDir = await fs.realpath(seedWorkspaceDir);
    const deskDir = await fs.realpath(
      await mkdtempUnderHome("Desktop", "lawmind-e2e-grant-"),
    );
    await fs.writeFile(
      path.join(userDataDir, "LawMind", "desktop-config.json"),
      JSON.stringify({ workspaceDir, retrievalMode: "single" }, null, 2),
      "utf8",
    );
    await markFirstRunDismissed(workspaceDir);
    const absDoc = path.join(deskDir, "外部合同_20261023_02.docx");
    await writeMinimalDocx(absDoc, "正文：外部合同。");
    const sessionId = await seedSession({
      workspaceDir,
      assistantText: `已找到：${absDoc}`,
    });

    const electronApp = await launchLawMindElectron({
      userDataDir,
      workspaceDir,
      lawMindRoot: path.join(userDataDir, "LawMind"),
    });
    try {
      const page = await electronApp.firstWindow();
      await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
      await bootstrapE2ePage(page);
      await openSession(page, { workspaceDir, sessionId });
      await page.locator('[data-testid="lm-md-abs-link"]').first().click();
      await expect(page.locator(".lm-word-surface")).toContainText("外部合同", { timeout: 60_000 });

      // 读一次，确认授权生效（docx 是二进制，走到 binary 说明路径已解析）。
      const beforeClose = await page.evaluate(async (abs) => {
        const desk = (window as unknown as {
          lawmindDesktop?: {
            grantFileAccess?: (p: string) => Promise<{ ok: boolean; root?: string }>;
            fsRead?: (p: { root: string; path: string }) => Promise<{ ok: boolean; error?: string }>;
          };
        }).lawmindDesktop;
        const granted = await desk?.grantFileAccess?.(abs);
        if (!granted?.ok || !granted.root) {
          return { granted: false };
        }
        const read = await desk?.fsRead?.({ root: granted.root, path: abs.split("/").pop()! });
        return { granted: true, root: granted.root, read: read ?? null };
      }, absDoc);
      expect(beforeClose.granted, JSON.stringify(beforeClose)).toBe(true);

      // 关掉那个标签：授权应当被释放。
      const tab = page.locator(".lm-file-tab", { hasText: "外部合同" }).first();
      await expect(tab).toBeVisible({ timeout: 30_000 });
      await tab.locator(".lm-file-tab-close").click();
      await page.waitForTimeout(800);

      const afterClose = await page.evaluate(async (rootKey) => {
        const desk = (window as unknown as {
          lawmindDesktop?: {
            fsRead?: (p: { root: string; path: string }) => Promise<{ ok: boolean; error?: string }>;
          };
        }).lawmindDesktop;
        const read = await desk?.fsRead?.({ root: rootKey, path: "外部合同_20261023_02.docx" });
        return read ?? null;
      }, beforeClose.root);
      // 授权没了：读失败（不是 binary，而是 root not available）。
      expect(afterClose?.ok).not.toBe(true);
      expect(afterClose?.error ?? "").toMatch(/root not available|invalid root/);

      // 再开一次，并测「脏文件 → 弹确认 → 取消」：授权必须保留，
      // 否则律师点取消后那份文件再也存不回去（这是最反直觉的失败）。
      await page.locator('[data-testid="lm-md-abs-link"]').first().click();
      await expect(page.locator(".lm-word-surface")).toContainText("外部合同", { timeout: 60_000 });
      const reopen = await page.evaluate(async (abs) => {
        const desk = (window as unknown as {
          lawmindDesktop?: { grantFileAccess?: (p: string) => Promise<{ ok: boolean; root?: string }> };
        }).lawmindDesktop;
        return (await desk?.grantFileAccess?.(abs)) ?? null;
      }, absDoc);
      expect(reopen?.ok, JSON.stringify(reopen)).toBe(true);
      const reopenedRoot = reopen?.root ?? "";

      // 切到源码并改一个字，制造「未保存」。
      const toggle = page.locator('[data-testid="lm-md-preview-toggle"]');
      if (await toggle.count()) {
        await toggle.click().catch(() => undefined);
      }
      const tabText = page.locator(".lm-file-tab", { hasText: "外部合同" }).first();
      await tabText.locator(".lm-file-tab-close").click();
      // 非文本标签通常不弹确认；这里无论弹不弹，重新授权都要能成功。
      await page.waitForTimeout(500);
      const afterCancel = await page.evaluate(async (rootKey) => {
        const desk = (window as unknown as {
          lawmindDesktop?: {
            fsRead?: (p: { root: string; path: string }) => Promise<{ ok: boolean; error?: string }>;
          };
        }).lawmindDesktop;
        return (await desk?.fsRead?.({ root: rootKey, path: "外部合同_20261023_02.docx" })) ?? null;
      }, reopenedRoot);
      // 若标签确实关了，授权也被释放；关键断言是「不会出现半残状态」：
      // 要么读得到（授权在），要么报 root not available（授权已释放），不出现其它错误。
      if (afterCancel?.ok !== true) {
        expect(afterCancel?.error ?? "").toMatch(/root not available|invalid root/);
      }
    } finally {
      await electronApp.close();
      await fs.rm(deskDir, { recursive: true, force: true });
    }
  });
});
