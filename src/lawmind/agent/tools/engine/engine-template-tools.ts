import {
  listBuiltInTemplates,
  listUploadedTemplates,
  registerUploadedTemplate,
  setUploadedTemplateEnabled,
} from "../../../templates/index.js";
import type { AgentTool } from "../../types.js";
import { asNonEmptyString, MAX_TEMPLATE_ID_LENGTH } from "./engine-tool-shared.js";

export const registerTemplate: AgentTool = {
  definition: {
    name: "register_template",
    description:
      "注册用户上传的 Word/PPT 模板，支持占位符映射、版本递增、启用状态管理。用于律所模板库维护。",
    category: "system",
    parameters: {
      id: { type: "string", description: "模板 ID，必须以 upload/ 开头", required: true },
      format: { type: "string", description: "模板格式：docx 或 pptx", required: true },
      label: { type: "string", description: "模板显示名称", required: true },
      source_path: { type: "string", description: "模板文件本地路径", required: true },
      enabled: { type: "boolean", description: "是否启用模板（默认 true）" },
      placeholder_map_json: {
        type: "string",
        description: '占位符映射 JSON 字符串，例如 {"case_title":"title"}',
      },
    },
    requiresApproval: true,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    try {
      const id = asNonEmptyString(params.id, "id", MAX_TEMPLATE_ID_LENGTH);
      const label = asNonEmptyString(params.label, "label", 100);
      const sourcePath = asNonEmptyString(params.source_path, "source_path", 1000);
      const formatRaw = asNonEmptyString(params.format, "format", 8).toLowerCase();
      if (formatRaw !== "docx" && formatRaw !== "pptx") {
        throw new Error("format 必须为 docx 或 pptx");
      }
      let placeholderMap: Record<string, string> = {};
      if (typeof params.placeholder_map_json === "string" && params.placeholder_map_json.trim()) {
        const parsed = JSON.parse(params.placeholder_map_json) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("placeholder_map_json 必须是对象 JSON");
        }
        placeholderMap = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]),
        );
      }
      const record = await registerUploadedTemplate({
        workspaceDir: ctx.workspaceDir,
        id,
        format: formatRaw,
        label,
        sourcePath,
        enabled: params.enabled !== false,
        placeholderMap,
      });
      return {
        ok: true,
        data: {
          id: record.id,
          format: record.format,
          label: record.label,
          version: record.version,
          enabled: record.enabled,
          uploadedAt: record.uploadedAt,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `模板注册失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const listTemplates: AgentTool = {
  definition: {
    name: "list_templates",
    description: "查看内置模板和已上传模板。用于任务前检查模板是否可用。如需变更启用状态请用 set_template_enabled。",
    category: "system",
    parameters: {},
  },
  async execute(_params, ctx) {
    try {
      const builtIn = listBuiltInTemplates();
      const uploaded = await listUploadedTemplates(ctx.workspaceDir);
      return {
        ok: true,
        data: {
          builtIn,
          uploaded,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `读取模板失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const setTemplateEnabled: AgentTool = {
  definition: {
    name: "set_template_enabled",
    description: "启用或停用某个已上传模板。会改变工作区模板库状态，需律师审批。",
    category: "system",
    parameters: {
      id: { type: "string", description: "要变更启用状态的上传模板 ID", required: true },
      enabled: { type: "boolean", description: "true 启用 / false 停用", required: true },
    },
    requiresApproval: true,
    riskLevel: "medium",
  },
  async execute(params, ctx) {
    try {
      if (typeof params.id !== "string" || !params.id.trim()) {
        throw new Error("id 必填");
      }
      if (typeof params.enabled !== "boolean") {
        throw new Error("enabled 必填且为布尔");
      }
      const rec = await setUploadedTemplateEnabled({
        workspaceDir: ctx.workspaceDir,
        id: params.id.trim(),
        enabled: params.enabled,
      });
      if (!rec) {
        return {
          ok: false,
          error: `未找到模板：${params.id.trim()}`,
        };
      }
      return {
        ok: true,
        data: {
          id: rec.id,
          enabled: rec.enabled,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: `变更模板启用状态失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
