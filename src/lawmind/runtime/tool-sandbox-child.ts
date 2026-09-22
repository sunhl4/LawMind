/**
 * Child process entry for tool sandbox (forked from tool-sandbox.ts).
 */

import { executeToolSandboxInline, type ToolSandboxPayload } from "./tool-sandbox.js";

process.on("message", (msg: unknown) => {
  void (async () => {
    const payload = msg as ToolSandboxPayload;
    try {
      const result = await executeToolSandboxInline(payload);
      if (typeof process.send === "function") {
        process.send({ ok: true, result });
      }
    } catch (err) {
      if (typeof process.send === "function") {
        process.send({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      process.exit(0);
    }
  })();
});
