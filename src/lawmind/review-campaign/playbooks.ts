/**
 * Fleet playbook loader — Skills E2 / W21.
 * Bundled defaults live under workspace/lawmind/fleet-playbooks/ when present;
 * always fall back to in-repo DEFAULT_PLAYBOOKS so engine tests need no workspace.
 */

import fs from "node:fs";
import path from "node:path";
import type { FleetPlaybook, ReviewCampaignRoleId } from "./types.js";

const STANDARD_CONTRACT_REVIEW: FleetPlaybook = {
  id: "standard-contract-review",
  label: "标准合同审查专案组",
  version: 1,
  deliverableTypes: ["contract.review", "contract.general", "contract.nda", "contract.rental"],
  executionMode: "serial",
  roles: [
    {
      id: "clause",
      label: "条款结构",
      weight: 0.2,
      timeoutMs: 120_000,
      toolAllowlist: ["draft_document", "update_draft"],
      promptHint: "核对章节完整性、定义一致与交叉引用。",
    },
    {
      id: "risk",
      label: "风险与责任",
      weight: 0.3,
      timeoutMs: 120_000,
      toolAllowlist: ["draft_document", "research_task"],
      promptHint: "识别责任上限、违约、解除与高风险偏移。",
    },
    {
      id: "compliance",
      label: "合规",
      weight: 0.15,
      timeoutMs: 90_000,
      toolAllowlist: ["research_task"],
      promptHint: "核对强制规范、行业与数据保护相关条款缺口。",
    },
    {
      id: "obligation_timeline",
      label: "义务时间线",
      weight: 0.15,
      timeoutMs: 90_000,
      toolAllowlist: ["draft_document"],
      promptHint: "抽取履行期限、通知期与自动续期陷阱。",
    },
    {
      id: "citation_check",
      label: "引用核验",
      weight: 0.2,
      timeoutMs: 90_000,
      toolAllowlist: ["research_task"],
      promptHint: "核对高风险结论是否有来源或已标待核实。",
    },
  ],
};

const DEFAULT_PLAYBOOKS: FleetPlaybook[] = [STANDARD_CONTRACT_REVIEW];

function isRoleId(v: string): v is ReviewCampaignRoleId {
  return (
    v === "clause" ||
    v === "risk" ||
    v === "compliance" ||
    v === "obligation_timeline" ||
    v === "citation_check"
  );
}

function normalizePlaybook(raw: unknown): FleetPlaybook | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (!id || !label || !Array.isArray(o.roles) || o.roles.length === 0) {
    return null;
  }
  const roles = [];
  for (const r of o.roles) {
    if (!r || typeof r !== "object") {
      continue;
    }
    const rr = r as Record<string, unknown>;
    const rid = typeof rr.id === "string" ? rr.id : "";
    if (!isRoleId(rid)) {
      continue;
    }
    roles.push({
      id: rid,
      label: typeof rr.label === "string" ? rr.label : rid,
      weight: typeof rr.weight === "number" && rr.weight > 0 ? rr.weight : 0.1,
      timeoutMs: typeof rr.timeoutMs === "number" ? rr.timeoutMs : 90_000,
      toolAllowlist: Array.isArray(rr.toolAllowlist)
        ? rr.toolAllowlist.filter((x): x is string => typeof x === "string")
        : [],
      promptHint: typeof rr.promptHint === "string" ? rr.promptHint : "",
    });
  }
  if (roles.length < 4) {
    return null;
  }
  return {
    id,
    label,
    version: typeof o.version === "number" ? o.version : 1,
    deliverableTypes: Array.isArray(o.deliverableTypes)
      ? o.deliverableTypes.filter((x): x is string => typeof x === "string")
      : ["contract.review"],
    roles,
    executionMode: o.executionMode === "parallel" ? "parallel" : "serial",
  };
}

export function listBundledFleetPlaybooks(): FleetPlaybook[] {
  return DEFAULT_PLAYBOOKS.map((p) => structuredClone(p));
}

export function loadFleetPlaybooksFromWorkspace(workspaceDir: string): FleetPlaybook[] {
  const dir = path.join(workspaceDir, "lawmind", "fleet-playbooks");
  const byId = new Map<string, FleetPlaybook>();
  for (const p of DEFAULT_PLAYBOOKS) {
    byId.set(p.id, structuredClone(p));
  }
  if (!fs.existsSync(dir)) {
    return [...byId.values()];
  }
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      const pb = normalizePlaybook(raw);
      if (pb) {
        byId.set(pb.id, pb);
      }
    } catch {
      /* skip bad file */
    }
  }
  return [...byId.values()];
}

export function getFleetPlaybook(
  workspaceDir: string | null | undefined,
  playbookId: string,
): FleetPlaybook | null {
  const id = playbookId.trim();
  if (!id) {
    return null;
  }
  const list = workspaceDir
    ? loadFleetPlaybooksFromWorkspace(workspaceDir)
    : listBundledFleetPlaybooks();
  return list.find((p) => p.id === id) ?? null;
}

export function resolveDefaultPlaybookId(deliverableType?: string | null): string {
  const dt = (deliverableType ?? "").trim();
  if (dt.startsWith("contract")) {
    return "standard-contract-review";
  }
  return "standard-contract-review";
}
