/**
 * Tool registry — agent 的能力注册中心。
 *
 * 所有法律工具在此注册，agent runtime 按名称查找和调度。
 */

import type { AgentTool, ToolDefinition } from "../types.js";

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool already registered: ${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  listDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  listByCategory(category: ToolDefinition["category"]): ToolDefinition[] {
    return this.listDefinitions().filter((def) => def.category === category);
  }

  size(): number {
    return this.tools.size;
  }

  /**
   * 转换为 LLM function calling 格式。
   * 兼容 OpenAI chat completions API 的 tools 字段。
   */
  toOpenAITools(): Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required: string[];
      };
    };
  }> {
    return this.listDefinitions().map((def) => {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, schema] of Object.entries(def.parameters)) {
        properties[key] = {
          type: schema.type,
          description: schema.description,
          ...(schema.enum ? { enum: schema.enum } : {}),
        };
        if (schema.required) {
          required.push(key);
        }
      }
      return {
        type: "function" as const,
        function: {
          name: def.name,
          description: def.description,
          parameters: { type: "object" as const, properties, required },
        },
      };
    });
  }
}
