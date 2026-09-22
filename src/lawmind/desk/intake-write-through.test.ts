import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { createMatterIfMissing } from "../application/services/matter-write-service.js";
import { applyIntakeBrief, compileAndSaveIntakeBrief } from "./desk-apply.js";
import { loadIntakeBrief } from "./intake-brief.js";

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

describe("apply_intake_brief write-through", () => {
  it("promotes parties + cause into the same matter.json the workbench reads", async () => {
    const ws = tmp("lm-intake-through-");
    createMatterIfMissing(ws, { matterId: "m-through", title: "买卖合同纠纷" });
    await compileAndSaveIntakeBrief({
      workspaceDir: ws,
      matterId: "m-through",
      transcript:
        "委托人：张北县瑞霖乳制品有限公司。对方：某乳业集团有限公司。客户希望追回货款并主张违约金。",
    });
    // 确认前：卷宗不该被改（谈话稿尚未确认）。
    expect(loadMatter(ws, "m-through")?.parties ?? []).toHaveLength(0);

    const result = await applyIntakeBrief(ws, "m-through");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(loadIntakeBrief(ws, "m-through")?.confirmedAt).toBeTruthy();
    expect(result.promotion.promoted).toContain("当事人");

    const saved = loadMatter(ws, "m-through");
    expect(saved?.parties?.map((p) => `${p.role}:${p.name}`)).toEqual([
      "client:张北县瑞霖乳制品有限公司",
      "counterparty:某乳业集团有限公司",
    ]);
    // 工作台列表列就是 clientId / counterparty。
    expect(saved?.clientId).toBe("张北县瑞霖乳制品有限公司");
    expect(saved?.counterparty).toBe("某乳业集团有限公司");
  });

  it("does not overwrite a lawyer-entered cause or parties", async () => {
    const ws = tmp("lm-intake-keep-");
    createMatterIfMissing(ws, { matterId: "m-keep", title: "案" });
    const { updateMatterProfile } = await import("../application/services/matter-write-service.js");
    await updateMatterProfile(ws, {
      matterId: "m-keep",
      causeOfAction: "律师手填案由",
      parties: [{ partyId: "p-client", name: "律师手填委托人", role: "client" }],
    });
    await compileAndSaveIntakeBrief({
      workspaceDir: ws,
      matterId: "m-keep",
      transcript: "委托人：谈话里说的委托人。对方：某公司。",
    });
    const result = await applyIntakeBrief(ws, "m-keep");
    expect(result.ok).toBe(true);
    const saved = loadMatter(ws, "m-keep");
    expect(saved?.causeOfAction).toBe("律师手填案由");
    expect(saved?.parties?.find((p) => p.role === "client")?.name).toBe("律师手填委托人");
    // 新读到的对方仍被登记（不覆盖、也不丢）。
    expect(saved?.parties?.some((p) => p.role === "counterparty")).toBe(true);
  });
});
