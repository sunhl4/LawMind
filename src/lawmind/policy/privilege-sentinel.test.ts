import { describe, expect, it } from "vitest";
import {
  assessOutboundPrivilege,
  isPrivilegeSentinelEnabled,
  scanPrivilegeTip,
} from "./privilege-sentinel.js";

describe("privilege-sentinel", () => {
  it("flags privilege markers and respects disable", () => {
    expect(scanPrivilegeTip("本函为 attorney-client privileged 材料").code).toBe(
      "privilege_marker",
    );
    expect(scanPrivilegeTip("普通催告函")).toBeNull();
    expect(isPrivilegeSentinelEnabled({ env: { LAWMIND_PRIVILEGE_SENTINEL: "0" } })).toBe(false);
    expect(isPrivilegeSentinelEnabled({ policy: { privilegeSentinel: false } })).toBe(false);
  });
});

describe("assessOutboundPrivilege（P0-4c 结构化评估）", () => {
  it("正文带特权标记 → warn，无论收件人是谁（收件人可能识别错，不得因此放松）", () => {
    for (const audienceKind of ["internal", "client", "opposing", "court", "unknown"]) {
      const tip = assessOutboundPrivilege({
        text: "本函为 privileged and confidential",
        audienceKind,
      });
      expect(tip?.level, `audience=${audienceKind}`).toBe("warn");
      expect(tip?.code).toBe("privilege_marker");
    }
  });

  it("所外受众 × 特权外观附件 → 升级为 warn（旧实现完全看不到这条路径）", () => {
    const tip = assessOutboundPrivilege({
      text: "请查收。",
      audienceKind: "opposing",
      attachmentNames: ["谈判底线与策略.docx"],
    });
    expect(tip?.level).toBe("warn");
    expect(tip?.code).toBe("privileged_attachment_external");
    expect(tip?.message).toContain("谈判底线与策略.docx");
  });

  it("所外受众 × 正文含工作成果 → 升级为 warn（纯文本层只是 info）", () => {
    const tip = assessOutboundPrivilege({
      text: "以下是我方诉讼策略的初步判断。",
      audienceKind: "court",
    });
    expect(tip?.level).toBe("warn");
    expect(tip?.code).toBe("work_product_external");
  });

  it("所内受众 × 正文含工作成果 → 保持 info（对所内披露是该走的路，报 warn 只会变成噪声）", () => {
    const tip = assessOutboundPrivilege({
      text: "以下是我方诉讼策略的初步判断。",
      audienceKind: "internal",
    });
    expect(tip?.level).toBe("info");
    expect(tip?.code).toBe("work_product");
  });

  it("委托人受众 × 工作成果 → 保持 info（同上）", () => {
    const tip = assessOutboundPrivilege({
      text: "内部备忘记录如下。",
      audienceKind: "client",
    });
    expect(tip?.level).toBe("info");
  });

  it("所外受众但附件名不自带特权外观 → 不因受众本身就报特权（不制造噪声）", () => {
    const tip = assessOutboundPrivilege({
      text: "请查收合同文本。",
      audienceKind: "opposing",
      attachmentNames: ["合同v2.docx"],
    });
    expect(tip).toBeNull();
  });

  it("unknown 受众不当作所外（未知不等于危险，避免误报）", () => {
    const tip = assessOutboundPrivilege({
      text: "以下是我方诉讼策略的初步判断。",
      audienceKind: "unknown",
    });
    expect(tip?.level).toBe("info");
  });

  it("附件名判据只看文件名，不因为路径里的目录名触发", () => {
    const tip = assessOutboundPrivilege({
      text: "请查收。",
      audienceKind: "opposing",
      // 调用方应传 basename；这里传纯文件名，目录名（策略/）不该参与判据
      attachmentNames: ["合同v2.docx"],
    });
    expect(tip).toBeNull();
  });

  it("只加严不放松：纯文本 warn 的场合，结构化评估必为 warn", () => {
    const text = "本材料为 attorney-client privilege 覆盖";
    const plain = scanPrivilegeTip(text);
    expect(plain?.level).toBe("warn");
    for (const audienceKind of ["internal", "client", "opposing", "court", "public", "unknown"]) {
      const structured = assessOutboundPrivilege({ text, audienceKind });
      expect(structured?.level, `audience=${audienceKind}`).toBe("warn");
    }
  });

  it("无信号时返回 null（不编造提示）", () => {
    expect(assessOutboundPrivilege({ text: "普通催告函", audienceKind: "opposing" })).toBeNull();
    expect(assessOutboundPrivilege({ text: "", audienceKind: "court" })).toBeNull();
  });

  it("缺 audienceKind 时按 unknown 处理，不误升级", () => {
    const tip = assessOutboundPrivilege({ text: "诉讼策略如下" });
    expect(tip?.level).toBe("info");
  });
});
