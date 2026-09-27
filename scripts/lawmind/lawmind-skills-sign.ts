#!/usr/bin/env node
/**
 * Sign every Skill in a workspace with the current signing secret
 * (`pnpm lawmind:skills:sign`).
 *
 * 只签工作区副本。回合、read_skill 和工具披露不读这些副本，
 * 重签与否不改变律师交办时看到的作业标准。
 *
 * 用法：
 *   pnpm lawmind:skills:sign                      # 签 <repo>/workspace
 *   pnpm lawmind:skills:sign -- --workspace <dir> # 签指定工作区（如现场工作区）
 *   pnpm lawmind:skills:sign -- --check           # 只校验，不写盘
 *   pnpm lawmind:skills:sign -- --allow-derived   # 本地开发：允许用兜底密钥签
 *
 * 安全口径：默认**拒绝**用 `derived` 兜底密钥签名。它不是秘密（`sha256("lawmind-skill:"+路径)`），
 * 签出来的 `.sig` 只是「看起来可信」。要真签名就设 `LAWMIND_SKILL_SIGNING_SECRET`
 * （推荐：密钥放 workspace 之外，例如 `<userData>/LawMind/.env.lawmind`），
 * 或放 `<workspace>/lawmind/skills/.signing-secret`（该文件永不入库）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveSkillSigningSecretSource,
  signSkillBody,
  verifySkillSignature,
} from "../../src/lawmind/skills/skill-runtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i < 0) {
    return undefined;
  }
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

function main(): number {
  const check = process.argv.includes("--check");
  const allowDerived = process.argv.includes("--allow-derived");
  const workspaceDir = path.resolve(argValue("--workspace") ?? path.join(repoRoot, "workspace"));
  const skillsRoot = path.join(workspaceDir, "lawmind", "skills");

  if (!fs.existsSync(skillsRoot)) {
    console.error(`没有找到 Skills 目录：${skillsRoot}`);
    return 1;
  }

  const { secret, source } = resolveSkillSigningSecretSource(workspaceDir);
  if (source === "derived" && !allowDerived) {
    console.error(
      [
        '拒绝用「按路径派生」的兜底密钥签名：它不是秘密（sha256("lawmind-skill:" + 工作区路径)），',
        "签出来的 SKILL.sig 任何知道该路径的人都能伪造。",
        "",
        "要真签名，二选一：",
        "  1) 设 LAWMIND_SKILL_SIGNING_SECRET（推荐，密钥放工作区之外，例如 <userData>/LawMind/.env.lawmind）",
        `  2) 写 ${path.join(skillsRoot, ".signing-secret")}（该文件永不入库）`,
        "",
        "本地开发确实要用兜底值时加 --allow-derived。",
      ].join("\n"),
    );
    return 1;
  }

  const ids = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .toSorted();

  let signed = 0;
  let upToDate = 0;
  let failed = 0;

  for (const id of ids) {
    const skillPath = path.join(skillsRoot, id, "SKILL.md");
    const sigPath = path.join(skillsRoot, id, "SKILL.sig");
    if (!fs.existsSync(skillPath)) {
      continue;
    }
    const body = fs.readFileSync(skillPath, "utf8");
    const expected = signSkillBody(body, secret);
    const current = fs.existsSync(sigPath) ? fs.readFileSync(sigPath, "utf8").trim() : "";

    if (verifySkillSignature(body, current, secret).ok) {
      upToDate += 1;
      continue;
    }
    if (check) {
      console.error(`  ✗ ${id}  签名不通过（--check 不写盘）`);
      failed += 1;
      continue;
    }
    fs.writeFileSync(sigPath, `${expected}\n`, "utf8");
    console.log(`  ✓ ${id}`);
    signed += 1;
  }

  console.log(
    [
      "",
      `工作区 ${workspaceDir}`,
      `密钥来源 ${source}${source === "derived" ? "（兜底值：仅供本地开发）" : ""}`,
      check
        ? `校验：通过 ${upToDate}，不通过 ${failed}`
        : `签名：新签 ${signed}，原本有效 ${upToDate}${failed > 0 ? `，失败 ${failed}` : ""}`,
    ].join("\n"),
  );
  return failed > 0 ? 1 : 0;
}

process.exit(main());
