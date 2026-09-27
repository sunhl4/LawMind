import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendQueueItem } from "../adapters/matter-storage/index.js";
import { persistDraft } from "../drafts/index.js";
import type { ArtifactDraft } from "../types.js";
import { replaceDroppedDigestInMessages } from "./compact-llm-digest.js";
import {
  autoCompactSessionHistory,
  buildDroppedSpanDigest,
  buildPostCompactSystemNote,
  cutIndexForTokenTail,
  resolveCompactDigestCharCap,
} from "./compact.js";
import { normalizeToolResultMessages } from "./session-tool-call-pairing.js";
import type { AgentMessage, AgentSession } from "./types.js";

describe("resolveCompactDigestCharCap", () => {
  it("caps digest size at the 200K history band", () => {
    expect(resolveCompactDigestCharCap(128_000)).toBe(Math.floor(128_000 * 0.08));
    expect(resolveCompactDigestCharCap(200_000)).toBe(16_000);
    expect(resolveCompactDigestCharCap(1_000_000)).toBe(16_000);
  });
});

describe("cutIndexForTokenTail", () => {
  const msg = (content: string): AgentMessage => ({
    role: "user",
    content,
    timestamp: "t",
  });

  it("短对话放得进预算时不切", () => {
    const messages = [msg("sys"), ...Array.from({ length: 30 }, (_, i) => msg(`第${i}条`))];
    messages[0] = { role: "system", content: "sys", timestamp: "t" };
    expect(
      cutIndexForTokenTail(messages, {
        tailTokenBudget: 20_000,
        minTailMessages: 2,
        maxTailMessages: 100,
      }),
    ).toBe(0);
  });

  it("从尾部按 token 装，不按固定条数留 24 条", () => {
    const messages: AgentMessage[] = [{ role: "system", content: "sys", timestamp: "t" }];
    for (let i = 0; i < 40; i += 1) {
      messages.push(msg("条款".repeat(80)));
    }
    const cut = cutIndexForTokenTail(messages, {
      tailTokenBudget: 400,
      minTailMessages: 2,
      maxTailMessages: 100,
    });
    expect(cut).toBeGreaterThan(1);
    const kept = messages.length - cut;
    expect(kept).toBeGreaterThanOrEqual(2);
    expect(kept).toBeLessThan(24);
  });

  it("切点不拆开一组工具调用", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "sys", timestamp: "t" },
      msg("旧"),
      {
        role: "assistant",
        content: "",
        timestamp: "t",
        toolCalls: [{ id: "c1", name: "read", arguments: {} }],
      },
      {
        role: "tool",
        content: "x".repeat(2_000),
        timestamp: "t",
        toolCallResponses: [{ toolCallId: "c1", name: "read", result: { ok: true } }],
      },
      msg("新"),
    ];
    const cut = cutIndexForTokenTail(messages, {
      tailTokenBudget: 50,
      minTailMessages: 1,
      maxTailMessages: 10,
    });
    expect(messages[cut]?.role).not.toBe("tool");
  });
});

describe("buildDroppedSpanDigest", () => {
  it("extracts lawyer points, assistant replies, and tool names", () => {
    const dropped: AgentMessage[] = [
      { role: "user", content: "请审查违约金条款", timestamp: "t1" },
      {
        role: "assistant",
        content: "",
        timestamp: "t2",
        toolCalls: [{ id: "c1", name: "analyze_document", arguments: {} }],
      },
      {
        role: "tool",
        content: "{}",
        timestamp: "t3",
        toolCallResponses: [{ toolCallId: "c1", name: "analyze_document", result: { ok: true } }],
      },
      {
        role: "assistant",
        content: "建议将违约金上限改为合同总额的20%。",
        timestamp: "t4",
      },
    ];
    const digest = buildDroppedSpanDigest(dropped, 4_000);
    expect(digest).toContain("压缩前对话蒸馏");
    expect(digest).toContain("审查违约金");
    expect(digest).toContain("20%");
    expect(digest).toContain("analyze_document");
  });

  it("keeps statute citations from dropped tool results", () => {
    const dropped: AgentMessage[] = [
      { role: "user", content: "违约责任依据？", timestamp: "t1" },
      {
        role: "assistant",
        content: "",
        timestamp: "t2",
        toolCalls: [{ id: "c1", name: "search_statute", arguments: {} }],
      },
      {
        role: "tool",
        content: "{}",
        timestamp: "t3",
        toolCallResponses: [
          {
            toolCallId: "c1",
            name: "search_statute",
            result: { ok: true, data: { hits: ["依据《民法典》第577条承担责任"] } },
          },
        ],
      },
    ];
    const digest = buildDroppedSpanDigest(dropped, 4_000);
    expect(digest).toContain("压缩前引用");
    expect(digest).toContain("《民法典》第577条");
  });

  it("keeps Chinese-numeral 条 citations and puts them before truncation", () => {
    const dropped: AgentMessage[] = [
      {
        role: "assistant",
        content: `${"律师长文。".repeat(80)}依据《民法典》第五百七十七条承担责任。`,
        timestamp: "t1",
      },
    ];
    const digest = buildDroppedSpanDigest(dropped, 220);
    expect(digest).toContain("压缩前引用");
    expect(digest).toContain("《民法典》第五百七十七条");
    const citeAt = digest.indexOf("压缩前引用");
    const assistAt = digest.indexOf("助手结论");
    expect(citeAt).toBeGreaterThan(0);
    if (assistAt >= 0) {
      expect(citeAt).toBeLessThan(assistAt);
    }
  });

  it("keeps 法释 and 案号 anchors from dropped tool results", () => {
    const dropped: AgentMessage[] = [
      { role: "user", content: "司法解释和案号？", timestamp: "t1" },
      {
        role: "assistant",
        content: "",
        timestamp: "t2",
        toolCalls: [{ id: "c1", name: "search_case_law", arguments: {} }],
      },
      {
        role: "tool",
        content: "{}",
        timestamp: "t3",
        toolCallResponses: [
          {
            toolCallId: "c1",
            name: "search_case_law",
            result: {
              ok: true,
              data: { hits: ["法释〔2023〕1号 与 （2023）京民终123号"] },
            },
          },
        ],
      },
    ];
    const digest = buildDroppedSpanDigest(dropped, 4_000);
    expect(digest).toContain("压缩前引用");
    expect(digest).toContain("法释〔2023〕1号");
    expect(digest).toContain("（2023）京民终123号");
  });

  it("keeps guiding-case numbers and dotted contract clauses", () => {
    const dropped: AgentMessage[] = [
      {
        role: "tool",
        content: "{}",
        timestamp: "t1",
        toolCallResponses: [
          {
            toolCallId: "c1",
            name: "search_case_law",
            result: {
              ok: true,
              data: "参照指导案例24号，以及合同第 3.2 条、第12.3.1条。普通第3条不单列。",
            },
          },
        ],
      },
    ];
    const digest = buildDroppedSpanDigest(dropped, 4_000);
    expect(digest).toContain("指导案例24号");
    expect(digest).toContain("第3.2条");
    expect(digest).toContain("第12.3.1条");
    expect(digest).not.toContain("第3条");
  });
});

describe("buildDroppedSpanDigest · 任务保留与摘要接续（对照 Codex）", () => {
  const TASK = "把竞业限制解除条款与三方义务分配写出来，落到 Word 稿";
  const CITATION = "《劳动合同法》第23条";

  function filler(n: number): AgentMessage[] {
    return Array.from({ length: n }, (_, i) => ({
      role: "user" as const,
      content: `第${i}轮律师发言：请继续核对付款与违约`,
      timestamp: `t${i}`,
    }));
  }

  it("任务陈述按原文保留，即便律师发言远超「末 8 条」窗口", () => {
    const dropped: AgentMessage[] = [
      { role: "user", content: TASK, timestamp: "t0" },
      ...filler(30),
    ];
    const digest = buildDroppedSpanDigest(dropped, 10_000);
    expect(digest).toContain("### 任务与目标（原文保留，最早一条律师发言）");
    expect(digest).toContain("三方义务分配");
    // 末 8 条要点里当然不会有它（那是「最近」窗口），说明它是靠任务段活下来的。
    const lawyerSection = digest.split("### 律师要点")[1] ?? "";
    expect(lawyerSection.includes(TASK)).toBe(false);
  });

  it("此前的整理稿不嵌进新摘要，也不当成律师发言", () => {
    const priorDigest = `【压缩前对话蒸馏】共丢弃约 12 条消息\n\n### 任务与目标（原文保留，最早一条律师发言）\n- ${TASK}`;
    const dropped: AgentMessage[] = [
      { role: "user", content: priorDigest, timestamp: "t0" },
      { role: "user", content: "本轮新要求：再核对管辖条款", timestamp: "t1" },
      ...filler(10),
    ];
    const digest = buildDroppedSpanDigest(dropped, 10_000, undefined, {
      archiveRelPath: "sessions/s1.drops/drop.json",
    });
    expect(digest).not.toContain("### 上一轮整理稿");
    expect(digest).not.toContain("三方义务分配");
    expect(digest).toContain("sessions/s1.drops/drop.json");
    const lawyerSection = digest.split("### 律师要点")[1]?.split("###")[0] ?? "";
    expect(lawyerSection).not.toContain("【压缩前对话蒸馏】");
    expect(digest).toContain("再核对管辖条款");
  });

  it("红线重注 / 续接种子 / 退让反弹同样不算律师发言", () => {
    const dropped: AgentMessage[] = [
      { role: "user", content: "## 压缩后红线重注（仍有效）\n- 规则仍有效。", timestamp: "t0" },
      { role: "user", content: "【前序对话续接】律师从上一段对话另起了新会话。", timestamp: "t1" },
      { role: "user", content: "【上下文预算】上下文水位不是停下的理由。", timestamp: "t2" },
      { role: "user", content: "真实发言：再核对违约金", timestamp: "t3" },
    ];
    const digest = buildDroppedSpanDigest(dropped, 10_000);
    const lawyerSection = digest.split("### 律师要点")[1]?.split("###")[0] ?? "";
    expect(lawyerSection).toContain("真实发言");
    expect(lawyerSection).not.toContain("红线重注");
    expect(lawyerSection).not.toContain("前序对话续接");
    // 生效的红线由 `applyCompactReinjectionToSession` 在调用方重注（不是这里）。
    expect(digest.startsWith("【压缩前对话蒸馏】")).toBe(true);
  });

  it("段落顺序 = 截断优先级：超预算先丢工具名，任务与引用保留", () => {
    // 每行都要够长，否则总量压不到预算以下 —— 那样就测不到「切尾巴」。
    const longLines: AgentMessage[] = Array.from({ length: 20 }, (_, i) => ({
      role: "user" as const,
      content: `第${i}轮律师发言：${"请继续核对付款与违约条款的细节。".repeat(6)}`,
      timestamp: `L${i}`,
    }));
    const dropped: AgentMessage[] = [
      { role: "user", content: `${TASK}，依据 ${CITATION}`, timestamp: "t0" },
      ...longLines,
      {
        role: "assistant",
        content: "",
        timestamp: "t1",
        toolCalls: [{ id: "c1", name: "search_statute", arguments: {} }],
      },
    ];
    const digest = buildDroppedSpanDigest(dropped, 900);
    expect(digest.length).toBeLessThanOrEqual(900);
    expect(digest).toContain("三方义务分配");
    expect(digest).toContain(CITATION);
    // 尾巴上的工具名是第一个被切掉的（它丢了不影响答对）。
    expect(digest).not.toContain("### 曾调用工具");
    expect(digest).toContain("[蒸馏截断]");
  });

  it("任务段有额度上限，不会把整段摘要吃掉", () => {
    const hugeTask = "请".repeat(50_000);
    const digest = buildDroppedSpanDigest(
      [{ role: "user", content: hugeTask, timestamp: "t0" }],
      2_000,
    );
    expect(digest.length).toBeLessThanOrEqual(2_000);
  });
});

describe("autoCompactSessionHistory", () => {
  it("preserves tool_use/tool_result pairs at boundary", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-"));
    const session: AgentSession = {
      sessionId: "s1",
      actorId: "test",
      turns: [],
      conversationHistory: [
        { role: "system", content: "sys", timestamp: new Date().toISOString() },
        { role: "user", content: "u1", timestamp: new Date().toISOString() },
        {
          role: "assistant",
          content: "",
          timestamp: new Date().toISOString(),
          toolCalls: [{ id: "t1", name: "search_workspace", arguments: {} }],
        },
        {
          role: "tool",
          content: "{}",
          timestamp: new Date().toISOString(),
          toolCallResponses: [{ toolCallId: "t1", name: "search_workspace", result: { ok: true } }],
        },
        { role: "assistant", content: "done", timestamp: new Date().toISOString() },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const out = autoCompactSessionHistory(session, ws, { maxHistoryMessages: 4 });
    expect(out.compacted).toBe(true);
    const roles = out.messages.map((m) => m.role).join(",");
    expect(roles).toContain("tool");
  });

  it("蒸馏块按 user 角色插入，LLM 摘要能就地替换（生产路径回归）", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-digest-"));
    const now = new Date().toISOString();
    const history: AgentMessage[] = [{ role: "system", content: "sys", timestamp: now }];
    for (let i = 0; i < 12; i += 1) {
      history.push(
        { role: "user", content: `请审查第 ${i} 条违约金条款`, timestamp: now },
        { role: "assistant", content: `第 ${i} 条建议改为……`, timestamp: now },
      );
    }
    const session: AgentSession = {
      sessionId: "s-digest",
      actorId: "test",
      turns: [],
      matterId: "m-digest",
      conversationHistory: history,
      createdAt: now,
      updatedAt: now,
    };

    const out = autoCompactSessionHistory(session, ws, { maxHistoryMessages: 4 });
    expect(out.compacted).toBe(true);
    const digestIndex = out.messages.findIndex((m) =>
      (m.content ?? "").includes("【压缩前对话蒸馏】"),
    );
    expect(digestIndex).toBeGreaterThanOrEqual(0);
    // 生产路径插成 user（合成用户轮）。若这里回退成 system，替换逻辑又会静默失效。
    expect(out.messages[digestIndex]?.role).toBe("user");
    // 中文按 1 字 ≈ 1 token，不能再按字符÷4 报给用量确认框。
    const dropped = out.droppedSpan ?? [];
    const cjkChars = dropped.reduce(
      (n, m) => n + (m.content ?? "").replace(/[^\u4e00-\u9fff]/g, "").length,
      0,
    );
    expect(cjkChars).toBeGreaterThan(40);
    expect(out.estimatedDroppedTokens ?? 0).toBeGreaterThan(cjkChars / 2);

    const next = replaceDroppedDigestInMessages(out.messages, "【压缩前对话蒸馏】摘要：新");
    expect(next[digestIndex]?.content).toContain("摘要：新");
  });

  it("keeps a multi-tool batch whole when the tail cut lands inside it", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-group-"));
    const now = new Date().toISOString();
    const toolIds = ["t1", "t2", "t3"];
    const session: AgentSession = {
      sessionId: "s-group",
      actorId: "test",
      turns: [],
      conversationHistory: [
        { role: "system", content: "sys", timestamp: now },
        { role: "user", content: "一次查三份", timestamp: now },
        {
          role: "assistant",
          content: "",
          timestamp: now,
          toolCalls: toolIds.map((id) => ({ id, name: `tool_${id}`, arguments: {} })),
        },
        ...toolIds.map((id) => ({
          role: "tool" as const,
          content: "{}",
          timestamp: now,
          toolCallResponses: [{ toolCallId: id, name: `tool_${id}`, result: { ok: true } }],
        })),
        { role: "assistant", content: "三份结果已合并。", timestamp: now },
      ],
      createdAt: now,
      updatedAt: now,
    };
    const out = autoCompactSessionHistory(session, ws, { maxHistoryMessages: 2 });
    expect(out.compacted).toBe(true);
    // 旧实现按条数裸切，会在 t3 处下刀留下孤立 tool → DeepSeek 400。
    // 压缩结果必须自身合规：normalize 无需再做任何改动。
    expect(normalizeToolResultMessages(out.messages).changed).toBe(false);
    const firstNonSystem = out.messages.find((m) => m.role !== "system");
    expect(firstNonSystem?.role).not.toBe("tool");
  });

  it("reinjects dropped-span digest when history is compacted by count", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-digest-"));
    const matterId = "m-digest";
    fs.mkdirSync(path.join(ws, "cases", matterId), { recursive: true });
    const history: AgentMessage[] = [
      { role: "system", content: "sys", timestamp: new Date().toISOString() },
    ];
    for (let i = 0; i < 12; i++) {
      history.push({
        role: "user",
        content: `律师问题 ${i}：关注付款节点`,
        timestamp: new Date().toISOString(),
      });
      history.push({
        role: "assistant",
        content: `助手回答 ${i}：建议分期付款。`,
        timestamp: new Date().toISOString(),
      });
    }
    const session: AgentSession = {
      sessionId: "s-digest",
      matterId,
      actorId: "test",
      turns: [],
      conversationHistory: history,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const out = autoCompactSessionHistory(session, ws, {
      maxHistoryMessages: 6,
      contextTokens: 128_000,
    });
    expect(out.compacted).toBe(true);
    expect(out.droppedDigest).toBeTruthy();
    expect(out.firstKeptTimestamp).toBeTruthy();
    expect(out.firstKeptRole).toBeTruthy();
    expect(out.boundaryId).toMatch(/#/);
    expect(out.messages.some((m) => m.content?.includes("压缩前对话蒸馏"))).toBe(true);
    expect(fs.existsSync(path.join(ws, "cases", matterId, "compact-digest.md"))).toBe(true);
    const lastRealUser = [...out.messages]
      .toReversed()
      .find((m) => m.role === "user" && m.content.includes("律师问题"));
    const digestIdx = out.messages.findIndex((m) => m.content?.includes("压缩前对话蒸馏"));
    const lastUserIdx = out.messages.findIndex((m) => m === lastRealUser);
    expect(out.messages[0]?.role).toBe("system");
    expect(out.messages[0]?.content).toBe("sys");
    expect(out.messages.filter((m) => m.role === "system")).toHaveLength(1);
    expect(digestIdx).toBeGreaterThan(0);
    expect(digestIdx).toBeLessThan(lastUserIdx);
    expect(out.droppedDigest).toContain("sessions/s-digest.drops/");
    const rel = out.droppedDigest?.match(/sessions\/s-digest\.drops\/\S+?\.json/)?.[0];
    expect(rel).toBeTruthy();
    const saved = JSON.parse(fs.readFileSync(path.join(ws, rel!), "utf8")) as {
      messages: Array<{ content?: string }>;
    };
    expect(JSON.stringify(saved.messages)).toContain("律师问题 0");
  });

  it("points at the case file instead of pasting its body", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-case-"));
    const matterId = "m-case";
    const caseDir = path.join(ws, "cases", matterId);
    fs.mkdirSync(caseDir, { recursive: true });
    const secret = "CASE_BODY_SHOULD_STAY_ON_DISK_9f3a";
    fs.writeFileSync(path.join(caseDir, "CASE.md"), `# 案\n\n${secret}\n`, "utf8");
    const now = new Date().toISOString();
    const history: AgentMessage[] = [{ role: "system", content: "sys", timestamp: now }];
    for (let i = 0; i < 8; i += 1) {
      history.push({ role: "user", content: `请核对第 ${i} 条`, timestamp: now });
    }
    const session: AgentSession = {
      sessionId: "s-case",
      matterId,
      actorId: "test",
      turns: [],
      conversationHistory: history,
      createdAt: now,
      updatedAt: now,
    };
    const out = autoCompactSessionHistory(session, ws, { maxHistoryMessages: 3 });
    const joined = out.messages.map((m) => m.content ?? "").join("\n");
    expect(joined).toContain(`cases/${matterId}/CASE.md`);
    expect(joined).not.toContain(secret);
  });

  it("buildPostCompactSystemNote includes draft and queue attachments", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-compact-att-"));
    const matterId = "m-att";
    const taskId = "task-att-1";
    const now = new Date().toISOString();
    persistDraft(ws, {
      taskId,
      matterId,
      title: "测试草稿",
      output: "docx",
      summary: "摘要",
      sections: [{ heading: "结论", body: "正文", citations: [] }],
      reviewNotes: [],
      reviewStatus: "pending",
      createdAt: now,
    } as ArtifactDraft);
    appendQueueItem(ws, {
      queueItemId: "q1",
      matterId,
      kind: "need_lawyer_review",
      status: "open",
      priority: "high",
      title: "律师复核",
      createdAt: now,
      updatedAt: now,
    });
    const note = buildPostCompactSystemNote({
      matterId,
      linkedTaskId: taskId,
      workspaceDir: ws,
    });
    expect(note).toContain("关联草稿");
    expect(note).toContain("drafts/task-att-1.json");
    expect(note).toContain("待办队列");
    expect(note).not.toContain("### 结论");
  });
});
