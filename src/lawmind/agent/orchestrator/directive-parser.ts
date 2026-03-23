/**
 * Directive parser — translates lawyer natural language into workflow definitions.
 *
 * Two modes:
 *   1. LLM-driven: sends the directive to a coordinator model that returns structured JSON
 *   2. Heuristic: pattern-matches common directive patterns (fallback)
 *
 * Example directives:
 *   "让合同审查助手检查这份合同，然后让诉讼策略助手评估风险"
 *   → two-step workflow with dependency (step 2 depends on step 1)
 */

import { randomUUID } from "node:crypto";
import { loadAssistantProfiles } from "../../assistants/store.js";
import type { AgentConfig, AgentModelConfig } from "../types.js";
import type {
  CollaborationWorkflow,
  WorkflowStep,
  ParsedDirective,
  ParsedDirectiveStep,
} from "./types.js";

/**
 * Heuristic directive parser — handles common Chinese-language collaboration patterns
 * without needing an LLM call.
 */
export function parseDirectiveHeuristic(
  directive: string,
  workspaceDir: string,
): ParsedDirective | undefined {
  const _lawMindRoot = workspaceDir.replace(/[\\/]workspace$/, "") || workspaceDir;

  const steps: ParsedDirectiveStep[] = [];

  // Sequential pattern: "让A做X，然后让B做Y" or "先让A做X，再让B做Y"
  const sequentialPatterns = [
    /(?:先)?让[「"']?(.+?)[」"']?(.+?)[，,](?:然后|再|接着|之后)让[「"']?(.+?)[」"']?(.+?)$/,
    /(?:先)?请[「"']?(.+?)[」"']?(.+?)[，,](?:然后|再|接着|之后)请[「"']?(.+?)[」"']?(.+?)$/,
  ];

  for (const pattern of sequentialPatterns) {
    const match = directive.match(pattern);
    if (match) {
      steps.push({
        assigneeHint: match[1]?.trim() ?? "",
        task: match[2]?.trim() ?? "",
        dependsOnHints: [],
      });
      steps.push({
        assigneeHint: match[3]?.trim() ?? "",
        task: match[4]?.trim() ?? "",
        dependsOnHints: [match[1]?.trim() ?? ""],
      });
      break;
    }
  }

  // Parallel pattern: "让A做X，同时让B做Y"
  if (steps.length === 0) {
    const parallelPatterns = [
      /让[「"']?(.+?)[」"']?(.+?)[，,](?:同时|并行|一起)让[「"']?(.+?)[」"']?(.+?)$/,
    ];
    for (const pattern of parallelPatterns) {
      const match = directive.match(pattern);
      if (match) {
        steps.push({
          assigneeHint: match[1]?.trim() ?? "",
          task: match[2]?.trim() ?? "",
          dependsOnHints: [],
        });
        steps.push({
          assigneeHint: match[3]?.trim() ?? "",
          task: match[4]?.trim() ?? "",
          dependsOnHints: [],
        });
        break;
      }
    }
  }

  // Simple single-assistant delegation: "让A做X"
  if (steps.length === 0) {
    const singlePatterns = [/让[「"']?(.+?)[」"']?(.+)$/, /请[「"']?(.+?)[」"']?(.+)$/];
    for (const pattern of singlePatterns) {
      const match = directive.match(pattern);
      if (match) {
        steps.push({
          assigneeHint: match[1]?.trim() ?? "",
          task: match[2]?.trim() ?? "",
          dependsOnHints: [],
        });
        break;
      }
    }
  }

  if (steps.length === 0) {
    return undefined;
  }

  return {
    name: directive.slice(0, 60),
    description: directive,
    steps,
  };
}

/**
 * LLM-driven directive parser — sends the directive to the model with a structured
 * output schema to produce a workflow definition.
 */
export async function parseDirectiveWithModel(
  directive: string,
  modelConfig: AgentModelConfig,
  workspaceDir: string,
): Promise<ParsedDirective | undefined> {
  const lawMindRoot = workspaceDir.replace(/[\\/]workspace$/, "") || workspaceDir;
  const profiles = loadAssistantProfiles(lawMindRoot);
  const assistantList = profiles.map((p) => `- ${p.assistantId}: ${p.displayName}`).join("\n");

  const systemPrompt = `你是一个工作流解析器。律师会给你一个指令，你需要将其拆解为多个步骤，每个步骤分配给一个助手。

可用助手：
${assistantList}

请返回 JSON 格式：
{
  "name": "工作流名称",
  "description": "工作流描述",
  "steps": [
    {
      "assigneeHint": "助手ID或名称",
      "task": "任务描述",
      "dependsOnHints": ["前序步骤的助手名称"],
      "reviewByHint": "审查助手名称（可选）"
    }
  ]
}

注意：
- 如果步骤之间有依赖关系（后者需要前者的结果），用 dependsOnHints 标明
- 如果步骤可以并行执行，dependsOnHints 留空数组
- assigneeHint 尽量匹配上面的助手名称或 ID`;

  const url = `${modelConfig.baseUrl.replace(/\/$/, "")}/chat/completions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${modelConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: directive },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = data.choices[0]?.message?.content ?? "";

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return undefined;
    }

    return JSON.parse(jsonMatch[0]) as ParsedDirective;
  } catch {
    return undefined;
  }
}

/**
 * Resolve assistant hints to actual assistant IDs.
 */
function resolveAssignee(hint: string, workspaceDir: string): string | undefined {
  const lawMindRoot = workspaceDir.replace(/[\\/]workspace$/, "") || workspaceDir;
  const profiles = loadAssistantProfiles(lawMindRoot);

  const byId = profiles.find((p) => p.assistantId === hint);
  if (byId) {
    return byId.assistantId;
  }

  const byName = profiles.find((p) => p.displayName === hint || p.displayName.includes(hint));
  return byName?.assistantId;
}

/**
 * Build a CollaborationWorkflow from a parsed directive.
 */
export function buildWorkflowFromDirective(
  parsed: ParsedDirective,
  workspaceDir: string,
  createdBy: string,
): CollaborationWorkflow {
  const now = new Date().toISOString();
  const stepMap = new Map<string, string>();

  const steps: WorkflowStep[] = parsed.steps.map((ps) => {
    const stepId = randomUUID();
    const assignee = resolveAssignee(ps.assigneeHint, workspaceDir) ?? ps.assigneeHint;
    stepMap.set(ps.assigneeHint, stepId);

    return {
      stepId,
      assignee,
      task: ps.task,
      dependsOn: [],
      reviewBy: ps.reviewByHint
        ? (resolveAssignee(ps.reviewByHint, workspaceDir) ?? ps.reviewByHint)
        : undefined,
      autoApprove: false,
      status: "pending" as const,
    };
  });

  // Resolve dependency hints to step IDs
  for (let i = 0; i < parsed.steps.length; i++) {
    const ps = parsed.steps[i];
    if (!ps) {
      continue;
    }
    for (const depHint of ps.dependsOnHints) {
      const depStepId = stepMap.get(depHint);
      if (depStepId && steps[i]) {
        steps[i].dependsOn.push(depStepId);
      }
    }
  }

  return {
    workflowId: randomUUID(),
    name: parsed.name,
    description: parsed.description,
    matterId: parsed.matterId,
    steps,
    status: "draft",
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Parse a lawyer directive and build a workflow, trying LLM first then heuristic fallback.
 */
export async function parseAndBuildWorkflow(params: {
  directive: string;
  baseConfig: AgentConfig;
  createdBy: string;
}): Promise<CollaborationWorkflow | undefined> {
  const { directive, baseConfig, createdBy } = params;

  // Try LLM-driven parsing first
  let parsed = await parseDirectiveWithModel(directive, baseConfig.model, baseConfig.workspaceDir);

  // Fallback to heuristic
  if (!parsed) {
    parsed = parseDirectiveHeuristic(directive, baseConfig.workspaceDir);
  }

  if (!parsed || parsed.steps.length === 0) {
    return undefined;
  }

  return buildWorkflowFromDirective(parsed, baseConfig.workspaceDir, createdBy);
}
