/**
 * 律师可见的外发文案：一个动作一个词，统一为「签批发送」。
 *
 * 工具描述、参数说明和结果会原样出现在对话与待拍板里，所以在这里钉住，
 * 避免又退回「批准发送」。内部实现名（`approve_send`、审批队列、绑定字段）
 * 不受这条约束，也不该为了改文案去动协议。
 */
import { describe, expect, it } from "vitest";
import { packetApprovalProblems } from "../../../delivery/packet-outbound.js";
import { irreversibleImpactLabelZh } from "../../tool-name-sets.js";
import { prepareOutboundMail, sendEmail } from "./mail-tools.js";

const FORBIDDEN = ["批准发送", "批准后", "批准前", "等待批准", "重新批准", "待批准", "批准整包"];

function outboundLawyerCopy(): string {
  const descriptions = [sendEmail, prepareOutboundMail].flatMap((tool) => [
    tool.definition.description,
    ...Object.values(tool.definition.parameters).map((param) => param.description ?? ""),
  ]);
  return [
    ...descriptions,
    irreversibleImpactLabelZh("send_email"),
    irreversibleImpactLabelZh("prepare_outbound_mail"),
    ...packetApprovalProblems("/nonexistent-lawmind-workspace", "m1", {
      packetId: "",
      packetHash: "",
    }),
  ].join("\n");
}

describe("outbound lawyer copy", () => {
  it("says 签批发送 and never 批准 for the lawyer action", () => {
    const copy = outboundLawyerCopy();
    for (const word of FORBIDDEN) {
      expect(copy).not.toContain(word);
    }
    expect(copy).toContain("签批发送");
  });
});
