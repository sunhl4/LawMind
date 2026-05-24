import { createLegalToolRegistry } from "../../../src/lawmind/agent/tools/legal-tools.js";
import { toolRequiresExplicitApproval } from "../../../src/lawmind/agent/dangerous-tool-policy.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

export function handleToolsRegistryRoute({ ctx: _ctx, pathname, req, res, c }: LawmindRouteContext): boolean {
  if (!(pathname === "/api/tools/registry" && req.method === "GET")) {
    return false;
  }
  const registry = createLegalToolRegistry();
  const tools = registry.listDefinitions().map((toolDef) => {
    const name = toolDef.name;
    const tool = registry.get(name);
    const definition = tool?.definition;
    const requires = tool
      ? toolRequiresExplicitApproval({
          toolName: name,
          definition,
          allowDangerousToolsWithoutApproval: false,
          strictDangerousToolApproval: true,
        })
      : false;
    return {
      name,
      description: definition?.description ?? "",
      category: definition?.category ?? "other",
      requiresApproval: requires,
    };
  });
  sendJson(res, 200, { ok: true, tools }, c);
  return true;
}
