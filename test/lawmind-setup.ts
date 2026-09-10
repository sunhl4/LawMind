import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";
import { drainMatterProjections } from "../src/lawmind/application/services/matter-write-service.js";

process.env.VITEST = "true";
// 测试隔离：本地对称密钥（审计链 HMAC / 邮件凭证加密）写入 per-process 临时目录，
// 绝不触碰开发者真实 ~/.lawmind/keys。
if (!process.env.LAWMIND_KEY_DIR?.trim()) {
  process.env.LAWMIND_KEY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "lm-test-keys-"));
}
// Pin keyword routing in unit tests so a developer shell with API keys cannot
// trigger live classifier calls. Production leaves LAWMIND_ROUTER_MODE unset
// and uses the model classifier when credentials exist.
if (!process.env.LAWMIND_ROUTER_MODE?.trim()) {
  process.env.LAWMIND_ROUTER_MODE = "keyword";
}

// Linux CI: recursive rm of disposable tmp dirs can race SQLite/fs close (ENOTEMPTY).
// Do not fail the suite on throwaway cleanup after assertions already passed.
const rmSyncOrig = fs.rmSync.bind(fs);
fs.rmSync = ((target, options) => {
  const opts = {
    maxRetries: 8,
    retryDelay: 25,
    ...options,
  };
  try {
    return rmSyncOrig(target, opts);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (opts.force && opts.recursive && (code === "ENOTEMPTY" || code === "EBUSY")) {
      return;
    }
    throw err;
  }
}) as typeof fs.rmSync;

afterEach(async () => {
  await drainMatterProjections();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});