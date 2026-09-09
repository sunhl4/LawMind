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

afterEach(async () => {
  await drainMatterProjections();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
