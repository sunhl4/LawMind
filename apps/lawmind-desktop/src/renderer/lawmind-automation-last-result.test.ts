import { describe, expect, it } from "vitest";
import { formatAutomationLastResultForLawyer } from "./lawmind-automation-last-result";

const dump = [
  "（已从远程邮箱同步 0 封（按对方名单过滤，跳过 30 封））",
  "",
  "发现 1 个合同类附件，将启动「邮件合同审阅改稿」工作流（最小修改 + 原文件审阅痕迹）。",
  "1. `cases/临时讨论/mail/attachments/x/国浩审-20260730-合作协议.doc`（Word）← 合作协议",
  "默认 Word 基线：`cases/临时讨论/mail/attachments/x/国浩审-20260730-合作协议.doc`",
  "完成后请在文书台签批；批准发送前不会对外发信。",
  "",
  "已启动邮件合同审阅改稿工作流「mail-contract-redline」（任务 191c0555…）。完成后请在「文书台」签批；外发须在待拍板「批准发送」。",
].join("\n");

describe("formatAutomationLastResultForLawyer", () => {
  it("collapses a mail-contract dump into one lawyer line", () => {
    const line = formatAutomationLastResultForLawyer(dump);
    expect(line).toContain("1 份合同");
    expect(line).toContain("待我拍板");
    expect(line).not.toMatch(/mail-contract-redline|191c0555|cases\//);
  });

  it("says no new contracts without a dump", () => {
    expect(formatAutomationLastResultForLawyer("未发现带合同附件的邮件。")).toContain("没有新的合同");
  });

  it("surfaces failures briefly", () => {
    expect(formatAutomationLastResultForLawyer("运行失败（smtp_send_failed）：连接超时")).toContain(
      "没跑成",
    );
    expect(formatAutomationLastResultForLawyer("（远程同步失败：auth；仍读取本地匣。）")).toContain(
      "没跑成",
    );
  });

  it("returns null when empty", () => {
    expect(formatAutomationLastResultForLawyer("")).toBeNull();
    expect(formatAutomationLastResultForLawyer(undefined)).toBeNull();
  });
});
