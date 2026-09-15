import { describe, expect, it } from "vitest";
import {
  CONTRACT_FAST_LANE_PROMPT,
  CONTRACT_FAST_LANE_TOOL_NAMES,
  contractFastLaneAllowNames,
  formatContractFastLanePrompt,
  isContractFastLaneInstruction,
} from "./contract-fast-lane-instruction.js";

const FAST_LANE = `【交办】5 分钟合同审查
交付物类型：合同审查意见
交办要点：
- 合同/材料说明：nda.docx
- 审查重点：付款与违约
- 己方立场：委托方（保护我方利益）

审查深度：快速。只列出最高优先级的 3–5 个风险点。`;

describe("contract-fast-lane-instruction", () => {
  it("detects 5-minute and structured intake dispatches", () => {
    expect(isContractFastLaneInstruction(FAST_LANE)).toBe(true);
    expect(
      isContractFastLaneInstruction(
        "【交办】合同审查意见\n交付物类型：合同审查意见\n- 己方立场：中立\n- 审查重点：管辖",
      ),
    ).toBe(true);
    expect(isContractFastLaneInstruction("【办件】能力：contract.review\n流程：合同审查")).toBe(
      false,
    );
  });

  it("does not lock free chat, mail short path, or campaign upgrade", () => {
    expect(isContractFastLaneInstruction("请帮我审一下这份合同")).toBe(false);
    expect(
      isContractFastLaneInstruction(
        "【邮件合同审阅改稿 · 短路径】\n默认 contract_edit_baseline_path=`cases/m/a.docx`",
      ),
    ).toBe(false);
    expect(
      isContractFastLaneInstruction(`${FAST_LANE}\n\n【律师指示】请按完整合同审查专案组执行`),
    ).toBe(false);
  });

  it("does not freeze the tool table", () => {
    expect(contractFastLaneAllowNames(FAST_LANE)).toBeUndefined();
    expect(CONTRACT_FAST_LANE_PROMPT).toContain("工具表不收窄");
    expect(CONTRACT_FAST_LANE_PROMPT).toContain("宏观交易结构");
    expect(CONTRACT_FAST_LANE_PROMPT).not.toContain("直接拒绝");
    expect(CONTRACT_FAST_LANE_TOOL_NAMES).toContain("draft_document");
  });

  it("pairs redline coaching when a Word is pinned", () => {
    expect(formatContractFastLanePrompt({ wordPinned: true })).toContain("render_tracked_draft");
    expect(formatContractFastLanePrompt({ wordPinned: true })).not.toContain("本地意见书优先");
    expect(formatContractFastLanePrompt()).toContain("本地意见书优先");
  });
});
