/**
 * 真实材料上的离线可判定探针（不调用模型、不花钱）。
 *
 * 目的：把「三条任务链」里**确定性的那两段**放到律师本机材料上跑一遍，回答
 * 「产物能不能打开、关键事实对不对、修订有没有丢」，而不是只用合成夹具。
 *
 *   - 改 Word：读取真实 .docx → 挑一处金额/日期做最短锚点改 → 导出带审阅痕迹
 *     的副本 → 复核 w:ins / w:del / 原文是否保留。
 *   - 多份合同抽取：真材料 → 真 review_table_update → 复核歧义格与出处。
 *
 * 需要模型的那段（正文成稿）在这里明确 SKIP，并说明原因；不拿假模型冒充成稿。
 */

import fs from "node:fs";
import path from "node:path";
import { applySurgicalEdits } from "../agent/tools/engine/apply-surgical-edits-tool.js";
import { renderTrackedDraft } from "../agent/tools/engine/engine-pipeline-tools.js";
import { readDocxText } from "../agent/tools/legal/ingest-helpers.js";
import { reviewTableUpdate } from "../agent/tools/legal/review-table-tool.js";
import type { AgentContext } from "../agent/types.js";
import { readReviewTable } from "../deliverables/review-table.js";
import { readDraft, persistDraft } from "../drafts/index.js";

export type ProbeStepResult = {
  step: string;
  status: "done" | "skipped" | "failed";
  detail?: string;
  ms?: number;
};

export type ProbeReport = {
  chain: string;
  status: "done" | "skipped" | "failed";
  steps: ProbeStepResult[];
  facts: Record<string, string | number | boolean | null>;
};

function now(): number {
  return Date.now();
}

function listMaterials(workspaceDir: string, matterId: string): string[] {
  const dir = path.join(workspaceDir, "cases", matterId, "materials");
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .map((name) => path.posix.join("cases", matterId, "materials", name))
    .toSorted();
}

/**
 * 改 Word 探针：需要材料夹里至少一份 .docx。
 * 锚点优先取「金额」里的数字串；没有金额时取第一个 4 位年份。
 */
export async function probeWordRevisionChain(opts: {
  workspaceDir: string;
  matterId: string;
  docxRelPath?: string;
  /** 保留探针产物（默认清理，避免在律师材料夹里留下副本）。 */
  keepArtifacts?: boolean;
}): Promise<ProbeReport> {
  const steps: ProbeStepResult[] = [];
  const facts: ProbeReport["facts"] = {};
  const materials = listMaterials(opts.workspaceDir, opts.matterId);
  const sourceDocx = opts.docxRelPath
    ? opts.docxRelPath
    : materials.find((rel) => rel.toLowerCase().endsWith(".docx"));
  if (!sourceDocx) {
    return {
      chain: "改 Word",
      status: "skipped",
      steps: [{ step: "找到 .docx 材料", status: "skipped", detail: "材料夹里没有 .docx" }],
      facts,
    };
  }
  facts.source = sourceDocx;

  /**
   * 探针不把副本写进律师的材料夹：先把原件复制到 `lawmind/probe/<ts>/`，
   * 再用副本当基线跑完整改稿链。这样既验证真实链路，也不污染案卷。
   */
  const probeDirRel = path.posix.join("lawmind", "probe", `word-${Date.now().toString(36)}`);
  let docx = path.posix.join(probeDirRel, path.posix.basename(sourceDocx));
  try {
    fs.mkdirSync(path.join(opts.workspaceDir, probeDirRel), { recursive: true });
    fs.copyFileSync(path.join(opts.workspaceDir, sourceDocx), path.join(opts.workspaceDir, docx));
    steps.push({ step: "复制到探针目录", status: "done", detail: `${sourceDocx} → ${docx}` });
  } catch (err) {
    steps.push({
      step: "复制到探针目录",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    return { chain: "改 Word", status: "failed", steps, facts };
  }
  facts.baseline = docx;

  let text = "";
  let readMs = 0;
  try {
    const started = now();
    text = await readDocxText(path.join(opts.workspaceDir, docx));
    readMs = now() - started;
    steps.push({
      step: "读取原文",
      status: text.trim().length > 0 ? "done" : "failed",
      detail: `${text.length} 字`,
      ms: readMs,
    });
  } catch (err) {
    steps.push({
      step: "读取原文",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    return { chain: "改 Word", status: "failed", steps, facts };
  }
  if (text.trim().length === 0) {
    return { chain: "改 Word", status: "failed", steps, facts };
  }

  const anchor = pickAnchor(text);
  facts.anchor = anchor?.find ?? null;
  facts.replacement = anchor?.replace ?? null;
  if (!anchor) {
    steps.push({ step: "挑最短锚点", status: "skipped", detail: "原文里没有可确定的数字锚点" });
    return { chain: "改 Word", status: "skipped", steps, facts };
  }

  const taskId = `probe-word-${Date.now().toString(36)}`;
  persistDraft(opts.workspaceDir, {
    taskId,
    matterId: opts.matterId,
    title: "改稿探针",
    summary: "离线探针：最短锚点改稿 + 带审阅痕迹导出",
    output: "docx",
    templateId: "document-general-default",
    deliverableType: "contract.review",
    sections: [],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
    contractEdit: { mode: "surgical", baselineRelativePath: docx },
  });

  const ctx = {
    workspaceDir: opts.workspaceDir,
    sessionId: "probe",
    matterId: opts.matterId,
    actorId: "probe",
    permissionMode: "standard",
  } as AgentContext;

  try {
    const started = now();
    const applied = await applySurgicalEdits.execute(
      {
        task_id: taskId,
        edits: [{ find: anchor.find, replace: anchor.replace }],
        craft_check: { deferred: [] },
        contract_edit_baseline_path: docx,
      },
      ctx,
    );
    const ms = now() - started;
    steps.push({
      step: "最短锚点落改",
      status: applied.ok ? "done" : "failed",
      detail: applied.ok ? "已落改" : (applied.error ?? "未落改"),
      ms,
    });
    if (!applied.ok) {
      return { chain: "改 Word", status: "failed", steps, facts };
    }
  } catch (err) {
    steps.push({
      step: "最短锚点落改",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    return { chain: "改 Word", status: "failed", steps, facts };
  }

  try {
    const started = now();
    const rendered = await renderTrackedDraft.execute({ task_id: taskId }, ctx);
    const ms = now() - started;
    const data = rendered.data as
      | { outputPath?: string; xmlQa?: { ok?: boolean; insCount?: number; delCount?: number } }
      | undefined;
    const outputPath = data?.outputPath ?? null;
    const outputExists = Boolean(outputPath && fs.existsSync(outputPath));
    facts.insCount = data?.xmlQa?.insCount ?? null;
    facts.delCount = data?.xmlQa?.delCount ?? null;
    facts.outputOpened = outputExists;
    steps.push({
      step: "导出审阅稿",
      status: rendered.ok && outputExists ? "done" : "failed",
      detail: rendered.ok
        ? `${path.basename(outputPath ?? "")}（修订 ${data?.xmlQa?.insCount ?? 0} 增 / ${data?.xmlQa?.delCount ?? 0} 删）`
        : (rendered.error ?? "导出失败"),
      ms,
    });
    // 副本内容未被“落改”改写（改的是草稿，导出才叠加修订）。
    const after = await readDocxText(path.join(opts.workspaceDir, docx));
    facts.baselineUnchanged = after === text;
    steps.push({
      step: "副本内容未被原地改写",
      status: after === text ? "done" : "failed",
      detail: after === text ? "原文逐字相同" : "副本被改写",
    });
    const draft = readDraft(opts.workspaceDir, taskId);
    facts.draftPersisted = Boolean(draft);
    const ok = rendered.ok && outputExists && after === text;
    if (!opts.keepArtifacts) {
      try {
        fs.rmSync(path.join(opts.workspaceDir, probeDirRel), { recursive: true, force: true });
        fs.rmSync(path.join(opts.workspaceDir, "drafts", `${taskId}.json`), { force: true });
        facts.artifactsKept = false;
        steps.push({ step: "清理探针产物", status: "done", detail: "案卷未被写入副本" });
      } catch {
        facts.artifactsKept = true;
      }
    } else {
      facts.artifactsKept = true;
      facts.outputPath = outputPath;
    }
    return { chain: "改 Word", status: ok ? "done" : "failed", steps, facts };
  } catch (err) {
    steps.push({
      step: "导出审阅稿",
      status: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    return { chain: "改 Word", status: "failed", steps, facts };
  }
}

/** 从正文里挑一个「短、唯一、语义上可替换」的锚点。 */
export function pickAnchor(text: string): { find: string; replace: string } | undefined {
  const amount = /(\d[\d,.]*)\s*(万元|元)/.exec(text);
  if (amount?.[1]) {
    const digits = amount[1];
    if (text.split(digits).length === 2) {
      const bump = digits.replace(/\d/g, (d, i) => (i === 0 ? String((Number(d) + 1) % 10) : d));
      return { find: digits, replace: bump === digits ? digits : bump };
    }
  }
  const year = /(19|20)\d{2}/.exec(text);
  if (year?.[0] && text.split(year[0]).length === 2) {
    const next = String(Number(year[0]) + 1);
    return { find: year[0], replace: next };
  }
  return undefined;
}

/** 多份合同抽取探针：真材料 → 真工具 → 复核歧义与出处。 */
export async function probeContractExtractionChain(opts: {
  workspaceDir: string;
  matterId: string;
}): Promise<ProbeReport> {
  const steps: ProbeStepResult[] = [];
  const facts: ProbeReport["facts"] = {};
  const materials = listMaterials(opts.workspaceDir, opts.matterId);
  facts.materials = materials.length;
  if (materials.length === 0) {
    return {
      chain: "多份合同比较",
      status: "skipped",
      steps: [{ step: "找到材料", status: "skipped", detail: "材料夹为空" }],
      facts,
    };
  }

  const taskId = `probe-extract-${Date.now().toString(36)}`;
  persistDraft(opts.workspaceDir, {
    taskId,
    matterId: opts.matterId,
    title: "抽取探针",
    summary: "离线探针：真材料批量抽取",
    output: "docx",
    templateId: "document-general-default",
    deliverableType: "document.general",
    sections: [{ heading: "结论与说明", body: "见审查表明细。", citations: [] }],
    reviewNotes: [],
    reviewStatus: "pending",
    createdAt: new Date().toISOString(),
  });

  const ctx = {
    workspaceDir: opts.workspaceDir,
    sessionId: "probe",
    matterId: opts.matterId,
    actorId: "probe",
    permissionMode: "standard",
  } as AgentContext;

  const template = await reviewTableUpdate.execute(
    { task_id: taskId, action: "set_template", template: "due_diligence" },
    ctx,
  );
  steps.push({ step: "建表", status: template.ok ? "done" : "failed", detail: template.error });
  if (!template.ok) {
    return { chain: "多份合同比较", status: "failed", steps, facts };
  }

  // 比较合同要的是可判定列：金额、日期、法院等各自映射到确定性模式。
  const columns = await reviewTableUpdate.execute(
    {
      task_id: taskId,
      action: "set_columns",
      columns: [
        { key: "document", label: "对应文件" },
        { key: "amount", label: "金额" },
        { key: "date", label: "日期" },
        { key: "court", label: "管辖法院" },
        { key: "source", label: "来源" },
      ],
    },
    ctx,
  );
  steps.push({
    step: "设抽取列",
    status: columns.ok ? "done" : "failed",
    detail: columns.error,
  });
  if (!columns.ok) {
    return { chain: "多份合同比较", status: "failed", steps, facts };
  }

  const started = now();
  const extracted = await reviewTableUpdate.execute(
    { task_id: taskId, action: "extract_batch" },
    ctx,
  );
  const ms = now() - started;
  const data = extracted.data as
    | {
        rowCount?: number;
        provenance?: { cells?: number; sourced?: number; abstained?: number };
        ambiguousCells?: unknown[];
      }
    | undefined;
  facts.rows = data?.rowCount ?? 0;
  facts.cells = data?.provenance?.cells ?? 0;
  facts.sourced = data?.provenance?.sourced ?? 0;
  facts.abstained = data?.provenance?.abstained ?? 0;
  facts.ambiguous = Array.isArray(data?.ambiguousCells) ? data.ambiguousCells.length : 0;
  steps.push({
    step: "批量抽取",
    status: extracted.ok ? "done" : "failed",
    detail: extracted.ok
      ? `${facts.rows} 行 · ${facts.cells} 格 · 有出处 ${facts.sourced} · 弃答 ${facts.abstained} · 歧义 ${facts.ambiguous}`
      : (extracted.error ?? "抽取失败"),
    ms,
  });

  const table = readReviewTable(opts.workspaceDir, taskId);
  const rowsWithSource =
    table?.rows.filter((row) => (row.source ?? "").trim().length > 0).length ?? 0;
  facts.rowsWithSource = rowsWithSource;
  steps.push({
    step: "逐行可追溯",
    status: rowsWithSource === facts.rows ? "done" : "failed",
    detail: `${rowsWithSource}/${facts.rows} 行带材料出处`,
  });

  const ok = extracted.ok && rowsWithSource === facts.rows;
  return { chain: "多份合同比较", status: ok ? "done" : "failed", steps, facts };
}

/** 需要模型的那条链：明确标注 SKIP，不伪造结果。 */
export function probeDraftChainWithoutModel(): ProbeReport {
  return {
    chain: "材料成稿",
    status: "skipped",
    steps: [
      {
        step: "正文成稿",
        status: "skipped",
        detail:
          "需要配置模型（BYOK）；离线探针不冒充模型写作。用 `pnpm lawmind:desktop` 在真机跑一遍。",
      },
    ],
    facts: {},
  };
}

export function listProbeMatters(
  workspaceDir: string,
): Array<{ matterId: string; materials: number }> {
  const casesDir = path.join(workspaceDir, "cases");
  if (!fs.existsSync(casesDir)) {
    return [];
  }
  return fs
    .readdirSync(casesDir)
    .filter((name) => !name.startsWith("."))
    .map((matterId) => ({ matterId, materials: listMaterials(workspaceDir, matterId).length }))
    .toSorted((a, b) => b.materials - a.materials);
}
