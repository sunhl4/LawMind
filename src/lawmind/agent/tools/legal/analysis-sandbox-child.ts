/**
 * Child entry for run_analysis. Guest script never sees fs / fetch / process.
 */

import { runAnalysisScriptInVm } from "./analysis-sandbox.js";

type Payload = {
  source: string;
  workspaceDir: string;
  timeoutMs?: number;
};

process.on("message", async (msg: unknown) => {
  const payload = msg as Payload;
  try {
    const result = await runAnalysisScriptInVm({
      source: payload.source,
      workspaceDir: payload.workspaceDir,
      timeoutMs: payload.timeoutMs,
    });
    process.send?.({ ok: true, result });
  } catch (err) {
    process.send?.({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
