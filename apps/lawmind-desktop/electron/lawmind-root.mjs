/**
 * 应用 userData 目录解析（可单测的纯函数，不依赖 electron 运行时）。
 *
 * 为什么需要显式覆盖：E2E 需要把应用状态（配置、`.env.lawmind`、Chromium profile/
 * localStorage）隔离到临时目录。两条路都不通：
 *   1. `--user-data-dir`：Playwright 的 `_electron.launch()` 固定把 `--inspect=0` /
 *      `--remote-debugging-port=0` 前置，而 Electron 只在它位于其它开关之前时才认，
 *      于是开关被静默忽略；
 *   2. `pinDevUserData` 本身在非打包时会 `setPath("userData", appData/Electron)`，
 *      无条件盖掉任何外部设置。
 * 结果是应用读到机器上真实的 `<userData>/LawMind/desktop-config.json`（陈旧
 * workspaceDir）与真实 localStorage（首跑弹窗已被 dismissed），并且读不到夹具的
 * `.env.lawmind`（签批 bypass 缺失 → 403 checklist_bypass_forbidden）。
 *
 * 因此由应用自己支持 `LAWMIND_USER_DATA_DIR`，且**打包版一律忽略**——与
 * `LAWMIND_SKIP_API_AUTH` 同一姿态：测试可隔离，生产不可被环境变量改状态。
 */

import path from "node:path";

/**
 * @param {{ appDataDir: string, brandFolder?: string, override?: string, packaged?: boolean }} input
 * @returns {string | null} 目标 userData 目录；null 表示不干预（打包版保持 Electron 默认）
 */
export function resolveDevUserDataDir({ appDataDir, brandFolder, override, packaged }) {
  if (packaged) {
    return null;
  }
  const trimmed = typeof override === "string" ? override.trim() : "";
  if (trimmed) {
    return path.resolve(trimmed);
  }
  return path.join(appDataDir, brandFolder || "Electron");
}
