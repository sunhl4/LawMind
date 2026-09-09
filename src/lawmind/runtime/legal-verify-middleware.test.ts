import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyLegalVerifyToResult,
  extractEmailDomain,
  precheckOutboundMail,
  recipientDomainOutsideAllowlist,
  resolveOutboundAllowedDomains,
} from "./legal-verify-middleware.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dirs.length = 0;
});

describe("legal-verify-middleware", () => {
  it("parses email domains and allowlists", () => {
    expect(extractEmailDomain("Counsel <opp@firm.cn>")).toBe("firm.cn");
    expect(recipientDomainOutsideAllowlist("a@client.com", ["client.com"])).toBe(false);
    expect(recipientDomainOutsideAllowlist("a@other.com", ["client.com"])).toBe(true);
    expect(recipientDomainOutsideAllowlist("a@other.com", [])).toBe(false);
  });

  it("blocks privileged outbound text before execute", () => {
    const blocked = precheckOutboundMail({
      toolName: "prepare_outbound_mail",
      args: {
        to: "opp@example.com",
        subject: "Privileged",
        body: "本函为 attorney-client privileged 材料，请查收。",
      },
      privilegeEnabled: true,
      allowedOutboundDomains: [],
    });
    expect(blocked?.ok).toBe(false);
    expect(blocked?.error).toContain("发前需确认");
    const data = blocked?.data as { gateDecision?: { gate?: string } };
    expect(data.gateDecision?.gate).toBe("outbound_privilege_gate");
  });

  it("blocks recipient domains outside the workspace allowlist", () => {
    const blocked = precheckOutboundMail({
      toolName: "prepare_outbound_mail",
      args: { to: "x@gmail.com", subject: "催告", body: "请于周五前回复。" },
      privilegeEnabled: true,
      allowedOutboundDomains: ["client.com"],
    });
    expect(blocked?.ok).toBe(false);
    expect(blocked?.error).toContain("发前需确认收件人");
  });

  it("blocks prepare_outbound_mail when to diverges from the short-path pin", () => {
    const blocked = precheckOutboundMail({
      toolName: "prepare_outbound_mail",
      args: { to: "other@firm.cn", subject: "审阅稿", body: "请查收" },
      privilegeEnabled: false,
      allowedOutboundDomains: [],
      pinnedTo: "opp@firm.cn",
    });
    expect(blocked?.ok).toBe(false);
    expect(blocked?.error).toContain("opp@firm.cn");
    expect(
      precheckOutboundMail({
        toolName: "prepare_outbound_mail",
        args: { to: "Counsel <Opp@Firm.CN>", subject: "审阅稿", body: "请查收" },
        privilegeEnabled: false,
        allowedOutboundDomains: [],
        pinnedTo: "opp@firm.cn",
      }),
    ).toBeUndefined();
  });

  it("does not precheck send_email or ordinary mail", () => {
    expect(
      precheckOutboundMail({
        toolName: "send_email",
        args: { to: "x@gmail.com", subject: "催告", body: "请回复。" },
        privilegeEnabled: true,
        allowedOutboundDomains: ["client.com"],
      }),
    ).toBeUndefined();
    expect(
      precheckOutboundMail({
        toolName: "prepare_outbound_mail",
        args: { to: "a@client.com", subject: "催告", body: "请于周五前回复。" },
        privilegeEnabled: true,
        allowedOutboundDomains: ["client.com"],
      }),
    ).toBeUndefined();
  });

  it("elevates failed citationIntegrity without flipping ok", () => {
    const next = applyLegalVerifyToResult("draft_document", {
      ok: true,
      data: {
        citationIntegrity: { checked: true, ok: false, missingSourceIds: ["src-9"] },
      },
    });
    expect(next.ok).toBe(true);
    const data = next.data as {
      verify?: { message?: string };
      gateDecision?: { gate?: string; category?: string };
    };
    expect(data.verify?.message).toContain("引用对不上来源");
    expect(data.gateDecision?.gate).toBe("citation_integrity_gate");
    expect(data.gateDecision?.category).toBe("judgment_soft");
  });

  it("marks document.general without citations as unverified, not failed", () => {
    const next = applyLegalVerifyToResult("draft_document", {
      ok: true,
      data: { deliverableType: "document.general" },
    });
    expect(next.ok).toBe(true);
    const data = next.data as { verify?: { unverified?: boolean } };
    expect(data.verify?.unverified).toBe(true);
  });

  it("marks opinion drafts unverified when authority is not live", () => {
    const next = applyLegalVerifyToResult("draft_document", {
      ok: true,
      data: { deliverableType: "memo.opinion" },
    });
    expect(next.ok).toBe(true);
    const data = next.data as { verify?: { message?: string; unverified?: boolean } };
    expect(data.verify?.unverified).toBe(true);
    // Offline: 未接真源；online but no this-turn trial: 尚未试检. Both are soft stamps.
    expect(data.verify?.message).toMatch(/未接真源|尚未试检/);
  });

  it("stamps workspace statute search as sample when the tool did not hit a live corpus", () => {
    const next = applyLegalVerifyToResult("search_statute", {
      ok: true,
      data: { hits: [{ snippet: "民法典" }] },
    });
    const data = next.data as { sourceTier?: string; authorityLive?: boolean };
    expect(data.sourceTier).toBe("sample");
    expect(data.authorityLive).toBe(false);
  });

  it("does not overwrite a live 法宝 search_statute result as sample", () => {
    const next = applyLegalVerifyToResult("search_statute", {
      ok: true,
      data: {
        hits: [{ source: "北大法宝", url: "https://www.pkulaw.com/chl/x" }],
        authority: "live",
        authorityLive: true,
        authorityProvider: "pkulaw",
      },
    });
    const data = next.data as {
      sourceTier?: string;
      authorityLive?: boolean;
      authority?: string;
      authorityProvider?: string;
    };
    expect(data.sourceTier).toBe("live");
    expect(data.authorityLive).toBe(true);
    expect(data.authority).toBe("live");
    expect(data.authorityProvider).toBe("pkulaw");
  });

  it("attaches advisory lintReport when draft body is long enough", () => {
    const next = applyLegalVerifyToResult("draft_document", {
      ok: true,
      data: {
        draft: {
          title: "供货合同",
          sections: [{ heading: "第一条", body: "定金为本合同标的额的 30%，其余条款按约定履行。" }],
        },
      },
    });
    expect(next.ok).toBe(true);
    const data = next.data as {
      lintReport?: { blockerCount?: number; findings?: Array<{ ruleId: string }> };
      selfRevise?: {
        applied?: Array<{ ruleId: string }>;
        proposals?: Array<{ ruleId: string; requiresLawyerDecision?: boolean }>;
        summaryZh?: string;
      };
    };
    expect(data.lintReport?.blockerCount).toBeGreaterThanOrEqual(1);
    expect(data.lintReport?.findings?.some((f) => f.ruleId === "statutory.deposit_cap")).toBe(true);
    // 法定参数类不自动改：不出现在 applied，只产出建议式提案。
    expect(data.selfRevise?.applied?.some((a) => a.ruleId === "statutory.deposit_cap")).toBe(false);
    expect(
      data.selfRevise?.proposals?.some(
        (p) => p.ruleId === "statutory.deposit_cap" && p.requiresLawyerDecision === true,
      ),
    ).toBe(true);
  });

  it("soft-stamps missing statute trial on unlocked opinion drafts", () => {
    const stamped = applyLegalVerifyToResult(
      "draft_document",
      {
        ok: true,
        data: {
          deliverableType: "contract.review",
          citationIntegrity: { checked: true, ok: true, missingSourceIds: [] },
          sections: [{ heading: "依据", bodyPreview: "见《民法典》第577条" }],
        },
      },
      { toolNameCallCounts: {} },
    );
    const data = stamped.data as { verify?: { statuteTrialMissing?: boolean; message?: string } };
    expect(data.verify?.statuteTrialMissing).toBe(true);
    expect(data.verify?.message).toContain("尚未试检");

    const skipped = applyLegalVerifyToResult(
      "draft_document",
      {
        ok: true,
        data: {
          deliverableType: "contract.review",
          citationIntegrity: { checked: true, ok: true, missingSourceIds: [] },
          sections: [{ heading: "依据", bodyPreview: "见《民法典》第577条" }],
        },
      },
      { toolNameCallCounts: {}, mailContractTurn: true },
    );
    expect((skipped.data as { verify?: unknown }).verify).toBeUndefined();

    const tried = applyLegalVerifyToResult(
      "draft_document",
      {
        ok: true,
        data: {
          deliverableType: "contract.review",
          citationIntegrity: { checked: true, ok: true, missingSourceIds: [] },
          sections: [{ heading: "依据", bodyPreview: "见《民法典》第577条" }],
        },
      },
      { toolNameCallCounts: { search_statute: 1 } },
    );
    expect(
      (tried.data as { verify?: { statuteTrialMissing?: boolean } }).verify?.statuteTrialMissing,
    ).toBeUndefined();
  });

  it("is a no-op for clean drafts and aborted tools", () => {
    const clean = applyLegalVerifyToResult("draft_document", {
      ok: true,
      data: { citationIntegrity: { checked: true, ok: true, missingSourceIds: [] } },
    });
    expect(clean).toEqual({
      ok: true,
      data: { citationIntegrity: { checked: true, ok: true, missingSourceIds: [] } },
    });
    const stopped = applyLegalVerifyToResult("draft_document", {
      ok: false,
      aborted: true,
      error: "已停止",
    });
    expect(stopped.aborted).toBe(true);
  });

  it("reads outboundAllowedDomains from workspace policy", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "lm-verify-"));
    dirs.push(ws);
    fs.mkdirSync(path.join(ws, "lawmind"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, "lawmind.policy.json"),
      JSON.stringify({ schemaVersion: 1, outboundAllowedDomains: ["acme.cn"] }),
      "utf8",
    );
    expect(resolveOutboundAllowedDomains(ws)).toEqual(["acme.cn"]);
  });
});
