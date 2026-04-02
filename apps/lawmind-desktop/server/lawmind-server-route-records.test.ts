import type http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleRecordRoutes } from "./lawmind-server-route-records.js";
import type { LawmindDispatchContext } from "./lawmind-server-route-types.js";

describe("lawmind-server-route-records", () => {
  it("returns false for unrelated routes", async () => {
    const ctx: LawmindDispatchContext = {
      workspaceDir: os.tmpdir(),
      envFile: undefined,
      userEnvPath: path.join(os.tmpdir(), "x.env"),
      policy: { loaded: false },
    };
    await expect(
      handleRecordRoutes({
        ctx,
        req: { method: "GET" } as http.IncomingMessage,
        res: {} as http.ServerResponse,
        url: new URL("http://127.0.0.1/api/other"),
        pathname: "/api/other",
        c: {},
      }),
    ).resolves.toBe(false);
  });
});
