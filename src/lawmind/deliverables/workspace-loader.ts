/**
 * Workspace-side DeliverableSpec loader.
 *
 * 事务所/客户在工作区放置 `<workspaceDir>/lawmind/deliverables/*.json` 即可
 * 注册私有交付物规范，无需修改源码。这是 LawMind "Firm / Private Deploy"
 * 商业化 edition 的核心扩展点（见 EDITION_FEATURES.customDeliverableSpec）。
 *
 * 文件格式：每个 JSON 对应一个 DeliverableSpec，字段约束：
 *   - type / displayName / description / defaultTemplateId 必填
 *   - defaultOutput: "docx" | "pptx" | "markdown"，默认 "docx"
 *   - defaultRiskLevel: "low" | "medium" | "high"，默认 "medium"
 *   - requiredSections: 至少 1 项；每项含 headingKeywords[] / purpose / severity
 *   - acceptanceCriteria: 字符串数组，可空
 *   - placeholderPattern: 可选字符串（正则源），默认 `【待补充[:：][^】]*】`
 *   - placeholderMustResolveBeforeRender: boolean，默认 false
 *   - defaultClarificationQuestions: 可空数组
 *
 * 解析失败的文件会被跳过并附带 warnings；调用方可决定是否阻断启动。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DeliverableType, RiskLevel } from "../types.js";
import type { DeliverableSpec, RequiredSection } from "./types.js";

/** 单个文件 JSON 表示形式（外部输入，宽松类型）。 */
type DeliverableSpecJson = {
  type?: unknown;
  displayName?: unknown;
  description?: unknown;
  defaultTemplateId?: unknown;
  defaultOutput?: unknown;
  defaultRiskLevel?: unknown;
  requiredSections?: unknown;
  acceptanceCriteria?: unknown;
  placeholderPattern?: unknown;
  placeholderMustResolveBeforeRender?: unknown;
  defaultClarificationQuestions?: unknown;
};

export type WorkspaceSpecWarning = {
  file: string;
  message: string;
};

export type WorkspaceSpecLoadResult = {
  /** 成功解析的规范 */
  specs: DeliverableSpec[];
  /** 解析失败 / 字段不合法的文件信息 */
  warnings: WorkspaceSpecWarning[];
};

/** 内置 5 类，扩展时禁用以避免 silent override 默认契约。 */
const RESERVED_BUILTIN_TYPES = new Set<string>([
  "contract.review",
  "contract.rental",
  "contract.general",
  "letter.demand",
  "document.general",
]);

const VALID_OUTPUT = new Set(["docx", "pptx", "markdown"]);
const VALID_RISK = new Set(["low", "medium", "high"]);
const VALID_SEVERITY = new Set(["blocker", "warning"]);

const DEFAULT_PLACEHOLDER_SOURCE = "【待补充[:：][^】]*】";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isNonEmptyString);
}

function compilePlaceholderPattern(source: unknown, fallback = DEFAULT_PLACEHOLDER_SOURCE): RegExp {
  const raw = isNonEmptyString(source) ? source : fallback;
  // 全局标志由 validator 保证，这里给保守默认。
  return new RegExp(raw, "g");
}

function parseRequiredSections(value: unknown): RequiredSection[] | string {
  if (!Array.isArray(value) || value.length === 0) {
    return "requiredSections 必须是非空数组";
  }
  const sections: RequiredSection[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    if (!raw || typeof raw !== "object") {
      return `requiredSections[${i}] 必须是对象`;
    }
    const obj = raw as Record<string, unknown>;
    const headingKeywords = asStringArray(obj.headingKeywords);
    if (headingKeywords.length === 0) {
      return `requiredSections[${i}].headingKeywords 必须是非空字符串数组`;
    }
    if (!isNonEmptyString(obj.purpose)) {
      return `requiredSections[${i}].purpose 必须是字符串`;
    }
    const severity = isNonEmptyString(obj.severity) ? obj.severity : "blocker";
    if (!VALID_SEVERITY.has(severity)) {
      return `requiredSections[${i}].severity 仅支持 blocker / warning`;
    }
    sections.push({
      headingKeywords,
      purpose: obj.purpose,
      severity: severity as RequiredSection["severity"],
    });
  }
  return sections;
}

function parseClarificationQuestions(
  value: unknown,
): DeliverableSpec["defaultClarificationQuestions"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
    .map((q) => ({
      key: isNonEmptyString(q.key) ? q.key : "info",
      question: isNonEmptyString(q.question) ? q.question : "请补充关键信息。",
      reason: isNonEmptyString(q.reason) ? q.reason : undefined,
    }));
}

/**
 * 从单个 JSON 对象构造 DeliverableSpec；返回字符串视为错误信息。
 * 公开导出便于上层（如 desktop 上传校验）复用。
 */
export function parseDeliverableSpec(json: DeliverableSpecJson): DeliverableSpec | string {
  if (!isNonEmptyString(json.type)) {
    return "缺少 `type` 字段（如 contract.employment）";
  }
  if (!isNonEmptyString(json.displayName)) {
    return "缺少 `displayName` 字段";
  }
  if (!isNonEmptyString(json.description)) {
    return "缺少 `description` 字段";
  }
  if (!isNonEmptyString(json.defaultTemplateId)) {
    return "缺少 `defaultTemplateId` 字段";
  }
  const defaultOutput = isNonEmptyString(json.defaultOutput) ? json.defaultOutput : "docx";
  if (!VALID_OUTPUT.has(defaultOutput)) {
    return `defaultOutput 仅支持 ${Array.from(VALID_OUTPUT).join(" / ")}`;
  }
  const defaultRiskLevel = isNonEmptyString(json.defaultRiskLevel)
    ? json.defaultRiskLevel
    : "medium";
  if (!VALID_RISK.has(defaultRiskLevel)) {
    return `defaultRiskLevel 仅支持 ${Array.from(VALID_RISK).join(" / ")}`;
  }
  const sections = parseRequiredSections(json.requiredSections);
  if (typeof sections === "string") {
    return sections;
  }
  return {
    type: json.type as DeliverableType,
    displayName: json.displayName,
    description: json.description,
    defaultTemplateId: json.defaultTemplateId,
    defaultOutput: defaultOutput as DeliverableSpec["defaultOutput"],
    defaultRiskLevel: defaultRiskLevel as RiskLevel,
    requiredSections: sections,
    acceptanceCriteria: asStringArray(json.acceptanceCriteria),
    placeholderRule: {
      pattern: compilePlaceholderPattern(json.placeholderPattern),
      mustResolveBeforeRender: json.placeholderMustResolveBeforeRender === true,
    },
    defaultClarificationQuestions: parseClarificationQuestions(json.defaultClarificationQuestions),
  };
}

/**
 * 扫描工作区下的 `lawmind/deliverables/*.json` 文件；返回成功解析的规范与警告。
 *
 * 设计取舍：
 *   - 目录不存在视为合法（事务所未启用扩展）。
 *   - 单个文件解析失败不阻断其他文件，避免一个坏文件导致整个 engine 起不来。
 *   - 调用方（engine bootstrap）决定如何上报 warnings（日志 / desktop notification）。
 */
export function loadWorkspaceDeliverableSpecs(workspaceDir: string): WorkspaceSpecLoadResult {
  const baseDir = path.join(workspaceDir, "lawmind", "deliverables");
  const result: WorkspaceSpecLoadResult = { specs: [], warnings: [] };
  if (!existsSync(baseDir)) {
    return result;
  }
  let stat;
  try {
    stat = statSync(baseDir);
  } catch (err) {
    result.warnings.push({
      file: baseDir,
      message: `无法读取目录：${(err as Error).message}`,
    });
    return result;
  }
  if (!stat.isDirectory()) {
    return result;
  }
  let files: string[];
  try {
    files = readdirSync(baseDir).filter((name) => name.toLowerCase().endsWith(".json"));
  } catch (err) {
    result.warnings.push({
      file: baseDir,
      message: `无法列出目录：${(err as Error).message}`,
    });
    return result;
  }
  files.sort((a, b) => a.localeCompare(b));
  const seen = new Set<string>();
  for (const name of files) {
    const fullPath = path.join(baseDir, name);
    let raw: string;
    try {
      raw = readFileSync(fullPath, "utf-8");
    } catch (err) {
      result.warnings.push({ file: fullPath, message: `无法读取：${(err as Error).message}` });
      continue;
    }
    let json: DeliverableSpecJson;
    try {
      json = JSON.parse(raw) as DeliverableSpecJson;
    } catch (err) {
      result.warnings.push({ file: fullPath, message: `JSON 解析失败：${(err as Error).message}` });
      continue;
    }
    const parsed = parseDeliverableSpec(json);
    if (typeof parsed === "string") {
      result.warnings.push({ file: fullPath, message: parsed });
      continue;
    }
    if (RESERVED_BUILTIN_TYPES.has(parsed.type) && !isOverrideAllowed(json)) {
      result.warnings.push({
        file: fullPath,
        message: `type "${parsed.type}" 是内置类型；如需覆盖请在 JSON 顶层加入 "overrideBuiltin": true。`,
      });
      continue;
    }
    if (seen.has(parsed.type)) {
      result.warnings.push({
        file: fullPath,
        message: `type "${parsed.type}" 已被其它文件注册，跳过。`,
      });
      continue;
    }
    seen.add(parsed.type);
    result.specs.push(parsed);
  }
  return result;
}

function isOverrideAllowed(json: DeliverableSpecJson): boolean {
  return (json as { overrideBuiltin?: unknown }).overrideBuiltin === true;
}
