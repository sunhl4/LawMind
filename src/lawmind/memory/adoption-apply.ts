/**
 * Apply a pending MemoryAdoptionRecord to durable workspace files.
 * Called from Inspector adopt — must not silent-write before this path.
 */

import fs from "node:fs";
import path from "node:path";
import { appendAssistantProfileMarkdown } from "../assistants/profile-md.js";
import { resolveLawMindRoot } from "../assistants/store.js";
import { applyReviewLabelFromAdoption } from "../learning/suggestion-queue.js";
import { writeStanceFromHabit } from "../stance/capture.js";
import type { MemoryAdoptionRecord } from "./adoption-service.js";
import { appendCaseSectionBullet } from "./case-writes.js";
import { writeExecutablePreference } from "./executable-preferences.js";
import { courtAndOpponentProfilePath, ensureClientProfile } from "./index.js";
import { appendLawyerProfileLearning } from "./lawyer-profile-learning.js";
import { appendClausePlaybookLearning } from "./playbook-learning.js";
import { appendSessionSummary } from "./session-summary.js";
import { defaultFirmProfileTemplate } from "./templates.js";

export type ApplyMemoryAdoptionResult = {
  written: string[];
  /**
   * 无落盘面时的如实原因。存在即表示本次 adopt 不宣称生效——
   * 服务层会把状态记为 recorded_noop 而非 adopted。
   */
  noopReason?: string;
};

function requireTarget(rec: MemoryAdoptionRecord, label: string): string {
  const id = rec.targetId?.trim();
  if (!id) {
    throw new Error(`${label}_target_required`);
  }
  return id;
}

/**
 * Persist adopted suggestion payload. Throws on hard failures so adopt stays pending.
 */
export async function applyMemoryAdoptionWrite(
  workspaceDir: string,
  rec: MemoryAdoptionRecord,
  opts?: { envFile?: string; auditDir?: string },
): Promise<ApplyMemoryAdoptionResult> {
  const written: string[] = [];
  const payload = rec.payload.trim();
  if (!payload) {
    return { written, noopReason: "empty_payload" };
  }

  switch (rec.kind) {
    case "lawyer.profile_learning": {
      await appendLawyerProfileLearning(workspaceDir, payload, "manual", {
        idempotencyKey: rec.id,
      });
      written.push("LAWYER_PROFILE.md");
      return { written };
    }
    case "assistant.profile_section": {
      const assistantId = requireTarget(rec, "assistant");
      const root = resolveLawMindRoot(workspaceDir, opts?.envFile);
      appendAssistantProfileMarkdown(root, assistantId, payload);
      written.push(`assistants/${assistantId}/PROFILE.md`);
      return { written };
    }
    case "case.progress": {
      const matterId = requireTarget(rec, "matter");
      const out = appendSessionSummary(workspaceDir, matterId, payload);
      if (!out.ok) {
        throw new Error(out.error);
      }
      written.push(`cases/${matterId}/session-summary.md`);
      // Short headline into CASE 进展，避免长文整段塞进 bullet
      const headline = payload
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#"))
        ?.replace(/^[-*]\s+/, "")
        .slice(0, 160);
      if (headline) {
        await appendCaseSectionBullet(workspaceDir, matterId, "## 8. 工作进展记录", headline, {
          mode: "append",
          timestamped: true,
        });
        written.push(`cases/${matterId}/CASE.md`);
      }
      return { written };
    }
    case "case.core_issue": {
      const matterId = requireTarget(rec, "matter");
      await appendCaseSectionBullet(workspaceDir, matterId, "## 4. 核心争点", payload, {
        mode: "merge",
        timestamped: false,
      });
      written.push(`cases/${matterId}/CASE.md`);
      return { written };
    }
    case "case.risk_note": {
      const matterId = requireTarget(rec, "matter");
      await appendCaseSectionBullet(workspaceDir, matterId, "## 7. 风险与待确认事项", payload, {
        mode: "merge",
        timestamped: false,
      });
      written.push(`cases/${matterId}/CASE.md`);
      return { written };
    }
    case "case.task_goal": {
      const matterId = requireTarget(rec, "matter");
      await appendCaseSectionBullet(workspaceDir, matterId, "## 6. 当前任务目标", payload, {
        mode: "merge",
        timestamped: false,
      });
      written.push(`cases/${matterId}/CASE.md`);
      return { written };
    }
    case "case.artifact": {
      const matterId = requireTarget(rec, "matter");
      await appendCaseSectionBullet(workspaceDir, matterId, "## 9. 生成产物", payload, {
        mode: "merge",
        timestamped: false,
      });
      written.push(`cases/${matterId}/CASE.md`);
      return { written };
    }
    case "playbook.clause_learning": {
      await appendClausePlaybookLearning(workspaceDir, payload);
      written.push("playbooks/CLAUSE_PLAYBOOK.md");
      return { written };
    }
    case "firm.preference": {
      const dest = path.join(workspaceDir, "FIRM_PROFILE.md");
      if (!fs.existsSync(dest)) {
        fs.writeFileSync(dest, defaultFirmProfileTemplate(), "utf8");
      }
      fs.appendFileSync(dest, `\n### 所内惯例（已确认）\n\n- ${payload.trim()}\n`, "utf8");
      written.push("FIRM_PROFILE.md");
      return { written };
    }
    case "historical.knowledge": {
      const dir = path.join(workspaceDir, "memory", "topics");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "historical-scan.md"), `${payload.trim()}\n\n`, "utf8");
      written.push("memory/topics/historical-scan.md");
      return { written };
    }
    case "lawyer.habit_pattern": {
      let stanceWritten = false;
      try {
        stanceWritten = Boolean(writeStanceFromHabit(workspaceDir, payload));
      } catch {
        throw new Error("stance_write_failed");
      }
      if (!stanceWritten) {
        throw new Error("stance_write_failed");
      }
      await appendLawyerProfileLearning(workspaceDir, payload, "manual", {
        idempotencyKey: rec.id,
      });
      writeExecutablePreference(workspaceDir, {
        id: rec.id,
        text: payload,
        tags: ["habit", "historical-scan"],
      });
      written.push("LAWYER_PROFILE.md");
      written.push("lawmind/lawyer-preferences.json");
      if (stanceWritten) {
        written.push("lawmind/stance/items.json");
      }
      return { written };
    }
    case "client.profile_note": {
      const clientId = requireTarget(rec, "client");
      const dest = await ensureClientProfile(workspaceDir, clientId);
      fs.appendFileSync(dest, `\n### 客户备注（已确认）\n\n- ${payload}\n`, "utf8");
      written.push(`clients/${clientId}/CLIENT_PROFILE.md`);
      return { written };
    }
    case "opponent.note": {
      const dest = courtAndOpponentProfilePath(workspaceDir);
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, "# 法院与对手画像\n", "utf8");
      }
      fs.appendFileSync(dest, `\n### 对手/法院备注（已确认）\n\n- ${payload}\n`, "utf8");
      written.push("playbooks/COURT_AND_OPPONENT_PROFILE.md");
      return { written };
    }
    case "project.note":
      // 项目级暂无持久化存储面（memory-target-path 对 project 返回 null）——如实 no-op。
      return { written, noopReason: "project 暂无落盘存储面，采纳仅记录决策" };
    case "review_label": {
      const auditDir = opts?.auditDir ?? path.join(workspaceDir, "audit");
      return applyReviewLabelFromAdoption(workspaceDir, auditDir, rec);
    }
    case "source.annotation":
      // 批注在创建时已落盘 source-annotations/annotations.jsonl，采纳仅作确认。
      return { written, noopReason: "批注已于创建时落盘 source-annotations/annotations.jsonl" };
    default:
      // 新增 kind 未配 writer 时必须如实标注，不得静默宣称已采纳。
      return { written, noopReason: `kind ${(rec as { kind: string }).kind} 无对应落盘 writer` };
  }
}
