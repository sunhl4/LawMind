import { describe, expect, it } from "vitest";
import { templatePreApprovableTools } from "../../agent/orchestrator/executor.js";
import { isWordRevisionTurn } from "../../platform/word-revision-instruction.js";
import {
  WORD_ADDIN_PREAPPROVE_TOOL_NAMES,
  buildWordAddinRedlineInstruction,
  buildWordAddinRedlineWorkflow,
  buildWordAddinRunAuthorization,
  matterIdFromWorkspacePath,
  needsHostDirGrant,
  resolveWordAddinMatterForSource,
} from "./auto-run.js";
import type { WordAddinReviewRequest } from "./review-requests.js";

const WORKSPACE = "/tmp/lm-ws";

describe("matterIdFromWorkspacePath", () => {
  it("reads the matter id out of cases/ and matters/ paths", () => {
    expect(matterIdFromWorkspacePath(WORKSPACE, `${WORKSPACE}/cases/甲案/materials/x.docx`)).toBe(
      "甲案",
    );
    expect(matterIdFromWorkspacePath(WORKSPACE, `${WORKSPACE}/cases/乙案`)).toBe("乙案");
    expect(matterIdFromWorkspacePath(WORKSPACE, `${WORKSPACE}/matters/丙案/doc.json`)).toBe("丙案");
  });

  it("returns undefined for anything outside those roots", () => {
    expect(matterIdFromWorkspacePath(WORKSPACE, "/Users/shl/Desktop/合同.docx")).toBeUndefined();
    expect(matterIdFromWorkspacePath(WORKSPACE, `${WORKSPACE}/artifacts/x.docx`)).toBeUndefined();
    expect(matterIdFromWorkspacePath(WORKSPACE, `${WORKSPACE}/cases`)).toBeUndefined();
  });
});

describe("resolveWordAddinMatterForSource", () => {
  it("uses the matter the lawyer already picked in Word", () => {
    const res = resolveWordAddinMatterForSource({
      workspaceDir: WORKSPACE,
      sourceAbs: "/Users/shl/Desktop/合同.docx",
      matterIds: ["甲案", "乙案"],
      requestedMatterId: "乙案",
    });
    expect(res).toEqual({ ok: true, matterId: "乙案", source: "requested" });
  });

  it("infers the matter when the file lives under cases/<id>/", () => {
    const res = resolveWordAddinMatterForSource({
      workspaceDir: WORKSPACE,
      sourceAbs: `${WORKSPACE}/cases/甲案/materials/合作协议.docx`,
      matterIds: ["甲案", "乙案"],
    });
    expect(res).toEqual({ ok: true, matterId: "甲案", source: "path" });
  });

  it("runs ad-hoc for a Desktop file instead of blocking on matter", () => {
    // 律师要的是「任何文件夹打开就能操作」：对不到案卷不能变成拦人。
    const res = resolveWordAddinMatterForSource({
      workspaceDir: WORKSPACE,
      sourceAbs: "/Users/shl/Desktop/常法单位【奥看】诉讼律师费收费说明.docx",
      matterIds: ["甲案", "乙案"],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matterId).toBeUndefined();
      expect(res.source).toBe("adhoc");
      const byName = (a: string, b: string): number => a.localeCompare(b);
      expect([...res.candidates].toSorted(byName)).toEqual(["甲案", "乙案"].toSorted(byName));
    }
  });

  it("ignores a requested matter that no longer exists but still runs ad-hoc", () => {
    const res = resolveWordAddinMatterForSource({
      workspaceDir: WORKSPACE,
      sourceAbs: "/Users/shl/Desktop/合同.docx",
      matterIds: ["甲案"],
      requestedMatterId: "已删除的案卷",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matterId).toBeUndefined();
    }
  });

  it("still runs ad-hoc when the workspace has no matters at all", () => {
    const res = resolveWordAddinMatterForSource({
      workspaceDir: WORKSPACE,
      sourceAbs: "/Users/shl/Desktop/合同.docx",
      matterIds: [],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matterId).toBeUndefined();
      expect(res.candidates).toEqual([]);
    }
  });
});

describe("buildWordAddinRedlineInstruction", () => {
  const instruction = buildWordAddinRedlineInstruction({
    sourceAbs: "/Users/shl/Desktop/某案/合作协议.docx",
    matterId: "甲案",
    instruction: "审查这份合同",
  });

  it("locks the turn into Word revision mode", () => {
    // 只断言纯判定：这个 chrome 必须让引擎进 Word 改稿锁（硬禁重建原件/外发）。
    expect(isWordRevisionTurn(instruction)).toBe(true);
    expect(isWordRevisionTurn("请审查这份合同")).toBe(false);
  });

  it("pins the absolute host path as the edit baseline", () => {
    expect(instruction).toContain("`/Users/shl/Desktop/某案/合作协议.docx`");
    expect(instruction).toContain("contract_edit_baseline_path");
  });

  it("tells the model not to ask, so an unattended run can actually finish", () => {
    // 反问会触发澄清门禁 → 这一步停住 → 不会 render → 律师在 Word 里只看到「没有结果」。
    expect(instruction).toContain("不要再问");
    expect(instruction).toContain("己方立场");
  });

  it("denies outbound tools in the wording the lock reads", () => {
    expect(instruction).toContain("prepare_outbound_mail");
    expect(instruction).toContain("send_email");
    expect(instruction).toContain("render_document");
  });
});

describe("buildWordAddinRedlineWorkflow", () => {
  const workflow = buildWordAddinRedlineWorkflow({
    workflowId: "word-addin-waddin-abc",
    matterId: "甲案",
    instruction: "【Word 改稿】\n审查这份合同",
  });

  it("is a single auto-approved step", () => {
    expect(workflow.steps).toHaveLength(1);
    expect(workflow.steps[0]).toMatchObject({
      stepId: "redline",
      autoApprove: true,
      dependsOn: [],
      status: "pending",
      assignee: "contract_review",
    });
    expect(workflow.matterId).toBe("甲案");
  });

  it("pre-approves the redline chain but never outbound mail", () => {
    expect(WORD_ADDIN_PREAPPROVE_TOOL_NAMES).toContain("apply_surgical_edits");
    expect(WORD_ADDIN_PREAPPROVE_TOOL_NAMES).toContain("render_tracked_draft");
    expect(workflow.preApproveToolNames).not.toContain("prepare_outbound_mail");
    expect(workflow.preApproveToolNames).not.toContain("send_email");
  });

  it("survives the executor's pre-approval whitelist without silent filtering", () => {
    // executor 会再过滤一次（TEMPLATE_PREAPPROVABLE_TOOLS）；名字写错了就会被静默丢掉，
    // 表现为「改稿链突然要批准」。这里锁住：我们声明的白名单必须原样通过。
    expect(templatePreApprovableTools([...WORD_ADDIN_PREAPPROVE_TOOL_NAMES])).toEqual([
      ...WORD_ADDIN_PREAPPROVE_TOOL_NAMES,
    ]);
    expect(templatePreApprovableTools([...WORD_ADDIN_PREAPPROVE_TOOL_NAMES])).not.toContain(
      "prepare_outbound_mail",
    );
  });
});

describe("buildWordAddinRunAuthorization", () => {
  const request = {
    id: "waddin-1",
    createdAt: "2026-09-20T03:00:00.000Z",
    updatedAt: "2026-09-20T03:00:00.000Z",
    state: "queued",
    sourcePath: "/Users/shl/Desktop/某案/合作协议.docx",
    fileName: "合作协议.docx",
    instruction: "审查这份合同",
    origin: "word-addin",
  } satisfies WordAddinReviewRequest;

  it("records who/when/what and the granted directory", () => {
    const auth = buildWordAddinRunAuthorization({
      request,
      actorId: "lawyer:desktop",
      matterId: "甲案",
      sourceHash: "abc123",
      grantedDir: "/Users/shl/Desktop/某案",
      at: new Date("2026-09-20T03:00:05.000Z"),
    });
    expect(auth).toEqual({
      at: "2026-09-20T03:00:05.000Z",
      actorId: "lawyer:desktop",
      // 请求上没登记来源 ⇒ 如实记 unknown，不猜（改造前连这一栏都没有）。
      clientId: "unknown",
      sourcePath: "/Users/shl/Desktop/某案/合作协议.docx",
      sourceHash: "abc123",
      grantedDir: "/Users/shl/Desktop/某案",
      matterId: "甲案",
      instruction: "审查这份合同",
    });
  });

  it("carries the source client from the request (who + from where)", () => {
    // 「谁」与「从哪来」必须成对：actorId 回答是谁，clientId 回答是 Word 还是桌面端。
    const auth = buildWordAddinRunAuthorization({
      request: { ...request, clientId: "word-addin" },
      actorId: "lawyer:desktop",
      matterId: "甲案",
      sourceHash: "abc123",
      grantedDir: "",
    });
    expect(auth.actorId).toBe("lawyer:desktop");
    expect(auth.clientId).toBe("word-addin");
  });

  it("lets an explicit clientId win over the one recorded on the request", () => {
    // 取件方若明确知道来源（例如人工重放），以显式传入的为准。
    const auth = buildWordAddinRunAuthorization({
      request: { ...request, clientId: "word-addin" },
      actorId: "lawyer:desktop",
      clientId: "renderer",
      matterId: "甲案",
      sourceHash: "abc123",
      grantedDir: "",
    });
    expect(auth.clientId).toBe("renderer");
  });

  it("records an empty grant when no host directory was needed", () => {
    const auth = buildWordAddinRunAuthorization({
      request,
      actorId: "a",
      matterId: "m",
      sourceHash: "h",
      grantedDir: "",
    });
    expect(auth.grantedDir).toBe("");
  });
});

describe("needsHostDirGrant", () => {
  it("is true for files outside the workspace", () => {
    expect(needsHostDirGrant(WORKSPACE, "/Users/shl/Desktop/合同.docx")).toBe(true);
    expect(needsHostDirGrant(WORKSPACE, `${WORKSPACE}/../elsewhere/合同.docx`)).toBe(true);
  });

  it("is false for files inside the workspace (no extra mount, same behaviour as a desk turn)", () => {
    expect(needsHostDirGrant(WORKSPACE, `${WORKSPACE}/cases/甲案/materials/合同.docx`)).toBe(false);
    expect(needsHostDirGrant(WORKSPACE, `${WORKSPACE}/合同.docx`)).toBe(false);
  });
});
