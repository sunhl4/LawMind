/**
 * 委托包（P1.3 第二阶段）：委托合同、授权委托书、风险告知、AI 使用告知、报价单。
 *
 * 这里的文本是**草案骨架**，不是可直接签署的定稿：
 * - 每份文件顶部都有「草案 · 须律师核对」横幅；
 * - 律所名称、律师、费用、付款安排等由律师填写，不替律师做商业或法律判断；
 * - 电子签只保留 manifest 里的占位，不接任何第三方签名服务；
 * - 已存在的文件默认不覆盖：律师改过的稿不能被一次重新生成冲掉。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadMatter } from "../adapters/matter-storage/index.js";
import { matterDir, writeFileAtomicAsync } from "../adapters/matter-storage/io.js";
import { isValidMatterId } from "../cases/matter-id.js";

export const ENGAGEMENT_DIRNAME = "收案";

const BANNER = "> 草案 · 由 LawMind 生成，须律师核对后使用。未核对不得对外发送。";

export const EngagementPackageInputSchema = z.object({
  clientName: z.string().trim().min(1).max(120),
  firmName: z.string().trim().max(120).optional(),
  lawyerName: z.string().trim().max(120).optional(),
  scope: z.string().trim().max(500).optional(),
  feeText: z.string().trim().min(1).max(500),
  paymentSchedule: z.string().trim().max(500).optional(),
  caseNo: z.string().trim().max(120).optional(),
  court: z.string().trim().max(120).optional(),
  riskNotes: z.array(z.string().trim().max(240)).max(12).optional(),
  date: z.string().trim().max(40).optional(),
});
export type EngagementPackageInput = z.infer<typeof EngagementPackageInputSchema>;

export type EngagementPackageFile = {
  name: string;
  relativePath: string;
  sha256: string;
  bytes: number;
};

export type EngagementPackageManifest = {
  schemaVersion: 1;
  matterId: string;
  generatedAt: string;
  draft: true;
  files: EngagementPackageFile[];
  esign: { status: "placeholder"; provider: null };
  /** DOCX 导出记录。Markdown 仍是真相源；重新导出会从当前 .md 重读。 */
  docx?: { generatedAt: string; files: EngagementPackageFile[] };
};

export type EngagementPackageError =
  | "invalid_matter_id"
  | "matter_not_found"
  | "missing_fields"
  | "exists"
  | "write_failed";

export type EngagementPackageResult =
  | { ok: true; manifest: EngagementPackageManifest }
  | { ok: false; error: EngagementPackageError; fields?: string[]; files?: string[] };

const FILE_NAMES = [
  "委托代理合同.md",
  "授权委托书.md",
  "风险告知书.md",
  "AI-使用告知与同意.md",
  "报价单.md",
] as const;

function fill(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  return trimmed || `【待填：${label}】`;
}

function bulletList(notes: string[] | undefined, fallback: string): string {
  const rows = (notes ?? []).map((note) => note.trim()).filter(Boolean);
  return (rows.length > 0 ? rows : [fallback]).map((note) => `- ${note}`).join("\n");
}

function buildDocuments(
  input: EngagementPackageInput,
  ctx: { matterTitle: string },
): Array<{ name: (typeof FILE_NAMES)[number]; body: string }> {
  const client = fill(input.clientName, "委托人");
  const firm = fill(input.firmName, "律所名称");
  const lawyer = fill(input.lawyerName, "承办律师");
  const scope = input.scope?.trim() || ctx.matterTitle || "【待填：委托事项】";
  const fee = fill(input.feeText, "律师费");
  const payment = fill(input.paymentSchedule, "付款安排");
  const date = fill(input.date, "签署日期");
  const caseNo = fill(input.caseNo, "案号（如适用）");
  const court = fill(input.court, "法院（如适用）");

  const contract = `# 委托代理合同（草案）

${BANNER}

委托人：${client}
受托人：${firm}
承办律师：${lawyer}
委托事项：${scope}
${input.caseNo ? `案号：${caseNo}\n` : ""}${input.court ? `法院：${court}\n` : ""}
## 一、委托事项与范围

1. 委托人委托受托人办理：${scope}。
2. 受托人指派 ${lawyer} 律师承办；受托人可安排其他律师或助理协助，但不改变承办责任。
3. 委托范围以本条为准；增加或变更事项应另行书面确认。

## 二、代理权限

1. 代理权限：${fill(undefined, "一般代理 / 特别授权（请律师勾选并写明）")}。
2. 特别授权包括承认、放弃、变更诉讼请求，进行和解、调解，提起反诉或上诉等，须逐项列明。

## 三、律师费与支付

1. 律师费：${fee}。
2. 付款安排：${payment}。
3. 差旅、鉴定、公证、诉讼费等由委托人另行承担，受托人应事先说明并保留凭证。

## 四、双方权利义务

1. 受托人应勤勉尽责，及时向委托人报告进展和风险。
2. 委托人应如实提供材料、及时确认方案，并保证材料来源合法。
3. 双方应遵守保密义务；受托人不得泄露委托人隐私和案件信息。

## 五、风险提示

${bulletList(
  input.riskNotes,
  "诉讼/非诉结果受证据、法律适用、裁判者和对方行为等多种因素影响，受托人不对结果作出承诺。",
)}

## 六、利益冲突与解除

1. 受托人应在接受委托前完成利益冲突检查；发现冲突的，应告知委托人并依法处理。
2. 任何一方解除合同，应按已完成工作结算费用；另有约定的从其约定。

## 七、争议解决

因本合同发生的争议，双方应协商解决；协商不成的，提交${fill(undefined, "约定的仲裁机构或法院")}处理。

## 八、签署

委托人（签字/盖章）：____________________
受托人（盖章）：____________________
承办律师：____________________
签署日期：${date}
`;

  const power = `# 授权委托书（草案）

${BANNER}

委托人：${client}
受托人：${firm}
承办律师：${lawyer}
案由/事项：${scope}
${input.caseNo ? `案号：${caseNo}\n` : ""}${input.court ? `法院：${court}\n` : ""}
## 授权事项

现委托上列受托人及其承办律师，在下列事项中担任委托人的代理人：

1. ${fill(undefined, "一审 / 二审 / 执行 / 非诉事项（请律师勾选）")}；
2. 代为提交、签收法律文书；
3. 代为参加庭审、调查、调解；
4. ${fill(undefined, "其他授权事项")}。

## 授权权限

${fill(undefined, "一般代理 / 特别授权（特别授权须逐项列明）")}。

## 期限

自签署之日起至${fill(undefined, "事项办结 / 特定期限")}止。

委托人（签字/盖章）：____________________
签署日期：${date}
`;

  const risk = `# 风险告知书（草案）

${BANNER}

致：${client}
事项：${scope}

## 一、结果不确定性

诉讼、仲裁、谈判或非诉事项的结果受证据、法律适用、裁判者判断、对方行为等多种因素影响。受托人及承办律师不对案件结果作出任何承诺。

## 二、证据与时效风险

1. 证据不足、证据形式不合法或关键证据缺失，可能导致主张不被支持。
2. 超过诉讼时效、除斥期间、上诉期、申请执行期等法定期限，可能丧失相应权利。
3. 委托人应如实、完整、及时提供材料；隐瞒或延误可能影响方案和结果。

## 三、费用与执行风险

1. 律师费、诉讼费、保全费、鉴定费、公证费、差旅费等由委托人按约定承担。
2. 即使胜诉，也可能因对方无财产可供执行而无法实际回款。

## 四、本案特别提示

${bulletList(input.riskNotes, "【待填：本案特别风险】")}

## 五、确认

委托人已阅读并理解上述风险，确认在充分知情的前提下委托。

委托人（签字/盖章）：____________________
日期：${date}
`;

  const ai = `# AI 使用告知与同意（草案）

${BANNER}

致：${client}
事项：${scope}

## 一、AI 的使用方式

为提升效率，受托人可能在材料整理、检索、初稿起草、格式核对等环节使用人工智能工具。AI 输出仅作为律师工作的辅助材料，不替代律师的专业判断。

## 二、人工复核

所有对外交付物均由承办律师 ${lawyer} 或受托人指定的律师复核后发出。AI 生成内容不会未经律师审核直接对外发送。

## 三、数据与保密

1. 受托人应按照保密义务和适用的数据保护要求处理委托人材料。
2. 受托人不会将委托人的敏感信息用于与本案无关的目的。
3. 如委托人对特定材料的使用有额外限制，应在下方写明。

## 四、委托人的选择

委托人同意 / 不同意（请律师勾选）在上述范围内使用 AI 工具辅助办理本案。不同意不影响受托人提供人工法律服务，但可能影响交付时间。

## 五、特别约定

${fill(undefined, "客户对 AI 使用的特别约定（如有）")}

委托人（签字/盖章）：____________________
日期：${date}
`;

  const quote = `# 报价单（草案）

${BANNER}

致：${client}
事项：${scope}
报价日期：${date}

| 项目 | 说明 | 金额/计费方式 |
| --- | --- | --- |
| 律师费 | ${fee} | ${fee} |
| 付款安排 | ${payment} | — |
| 差旅/鉴定/公证等 | 按实际发生 | 另行结算 |

## 说明

1. 本报价为草案，最终以双方签署的委托代理合同为准。
2. 报价有效期：${fill(undefined, "报价有效期")}。
3. 费用是否包含税费、是否分期，请律师补充。

受托人：${firm}
承办律师：${lawyer}
`;

  return [
    { name: FILE_NAMES[0], body: contract },
    { name: FILE_NAMES[1], body: power },
    { name: FILE_NAMES[2], body: risk },
    { name: FILE_NAMES[3], body: ai },
    { name: FILE_NAMES[4], body: quote },
  ];
}

export function engagementPackageDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), ENGAGEMENT_DIRNAME);
}

function manifestPath(workspaceDir: string, matterId: string): string {
  return path.join(engagementPackageDir(workspaceDir, matterId), "manifest.json");
}

export function loadEngagementPackage(
  workspaceDir: string,
  matterId: string,
): EngagementPackageManifest | undefined {
  try {
    const file = manifestPath(workspaceDir, matterId);
    if (!fs.existsSync(file)) {
      return undefined;
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as EngagementPackageManifest;
    if (raw?.schemaVersion !== 1 || !Array.isArray(raw.files)) {
      return undefined;
    }
    return raw;
  } catch {
    return undefined;
  }
}

/**
 * 生成委托包。默认不覆盖已有文件：律师可能已经在草案上改了条款。
 */
export async function writeEngagementPackage(
  workspaceDir: string,
  matterId: string,
  input: EngagementPackageInput,
  opts?: { overwrite?: boolean; now?: Date },
): Promise<EngagementPackageResult> {
  const id = matterId.trim();
  if (!isValidMatterId(id)) {
    return { ok: false, error: "invalid_matter_id" };
  }
  const matter = loadMatter(workspaceDir, id);
  if (!matter) {
    return { ok: false, error: "matter_not_found" };
  }
  const missing: string[] = [];
  if (!input.clientName.trim()) {
    missing.push("clientName");
  }
  if (!input.feeText.trim()) {
    missing.push("feeText");
  }
  if (missing.length > 0) {
    return { ok: false, error: "missing_fields", fields: missing };
  }
  const dir = engagementPackageDir(workspaceDir, id);
  const existing = FILE_NAMES.filter((name) => fs.existsSync(path.join(dir, name)));
  if (existing.length > 0 && opts?.overwrite !== true) {
    return { ok: false, error: "exists", files: existing };
  }
  const generatedAt = (opts?.now ?? new Date()).toISOString();
  const docs = buildDocuments(input, { matterTitle: matter.title });
  try {
    fs.mkdirSync(dir, { recursive: true });
    const files: EngagementPackageFile[] = [];
    for (const doc of docs) {
      const content = `${doc.body.trimEnd()}\n`;
      await writeFileAtomicAsync(path.join(dir, doc.name), content);
      files.push({
        name: doc.name,
        relativePath: path.relative(path.resolve(workspaceDir), path.join(dir, doc.name)),
        sha256: createHash("sha256").update(content, "utf8").digest("hex"),
        bytes: Buffer.byteLength(content, "utf8"),
      });
    }
    const manifest: EngagementPackageManifest = {
      schemaVersion: 1,
      matterId: id,
      generatedAt,
      draft: true,
      files,
      esign: { status: "placeholder", provider: null },
    };
    await writeFileAtomicAsync(
      manifestPath(workspaceDir, id),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return { ok: true, manifest };
  } catch {
    return { ok: false, error: "write_failed" };
  }
}
