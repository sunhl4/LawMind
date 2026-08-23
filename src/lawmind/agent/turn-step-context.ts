/**
 * TurnContext is frozen for the whole runTurn.
 * StepContext is rebuilt each sampling round (pins, disclosed tools).
 */

import type { AgentPermissionMode } from "./permission-mode.js";
import { collectDisclosedToolNames, resolveModelToolNames } from "./tools/governance.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { AgentSession } from "./types.js";

export type TurnContext = {
  sessionId: string;
  turnId: string;
  permissionMode: AgentPermissionMode;
  matterId?: string;
  model: string;
  actorId: string;
  sandboxEnabled: boolean;
  allowNames?: string[];
};

export type StepContext = {
  toolNames: string[];
  pinIds: string[];
  worldStateEpoch: number;
};

export function freezeTurnContext(input: TurnContext): TurnContext {
  return {
    sessionId: input.sessionId,
    turnId: input.turnId,
    permissionMode: input.permissionMode,
    ...(input.matterId ? { matterId: input.matterId } : {}),
    model: input.model,
    actorId: input.actorId,
    sandboxEnabled: input.sandboxEnabled,
    ...(input.allowNames && input.allowNames.length > 0
      ? { allowNames: [...input.allowNames] }
      : {}),
  };
}

export function rebuildStepContext(opts: {
  session: AgentSession;
  registry: ToolRegistry;
  turnContext: TurnContext;
  pinIds?: string[];
}): StepContext {
  const disclosed = collectDisclosedToolNames(opts.session);
  opts.session.disclosedToolNames = disclosed;
  const toolNames = resolveModelToolNames({
    registeredNames: opts.registry.listDefinitions().map((def) => def.name),
    allowNames: opts.turnContext.allowNames,
    permissionMode: opts.turnContext.permissionMode,
    disclosedNames: disclosed,
  });
  return {
    toolNames,
    pinIds: opts.pinIds ? [...opts.pinIds] : [],
    worldStateEpoch: opts.session.worldStateEpoch ?? 0,
  };
}
