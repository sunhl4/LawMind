import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../../../adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../../../application/services/matter-write-service.js";
import type { AgentContext } from "../../types.js";
import { createMatterTool, deleteMatterTool, updateMatterProfileTool } from "./desk-tools.js";

const temps: string[] = [];

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ctx(workspaceDir: string, extra?: Partial<AgentContext>): AgentContext {
  return {
    workspaceDir,
    sessionId: "sess-desk-tools",
    actorId: "lawyer",
    ...extra,
  };
}

describe("update_matter_profile", () => {
  it("writes parties[] and status into matter.json (same store as the workbench)", async () => {
    const ws = tmp("lm-desk-");
    createMatterIfMissing(ws, { matterId: "m-parties", title: "买卖合同纠纷" });
    const result = await updateMatterProfileTool.execute(
      {
        matter_id: "m-parties",
        status: "active",
        parties: [
          { name: "张北县瑞霖乳制品有限公司", role: "client", standing: "原告" },
          { name: "某乳业有限公司", role: "counterparty", standing: "被告" },
        ],
        case_no: "（2026）冀0722民初123号",
        court: "张北县人民法院",
        cause_of_action: "买卖合同纠纷",
      },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    const saved = loadMatter(ws, "m-parties");
    expect(saved?.status).toBe("active");
    expect(saved?.docket?.caseNo).toBe("（2026）冀0722民初123号");
    expect(saved?.docket?.court).toBe("张北县人民法院");
    expect(saved?.causeOfAction).toBe("买卖合同纠纷");
    expect(saved?.parties?.map((p) => `${p.role}:${p.name}`)).toEqual([
      "client:张北县瑞霖乳制品有限公司",
      "counterparty:某乳业有限公司",
    ]);
    // 当事人派生委托人/对方，工作台列表直接可读。
    expect(saved?.clientId).toBe("张北县瑞霖乳制品有限公司");
    expect(saved?.counterparty).toBe("某乳业有限公司");
  });

  it("records 标的金额 verbatim as a docket field (workbench 案件信息 reads it)", async () => {
    const ws = tmp("lm-desk-");
    createMatterIfMissing(ws, { matterId: "m-amount", title: "货款案" });
    const result = await updateMatterProfileTool.execute(
      { matter_id: "m-amount", claim_amount: "32,100 元" },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    // 照原文保存，不换算、不加总——金额表述多且可能分项，解析反而丢信息。
    expect(loadMatter(ws, "m-amount")?.docket?.claimAmount).toBe("32,100 元");
  });

  it("rejects unknown status values instead of writing them", async () => {
    const ws = tmp("lm-desk-");
    createMatterIfMissing(ws, { matterId: "m-status", title: "案" });
    const result = await updateMatterProfileTool.execute(
      { matter_id: "m-status", status: "bogus", court: "某法院" },
      ctx(ws),
    );
    expect(result.ok).toBe(true);
    const saved = loadMatter(ws, "m-status");
    expect(saved?.status).toBe("intake");
    expect(saved?.docket?.court).toBe("某法院");
  });
});

describe("create_matter", () => {
  it("tells the model to keep writing with the returned matter_id (no manual relink)", async () => {
    const ws = tmp("lm-desk-");
    const result = await createMatterTool.execute({ title: "新案件" }, ctx(ws));
    expect(result.ok).toBe(true);
    const data = result.data as { matterId?: string; message?: string };
    expect(data.matterId).toBeTruthy();
    expect(data.message).toContain(`matter_id="${data.matterId}"`);
    expect(data.message).not.toContain("请律师");
    // 后续写入可直接用返回的 matter_id。
    const follow = await updateMatterProfileTool.execute(
      { matter_id: data.matterId, court: "张北县人民法院" },
      ctx(ws),
    );
    expect(follow.ok).toBe(true);
    expect(loadMatter(ws, data.matterId!)?.docket?.court).toBe("张北县人民法院");
  });

  it("reuses an existing same-title matter instead of creating -2", async () => {
    const ws = tmp("lm-desk-");
    const first = await createMatterTool.execute(
      { title: "江苏岚江智能科技有限公司 常年法律顾问服务" },
      ctx(ws),
    );
    const second = await createMatterTool.execute(
      { title: "江苏岚江智能科技有限公司 常年法律顾问服务", matter_kind: "contract" },
      ctx(ws),
    );
    expect(first.ok && second.ok).toBe(true);
    const a = first.data as { matterId: string };
    const b = second.data as { matterId: string; reused?: boolean; message?: string };
    expect(b.reused).toBe(true);
    expect(b.matterId).toBe(a.matterId);
    expect(b.message).toContain("未另建");
  });
});

describe("delete_matter", () => {
  it("removes an empty shell and refuses the volume that still has materials", async () => {
    const ws = tmp("lm-desk-del-");
    const shell = "江苏岚江智能科技有限公司 常年法律顾问服务";
    const kept = "岚江留存卷";
    createMatterIfMissing(ws, { matterId: shell, title: shell });
    createMatterIfMissing(ws, {
      matterId: kept,
      title: "岚江采购框架协议审查",
      matterKind: "contract",
    });
    fs.mkdirSync(path.join(ws, "cases", kept, "materials", "岚江公司"), { recursive: true });
    fs.writeFileSync(path.join(ws, "cases", kept, "materials", "岚江公司", "常法合同.docx"), "x");
    fs.writeFileSync(path.join(ws, "lawmind.policy.json"), "{}\n");

    const refused = await deleteMatterTool.execute(
      { matter_id: kept, confirm_matter_id: kept },
      ctx(ws),
    );
    expect(refused.ok).toBe(false);
    expect(loadMatter(ws, kept)?.matterKind).toBe("contract");

    const mismatch = await deleteMatterTool.execute(
      { matter_id: shell, confirm_matter_id: kept },
      ctx(ws),
    );
    expect(mismatch.ok).toBe(false);
    expect(loadMatter(ws, shell)).toBeTruthy();

    const removed = await deleteMatterTool.execute(
      { matter_id: shell, confirm_matter_id: shell },
      ctx(ws),
    );
    expect(removed.ok).toBe(true);
    expect(loadMatter(ws, shell)).toBeUndefined();
    expect(
      fs.existsSync(path.join(ws, "cases", kept, "materials", "岚江公司", "常法合同.docx")),
    ).toBe(true);
    expect(fs.readFileSync(path.join(ws, "lawmind.policy.json"), "utf8")).toBe("{}\n");
  });

  it("refuses traversal-like matter ids before scanning", async () => {
    const ws = tmp("lm-desk-del-bad-");
    const bad = await deleteMatterTool.execute(
      { matter_id: "../etc", confirm_matter_id: "../etc" },
      ctx(ws),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toContain("不合法");
    }
  });
});
