import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FS_ROOT_NOT_WRITABLE_CODE as MJS_ROOT_NOT_WRITABLE_CODE,
  MOUNT_WRITE_REFUSAL as MJS_MOUNT_REFUSAL,
  PROTECTED_WORKSPACE_WRITE_CODE as MJS_PROTECTED_CODE,
  PROTECTED_WORKSPACE_WRITE_REFUSAL as MJS_PROTECTED_REFUSAL,
  WRITABLE_ROOT_KEYS,
  assertWritableRoot,
  createFsBridge,
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
      // `.env` 家族：任意深度、任意后缀（`.env` / `.env.lawmind` / `.env.local` …）
      ".env",
      ".env.lawmind",
      ".env.local",
      ".env.production",
      ".ENV.LOCAL",
      "config/.env.local",
      "notes/.env.local.bak",
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
      ".git/hooks/pre-commit",
      ".git/config",
      "lawmind/skills/.signing-secret",
      // 正常数据面与近似名（两边都必须放行）
      "notes/分析.md",
      "drafts/t1.json",
      "drafts/t1.completion.json",
      "cases/m1/证据清单.md",
      "cases/m1/dms.json",
      // `.env` 家族的近似名：没有点后缀不算密钥文件
      "env.lawmind",
      ".envrc",
      ".environment",
      "artifacts/r1/report.md",
      "MEMORY.md",
      "LAWYER_PROFILE.md",
      "audits/x.json",
      "my-tasks/t1.json",
      "matters2/m1/matter.json",
      "notes/lawmind.policy.json.bak",
      "notes/.signing-secret.bak",
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

/**
 * 写保护的**执行点**覆盖。
 *
 * 回归背景：这五个写动词曾经只有 `fs:write` 查 `isProtectedWorkspaceRel`，
 * `mkdir / rename / delete / copy` 全都不查——渲染进程可以直接 `rm -r` 掉
 * `audit/`（审计链）、`sessions/`、`matters/`。而 `fs-bridge.test.ts` 当时只测了
 * 「分类函数两边算得一样」，**没有任何测试**去调那几个动词，所以漏洞一直绿着。
 *
 * 现在保护判定收进 `resolveFsPath` 的 write 分支（`assertProtectedWorkspaceWrite`），
 * 五个动词共用一个解析口，所以在这里按「动词 × 路径类别」参数化测。
 */
describe("write verbs share one protected-path gate", () => {
  const roots = () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lm-fsb-guard-")));
    return { workspace, map: { workspace } };
  };

  /** 建出一个真实的工作区骨架，让 destructive 分支能 stat / readdir。 */
  function seedWorkspace(workspace) {
    fs.mkdirSync(path.join(workspace, "audit"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "audit", "2026-09-24.jsonl"), "{}\n");
    fs.mkdirSync(path.join(workspace, "sessions"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "lawmind.policy.json"), "{}");
    fs.mkdirSync(path.join(workspace, "cases", "m1"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "cases", "m1", "RULES.md"), "# rules");
    fs.mkdirSync(path.join(workspace, "cases", "m1", "materials"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "cases", "m1", "materials", "证据.md"), "ok");
    fs.mkdirSync(path.join(workspace, "notes"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "notes", "分析.md"), "ok");
  }

  /** 五个写动词的调用形状（全部经由 resolveFsPath 的 write 分支）。 */
  const WRITE_VERBS = [
    {
      name: "fs:write",
      call: (bridge, target) =>
        bridge.resolveFsPath("workspace", target, { access: "write", allowRoot: false }),
    },
    {
      name: "fs:mkdir",
      call: (bridge, target) =>
        bridge.resolveFsPath("workspace", target, { access: "write", allowRoot: false }),
    },
    {
      name: "fs:delete",
      call: (bridge, target) =>
        bridge.resolveFsPath("workspace", target, {
          access: "write",
          mustExist: true,
          allowRoot: false,
          destructive: true,
        }),
    },
    {
      name: "fs:rename(from)",
      call: (bridge, target) =>
        bridge.resolveFsPath("workspace", target, {
          access: "write",
          mustExist: true,
          allowRoot: false,
          destructive: true,
        }),
    },
    {
      name: "fs:copy(to)",
      call: (bridge, target) =>
        bridge.resolveFsPath("workspace", target, { access: "write", allowRoot: false }),
    },
  ];

  /** 每个写动词都必须拒的路径：保护文件、保护前缀下的路径、保护目录的祖先。 */
  const MUST_REFUSE = [
    // 保护路径本身
    "lawmind.policy.json",
    "audit/2026-09-24.jsonl",
    "sessions/s1.json",
    "matters/m1/matter.json",
    "lawmind/mcp-servers.json",
    "RULES.md",
    "cases/m1/RULES.md",
    "cases/m1/.lawmind-dms.json",
    // 保护路径的**祖先目录**（删/改名会连带整棵子树）—— 这一批是最初漏掉的那类
    "audit",
    "sessions",
    "matters",
    "lawmind",
    "cases",
    "drafts",
    "drafts/t1.json",
  ];

  for (const verb of WRITE_VERBS) {
    it(`${verb.name} refuses protected paths and their ancestor directories`, () => {
      const { workspace, map } = roots();
      try {
        seedWorkspace(workspace);
        const bridge = createFsBridge(() => map);
        const leaked = MUST_REFUSE.filter((target) => {
          try {
            verb.call(bridge, target);
            return true;
          } catch (e) {
            return e?.code !== MJS_PROTECTED_CODE;
          }
        });
        expect(leaked).toEqual([]);
      } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });

    it(`${verb.name} still allows ordinary data-plane paths`, () => {
      // 防呆：守卫不能退化成「一律拒绝」，否则上面的断言也会通过。
      const { workspace, map } = roots();
      try {
        seedWorkspace(workspace);
        const bridge = createFsBridge(() => map);
        expect(() => verb.call(bridge, "notes/分析.md")).not.toThrow();
      } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
      }
    });
  }

  it("refuses deleting a directory that merely CONTAINS a protected file", () => {
    // 任意深度的 RULES.md 无法用前缀枚举，只能靠目录扫描。
    const { workspace, map } = roots();
    try {
      seedWorkspace(workspace);
      const bridge = createFsBridge(() => map);
      expect(() =>
        bridge.resolveFsPath("workspace", "cases/m1", {
          access: "write",
          mustExist: true,
          allowRoot: false,
          destructive: true,
        }),
      ).toThrow(MJS_PROTECTED_REFUSAL);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("allows deleting a directory with no protected content", () => {
    const { workspace, map } = roots();
    try {
      seedWorkspace(workspace);
      const bridge = createFsBridge(() => map);
      expect(() =>
        bridge.resolveFsPath("workspace", "cases/m1/materials", {
          access: "write",
          mustExist: true,
          allowRoot: false,
          destructive: true,
        }),
      ).not.toThrow();
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("does not apply the workspace protected list to the project root", () => {
    // 受保护清单是工作区相对的；project 根另有语义，保持原行为（与 /api/fs/write 同口径）。
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lm-fsb-ws-")));
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lm-fsb-pr-")));
    try {
      const bridge = createFsBridge(() => ({ workspace, project }));
      expect(() =>
        bridge.resolveFsPath("project", "audit/x.jsonl", { access: "write", allowRoot: false }),
      ).not.toThrow();
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
