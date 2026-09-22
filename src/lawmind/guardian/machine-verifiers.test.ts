import { describe, expect, it } from "vitest";
import type { LegalLintFinding, LegalLintReport } from "../lint/types.js";
import {
  MACHINE_VERIFIERS,
  runMachineVerifiers,
  type MachineVerifyContext,
} from "./machine-verifiers.js";
import type { GuardianEvidencePack } from "./types.js";

type PackOverrides = {
  citationIntegrityOk?: boolean;
  citationMissingIds?: string[];
  citations?: Array<{ id: string; usedInHeadings: string[] }>;
};

function makePack(o: PackOverrides = {}): GuardianEvidencePack {
  return {
    action: "render_document",
    taskId: "t-1",
    title: "测试稿",
    confirmedAnswers: [],
    hunks: [],
    sections: [],
    issues: [],
    citations: (o.citations ?? [{ id: "s1", usedInHeadings: ["第一条"] }]).map((c) => ({
      id: c.id,
      usedInHeadings: c.usedInHeadings,
    })),
    checklist: { items: [] },
    gates: {
      ...(o.citationIntegrityOk !== undefined
        ? { citationIntegrityOk: o.citationIntegrityOk }
        : {}),
      ...(o.citationMissingIds ? { citationMissingIds: o.citationMissingIds } : {}),
    },
    writerDeferredClaims: [],
    prior: null,
  };
}

function finding(ruleId: string): LegalLintFinding {
  return {
    ruleId,
    family: "meta",
    severity: "warning",
    message: `${ruleId} 命中`,
    fixable: false,
  };
}

function makeCtx(input: {
  findings?: string[];
  failedRules?: string[];
  documentText?: string;
  graphIssues?: MachineVerifyContext["graphIssues"];
}): MachineVerifyContext {
  const findings = (input.findings ?? []).map(finding);
  const report: LegalLintReport = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    coverageNote: "",
    ruleCount: 1,
    findings,
    blockerCount: 0,
    warningCount: findings.length,
    failedRules: input.failedRules ?? [],
    summaryZh: "",
  };
  return {
    documentText: input.documentText ?? "第一条 双方应履行义务。",
    lintReport: report,
    ...(input.graphIssues ? { graphIssues: input.graphIssues } : {}),
  };
}

/**
 * `forum.form_valid` 只吃两条形式规则（`form.jurisdiction` /
 * `form.or_arbitrate_or_sue`），**不读正文**——具体形式违规由规则自己抓。
 * 为什么**不**把 `clause.dispute_missing` 接进来，见 `machine-verifiers.ts`
 * 里 `disputeFormVerifier` 的注释（附可复现的实测）。
 */

/** 每个验证器的「触发命中」规则，以及它的一个代表项。 */
const CASES: Array<{
  id: string;
  itemId: string;
  hitRule: string;
  okCtx: () => MachineVerifyContext;
  okPack: () => GuardianEvidencePack;
}> = [
  {
    id: "citations.subset",
    itemId: "contract-review-v1/citations",
    hitRule: "(门禁字段)",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({ citationIntegrityOk: true }),
  },
  {
    id: "citations.used",
    itemId: "compliance-dossier-v1/sources",
    hitRule: "(证据包字段)",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({ citations: [{ id: "s1", usedInHeadings: ["第一条"] }] }),
  },
  {
    id: "graph.authority_used",
    itemId: "demand-letter-v1/facts",
    hitRule: "(图谱字段)",
    okCtx: () =>
      makeCtx({ graphIssues: [{ issue: "争点1", authorityIds: ["a1"], openQuestions: [] }] }),
    okPack: () => makePack({}),
  },
  {
    id: "parties.consistent",
    itemId: "contract-review-v1/parties",
    hitRule: "consistency.party_pair",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({}),
  },
  {
    id: "amounts.case_consistent",
    itemId: "demand-letter-v1/claim",
    hitRule: "consistency.amount_case",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({}),
  },
  {
    id: "dates.ordered",
    itemId: "demand-letter-v1/deadline",
    hitRule: "consistency.date_order",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({}),
  },
  {
    id: "placeholders.closed",
    itemId: "general-v1/placeholders",
    hitRule: "placeholder.open",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({}),
  },
  {
    id: "statute.lpr_multiple",
    itemId: "loan.rate",
    hitRule: "statutory.lpr_multiple",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({}),
  },
  {
    id: "statute.deposit_cap",
    itemId: "pr.deposit",
    hitRule: "statutory.deposit_cap",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({}),
  },
  {
    id: "guarantee.form_valid",
    itemId: "loan.guarantee",
    hitRule: "form.guarantee_form_default",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({}),
  },
  {
    id: "forum.form_valid",
    itemId: "pr.dispute",
    hitRule: "form.or_arbitrate_or_sue",
    okCtx: () => makeCtx({}),
    okPack: () => makePack({}),
  },
];

describe("G0 机器验证器：每个验证器三条（通过 / 未覆盖 / 不可用）", () => {
  it("注册表里的每个验证器都被本测试覆盖（防止新增验证器漏测）", () => {
    expect(MACHINE_VERIFIERS.map((v) => v.id).toSorted()).toEqual(
      CASES.map((c) => c.id).toSorted(),
    );
  });

  it("每个验证器至少服务一个判定表项（否则是死代码）", () => {
    for (const v of MACHINE_VERIFIERS) {
      expect(v.itemIds.length, `验证器 ${v.id} 没有服务任何项`).toBeGreaterThan(0);
    }
  });

  for (const c of CASES) {
    describe(c.id, () => {
      it("无命中 → 该项 supported: true 且 status: ok", () => {
        const out = runMachineVerifiers({
          pack: c.okPack(),
          ctx: c.okCtx(),
          verifierIds: [c.id],
        });
        const v = out.get(c.itemId);
        expect(v, `${c.id} 没给出 ${c.itemId} 的结论`).toBeDefined();
        expect(v!.supported).toBe(true);
        expect(v!.status).toBe("ok");
        expect(v!.reason.trim().length).toBeGreaterThan(0);
      });

      it("规则命中 → 该项 supported: false（未覆盖）", () => {
        const out = runMachineVerifiers({
          pack: c.okPack(),
          ctx: makeCtx({ findings: [c.hitRule] }),
          verifierIds: [c.id],
        });
        const v = out.get(c.itemId);
        expect(v).toBeDefined();
        // 证据包类验证器不吃 lint findings——它们的命中条件在 pack 上，单独覆盖。
        if (c.hitRule.startsWith("(")) {
          return;
        }
        expect(v!.supported).toBe(false);
        expect(v!.status).toBe("ok");
      });

      it("依赖规则执行失败 → status: unavailable 且 **不得**当作通过（fail-closed）", () => {
        const out = runMachineVerifiers({
          pack: c.okPack(),
          ctx: makeCtx({ failedRules: [c.hitRule] }),
          verifierIds: [c.id],
        });
        const v = out.get(c.itemId);
        expect(v).toBeDefined();
        if (c.hitRule.startsWith("(")) {
          // 证据包类验证器没有 lint 依赖，用缺输入触发 unavailable（下一组用例覆盖）。
          return;
        }
        expect(v!.status).toBe("unavailable");
        expect(v!.supported).toBe(false);
      });
    });
  }
});

describe("G0 fail-closed：验证器缺输入时绝不返回通过", () => {
  it("citations.subset：无引用快照 → unavailable", () => {
    const out = runMachineVerifiers({
      pack: makePack(), // 未给 citationIntegrityOk
      ctx: makeCtx({}),
      verifierIds: ["citations.subset"],
    });
    expect(out.get("contract-review-v1/citations")?.status).toBe("unavailable");
    expect(out.get("contract-review-v1/citations")?.supported).toBe(false);
  });

  it("citations.subset：引用缺失 → 未覆盖（不是通过）", () => {
    const out = runMachineVerifiers({
      pack: makePack({ citationIntegrityOk: false, citationMissingIds: ["s9"] }),
      ctx: makeCtx({}),
      verifierIds: ["citations.subset"],
    });
    const v = out.get("contract-review-v1/citations");
    expect(v?.supported).toBe(false);
    expect(v?.status).toBe("ok");
  });

  it("citations.used：无来源记录 → unavailable", () => {
    const out = runMachineVerifiers({
      pack: makePack({ citations: [] }),
      ctx: makeCtx({}),
      verifierIds: ["citations.used"],
    });
    expect(out.get("compliance-dossier-v1/sources")?.status).toBe("unavailable");
  });

  it("citations.used：有来源未被引用 → 未覆盖", () => {
    const out = runMachineVerifiers({
      pack: makePack({ citations: [{ id: "s1", usedInHeadings: [] }] }),
      ctx: makeCtx({}),
      verifierIds: ["citations.used"],
    });
    expect(out.get("compliance-dossier-v1/sources")?.supported).toBe(false);
    expect(out.get("compliance-dossier-v1/sources")?.status).toBe("ok");
  });

  it("graph.authority_used：无图谱 → unavailable", () => {
    const out = runMachineVerifiers({
      pack: makePack({}),
      ctx: makeCtx({}),
      verifierIds: ["graph.authority_used"],
    });
    expect(out.get("demand-letter-v1/facts")?.status).toBe("unavailable");
  });

  it("graph.authority_used：争点无依据 → 未覆盖", () => {
    const out = runMachineVerifiers({
      pack: makePack({}),
      ctx: makeCtx({ graphIssues: [{ issue: "争点1", authorityIds: [], openQuestions: [] }] }),
      verifierIds: ["graph.authority_used"],
    });
    expect(out.get("demand-letter-v1/facts")?.supported).toBe(false);
  });

  it("未知验证器 id → 该项 unavailable（不是静默丢弃）", () => {
    const out = runMachineVerifiers({
      pack: makePack({}),
      ctx: makeCtx({}),
      verifierIds: ["not.a.real.verifier"],
    });
    expect(out.get("not.a.real.verifier")?.status).toBe("unavailable");
    expect(out.get("not.a.real.verifier")?.supported).toBe(false);
  });

  it("验证器抛错 → 该项 unavailable（绝不当作通过）", () => {
    const broken: MachineVerifyContext = makeCtx({});
    // 让 pack 变成畸形对象，触发验证器内部异常。
    const pack = makePack({}) as unknown as GuardianEvidencePack;
    (pack as { citations: unknown }).citations = null;
    const out = runMachineVerifiers({
      pack,
      ctx: broken,
      verifierIds: ["citations.used"],
    });
    expect(out.get("compliance-dossier-v1/sources")?.status).toBe("unavailable");
    expect(out.get("compliance-dossier-v1/sources")?.supported).toBe(false);
  });
});
