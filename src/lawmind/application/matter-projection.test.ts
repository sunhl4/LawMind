import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { parseMatterDisplayNameFromCase } from "../cases/matter-label.js";
import { caseFilePath } from "../memory/index.js";
import { ensureMatterWithProjection } from "./matter-dual-write.js";
import { projectMatterToCaseMd } from "./matter-projection.js";
import { createMatterIfMissing } from "./services/matter-write-service.js";

describe("application/matter-projection", () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "lawmind-proj-"));
    await fs.mkdir(path.join(workspaceDir, "audit"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("ensureMatterWithProjection writes matter.json and CASE.md", async () => {
    await ensureMatterWithProjection(workspaceDir, {
      matterId: "m-dual",
      title: "双写测试案件",
    });
    expect(loadMatter(workspaceDir, "m-dual")?.title).toBe("双写测试案件");
    const caseRaw = await fs.readFile(caseFilePath(workspaceDir, "m-dual"), "utf8");
    expect(caseRaw).toContain("matterId: m-dual");
    expect(parseMatterDisplayNameFromCase(caseRaw)).toBe("双写测试案件");
    expect(caseRaw).toContain("当前阶段");
  });

  it("projectMatterToCaseMd updates display name when JSON title changes", async () => {
    createMatterIfMissing(
      workspaceDir,
      { matterId: "m-upd", title: "旧标题" },
      { projectCase: false },
    );
    const record = loadMatter(workspaceDir, "m-upd");
    expect(record).toBeDefined();
    await projectMatterToCaseMd(workspaceDir, { ...record!, title: "新标题" });
    const caseRaw = await fs.readFile(caseFilePath(workspaceDir, "m-upd"), "utf8");
    expect(parseMatterDisplayNameFromCase(caseRaw)).toBe("新标题");
  });

  it("projects causeOfAction and counterparty from JSON into CASE §1", async () => {
    createMatterIfMissing(
      workspaceDir,
      { matterId: "m-cause", title: "身份案件" },
      { projectCase: false },
    );
    const record = loadMatter(workspaceDir, "m-cause");
    expect(record).toBeDefined();
    await projectMatterToCaseMd(workspaceDir, {
      ...record!,
      causeOfAction: "买卖合同纠纷",
      counterparty: "乙公司",
    });
    const caseRaw = await fs.readFile(caseFilePath(workspaceDir, "m-cause"), "utf8");
    expect(caseRaw).toContain("案由: 买卖合同纠纷");
    expect(caseRaw).toContain("对方当事人: 乙公司");
  });

  it("writes a parse-empty placeholder when the lawyer clears identity fields", async () => {
    const { updateMatterProfile } = await import("./services/matter-write-service.js");
    const { parseMatterCaseProfileFields } = await import("../cases/matter-profile.js");
    await ensureMatterWithProjection(workspaceDir, {
      matterId: "m-clear",
      title: "清空身份",
    });
    await updateMatterProfile(workspaceDir, {
      matterId: "m-clear",
      causeOfAction: "买卖合同纠纷",
      counterparty: "乙公司",
    });
    await updateMatterProfile(workspaceDir, {
      matterId: "m-clear",
      causeOfAction: "",
      counterparty: "",
    });
    const caseRaw = await fs.readFile(caseFilePath(workspaceDir, "m-clear"), "utf8");
    expect(parseMatterCaseProfileFields(caseRaw).causeOfAction).toBeUndefined();
    expect(parseMatterCaseProfileFields(caseRaw).counterparty).toBeUndefined();
    expect(loadMatter(workspaceDir, "m-clear")?.causeOfAction).toBeUndefined();
  });
});
