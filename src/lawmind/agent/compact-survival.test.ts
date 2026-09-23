/**
 * 压缩生存不变量：**连续多次**压缩后，交付所必需的事实必须仍在历史里。
 *
 * ## 为什么这个文件存在
 *
 * 「压缩后再丢」这套机制的正确性，此前只有**单次**压缩的断言（cassette 里那条
 * 「被压缩掉的引用仍在下一次请求里存活」）。但真实长任务不是压一次：200 页的合同
 * 会连续触发多次。压一次能活，**不代表压三次还能活**——第二次压缩的输入是第一次
 * 的产物（摘要消息本身），任何「只保一层」的实现都会在第 2、3 轮静默丢掉引用。
 *
 * 这类失败是这个仓库最不能接受的一种：**静默**。律师看不到、测试不报错，
 * 直到某次交付里引用了不在案卷里的条文。所以这里把它写成不变量并反复压。
 *
 * ## 不变量（每次压缩后都必须成立）
 *
 * 1. **法条引用**仍在（`### 压缩前引用` 锚点，可跨轮传递）；
 * 2. **律师的原始指令**仍在（要点提取保留律师发言）；
 * 3. **待澄清键**仍以「仍生效」的措辞在场（丢了就等于静默放开起草硬门禁）；
 * 4. **红线重注**在场（规则/交付/工艺约束不因摘要而失效）；
 * 5. 每轮都**真的压缩了**（否则这个测试会退化成「什么都没发生也通过」）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistDraft } from "../drafts/index.js";
import { applyCompactReinjectionToSession } from "./compact-reinjection.js";
import { autoCompactSessionHistory } from "./compact.js";
import type { AgentMessage, AgentSession } from "./types.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function workspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-survival-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, "MEMORY.md"), "# 通用记忆\n", "utf8");
  return dir;
}

/** 交付必需的事实，全程用同一组常量断言。 */
const CITATION = "《劳动合同法》第23条";
const LAWYER_ASK = "把竞业限制解除条款与三方义务分配写出来，落到 Word 稿";
const CLARIFY_KEY = "竞业限制补偿标准";
const TASK_ID = "t-survival";

function ts(offsetSec = 0): string {
  return new Date(Date.now() + offsetSec * 1000).toISOString();
}

function createLongSession(): AgentSession {
  const now = ts();
  const history: AgentMessage[] = [
    { role: "system", content: "sys", timestamp: now },
    // 律师的原始交办（要跨多次压缩存活）
    { role: "user", content: LAWYER_ASK, timestamp: now },
    { role: "assistant", content: "先读合同与检索法条。", timestamp: now },
    {
      role: "assistant",
      content: "",
      timestamp: now,
      toolCalls: [{ id: "c1", name: "search_statute", arguments: { q: "竞业限制" } }],
    },
    {
      role: "tool",
      content: JSON.stringify({ ok: true, data: { hits: [`依据 ${CITATION}，当事人一方…`] } }),
      timestamp: now,
      toolCallResponses: [
        {
          toolCallId: "c1",
          name: "search_statute",
          result: { ok: true, data: { hits: [`依据 ${CITATION}，当事人一方…`] } },
        },
      ],
    },
    { role: "assistant", content: `已定位 ${CITATION}，接着起草解除条款。`, timestamp: now },
  ];
  return {
    sessionId: "s-survival",
    actorId: "lawyer",
    turns: [],
    matterId: "m-survival",
    pendingClarificationKeys: [CLARIFY_KEY],
    conversationHistory: history,
    createdAt: now,
    updatedAt: now,
  };
}

/** 模拟长任务继续推进：每轮再加一批对话与工具轮。 */
/** 每轮推进量要足以把「末 N 条」窗口完全推走——否则摘要会搭车存活，测试假绿。 */
function inflate(session: AgentSession, round: number): void {
  for (let i = 0; i < 20; i += 1) {
    session.conversationHistory.push(
      { role: "user", content: `第 ${round} 轮补充 ${i}：请继续核对付款与违约`, timestamp: ts(i) },
      {
        role: "assistant",
        content: `第 ${round} 轮答复 ${i}：已核对，建议保留原条款。`,
        timestamp: ts(i),
      },
    );
  }
}

/** 把整份历史拍平成可断言的文本（含各条 content 与消息角色）。 */
function flatten(session: AgentSession): string {
  return session.conversationHistory.map((m) => `${m.role}: ${m.content ?? ""}`).join("\n");
}

function assertInvariants(session: AgentSession, round: number): void {
  const text = flatten(session);
  expect(text, `第 ${round} 轮：法条引用丢了`).toContain(CITATION);
  // 任务陈述（要做什么）必须活着。它是「模型会不会变笨」的第一因：
  // 引用还在但目标丢了，模型就会答非所问或重复已做的事。
  expect(text, `第 ${round} 轮：律师原始交办丢了（任务目标不能只靠末 N 条要点）`).toContain(
    "三方义务分配",
  );
  // 也不能只靠「上一轮摘要的摘要」搭车活着：嵌套一层层传下去，最终会衰减成空壳。
  expect(text.includes("三方义务分配"), `第 ${round} 轮：任务陈述仅存于嵌套摘要里`).toBe(true);
  expect(
    session.conversationHistory.some(
      (m) => (m.content ?? "").includes(CLARIFY_KEY) && (m.content ?? "").includes("仍生效"),
    ),
    `第 ${round} 轮：待澄清键失了「仍生效」措辞（等于静默放开起草门禁）`,
  ).toBe(true);
  expect(text, `第 ${round} 轮：红线重注丢了`).toContain("压缩后红线重注（仍有效）");
}

describe("压缩生存不变量（连续多次压缩）", () => {
  it("连压 4 次后，引用 / 律师交办 / 待澄清键 / 红线重注 全部仍在", () => {
    const ws = workspace();
    persistDraft(ws, {
      taskId: TASK_ID,
      title: "竞业限制解除条款",
      summary: "s",
      sections: [{ heading: "解除条款", body: "……" }],
    });
    const session = createLongSession();

    // 连续四轮：每轮「推进任务 → 压缩」，断言不变量。
    for (let round = 1; round <= 4; round += 1) {
      inflate(session, round);
      const before = session.conversationHistory.length;
      const result = autoCompactSessionHistory(session, ws, {
        maxHistoryMessages: 8,
        linkedTaskId: TASK_ID,
      });
      // 每轮都必须真的压缩过，否则下面的断言毫无意义（退化通过）。
      expect(result.compacted, `第 ${round} 轮没触发压缩，测试退化`).toBe(true);
      expect(result.droppedMessageCount ?? 0, `第 ${round} 轮没丢弃任何消息`).toBeGreaterThan(0);
      session.conversationHistory = result.messages;
      expect(session.conversationHistory.length).toBeLessThan(before);
      // 重注由**调用方**应用（回合开始走 turn-orchestrator，回合内走 mid-turn-compact）。
      // 不变量必须断言在生产序列上，否则测的是半截管线。
      session.needsCompactReinjection = true;
      applyCompactReinjectionToSession(session, { mandatoryRulesActive: true });
      assertInvariants(session, round);
    }
  });

  it("引用即使只出现在被丢弃的工具回包里，也能跨轮传递下去", () => {
    const ws = workspace();
    const session = createLongSession();
    // 先把首次压缩做掉：引用此时靠「压缩前引用」锚点活下来。
    inflate(session, 1);
    const first = autoCompactSessionHistory(session, ws, { maxHistoryMessages: 8 });
    expect(first.compacted).toBe(true);
    session.conversationHistory = first.messages;
    session.needsCompactReinjection = true;
    applyCompactReinjectionToSession(session, { mandatoryRulesActive: true });
    expect(flatten(session)).toContain(CITATION);

    // 再压两次：原始工具回包早已不在，引用必须靠锚点继续传递。
    for (let round = 2; round <= 3; round += 1) {
      inflate(session, round);
      const result = autoCompactSessionHistory(session, ws, { maxHistoryMessages: 8 });
      expect(result.compacted).toBe(true);
      session.conversationHistory = result.messages;
      // 原始工具回包确实已被压掉（这是前提，不是断言目标）。
      expect(
        session.conversationHistory.some(
          (m) => m.role === "tool" && (m.content ?? "").includes(CITATION),
        ),
      ).toBe(false);
      expect(flatten(session), `第 ${round} 轮引用断了`).toContain(CITATION);
    }
  });

  it("蒸馏块按 user 角色插入（LLM 摘要替换的生产前提）", () => {
    const ws = workspace();
    const session = createLongSession();
    inflate(session, 1);
    const result = autoCompactSessionHistory(session, ws, { maxHistoryMessages: 8 });
    const digestIndex = result.messages.findIndex((m) =>
      (m.content ?? "").includes("【压缩前对话蒸馏】"),
    );
    expect(digestIndex).toBeGreaterThanOrEqual(0);
    expect(result.messages[digestIndex]?.role).toBe("user");
  });
});
