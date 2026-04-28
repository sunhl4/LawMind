import { afterEach, vi } from "vitest";

process.env.VITEST = "true";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
