import { describe, expect, it } from "vitest";
import { SAME_TURN_VERIFY_USER_PREFIX } from "../runtime/same-turn-verify.js";
import { estimateTextTokens } from "./context-budget.js";
import {
  clipTextToTokensMiddle,
  stringifyToolResultForHistory,
  summarizeToolResultForHistory,
} from "./tool-result-history.js";

describe("tool-result-history", () => {
  it("passes through small results unchanged", () => {
    const small = { ok: true, taskId: "t1", text: "short" };
    expect(summarizeToolResultForHistory(small)).toEqual(small);
  });

  it("falls back to an 8k-token cap when the model window is unknown", () => {
    const fits = { ok: true, text: "x".repeat(20_000) };
    expect(summarizeToolResultForHistory(fits)).toEqual(fits);
    const huge = { ok: true, text: "x".repeat(60_000) };
    const slim = summarizeToolResultForHistory(huge) as { truncated?: boolean };
    expect(slim.truncated).toBe(true);
    expect(stringifyToolResultForHistory(huge).length).toBeLessThan(40_000);
  });

  it("truncates huge results but keeps ok/error", () => {
    const huge = {
      ok: true,
      text: "x".repeat(40_000),
      nested: { blob: "y".repeat(10_000) },
    };
    const slim = summarizeToolResultForHistory(huge, { maxChars: 2_000 }) as Record<
      string,
      unknown
    >;
    expect(slim.ok).toBe(true);
    expect(slim.truncated).toBe(true);
    expect(stringifyToolResultForHistory(huge, { maxChars: 2_000 }).length).toBeLessThan(8_000);
    expect(typeof slim.text === "string" ? slim.text.length : 0).toBeLessThanOrEqual(4_000);
  });

  it("preserves craftSignals and gateDecision when truncating", () => {
    const huge = {
      ok: true,
      data: {
        taskId: "t1",
        craftSignals: [{ level: "warn", code: "rewrite_amplitude_soft", message: "宽改" }],
        gateDecision: {
          gate: "reasoning_gate",
          decision: "allow",
          category: "judgment_soft",
        },
        guardian: { verdict: "fail", gaps: [{ code: "coverage_gap", message: "缺口" }] },
        redlinePending: 3,
        warning: "幅度较大",
        applied: Array.from({ length: 200 }, (_, i) => ({
          find: `find-${i}-${"x".repeat(80)}`,
          replace: `rep-${i}`,
        })),
      },
    };
    const slim = summarizeToolResultForHistory(huge, { maxChars: 800 }) as {
      truncated?: boolean;
      data?: Record<string, unknown>;
    };
    expect(slim.truncated).toBe(true);
    expect(slim.data?.craftSignals).toEqual(huge.data.craftSignals);
    expect(slim.data?.gateDecision).toEqual(huge.data.gateDecision);
    expect(slim.data?.guardian).toEqual(huge.data.guardian);
    expect(slim.data?.redlinePending).toBe(3);
    expect(slim.data?.warning).toBe("幅度较大");
  });

  it("CJK counts ~1 token per char under an explicit cap; ASCII does not", () => {
    const ascii = { ok: true, text: "x".repeat(3_000) };
    const asciiSlim = summarizeToolResultForHistory(ascii, { maxTokens: 1_000 }) as {
      truncated?: boolean;
    };
    expect(asciiSlim.truncated).toBeUndefined();
    expect(asciiSlim).toEqual(ascii);

    const cjk = { ok: true, text: "合".repeat(3_000) };
    const cjkSlim = summarizeToolResultForHistory(cjk, { maxTokens: 1_000 }) as {
      truncated?: boolean;
      text?: string;
      ok?: boolean;
    };
    expect(cjkSlim.truncated).toBe(true);
    expect(cjkSlim.ok).toBe(true);
    expect(typeof cjkSlim.text === "string" ? cjkSlim.text.length : 0).toBeLessThan(3_000);
    expect(estimateTextTokens(JSON.stringify(cjkSlim))).toBeLessThan(2_000);
  });

  it("keeps a clipped data.content preview so CJK analyze_document does not go blank", () => {
    const page = {
      ok: true,
      data: {
        filePath: "合同.docx",
        content: "甲".repeat(2_500),
        hasMore: true,
        nextOffset: 2_500,
        hint: "文本未读完",
      },
    };
    const slim = summarizeToolResultForHistory(page, { maxTokens: 1_000 }) as {
      truncated?: boolean;
      data?: { content?: string; filePath?: string; hasMore?: boolean; nextOffset?: number };
    };
    expect(slim.truncated).toBe(true);
    expect(slim.data?.filePath).toBe("合同.docx");
    expect(slim.data?.hasMore).toBe(true);
    expect(slim.data?.nextOffset).toBe(2_500);
    expect(typeof slim.data?.content).toBe("string");
    expect(slim.data?.content?.length ?? 0).toBeGreaterThan(80);
    expect(slim.data?.content?.length ?? 0).toBeLessThan(2_500);
  });

  it("middle truncation keeps both head and tail with an elision marker (Codex-style)", () => {
    const head = "原告张三诉被告李四。";
    const middle = "事实与理由".repeat(2_000);
    const tail = "诉讼请求：判令支付货款 50 万元。此致 张北县人民法院。";
    const text = head + middle + tail;
    const clipped = clipTextToTokensMiddle(text, 400);
    expect(clipped.startsWith(head)).toBe(true);
    expect(clipped.endsWith(tail)).toBe(true);
    expect(clipped).toContain("中间省略");
    expect(estimateTextTokens(clipped)).toBeLessThanOrEqual(460);
    // 未超预算时原样返回。
    expect(clipTextToTokensMiddle("短文本", 400)).toBe("短文本");
  });

  it("keeps list_more_tools disclosure fields even when the catalog is slimmed", () => {
    // 目录本身可以裁，但 disclosedNames 丢了会导致后续轮次不再广告已启用工具（断链）。
    const hugeCatalog = {
      ok: true,
      data: {
        disclosedNames: ["deep_research", "render_tracked_draft"],
        tools: Array.from({ length: 60 }, (_, i) => ({
          name: `tool_${i}`,
          hint: "用途说明".repeat(20),
        })),
        message: "已启用",
      },
    };
    const slim = summarizeToolResultForHistory(hugeCatalog, { maxTokens: 200 }) as {
      truncated?: boolean;
      data?: { disclosedNames?: string[] };
    };
    expect(slim.truncated).toBe(true);
    expect(slim.data?.disclosedNames).toEqual(["deep_research", "render_tracked_draft"]);
  });

  it("keeps a successful citation coach verify.message (not a same-turn fail envelope)", () => {
    const okCoach = {
      ok: true,
      data: { verify: { message: "引用对不上来源：src-9 不在本次检索结果中" } },
    };
    expect(summarizeToolResultForHistory(okCoach)).toEqual(okCoach);
  });

  it("strips a duplicated PREFIX envelope off verify.message / gateDecision.reason", () => {
    const envelope = `${SAME_TURN_VERIFY_USER_PREFIX}验证器未绿，本回合不得结束。请立即调用 apply_surgical_edits，不要回复「已完成」。\n- [empty_redline] 未产生可核验修订`;
    const triple = {
      ok: false,
      error: envelope,
      data: {
        verify: { message: envelope, codes: ["empty_redline"], nextTool: "apply_surgical_edits" },
        sameTurnVerify: {
          red: true,
          issues: [
            {
              code: "empty_redline",
              message: "未产生可核验修订",
              gate: "redline_hunks_gate",
              nextTool: "apply_surgical_edits",
            },
          ],
        },
        gateDecision: { gate: "redline_hunks_gate", decision: "block", reason: envelope },
      },
    };
    const slim = summarizeToolResultForHistory(triple) as {
      error?: string;
      data?: {
        verify?: { message?: string; codes?: string[] };
        sameTurnVerify?: { issues?: Array<{ message?: string }> };
        gateDecision?: { reason?: string };
      };
    };
    expect(slim.error).toBe(envelope);
    expect(slim.data?.verify?.message).toBeUndefined();
    expect(slim.data?.verify?.codes).toEqual(["empty_redline"]);
    expect(slim.data?.sameTurnVerify?.issues?.[0]?.message).toBe("未产生可核验修订");
    expect(slim.data?.gateDecision?.reason).not.toBe(envelope);
    expect(slim.data?.gateDecision?.reason).toContain("空修订");
    expect(slim.data?.gateDecision?.reason).not.toContain("empty_redline");
    expect(JSON.stringify(slim).split(SAME_TURN_VERIFY_USER_PREFIX).length - 1).toBe(1);
  });
});
