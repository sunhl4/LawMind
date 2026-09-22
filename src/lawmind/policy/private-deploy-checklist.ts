/**
 * Private Deploy checklist — automated subset for Doctor trust screen (E10 / G6).
 */

import fs from "node:fs";
import path from "node:path";
import { resolveEdition } from "./edition.js";
import { readWorkspacePolicyFile } from "./workspace-policy.js";

export type PrivateDeployCheckItem = {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
};

export function runPrivateDeployChecklist(workspaceDir: string): {
  applicable: boolean;
  items: PrivateDeployCheckItem[];
  passCount: number;
} {
  const policy = readWorkspacePolicyFile(workspaceDir);
  const edition = resolveEdition({ policy });
  const applicable = edition.edition === "private_deploy";
  const items: PrivateDeployCheckItem[] = [];

  const policyPath = path.join(workspaceDir, "lawmind.policy.json");
  items.push({
    id: "policy_file",
    label: "lawmind.policy.json 存在",
    ok: fs.existsSync(policyPath),
    detail: policyPath,
  });

  items.push({
    id: "edition_private",
    label: "edition = private_deploy",
    ok: edition.edition === "private_deploy",
    detail: edition.edition,
  });

  const allowlist = policy?.networkAllowlist;
  items.push({
    id: "network_allowlist",
    label: "联网 allowlist 已配置",
    ok: Array.isArray(allowlist) && allowlist.length > 0,
    detail: Array.isArray(allowlist) ? `${allowlist.length} 条` : "未配置",
  });

  items.push({
    id: "strict_dangerous_tools",
    label: "危险工具严格批准",
    ok: edition.features.strictDangerousToolApproval,
  });

  items.push({
    id: "compliance_export",
    label: "合规审计导出能力",
    ok: edition.features.complianceAuditExport,
  });

  const skillsRoot = path.join(workspaceDir, "lawmind", "skills");
  const secret = path.join(skillsRoot, ".signing-secret");
  items.push({
    id: "skill_signing_secret",
    label: "技能签名密钥文件（可选）",
    ok: fs.existsSync(secret) || !fs.existsSync(skillsRoot),
    detail: fs.existsSync(secret) ? "已配置" : "无 skills 或未配置（开发默认可接受）",
  });

  const passCount = items.filter((i) => i.ok).length;
  return { applicable, items, passCount };
}
