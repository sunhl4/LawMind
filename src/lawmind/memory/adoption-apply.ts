/**
 * Apply a pending MemoryAdoptionRecord to durable workspace files.
 * Called from Inspector adopt — must not silent-write before this path.
 */

import fs from "node:fs";
import path from "node:path";
import { appendAssistantProfileMarkdown } from "../assistants/profile-md.js";
import { resolveLawMindRoot } from "../assistants/store.js";
import { writeStanceFromHabit } from "../stance/capture.js";
import type { MemoryAdoptionRecord } from "./adoption-service.js";
import { appendCaseSectionBullet } from "./case-writes.js";
import { writeExecutablePreference } from "./executable-preferences.js";
import { appendLawyerProfileLearning } from "./lawyer-profile-learning.js";
import { appendClausePlaybookLearning } from "./playbook-learning.js";
import { appendSessionSummary } from "./session-summary.js";

export type ApplyMemoryAdoptionResult = {
  written: string[];
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
  opts?: { envFile?: string },
): Promise<ApplyMemoryAdoptionResult> {
  const written: string[] = [];
  const payload = rec.payload.trim();
  if (!payload) {
    return { written };
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
    case "historical.knowledge": {
      const dir = path.join(workspaceDir, "memory", "topics");
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, "historical-scan.md"), `${payload.trim()}\n\n`, "utf8");
      written.push("memory/topics/historical-scan.md");
      return { written };
    }
    case "lawyer.habit_pattern": {
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
      try {
        if (writeStanceFromHabit(workspaceDir, payload)) {
          written.push("lawmind/stance/items.json");
        }
      } catch {
        /* stance is additive; adopt still succeeds */
      }
      return { written };
    }
    default:
      // Informational kinds without a durable writer yet — adopt still marks state.
      return { written };
  }
}
