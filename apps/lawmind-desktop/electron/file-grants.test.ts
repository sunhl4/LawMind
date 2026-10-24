/**
 * 本机文件按次授权（`file:<id>`）。
 *
 * 钉的是产品契约：律师让助手找到工作区外的文件时，那个文件要能打开、能改
 * （权限与工作区文件相同），但授权**只覆盖那一份文件**，且只在本次运行有效。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_FILE_GRANTS,
  createFileGrantStore,
  fileRootKeyFor,
  isDeniedFileGrantPath,
  readFileGrantRoots,
} from "./file-grants.mjs";

const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-file-grants-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function store(homeDir: string, secretDirs: string[] = []) {
  return createFileGrantStore({
    filePath: path.join(tmpDir(), "file-grants.json"),
    homeDir,
    secretDirs,
  });
}

describe("createFileGrantStore", () => {
  it("桌面上的真实文件得到根，roots() 给出它所在目录", () => {
    const home = tmpDir();
    const desktop = path.join(home, "Desktop");
    fs.mkdirSync(desktop, { recursive: true });
    const file = path.join(desktop, "查询意见_20261022_01.docx");
    fs.writeFileSync(file, "docx");

    const s = store(home);
    const granted = s.grant(file);
    expect(granted).toEqual({
      ok: true,
      root: fileRootKeyFor(file),
      rel: "查询意见_20261022_01.docx",
    });
    expect(s.roots()).toEqual({ [fileRootKeyFor(file)]: fs.realpathSync(desktop) });
  });

  it("文件不存在就说清楚，不登记", () => {
    const home = tmpDir();
    const s = store(home);
    const granted = s.grant(path.join(home, "Desktop", "没有.docx"));
    expect(granted.ok).toBe(false);
    expect(granted.error).toContain("不在磁盘上了");
    expect(s.size()).toBe(0);
  });

  it("目录不能当文件打开", () => {
    const home = tmpDir();
    const dir = path.join(home, "Desktop", "整个文件夹.docx");
    fs.mkdirSync(dir, { recursive: true });
    const granted = store(home).grant(dir);
    expect(granted.ok).toBe(false);
    expect(granted.error).toContain("不是文件");
  });

  it("相对路径直接拒绝（授权只认绝对路径）", () => {
    const granted = store(tmpDir()).grant("Desktop/a.docx");
    expect(granted.ok).toBe(false);
  });

  it("密钥与钥匙串一律拒绝，即使文件真的存在", () => {
    const home = tmpDir();
    const ssh = path.join(home, ".ssh");
    fs.mkdirSync(ssh, { recursive: true });
    // 故意用认识的交付后缀，确认拦住它的是拒绝名单而不是后缀。
    const key = path.join(ssh, "id_rsa.docx");
    fs.writeFileSync(key, "secret");
    const granted = store(home).grant(key);
    expect(granted.ok).toBe(false);
    expect(granted.error).toContain("密钥");
    expect(isDeniedFileGrantPath(key, { homeDir: home })).toBe(true);
  });

  it("LawMind 自己的数据目录（凭据、模型 key）不能开", () => {
    const home = tmpDir();
    const lawmindRoot = path.join(home, "Library", "Application Support", "LawMind");
    fs.mkdirSync(lawmindRoot, { recursive: true });
    const secret = path.join(lawmindRoot, "models.docx");
    fs.writeFileSync(secret, "keys");
    const s = store(home, [lawmindRoot]);
    expect(s.grant(secret).ok).toBe(false);
  });

  it("reset 之后没有授权（不会把上一次运行的点击变成长期读权限）", () => {
    const home = tmpDir();
    const desktop = path.join(home, "Desktop");
    fs.mkdirSync(desktop, { recursive: true });
    const file = path.join(desktop, "a.docx");
    fs.writeFileSync(file, "x");
    const s = store(home);
    expect(s.grant(file).ok).toBe(true);
    expect(Object.keys(s.roots())).toHaveLength(1);
    s.reset();
    expect(s.roots()).toEqual({});
    expect(readFileGrantRoots(s.filePath)).toEqual({});
  });

  it("交接单只读：本地服务进程按同一份 key→目录解析", () => {
    const home = tmpDir();
    const desktop = path.join(home, "Desktop");
    fs.mkdirSync(desktop, { recursive: true });
    const file = path.join(desktop, "意见书.docx");
    fs.writeFileSync(file, "x");
    const s = store(home);
    const granted = s.grant(file);
    expect(readFileGrantRoots(s.filePath)).toEqual({
      [granted.root]: fs.realpathSync(desktop),
    });
  });

  it("交接单坏了就等于没有授权（fail-closed）", () => {
    const filePath = path.join(tmpDir(), "file-grants.json");
    fs.writeFileSync(filePath, "{ not json");
    expect(readFileGrantRoots(filePath)).toEqual({});
  });

  it("已在工作区内的文件不登记外部根", () => {
    const home = tmpDir();
    const ws = path.join(home, "ws");
    fs.mkdirSync(ws, { recursive: true });
    const inside = path.join(ws, "案件.docx");
    fs.writeFileSync(inside, "x");
    const s = store(home);
    s.setKnownRoots([ws]);
    const refused = s.grant(inside);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("已经在工作区");
  });
});

describe("授权上限：到顶拒绝，不静默挤掉已有授权", () => {
  it("到上限后新的 grant 明确失败，已授权的都还在", () => {
    const home = tmpDir();
    const desk = path.join(home, "Desktop");
    fs.mkdirSync(desk, { recursive: true });
    const s = store(home);
    const granted: string[] = [];
    for (let i = 0; i < MAX_FILE_GRANTS; i += 1) {
      const abs = path.join(desk, `f-${i}.docx`);
      fs.writeFileSync(abs, "x");
      const row = s.grant(abs);
      expect(row.ok, `第 ${i + 1} 份应当授权成功（${row.error ?? ""}）`).toBe(true);
      if (row.ok && row.root) {
        granted.push(row.root);
      }
    }
    const extra = path.join(desk, "extra.docx");
    fs.writeFileSync(extra, "x");
    const refused = s.grant(extra);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("已到上限");
    // 关键：最早那条还在。以前会被静默删掉，那个标签下次保存就 404。
    expect(Object.keys(s.roots())).toHaveLength(MAX_FILE_GRANTS);
    for (const key of granted) {
      expect(Object.keys(s.roots())).toContain(key);
    }
  });

  it("释放后能腾出位置；重复释放与非法根无害", () => {
    const home = tmpDir();
    const desk = path.join(home, "Desktop");
    fs.mkdirSync(desk, { recursive: true });
    const s = store(home);
    const first = path.join(desk, "a.docx");
    fs.writeFileSync(first, "x");
    const row = s.grant(first);
    expect(row.ok).toBe(true);
    expect(s.release(row.root)).toBe(true);
    expect(s.roots()).toEqual({});
    expect(s.release(row.root)).toBe(false);
    expect(s.release("workspace")).toBe(false);
    expect(s.release(undefined)).toBe(false);
  });

  it("已授权的同一份文件再点一次：不重复占用名额", () => {
    const home = tmpDir();
    const desk = path.join(home, "Desktop");
    fs.mkdirSync(desk, { recursive: true });
    const file = path.join(desk, "a.docx");
    fs.writeFileSync(file, "x");
    const s = store(home);
    const first = s.grant(file);
    const second = s.grant(file);
    expect(second).toEqual(first);
    expect(s.size()).toBe(1);
  });
});
