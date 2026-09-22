/**
 * 真机 Electron 套件的**单一真相源**。
 *
 * 本目录下有两套互斥的 Playwright 配置：
 *
 * | 配置 | 起什么 | 谁跑 |
 * | ------------------------------------ | ---------------------------------------- | ---------------------------------------------- |
 * | `playwright.config.ts`（mock API + Vite） | `e2e/mock-api.mjs` + Vite | `test:e2e` / `lawmind:desktop:e2e`（CI mock 作业） |
 * | `playwright.electron.config.ts` | 真实 Electron + 真实本地服务 | `test:e2e:electron`（需要先 bundle server + 建渲染产物） |
 *
 * 下面这些 spec 全部 `import ... from "./helpers/app-driver.js"`，即走 `_electron.launch()`，
 * 在浏览器套件下**必失败**（它们要的本地服务与 `dist/` 产物都不在）。
 *
 * 为什么把清单抽到这里，而不是两边各写一份：`pnpm lawmind:desktop:e2e`（无参数）
 * 会把本目录下**所有** spec 扫进来，CI 的 `lawmind-desktop-e2e` 作业正是这么调的。
 * 清单一旦漂移，该作业会因为与 PR 改动无关的真机 spec 变红 —— 而两处各写一份清单
 * 正是漂移的常见来源。`apps/lawmind-desktop/electron/e2e-spec-partition.test.ts`
 * 锁住这份清单与磁盘上的实际文件一致。
 */
export const ELECTRON_SPEC_FILES = [
  "app-driver.spec.ts",
  "bundle-download-electron.spec.ts",
  "daemon-supervision.spec.ts",
  "electron-golden-path.spec.ts",
  "electron-file-deeplink.spec.ts",
  "first-matter-journey.spec.ts",
  "judgment-escalation-electron.spec.ts",
  "server-crash-recovery.spec.ts",
] as const;

/** 供 `testIgnore` 用的 glob 形式（Playwright 的 ignore 按路径匹配）。 */
export const ELECTRON_SPEC_GLOBS = ELECTRON_SPEC_FILES.map((file) => `**/${file}`);
