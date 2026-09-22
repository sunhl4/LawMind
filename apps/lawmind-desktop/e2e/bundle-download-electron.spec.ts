import { expect, test } from "@playwright/test";
import { bootstrapE2ePage } from "./e2e-helpers";
import {
  getRendererConfig,
  launchLawMindElectron,
  prepareE2EUserData,
  waitForShell,
} from "./helpers/app-driver.js";

/**
 * 诊断包下载 · **真机 Electron 链路冒烟**。
 *
 * ## ⚠️ 这条用例**不**守 CORS（别把它当成那条防线）
 *
 * 它曾被我当作「CORS 回归守卫」写下，但**变异验证证明它抓不到**：
 * E2E 下 `LAWMIND_E2E=1` 且存在 `dist/index.html` 时，窗口走 `win.loadFile(...)`
 * （`electron/app-menu.mjs` 的 `loadRendererIntoWindow`），渲染层源是 **`file://`（Origin=null）**；
 * 而**开发态真实运行**是 `http://127.0.0.1:5174`。两者的 CORS 执行条件不同 ——
 * 把 `...c` 撤掉后本用例照样通过，所以它**证明不了**下载响应的 CORS 正确性。
 *
 * 真正守 CORS 的是两道**不依赖源语义**的检查：
 *   - `server/lawmind-server-cors-structure.test.ts`：静态扫描所有手写 `writeHead` 必须带 CORS 载体；
 *   - `server/lawmind-server-route-support.test.ts`：断言下载响应**转发**了调度层给的 CORS 头。
 *
 * 以及一次人工的真实浏览器验证（对照服务器证明探测有效）：
 * 从 `http://127.0.0.1:<任意回环端口>` 源发起跨源 fetch —— 带 CORS 的对照可读、
 * 无 CORS 的对照报 `TypeError: Failed to fetch`、线上下载可读（6473 字节 zip）。
 *
 * ## 那这条用例还有什么价值
 *
 * 它仍然验证**真机 Electron 下这条下载链本身是通的**：用应用自己的 apiBase 与凭据、
 * 经真实预检与鉴权，拿到一个**真 zip**（`PK` 魔数 + 足够字节数）。这是「端点/鉴权/打包内容」
 * 层面的冒烟，只是**不覆盖** CORS。
 */

test.describe("诊断包下载 · 真机 Electron 链路冒烟（不含 CORS 断言）", () => {
  test("渲染进程内预览与下载都能读到响应体；下载为真 zip", async () => {
    const fixture = await prepareE2EUserData();
    const electronApp = await launchLawMindElectron(fixture);

    try {
      const window = await electronApp.firstWindow();
      await waitForShell(window);
      await bootstrapE2ePage(window);

      // 用**应用自己**的 apiBase 与凭据 —— 与界面点按钮时完全同源、同凭据。
      const config = await getRendererConfig(window);

      const probe = await window.evaluate(
        async ({ apiBase, token }: { apiBase: string; token: string }) => {
          const call = async (path: string) => {
            try {
              const res = await fetch(`${apiBase}${path}`, {
                headers: { authorization: `Bearer ${token}` },
              });
              const buf = await res.arrayBuffer();
              const bytes = new Uint8Array(buf);
              return {
                ok: true as const,
                status: res.status,
                length: bytes.byteLength,
                // zip 魔数 PK\x03\x04
                magic: String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0),
              };
            } catch (e) {
              return { ok: false as const, error: String(e) };
            }
          };
          return {
            preview: await call("/api/support/bundle"),
            download: await call("/api/support/bundle?download=1"),
          };
        },
        { apiBase: config.apiBase, token: config.apiAuthToken },
      );

      // 预览：JSON，可读。
      expect(
        probe.preview,
        `预览请求失败（跨源被拦或服务不可用）：${JSON.stringify(probe.preview)}`,
      ).toMatchObject({ ok: true, status: 200 });
      expect(probe.preview.ok && probe.preview.length).toBeGreaterThan(50);

      // 下载：链路可用的实证（**不代表 CORS 正确**，见本文件头说明）。
      expect(
        probe.download,
        "下载链路在真机 Electron 下不可用：" + JSON.stringify(probe.download),
      ).toMatchObject({ ok: true, status: 200 });
      if (probe.download.ok) {
        expect(probe.download.magic, "下载内容不是 zip（魔数应为 PK）").toBe("PK");
        expect(probe.download.length).toBeGreaterThan(1000);
      }
    } finally {
      await electronApp.close();
    }
  });
});
