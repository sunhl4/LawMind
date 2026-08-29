import { afterEach, vi } from "vitest";
import { drainMatterProjections } from "../src/lawmind/application/services/matter-write-service.js";

process.env.VITEST = "true";
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
