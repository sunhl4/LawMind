import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, type ElectronApplication, type Page } from "@playwright/test";
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { prepareElectronE2EUserDataWithEnv } from "../electron-fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..", "..");

export type AppDriverConfig = {
  userDataDir: string;
  workspaceDir: string;
  lawMindRoot: string;
};

export type RendererConfig = {
  apiBase: string;
  apiAuthToken: string;
  workspaceDir: string;
};

export type LogEntry = {
  type: "console" | "pageerror" | "response-failed" | "request-failed";
  text?: string;
  location?: string;
  error?: string;
};

export type CollectedLogs = {
  entries: LogEntry[];
  hasSevere: boolean;
  hasUnhandledException: boolean;
};

/**
 * 准备临时用户数据目录，并写入 E2E 专用环境配置（假模型 key、签批/导出 bypass、测试路由）。
 */
export async function prepareE2EUserData(opts: { matterId?: string } = {}): Promise<AppDriverConfig> {
  return prepareElectronE2EUserDataWithEnv(opts);
}

/**
 * 启动 LawMind Electron 应用，使用指定的 userDataDir。
 */
export async function launchLawMindElectron(
  config: AppDriverConfig,
  extraEnv: Record<string, string> = {},
): Promise<ElectronApplication> {
  return electron.launch({
    args: [path.join(desktopRoot, "electron/main.mjs"), `--user-data-dir=${config.userDataDir}`],
    cwd: desktopRoot,
    env: {
      ...process.env,
      LAWMIND_E2E: "1",
      LAWMIND_SKIP_AUTO_UPDATE: "1",
      LAWMIND_ENABLE_E2E_TEST_ROUTES: "1",
      ...extraEnv,
    },
    timeout: 120_000,
  });
}

/**
 * 从渲染进程获取本地服务配置（apiBase + apiAuthToken）。
 */
export async function getRendererConfig(page: Page): Promise<RendererConfig> {
  const config = await page.evaluate(() =>
    (window as typeof window & { lawmindDesktop?: { getConfig: () => Promise<unknown> } }).lawmindDesktop?.getConfig(),
  );
  expect(config).toBeTruthy();
  const c = config as Record<string, unknown>;
  expect(typeof c.apiBase).toBe("string");
  expect(typeof c.apiAuthToken).toBe("string");
  expect(typeof c.workspaceDir).toBe("string");
  return {
    apiBase: String(c.apiBase),
    apiAuthToken: String(c.apiAuthToken),
    workspaceDir: String(c.workspaceDir),
  };
}

/**
 * 等待主窗口 Shell 渲染完成。
 */
export async function waitForShell(page: Page): Promise<void> {
  await expect(page.locator(".lm-shell")).toBeVisible({ timeout: 120_000 });
}

/**
 * 通过 API 健康检查确认本地服务已就绪。
 * 用于崩溃恢复场景：持续读取渲染进程配置，直到新的 apiBase 健康为止。
 */
export async function waitForLocalServerReady(
  page: Page,
  timeoutMs = 30_000,
): Promise<RendererConfig> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;
  while (Date.now() < deadline) {
    const config = await getRendererConfig(page).catch(() => null);
    if (!config) {
      await page.waitForTimeout(250);
      continue;
    }
    try {
      const res = await page.request.get(`${config.apiBase}/api/health`, {
        headers: { authorization: `Bearer ${config.apiAuthToken}` },
      });
      if (res.ok()) {
        const body = (await res.json()) as { ok?: boolean };
        if (body.ok === true) {
          return config;
        }
      }
      lastError = new Error(`health returned HTTP ${res.status()}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`Local server did not become ready: ${lastError?.message ?? "timeout"}`);
}

/**
 * 完成首跑对话框，创建首个案件。
 * 返回自动生成的 matterId（通过 API 反查）。
 */
export async function completeFirstRunDialog(page: Page): Promise<string> {
  const dialog = page.getByRole("dialog", { name: /LawMind 新手引导/i });
  await expect(dialog).toBeVisible({ timeout: 30_000 });

  // 1. 选择角色
  await dialog.getByRole("button", { name: "独立执业" }).click();
  // 2. 跳过偏好，使用推荐默认
  await dialog.getByTestId("lm-firstrun-skip-prefs").click();
  // 3. 选择第一个可用交付物类型（通常是合同审查或律师函）
  await expect(dialog.locator(".lm-firstrun-cards")).toBeVisible({ timeout: 10_000 });
  const firstSpec = dialog.locator(".lm-firstrun-card").first();
  await expect(firstSpec).toBeVisible({ timeout: 10_000 });
  await firstSpec.click();
  // 4. 显式勾选「同时创建演示案件」，再开始交办
  await dialog.getByTestId("lm-firstrun-create-matter").check();
  const confirm = dialog.getByRole("button", { name: "建案件并开始交办" });
  await expect(confirm).toBeEnabled({ timeout: 10_000 });
  await confirm.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  const config = await getRendererConfig(page);
  const res = await page.request.get(`${config.apiBase}/api/matters/overviews`, {
    headers: { authorization: `Bearer ${config.apiAuthToken}` },
  });
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { overviews?: Array<{ matterId: string }> };
  expect(body.overviews?.length).toBeGreaterThan(0);
  return body.overviews![0].matterId;
}

/**
 * 跳过首跑对话框，后续通过 API 创建案件。
 */
export async function skipFirstRunDialog(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem("lm.firstRun.dismissed", new Date().toISOString());
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForShell(page);
}

/**
 * 在工作区聊天中提交一条消息。
 */
export async function submitWorkspaceChat(page: Page, message: string): Promise<void> {
  const composer = page.getByRole("textbox", { name: "消息输入" });
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(message);
  const send = page.getByRole("button", { name: "发送" });
  await expect(send).toBeEnabled();
  await send.click();
  // 断言用户消息出现在对话区
  await expect(page.getByRole("region", { name: "对话消息" })).toContainText(message, {
    timeout: 10_000,
  });
}

/**
 * 从「在办」进入文书台/改稿台。
 */
export async function openReviewWorkbench(page: Page): Promise<void> {
  await dismissBlockingDialogs(page);
  const mainNav = page.getByRole("navigation", { name: "功能模块" });
  await expect(mainNav).toBeVisible({ timeout: 30_000 });
  const agentsTab = mainNav.getByRole("button", { name: "在办", exact: true });
  await agentsTab.click({ force: true });
  await expect(page.locator(".lm-agent-fleet-page")).toBeVisible({ timeout: 30_000 });
  const openReview = page
    .getByTestId("lm-agents-open-review")
    .or(page.getByTestId("lm-fleet-primary-review"))
    .or(page.getByTestId("lm-fleet-empty-review"))
    .or(page.getByRole("button", { name: /改稿|文书台/ }))
    .first();
  await expect(openReview).toBeVisible({ timeout: 30_000 });
  await openReview.click();
  await expect(page.locator(".lm-review-workbench-root, .lm-review-workbench").first()).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * 在文书台选择指定草稿。
 */
export async function selectDraftInWorkbench(page: Page, taskId: string): Promise<void> {
  const draftSelect = page.getByRole("combobox", { name: "选择草稿" });
  await expect(draftSelect).toBeEnabled({ timeout: 30_000 });
  await expect(draftSelect.locator(`option[value="${taskId}"]`)).toBeAttached({
    timeout: 15_000,
  });
  await draftSelect.selectOption(taskId);
  await expect(draftSelect).toHaveValue(taskId);
  await expect(page.getByText("在上方选择草稿后开始改稿与预览")).toHaveCount(0, {
    timeout: 20_000,
  });
}

/**
 * 展开文书台「高级 · 签批」区域（如未展开）。
 */
export async function ensureSignoffAdvancedOpen(page: Page): Promise<void> {
  const advanced = page.locator("details.lm-review-advanced").first();
  if (await advanced.isVisible().catch(() => false)) {
    const open = await advanced.getAttribute("open");
    if (open === null) {
      await advanced.locator("summary.lm-review-advanced-summary").click({ force: true });
    }
  }
  await expect(page.getByText("在此签批")).toBeVisible({ timeout: 15_000 });
}

/**
 * 在文书台执行签批通过。
 */
export async function approveDraftInWorkbench(page: Page): Promise<void> {
  await ensureSignoffAdvancedOpen(page);
  const approve = page.getByRole("button", { name: "通过" }).first();
  await expect(approve).toBeVisible({ timeout: 15_000 });
  await approve.click();
  await expect(page.getByText(/已通过签批|已由.*批准/)).toBeVisible({ timeout: 30_000 });
}

/**
 * 在文书台导出 Word 交付物，并返回 UI 上展示的文件名。
 */
export async function exportWordInWorkbench(page: Page): Promise<string> {
  const exportBtn = page.getByRole("button", { name: "导出审查意见书" }).first();
  await expect(exportBtn).toBeEnabled({ timeout: 30_000 });
  await exportBtn.click();
  const pathEl = page.locator(".lm-review-export-path").first();
  await expect(pathEl).toBeVisible({ timeout: 30_000 });
  return (await pathEl.textContent())?.trim() ?? "";
}

/**
 * 关闭可能阻塞交互的弹窗（首跑/API 向导）。
 */
export async function dismissBlockingDialogs(page: Page): Promise<void> {
  const firstRun = page.getByRole("dialog", { name: /LawMind 新手引导|LawMind 首次配置|API/i });
  if (await firstRun.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const dismiss = firstRun.getByRole("button", { name: /稍后再说|不用了|跳过|关闭/i }).first();
    await dismiss.click({ force: true });
    await expect(firstRun).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
  }
}

/**
 * 截图并保存到临时目录，返回保存路径（用于调试）。
 */
export async function screenshot(page: Page, name: string): Promise<string> {
  const dir = path.join(os.tmpdir(), "lawmind-e2e-screenshots");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}-${Date.now()}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/**
 * 已知会对 E2E 造成噪音但不代表功能失败的 console 模式。
 */
const IGNORED_CONSOLE_PATTERNS = [
  /Electron Security Warning \(Insecure Content-Security-Policy\)/i,
  /Failed to load resource:/i,
  /ERR_INCOMPLETE_CHUNKED_ENCODING/i,
  /the server responded with a status of 500/i,
];

function isIgnoredConsole(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some((p) => p.test(text));
}

/**
 * 已知非本次测试目标且当前基线有 500 的本地 API 端点，暂时不视为严重失败。
 */
const IGNORED_FAILED_RESPONSE_PATTERNS = [
  new RegExp("/api/agent-fleet\\b"),
  new RegExp("/api/action-summary\\b"),
];

function isIgnoredFailedResponse(url: string): boolean {
  return IGNORED_FAILED_RESPONSE_PATTERNS.some((p) => p.test(url));
}

/**
 * 收集渲染进程的 console 与 pageerror 事件。
 * 调用方应在 page 创建后尽早调用，并在测试结束后断言 logs.hasSevere / hasUnhandledException。
 */
export function collectLogs(page: Page): CollectedLogs {
  const logs: CollectedLogs = { entries: [], hasSevere: false, hasUnhandledException: false };
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "error" && !isIgnoredConsole(text)) {
      logs.entries.push({ type: "console", text: `[${type}] ${text}` });
      logs.hasSevere = true;
    }
  });
  page.on("pageerror", (err) => {
    logs.entries.push({ type: "pageerror", error: err.message, location: err.stack });
    logs.hasUnhandledException = true;
    logs.hasSevere = true;
  });
  page.on("response", (res) => {
    if (res.status() >= 500 && !res.url().includes("127.0.0.1:1") && !isIgnoredFailedResponse(res.url())) {
      logs.entries.push({
        type: "response-failed",
        text: `HTTP ${res.status()} ${res.request().method()} ${res.url()}`,
      });
      logs.hasSevere = true;
    }
  });
  return logs;
}

/**
 * 关闭应用并断言无严重日志/未处理异常。
 */
export async function closeApp(
  electronApp: ElectronApplication,
  logs: CollectedLogs,
): Promise<void> {
  await electronApp.close();
  if (logs.hasUnhandledException || logs.hasSevere) {
    const summary = logs.entries.map((e) => `[${e.type}] ${e.text ?? e.error ?? ""}`).join("\n");
    throw new Error(`Severe logs detected during E2E run:\n${summary}`);
  }
}
