/**
 * Deep research plan — breadth/depth question tree (GPT Researcher / STORM inspired).
 * Pure planning helper; does not fetch the network.
 */

import type { TaskIntent } from "../types.js";

export type ResearchPerspective =
  | "regulator"
  | "enforcement"
  | "business"
  | "comparative"
  | "practice";

export type ResearchPlanQuery = {
  id: string;
  perspective: ResearchPerspective;
  query: string;
  depth: number;
};

export type DeepResearchPlan = {
  topic: string;
  breadth: number;
  depth: number;
  perspectives: ResearchPerspective[];
  queries: ResearchPlanQuery[];
  notes: string[];
};

const PERSPECTIVE_LABEL: Record<ResearchPerspective, string> = {
  regulator: "立法与规范层级",
  enforcement: "执法与案例",
  business: "业务场景影响",
  comparative: "比较法 / 跨境对照",
  practice: "执业操作清单",
};

function topicFromIntent(intent: TaskIntent): string {
  const s = intent.summary?.trim();
  if (s && s.length <= 120) {
    return s;
  }
  const inst = (intent.instruction ?? "").trim().replace(/\s+/g, " ");
  return inst.slice(0, 120) || "未命名研究主题";
}

function pickPerspectives(intent: TaskIntent): ResearchPerspective[] {
  const text = `${intent.instruction ?? ""} ${intent.summary ?? ""}`;
  const out: ResearchPerspective[] = ["regulator", "practice"];
  if (/执法|处罚|案例|裁判|调查/.test(text)) {
    out.push("enforcement");
  }
  if (/客户|业务|合规项目|尽调|投融资/.test(text)) {
    out.push("business");
  }
  if (/跨境|涉外|欧盟|美国|香港|新加坡|比较/.test(text)) {
    out.push("comparative");
  }
  return [...new Set(out)];
}

export function buildDeepResearchPlan(
  intent: TaskIntent,
  opts?: { breadth?: number; depth?: number },
): DeepResearchPlan {
  const breadth = Math.min(6, Math.max(2, opts?.breadth ?? 4));
  const depth = Math.min(3, Math.max(1, opts?.depth ?? 2));
  const topic = topicFromIntent(intent);
  const perspectives = pickPerspectives(intent).slice(0, breadth);
  const queries: ResearchPlanQuery[] = [];
  let n = 0;
  for (const p of perspectives) {
    n += 1;
    queries.push({
      id: `q${n}`,
      perspective: p,
      query: `${topic} — ${PERSPECTIVE_LABEL[p]} 要点与权威来源`,
      depth: 1,
    });
    if (depth >= 2) {
      n += 1;
      queries.push({
        id: `q${n}`,
        perspective: p,
        query: `${topic} — ${PERSPECTIVE_LABEL[p]} 近期变化、争议点与 [VERIFY] 事项`,
        depth: 2,
      });
    }
  }
  return {
    topic,
    breadth,
    depth,
    perspectives,
    queries,
    notes: [
      "先执行问题树再写正文；不确定处标 [VERIFY]。",
      "新闻/博客不得写成现行法；优先官方与立法文本。",
    ],
  };
}

export function formatDeepResearchPlanMarkdown(plan: DeepResearchPlan): string {
  const lines = [
    `# 研究计划：${plan.topic}`,
    "",
    `广度 ${plan.breadth} · 深度 ${plan.depth}`,
    "",
    "## 视角",
    ...plan.perspectives.map((p) => `- ${PERSPECTIVE_LABEL[p]}`),
    "",
    "## 检索问题",
    ...plan.queries.map((q) => `- [${q.id}/d${q.depth}] ${q.query}`),
    "",
    "## 备注",
    ...plan.notes.map((n) => `- ${n}`),
  ];
  return lines.join("\n");
}
