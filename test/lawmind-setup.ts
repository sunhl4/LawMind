import { afterEach, vi } from "vitest";
import { drainMatterProjections } from "../src/lawmind/application/services/matter-write-service.js";

process.env.VITEST = "true";

afterEach(async () => {
  await drainMatterProjections();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
