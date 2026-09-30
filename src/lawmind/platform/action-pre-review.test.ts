import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyActionForPreReview,
  recordActionPreReviewShadow,
  resolveActionPreReview,
  resolveActionPreReviewMode,
  actionPreReviewLogPath,
} from "./action-pre-review.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("action-pre-review", () => {
  it("defaults to off and accepts shadow/on", () => {
    expect(resolveActionPreReviewMode({})).toBe("off");
    expect(resolveActionPreReviewMode({ LAWMIND_ACTION_PRE_REVIEW: "shadow" })).toBe("shadow");
    expect(resolveActionPreReviewMode({ LAWMIND_ACTION_PRE_REVIEW: "on" })).toBe("on");
  });

  it("classifies send_email as ask but not owned by this layer", () => {
    const c = classifyActionForPreReview("send_email");
    expect(c.recommend).toBe("ask");
    expect(c.ownedByThisLayer).toBe(false);
  });

  it("classifies run_host_command as ask owned by this layer", () => {
    const c = classifyActionForPreReview("run_host_command");
    expect(c.recommend).toBe("ask");
    expect(c.ownedByThisLayer).toBe(true);
  });

  it("shadow records but never asks; on asks for host command unless approved", () => {
    expect(
      resolveActionPreReview({
        toolName: "run_host_command",
        alreadyApproved: false,
        mode: "shadow",
      }),
    ).toMatchObject({ shouldAsk: false, shouldRecord: true });
    expect(
      resolveActionPreReview({
        toolName: "run_host_command",
        alreadyApproved: false,
        mode: "on",
      }),
    ).toMatchObject({ shouldAsk: true, shouldRecord: true });
    expect(
      resolveActionPreReview({
        toolName: "run_host_command",
        alreadyApproved: true,
        mode: "on",
      }),
    ).toMatchObject({ shouldAsk: false });
    expect(
      resolveActionPreReview({
        toolName: "send_email",
        alreadyApproved: false,
        mode: "on",
      }),
    ).toMatchObject({ shouldAsk: false, shouldRecord: true });
  });

  it("records shadow lines under lawmind/decision/", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-apr-"));
    dirs.push(ws);
    recordActionPreReviewShadow(ws, {
      toolName: "run_host_command",
      mode: "shadow",
      recommend: "ask",
      reasonZh: "本机命令",
      wouldAsk: true,
      sessionId: "s1",
    });
    const raw = fs.readFileSync(actionPreReviewLogPath(ws), "utf8");
    expect(raw).toContain("run_host_command");
    expect(raw).toContain("shadow");
  });
});
