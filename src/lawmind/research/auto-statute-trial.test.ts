import { describe, expect, it } from "vitest";
import type { MemoryContext } from "../memory/index.js";
import type { RetrievalAdapter } from "../retrieval/index.js";
import type { ResearchBundle, TaskIntent } from "../types.js";
import { runAutoStatuteTrial, shouldAutoTrialStatute } from "./auto-statute-trial.js";

const intent: TaskIntent = {
  taskId: "t-auto-law",
  kind: "analyze.contract",
  output: "docx",
  instruction: "审查采购合同违约金",
  summary: "审查采购合同违约金",
  riskLevel: "medium",
  models: ["legal"],
  requiresConfirmation: false,
  deliverableType: "contract.review",
  createdAt: new Date().toISOString(),
};

const emptyMemory: MemoryContext = {
  general: "",
  profile: "",
  firmProfile: "",
  caseMemory: "",
  matterStrategy: "",
  todayLog: "",
  yesterdayLog: "",
  clausePlaybook: "",
  courtAndOpponentProfile: "",
  clientProfile: "",
};

function emptyBundle(): ResearchBundle {
  return {
    taskId: intent.taskId,
    query: intent.summary,
    sources: [],
    claims: [],
    riskFlags: [],
    missingItems: [],
    requiresReview: false,
    completedAt: new Date().toISOString(),
  };
}

describe("auto-statute-trial", () => {
  it("skips mail and Word locks", () => {
    expect(shouldAutoTrialStatute({ intent, mailContractTurn: true })).toBe(false);
    expect(shouldAutoTrialStatute({ intent, wordRevisionTurn: true })).toBe(false);
    expect(shouldAutoTrialStatute({ intent })).toBe(true);
  });

  it("runs query-matrix terms through adapters and merges anchored hits", async () => {
    let query = "";
    const adapter: RetrievalAdapter = {
      name: "test-authority",
      supports: () => true,
      async retrieve({ intent: trialIntent }) {
        query = trialIntent.instruction;
        return {
          sources: [
            {
              id: "law-577",
              title: "中华人民共和国民法典第五百七十七条",
              kind: "statute",
              citation: "《民法典》第577条",
            },
          ],
          claims: [
            {
              text: "违约方应承担继续履行、补救或赔偿损失等责任。",
              sourceIds: ["law-577"],
              confidence: 0.9,
              model: "legal",
            },
          ],
          riskFlags: [],
          missingItems: [],
        };
      },
    };
    const result = await runAutoStatuteTrial({
      intent,
      bundle: emptyBundle(),
      memory: emptyMemory,
      adapters: [adapter],
    });
    expect(result.attempted).toBe(true);
    expect(query).toContain("违约金");
    expect(result.bundle.sources.map((source) => source.id)).toContain("law-577");
    expect(result.bundle.claims[0]?.sourceIds).toEqual(["law-577"]);
  });

  it("continues with an explicit gap when no adapter hits", async () => {
    const adapter: RetrievalAdapter = {
      name: "empty",
      supports: () => true,
      async retrieve() {
        return { sources: [], claims: [], riskFlags: [], missingItems: [] };
      },
    };
    const result = await runAutoStatuteTrial({
      intent,
      bundle: emptyBundle(),
      memory: emptyMemory,
      adapters: [adapter],
    });
    expect(result.attempted).toBe(true);
    expect(result.bundle.missingItems.join(" ")).toContain("法规自动试检无命中");
  });
});
