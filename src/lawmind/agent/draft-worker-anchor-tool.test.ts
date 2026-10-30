import { describe, expect, it } from "vitest";
import {
  DRAFT_WORKER_ANCHOR_TOOL_NAME,
  DRAFT_WORKER_READONLY_TOOL_NAMES,
  readMarginalAnchorTool,
} from "./draft-worker-loop.js";
import { emptyFactorState, linkNeighbors, recordReading } from "./factor-state.js";
import type { AgentContext } from "./types.js";

function ctx(overrides: Partial<AgentContext>): AgentContext {
  return {
    workspaceDir: "/tmp/lawmind-anchor-tool",
    sessionId: "anchor-tool-session",
    actorId: "anchor-tool-actor",
    ...overrides,
  };
}

describe("read_marginal_anchor", () => {
  it("is part of the draft worker read-only allowlist", () => {
    expect(DRAFT_WORKER_READONLY_TOOL_NAMES).toContain(DRAFT_WORKER_ANCHOR_TOOL_NAME);
  });

  it("returns the reading for an anchor inside the worker scope", async () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    recordReading(state, "amount:wage", "amount", "88000", true);
    recordReading(state, "citation:labor-47", "citation", "live", true, "第47条");
    linkNeighbors(state, "clause:解除", "amount:wage");
    linkNeighbors(state, "amount:wage", "citation:labor-47");
    const result = await readMarginalAnchorTool.execute(
      { anchor: "citation:labor-47" },
      ctx({
        factorState: state,
        readableFactorAnchors: ["clause:解除", "amount:wage", "citation:labor-47"],
      }),
    );
    expect(result.ok).toBe(true);
    const data = result.data as { anchor: string; line: string };
    expect(data.anchor).toBe("citation:labor-47");
    expect(data.line).toContain("citation:labor-47");
  });

  it("rejects an anchor the worker was not allowed to see", async () => {
    const state = emptyFactorState();
    recordReading(state, "clause:解除", "clause", "may_terminate", true);
    recordReading(state, "clause:管辖", "clause", "仲裁", true);
    const result = await readMarginalAnchorTool.execute(
      { anchor: "clause:管辖" },
      ctx({ factorState: state, readableFactorAnchors: ["clause:解除"] }),
    );
    expect(result.ok).toBe(false);
  });

  it("reports no reading instead of inventing one", async () => {
    const result = await readMarginalAnchorTool.execute(
      { anchor: "citation:labor-47" },
      ctx({ factorState: emptyFactorState(), readableFactorAnchors: ["citation:labor-47"] }),
    );
    expect(result.ok).toBe(false);
  });
});
