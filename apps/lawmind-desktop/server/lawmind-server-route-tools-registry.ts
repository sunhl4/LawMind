import { createLegalToolRegistry } from "../../../src/lawmind/agent/tools/legal-tools.js";
import { toolRequiresExplicitApproval } from "../../../src/lawmind/agent/dangerous-tool-policy.js";
import { listToolGovernanceMetadata } from "../../../src/lawmind/agent/tools/governance.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";
import { sendJson } from "./lawmind-server-helpers.js";

export function handleToolsRegistryRoute({ ctx: _ctx, pathname, req, res, c }: LawmindRouteContext): boolean {
  if (!(pathname === "/api/tools/registry" && req.method === "GET")) {
    return false;
  }
  const registry = createLegalToolRegistry();
  const governanceByName = new Map(
    listToolGovernanceMetadata(registry).map((metadata) => [metadata.name, metadata]),
  );
  const tools = registry.listDefinitions().map((toolDef) => {
    const name = toolDef.name;
    const tool = registry.get(name);
    const definition = tool?.definition;
    const governance = governanceByName.get(name);
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
      governance,
    };
  });
  sendJson(res, 200, { ok: true, tools, governance: [...governanceByName.values()] }, c);
  return true;
}
