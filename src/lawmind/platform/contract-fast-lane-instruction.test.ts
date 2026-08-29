import { describe, expect, it } from "vitest";
import {
  CONTRACT_FAST_LANE_PROMPT,
  CONTRACT_FAST_LANE_TOOL_NAMES,
  contractFastLaneAllowNames,
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
      true,
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

  it("locks the opinion tool table", () => {
    expect(contractFastLaneAllowNames(FAST_LANE)).toEqual([...CONTRACT_FAST_LANE_TOOL_NAMES]);
    expect(CONTRACT_FAST_LANE_TOOL_NAMES).not.toContain("search_workspace");
    expect(CONTRACT_FAST_LANE_TOOL_NAMES).not.toContain("prepare_outbound_mail");
    expect(CONTRACT_FAST_LANE_TOOL_NAMES).not.toContain("apply_surgical_edits");
    expect(CONTRACT_FAST_LANE_PROMPT).toContain("直接拒绝");
  });
});
