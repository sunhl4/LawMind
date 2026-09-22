import { describe, expect, it } from "vitest";
import {
  FS_ROOT_NOT_WRITABLE_CODE as MJS_ROOT_NOT_WRITABLE_CODE,
  MOUNT_WRITE_REFUSAL as MJS_MOUNT_REFUSAL,
  PROTECTED_WORKSPACE_WRITE_CODE as MJS_PROTECTED_CODE,
  PROTECTED_WORKSPACE_WRITE_REFUSAL as MJS_PROTECTED_REFUSAL,
  WRITABLE_ROOT_KEYS,
  assertWritableRoot,
  isProtectedWorkspaceRel as mjsIsProtectedWorkspaceRel,
} from "./fs-bridge.mjs";
import { MOUNT_WRITE_REFUSAL } from "../../../src/lawmind/host-access/access-broker.js";
import {
  PROTECTED_WORKSPACE_WRITE_CODE as PROTECTED_WRITE_CODE,
  PROTECTED_WORKSPACE_WRITE_REFUSAL as PROTECTED_WRITE_REFUSAL,
  isProtectedWorkspaceRel as tsIsProtectedWorkspaceRel,
} from "../../../src/lawmind/runtime/protected-workspace-rels.js";
import {
  FS_ROOT_NOT_WRITABLE_CODE,
  WRITABLE_FS_ROOTS,
} from "../server/lawmind-server-helpers.js";

/**
 * 跨进程常量镜像的漂移守卫。
 *
 * Electron 主进程是 .mjs，无法 import TS，所以受保护路径清单、拒写文案与可写根
 * 白名单都存在两份手抄实现。没有这层守卫时，只改一边不会有任何测试变红——
 * 结果是「引擎拒绝、桌面放行」这类最难查的不一致。
 */
describe("fs-bridge mirrors engine constants", () => {
  it("keeps the refusal messages identical", () => {
    expect(MJS_MOUNT_REFUSAL).toBe(MOUNT_WRITE_REFUSAL);
    expect(MJS_PROTECTED_REFUSAL).toBe(PROTECTED_WRITE_REFUSAL);
  });

  it("keeps the machine-readable codes identical", () => {
    expect(MJS_ROOT_NOT_WRITABLE_CODE).toBe(FS_ROOT_NOT_WRITABLE_CODE);
    expect(MJS_PROTECTED_CODE).toBe(PROTECTED_WRITE_CODE);
  });

  it("keeps the writable root allowlist identical", () => {
    expect([...WRITABLE_ROOT_KEYS].toSorted()).toEqual([...WRITABLE_FS_ROOTS].toSorted());
  });

  /**
   * 行为等价而不是解析源码：任何一边新增/删减条目，语料里必然有路径出现分歧。
   * 语料同时覆盖三个来源——精确名、前缀、任意深度 basename——以及否定例与大小写变体。
   */
  it("classifies protected paths identically to the engine", () => {
    const corpus = [
      // 精确名（含大小写变体）
      "lawmind.policy.json",
      "LawMind.policy.json",
      "LAWMIND.POLICY.JSON",
      ".env",
      ".env.lawmind",
      ".env.local",
      // 前缀
      "lawmind/mcp-servers.json",
      "lawmind/jobs/job-1.json",
      "Lawmind/Mcp.json",
      "audit/2026-09-20.jsonl",
      "sessions/s1.json",
      "tasks/t1.json",
      "matters/m1/matter.json",
      // 任意深度 basename
      "RULES.md",
      "cases/m1/RULES.md",
      "cases/m1/rules.md",
      ".lawmind-dms.json",
      "cases/m1/.lawmind-dms.json",
      "cases/m1/ethics-wall.json",
      "cases/m1/ETHICS-WALL.JSON",
      // 正常数据面与近似名（两边都必须放行）
      "notes/分析.md",
      "drafts/t1.json",
      "cases/m1/证据清单.md",
      "cases/m1/dms.json",
      "artifacts/r1/report.md",
      "MEMORY.md",
      "LAWYER_PROFILE.md",
      "audits/x.json",
      "my-tasks/t1.json",
      "matters2/m1/matter.json",
      "notes/lawmind.policy.json.bak",
      // 归一化
      "lawmind\\mcp-servers.json",
      "./audit/x.jsonl",
      "/tasks/t1.json",
    ];

    const mismatches = corpus.filter(
      (p) => mjsIsProtectedWorkspaceRel(p) !== tsIsProtectedWorkspaceRel(p),
    );
    expect(mismatches).toEqual([]);

    // 防止守卫本身退化成空洞断言：语料必须同时含有命中和不命中的样本，
    // 否则「两个函数都恒返回 false」也会让上面那行通过。
    const protectedCount = corpus.filter((p) => tsIsProtectedWorkspaceRel(p)).length;
    expect(protectedCount).toBeGreaterThan(0);
    expect(protectedCount).toBeLessThan(corpus.length);
  });
});

describe("assertWritableRoot", () => {
  it("allows the writable roots", () => {
    expect(() => assertWritableRoot("workspace")).not.toThrow();
    expect(() => assertWritableRoot("project")).not.toThrow();
  });

  it("rejects mounts with the mount-specific message", () => {
    expect(() => assertWritableRoot("mount:m1")).toThrow(MJS_MOUNT_REFUSAL);
  });

  it("fail-closes on unknown or missing roots", () => {
    // 新增根种类默认只读：必须显式加进 WRITABLE_ROOT_KEYS 才能写。
    expect(() => assertWritableRoot("grant:g1")).toThrow(/不可写的根/);
    expect(() => assertWritableRoot(undefined)).toThrow(/不可写的根/);
  });
});
