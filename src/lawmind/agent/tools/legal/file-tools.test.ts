import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UNTRUSTED_DOCUMENT_PREAMBLE } from "../../../platform/content-trust.js";
import {
  resolveDocumentPageChars,
  resolveDocumentReadBudgetChars,
} from "../../document-read-budget.js";
import type { AgentContext } from "../../types.js";
import { analyzeDocument } from "./file-tools.js";

const temps: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ctx(workspaceDir: string, extra?: Partial<AgentContext>): AgentContext {
  return {
    workspaceDir,
    sessionId: "sess-file-tools",
    actorId: "lawyer",
    ...extra,
  };
}

function modelCtx(workspaceDir: string, contextTokens: number): AgentContext {
  return ctx(workspaceDir, {
    chatModel: { baseUrl: "http://localhost", apiKey: "k", model: "m", contextTokens },
  });
}

/** Body chars, i.e. what the model reads after stripping the anti-injection banner. */
function stripBanner(content: string): string {
  const body = content.startsWith(UNTRUSTED_DOCUMENT_PREAMBLE)
    ? content.slice(UNTRUSTED_DOCUMENT_PREAMBLE.length)
    : content;
  return body.replace(/\n---\s*$/, "");
}

describe("analyze_document default page", () => {
  it("fits the whole wrapped payload into the model-visible budget (unknown window)", async () => {
    const ws = tmp("lm-analyze-");
    fs.writeFileSync(path.join(ws, "big.txt"), "x".repeat(50_000));
    const result = await analyzeDocument.execute({ file_path: "big.txt" }, ctx(ws));
    expect(result.ok).toBe(true);
    const data = result.data as {
      content?: string;
      hasMore?: boolean;
      nextOffset?: number;
      totalChars?: number;
    };
    expect(data.totalChars).toBe(50_000);
    expect(data.hasMore).toBe(true);
    // 整包（含防注入横幅）正好等于预算，不会被工具结果管线静默裁剪。
    expect(data.content?.length).toBe(resolveDocumentReadBudgetChars(undefined));
    expect(stripBanner(data.content ?? "").length).toBe(resolveDocumentPageChars(undefined));
    expect(data.nextOffset).toBe(resolveDocumentPageChars(undefined));
  });

  it("grows the default page with the model context window", async () => {
    const ws = tmp("lm-analyze-");
    fs.writeFileSync(path.join(ws, "big.txt"), "x".repeat(50_000));
    const result = await analyzeDocument.execute({ file_path: "big.txt" }, modelCtx(ws, 128_000));
    expect(result.ok).toBe(true);
    const data = result.data as { content?: string; nextOffset?: number };
    // 128k 窗口 → 工具结果预算 16k tokens → 读取预算 12.8k 字符（含横幅）。
    expect(data.content?.length).toBe(resolveDocumentReadBudgetChars(128_000));
    expect(data.nextOffset).toBe(resolveDocumentPageChars(128_000));
    expect(data.content?.length ?? 0).toBeGreaterThan(resolveDocumentReadBudgetChars(undefined));
  });

  it("explicit limit still wins over the derived default", async () => {
    const ws = tmp("lm-analyze-");
    fs.writeFileSync(path.join(ws, "big.txt"), "x".repeat(50_000));
    const result = await analyzeDocument.execute({ file_path: "big.txt", limit: 2_000 }, ctx(ws));
    expect(result.ok).toBe(true);
    const data = result.data as { content?: string };
    // limit 是正文字符数；整包 = 正文 + 横幅。
    expect(stripBanner(data.content ?? "").length).toBe(2_000);
    expect(data.content?.length).toBe(
      2_000 + (resolveDocumentReadBudgetChars(undefined) - resolveDocumentPageChars(undefined)),
    );
  });
});
