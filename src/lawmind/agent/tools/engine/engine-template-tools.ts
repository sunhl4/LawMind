import { listBuiltInTemplates } from "../../../templates/index.js";
import type { AgentTool } from "../../types.js";
import { asNonEmptyString, MAX_TEMPLATE_ID_LENGTH } from "./engine-tool-shared.js";

const UPLOAD_RETIRED =
  "不再支持上传或启停自带文书模板。出稿请用内置模板；我们会在后台继续增加模板。";

/** @deprecated 上传已退役；保留工具名以免旧会话报「未知工具」，调用一律拒绝。 */
export const registerTemplate: AgentTool = {
  definition: {
    name: "register_template",
    description: "已退役：不再登记用户上传的 Word/PPT 模板。请改用内置模板。",
    category: "system",
    parameters: {
      id: { type: "string", description: "模板 ID（已无效）", required: true },
      format: { type: "string", description: "模板格式（已无效）", required: true },
      label: { type: "string", description: "显示名称（已无效）", required: true },
      source_path: { type: "string", description: "文件路径（已无效）", required: true },
      enabled: { type: "boolean", description: "是否启用（已无效）" },
      placeholder_map_json: {
        type: "string",
        description: "占位符映射（已无效）",
      },
    },
    requiresApproval: true,
    riskLevel: "medium",
  },
  async execute() {
    return { ok: false, error: UPLOAD_RETIRED };
  },
};

export const listTemplates: AgentTool = {
  definition: {
    name: "list_templates",
    description: "查看可用的内置文书模板（Word / PPT）。不再列出用户上传模板。",
    category: "system",
    parameters: {},
  },
  async execute() {
    try {
      const builtIn = listBuiltInTemplates();
      return {
        ok: true,
        data: {
          builtIn,
          uploaded: [],
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

/** @deprecated 上传已退役；保留工具名以免旧会话报「未知工具」，调用一律拒绝。 */
export const setTemplateEnabled: AgentTool = {
  definition: {
    name: "set_template_enabled",
    description: "已退役：不再启停用户上传的文书模板。",
    category: "system",
    parameters: {
      id: { type: "string", description: "模板 ID（已无效）", required: true },
      enabled: { type: "boolean", description: "启用状态（已无效）", required: true },
    },
    requiresApproval: true,
    riskLevel: "medium",
  },
  async execute(params) {
    // 仍校验参数形状，避免模型乱传时误以为工具坏了。
    asNonEmptyString(params.id, "id", MAX_TEMPLATE_ID_LENGTH);
    if (typeof params.enabled !== "boolean") {
      return { ok: false, error: "enabled 必填且为布尔" };
    }
    return { ok: false, error: UPLOAD_RETIRED };
  },
};
