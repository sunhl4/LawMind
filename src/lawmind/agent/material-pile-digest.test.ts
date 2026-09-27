import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  digestMaterialPile,
  digestReadingText,
  groundDigestPayload,
  instructionLooksLikeMaterialPile,
  parseDigestFilePayload,
  pileNeedsMaterialDigest,
} from "./material-pile-digest.js";
import { presentLawyerToolCall, presentLawyerToolResult } from "./tool-lawyer-card.js";
import type { AgentContext } from "./types.js";

vi.mock("./runtime-model-call.js", () => ({
  callModelWithRetry: vi.fn(async (_model: unknown, messages: Array<{ content?: string }>) => {
    const user = messages[1]?.content ?? "";
    if (user.includes("甲.txt")) {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                points: "写明付款日",
                gaps: "",
                citations: ["甲文件写了付款日"],
                reviewPoints: ["甲文件写了付款日"],
              }),
            },
          },
        ],
      };
    }
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              points: "写明交货地",
              gaps: "",
              citations: ["乙文件写了交货地"],
              reviewPoints: ["这份没有的句子"],
            }),
          },
        },
      ],
    };
  }),
  ModelCallUserAbortError: class ModelCallUserAbortError extends Error {
    override name = "ModelCallUserAbortError";
  },
}));

const temps: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-digest-"));
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
    sessionId: "sess-digest",
    actorId: "lawyer",
    ...extra,
  };
}

describe("material pile digest", () => {
  it("detects a pile from wording or from many pinned files", () => {
    expect(instructionLooksLikeMaterialPile("逐份审查这些合同")).toBe(true);
    expect(instructionLooksLikeMaterialPile("请审查这份采购合同")).toBe(false);
    expect(pileNeedsMaterialDigest("帮我看一份合同")).toBe(false);
    const pins = Array.from({ length: 8 }, (_, i) => ({
      pinKind: "file" as const,
      root: "workspace" as const,
      relPath: `f${i}.txt`,
      kind: "file" as const,
    }));
    expect(pileNeedsMaterialDigest("看看", pins)).toBe(true);
    expect(
      pileNeedsMaterialDigest("审查一下", [
        { pinKind: "file", root: "workspace", relPath: "材料夹", kind: "directory" },
      ]),
    ).toBe(true);
    expect(pileNeedsMaterialDigest("审查一下")).toBe(false);
  });

  it("parses one file payload and drops citations that are not in that file", () => {
    const payload = parseDigestFilePayload(
      '```json\n{"points":"付款","gaps":"","citations":["应于5月1日付款","别的合同的句子"],"reviewPoints":["应于5月1日付款"]}\n```',
    );
    expect(payload?.points).toBe("付款");
    const grounded = groundDigestPayload(payload!, "甲方应于5月1日付款。");
    expect(grounded.citations).toEqual(["应于5月1日付款"]);
    expect(grounded.reviewPoints).toEqual(["应于5月1日付款"]);
    expect(grounded.gaps).toContain("引用未在这份正文出现");
    const tooShort = groundDigestPayload(
      { points: "付款", gaps: "", citations: ["5月1日"], reviewPoints: [] },
      "甲方应于5月1日付款。",
    );
    expect(tooShort.citations).toEqual([]);
    expect(parseDigestFilePayload("不是 JSON")).toBeNull();
  });

  it("keeps the head and the tail of a long file", () => {
    const text = `${"头".repeat(2000)}${"中".repeat(4000)}${"尾".repeat(2000)}`;
    const reading = digestReadingText(text);
    expect(reading.elided).toBe(true);
    expect(reading.text.startsWith("头")).toBe(true);
    expect(reading.text.endsWith("尾")).toBe(true);
    expect(reading.text).toContain("中间省略");
  });

  it("returns excerpt cards without a model call when chat model is absent", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "甲.txt"), "甲方应于 2026-05-01 付款。");
    fs.writeFileSync(
      path.join(root, "开庭传票.txt"),
      "北京市朝阳区人民法院传票：请于2026年9月15日9时到第三法庭开庭。案号（2026）京0105民初88号。",
    );
    const result = await digestMaterialPile(ctx(root), {
      goal: "抽出付款日和开庭日",
      path: ".",
    });
    expect(result.ok).toBe(true);
    const data = result.data as {
      cards: Array<{
        path: string;
        genre: string;
        excerpt: string;
        gaps: string;
        points: string;
        events: Array<{ eventKind: string; dueAt?: string }>;
      }>;
      suggestedEvents: Array<{ sourcePath: string; eventKind: string }>;
    };
    expect(data.cards).toHaveLength(2);
    const summons = data.cards.find((card) => card.path.endsWith("开庭传票.txt"));
    expect(summons?.genre).toBe("传票/通知");
    expect(summons?.events[0]?.eventKind).toBe("hearing");
    expect(summons?.events[0]?.dueAt).toBeTruthy();
    expect(data.suggestedEvents.some((event) => event.eventKind === "hearing")).toBe(true);
    expect(data.cards.every((card) => card.points === "")).toBe(true);
    expect(data.cards.some((card) => card.gaps.includes("仅保留摘录"))).toBe(true);
  });

  it("summarizes each file in its own model call and drops ungrounded review points", async () => {
    const { callModelWithRetry } = await import("./runtime-model-call.js");
    const root = tmp();
    fs.writeFileSync(path.join(root, "甲.txt"), "甲文件写了付款日 2026-05-01。".repeat(40));
    fs.writeFileSync(path.join(root, "乙.txt"), "乙文件写了交货地上海。");
    const result = await digestMaterialPile(
      ctx(root, {
        chatModel: {
          provider: "openai-compatible",
          baseUrl: "http://127.0.0.1",
          apiKey: "test",
          model: "test",
        },
      }),
      { goal: "抽出付款日和交货地", paths: ["甲.txt", "乙.txt"] },
    );
    expect(result.ok).toBe(true);
    expect(callModelWithRetry).toHaveBeenCalledTimes(2);
    const data = result.data as {
      cards: Array<{
        path: string;
        points: string;
        citations: string[];
        reviewPoints: string[];
        gaps: string;
        excerpt: string;
      }>;
      suggestedReviewRows: Array<{ source: string; cells: { 要点: string; 引用: string } }>;
    };
    const jia = data.cards.find((card) => card.path.endsWith("甲.txt"));
    const yi = data.cards.find((card) => card.path.endsWith("乙.txt"));
    expect(jia?.points).toBe("写明付款日");
    expect(jia?.citations).toEqual(["甲文件写了付款日"]);
    expect(jia?.reviewPoints).toEqual(["甲文件写了付款日"]);
    expect(yi?.citations).toEqual(["乙文件写了交货地"]);
    expect(yi?.reviewPoints).toEqual([]);
    expect(yi?.gaps).toContain("审查要点对不上这份正文");
    expect(data.suggestedReviewRows).toEqual([
      expect.objectContaining({
        source: expect.stringContaining("甲.txt"),
        cells: expect.objectContaining({ 要点: "甲文件写了付款日", 引用: "甲文件写了付款日" }),
      }),
    ]);
    expect(jia?.excerpt.length).toBeLessThanOrEqual(161);
  });

  it("stops before reading when the turn is already aborted", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "甲.txt"), "正文");
    const abort = new AbortController();
    abort.abort();
    const result = await digestMaterialPile(ctx(root, { abortSignal: abort.signal }), {
      goal: "抽出要点",
      path: ".",
    });
    expect(result.aborted).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("rejects a vague goal and pages past the file cap", async () => {
    const root = tmp();
    const vague = await digestMaterialPile(ctx(root), { goal: "帮我看看", path: "." });
    expect(vague.ok).toBe(false);
    for (let i = 0; i < 33; i += 1) {
      fs.writeFileSync(path.join(root, `f${String(i).padStart(2, "0")}.txt`), `文件${i}`);
    }
    const result = await digestMaterialPile(ctx(root), { goal: "列出每份文件的第一句", path: "." });
    const data = result.data as { fileCount: number; notReadCount: number };
    expect(data.fileCount).toBe(32);
    expect(data.notReadCount).toBe(1);
    expect((result.data as { nextOffset?: number }).nextOffset).toBe(32);
  });

  it("reads image text through the injected recognizer and keeps the hearing", async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "开庭传票.png"), "not-a-real-image");
    const result = await digestMaterialPile(
      ctx(root),
      { goal: "抽出开庭日期", paths: ["开庭传票.png"] },
      {
        readImage: async () =>
          "北京市朝阳区人民法院传票：请于2026年9月15日9时到第三法庭开庭。案号（2026）京0105民初88号。",
      },
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      cards: Array<{ gaps: string; events: Array<{ eventKind: string; notes?: string }> }>;
      suggestedEvents: Array<{ eventKind: string; notes?: string; title: string }>;
    };
    expect(data.cards[0]?.gaps).not.toContain("图片");
    expect(data.cards[0]?.events[0]?.eventKind).toBe("hearing");
    expect(data.suggestedEvents[0]?.notes).toContain("开庭传票.png");
    expect(data.suggestedEvents[0]?.title).toBeTruthy();
  });

  it("labels the lawyer card in Chinese", () => {
    const card = presentLawyerToolCall("digest_materials", {
      goal: "抽出期限",
      paths: ["a.txt", "b.txt"],
    });
    expect(card.title).toBe("分头读材料");
    expect(card.detail).toBe("2 份材料");
    const done = presentLawyerToolResult(
      "digest_materials",
      {},
      {
        ok: true,
        data: { cards: [{}, {}], notRead: ["c.txt"] },
      },
    );
    expect(done.detail).toContain("已归纳 2 份");
  });
});
