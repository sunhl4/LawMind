/**
 * TurnContext is frozen for the whole runTurn.
 * StepContext is rebuilt each sampling round (pins, disclosed tools).
 */

import {
  discoveryCountsShowDocumentRead,
  dropSaturatedDiscoveryTools,
} from "../runtime/tool-pipeline.js";
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
  /** When true, advertise exactly allowNames — no core catalog / list_more_tools. */
  lockToAllowNames?: boolean;
  /** File-page / dialog Word tracked-export — drop re-reads after a successful document read. */
  wordRevisionTurn?: boolean;
  /** Policy-hidden tools (e.g. run_analysis when allowAnalysisScripts is off). */
  hiddenToolNames?: string[];
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
    ...(input.lockToAllowNames ? { lockToAllowNames: true } : {}),
    ...(input.wordRevisionTurn ? { wordRevisionTurn: true } : {}),
    ...(input.hiddenToolNames && input.hiddenToolNames.length > 0
      ? { hiddenToolNames: [...input.hiddenToolNames] }
      : {}),
  };
}

export function rebuildStepContext(opts: {
  session: AgentSession;
  registry: ToolRegistry;
  turnContext: TurnContext;
  pinIds?: string[];
  /** Successful discovery counts this turn (failed discovery is decremented). */
  discoveryCallCounts?: Record<string, number>;
}): StepContext {
  const disclosed = collectDisclosedToolNames(opts.session);
  opts.session.disclosedToolNames = disclosed;
  const hidden = new Set(opts.turnContext.hiddenToolNames ?? []);
  const advertised = resolveModelToolNames({
    registeredNames: opts.registry.listDefinitions().map((def) => def.name),
    allowNames: opts.turnContext.allowNames,
    permissionMode: opts.turnContext.permissionMode,
    disclosedNames: disclosed,
    lockToAllowNames: opts.turnContext.lockToAllowNames === true,
  }).filter((name) => !hidden.has(name));
  const dropDocumentReaders =
    opts.turnContext.wordRevisionTurn === true &&
    discoveryCountsShowDocumentRead(opts.discoveryCallCounts);
  const toolNames = dropSaturatedDiscoveryTools(advertised, opts.discoveryCallCounts, {
    dropDocumentReaders,
  });
  return {
    toolNames,
    pinIds: opts.pinIds ? [...opts.pinIds] : [],
    worldStateEpoch: opts.session.worldStateEpoch ?? 0,
  };
}
