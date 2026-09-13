/**
 * TestLawMindBuilder — LawMind's true-loop cassette harness.
 *
 * Contract (Codex test_codex, adapted):
 *   - Model bytes are scripted (JSON or SSE).
 *   - runTurn, tool pipeline, clarification, compact, steer, locks, approval are real.
 *   - Assert the next request body, not a Chinese sentence in system-prompt.ts.
 *
 * Shadow replay (`evaluation/shadow-engine-replay.ts`) stays the deliverable
 * regression layer (lint recall on real drafts). This harness is the admission
 * gate for turn-orchestrator / gate / compact / steer / tool-lock changes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ResumeRequiresActionInput } from "../../platform/requires-action.js";
import { resumeTurn, type ResumeTurnOpts } from "../runtime-resume.js";
import { runTurn, type RunTurnEvent } from "../runtime.js";
import { queuePendingSteer } from "../session-context-steer.js";
import { createSession, loadSession, saveSession } from "../session.js";
import { createLegalToolRegistry } from "../tools/legal-tools.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentConfig, AgentMessage, AgentSession, AgentTool } from "../types.js";
import type { ModelRequestSnapshot } from "./cassette-inspect.js";
import { startCassetteModelServer, type CassetteModelServer } from "./cassette-model-server.js";
import {
  lastDraftTaskIdFromRequestBody,
  resolveRuntimeTokens,
  type CassetteRound,
} from "./cassette-script.js";
import { createGateSpyRegistry, type GateSpyRegistry } from "./gate-spy-registry.js";

export type TestLawMindTurnOpts = {
  instruction: string;
  sessionId?: string;
  matterId?: string;
  permissionMode?: AgentConfig["permissionMode"];
  preApproveToolName?: string;
  preApproveToolArgs?: Record<string, unknown>;
  preApproveToolNames?: string[];
  contextPins?: import("../../platform/compose-context-pin.js").ComposeContextPin[];
  /** When set, production streams SSE from the cassette server. */
  onEvent?: (event: RunTurnEvent) => void;
  skipSessionTurnGate?: boolean;
};

export class TestLawMindBuilder {
  private registryFactory?: () => ToolRegistry;
  private useLegalTools = false;
  private permissionMode: AgentConfig["permissionMode"] | undefined;
  private allowWebSearch = false;
  private maxHistoryMessages: number | undefined;
  private maxToolCalls = 8;
  private configMutators: Array<(config: AgentConfig) => void> = [];
  private executeOverrides = new Map<string, AgentTool["execute"]>();

  withSpyTools(): this {
    this.useLegalTools = false;
    this.registryFactory = undefined;
    return this;
  }

  withLegalTools(): this {
    this.useLegalTools = true;
    this.registryFactory = undefined;
    return this;
  }

  withRegistry(registry: ToolRegistry | (() => ToolRegistry)): this {
    this.registryFactory = typeof registry === "function" ? registry : () => registry;
    this.useLegalTools = false;
    return this;
  }

  withToolExecute(name: string, execute: AgentTool["execute"]): this {
    this.executeOverrides.set(name, execute);
    return this;
  }

  withPermissionMode(mode: NonNullable<AgentConfig["permissionMode"]>): this {
    this.permissionMode = mode;
    return this;
  }

  withAllowWebSearch(allow = true): this {
    this.allowWebSearch = allow;
    return this;
  }

  withMaxHistory(n: number): this {
    this.maxHistoryMessages = n;
    return this;
  }

  withMaxToolCalls(n: number): this {
    this.maxToolCalls = n;
    return this;
  }

  withConfig(mutate: (config: AgentConfig) => void): this {
    this.configMutators.push(mutate);
    return this;
  }

  async build(): Promise<TestLawMind> {
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "lawmind-cassette-"));
    const dropWorkspace = (): void => {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    };
    fs.writeFileSync(path.join(workspaceDir, "MEMORY.md"), "# 通用记忆\n", "utf8");
    fs.writeFileSync(path.join(workspaceDir, "LAWYER_PROFILE.md"), "# 律师偏好\n", "utf8");

    try {
      let spy: GateSpyRegistry | undefined;
      let registry: ToolRegistry;
      if (this.registryFactory) {
        registry = this.registryFactory();
      } else if (this.useLegalTools) {
        registry = createLegalToolRegistry({ allowWebSearch: this.allowWebSearch });
      } else {
        spy = createGateSpyRegistry(
          this.allowWebSearch ? [{ name: "web_search", category: "search", riskLevel: "low" }] : [],
        );
        registry = spy.registry;
      }
      for (const [name, execute] of this.executeOverrides) {
        if (spy) {
          spy.setExecute(name, execute);
          continue;
        }
        const tool = registry.get(name);
        if (!tool) {
          throw new Error(`withToolExecute: ${name} is not registered`);
        }
        tool.execute = execute;
      }

      const server = await startCassetteModelServer({
        resolveValue: (value, rawBody) =>
          resolveRuntimeTokens(value, lastDraftTaskIdFromRequestBody(rawBody)),
      });
      try {
        const config: AgentConfig = {
          workspaceDir,
          maxToolCalls: this.maxToolCalls,
          maxHistoryMessages: this.maxHistoryMessages,
          allowWebSearch: this.allowWebSearch,
          permissionMode: this.permissionMode,
          model: {
            provider: "openai-compatible",
            baseUrl: server.url,
            apiKey: "sk-cassette",
            model: "cassette-scripted",
            timeoutMs: 15_000,
            maxRetries: 0,
          },
        };
        for (const mutate of this.configMutators) {
          mutate(config);
        }
        return new TestLawMind({ workspaceDir, config, registry, server, spy });
      } catch (err) {
        await server.close().catch(() => undefined);
        throw err;
      }
    } catch (err) {
      dropWorkspace();
      throw err;
    }
  }
}

export class TestLawMind {
  static builder(): TestLawMindBuilder {
    return new TestLawMindBuilder();
  }

  readonly workspaceDir: string;
  readonly config: AgentConfig;
  readonly registry: ToolRegistry;
  readonly events: RunTurnEvent[] = [];
  readonly spy?: GateSpyRegistry;
  private readonly server: CassetteModelServer;
  private sessionId: string | undefined;
  private closed = false;

  constructor(opts: {
    workspaceDir: string;
    config: AgentConfig;
    registry: ToolRegistry;
    server: CassetteModelServer;
    spy?: GateSpyRegistry;
  }) {
    this.workspaceDir = opts.workspaceDir;
    this.config = opts.config;
    this.registry = opts.registry;
    this.server = opts.server;
    this.spy = opts.spy;
  }

  get requests(): ModelRequestSnapshot[] {
    return this.server.requests;
  }

  remainingRounds(): number {
    return this.server.remaining();
  }

  enqueue(...rounds: CassetteRound[]): this {
    this.server.enqueue(...rounds);
    return this;
  }

  onModelRequest(handler: (req: ModelRequestSnapshot) => void | Promise<void>): this {
    this.server.onRequest(handler);
    return this;
  }

  queueSteer(text: string): this {
    const sessionId = this.sessionId;
    if (!sessionId) {
      throw new Error("queueSteer requires an active session (run a turn first, or seedHistory)");
    }
    queuePendingSteer(this.workspaceDir, sessionId, text);
    return this;
  }

  seedHistory(messages: AgentMessage[], opts?: { matterId?: string }): AgentSession {
    const existing = this.sessionId ? loadSession(this.workspaceDir, this.sessionId) : undefined;
    const session =
      existing ??
      createSession({
        workspaceDir: this.workspaceDir,
        actorId: "lawyer",
        matterId: opts?.matterId,
      });
    session.conversationHistory = messages;
    if (opts?.matterId) {
      session.matterId = opts.matterId;
    }
    saveSession(this.workspaceDir, session);
    this.sessionId = session.sessionId;
    return session;
  }

  session(): AgentSession | undefined {
    return this.sessionId ? loadSession(this.workspaceDir, this.sessionId) : undefined;
  }

  request(index = -1): ModelRequestSnapshot {
    const i = index < 0 ? this.requests.length + index : index;
    const snap = this.requests[i];
    if (!snap) {
      throw new Error(`cassette request ${index} does not exist (have ${this.requests.length})`);
    }
    return snap;
  }

  async runTurn(instruction: string, opts: Omit<TestLawMindTurnOpts, "instruction"> = {}) {
    const events: RunTurnEvent[] = [];
    const onEvent = opts.onEvent
      ? (event: RunTurnEvent) => {
          events.push(event);
          this.events.push(event);
          opts.onEvent?.(event);
        }
      : undefined;
    const result = await runTurn({
      config: this.config,
      registry: this.registry,
      instruction,
      sessionId: opts.sessionId ?? this.sessionId,
      matterId: opts.matterId,
      permissionMode: opts.permissionMode ?? this.config.permissionMode,
      preApproveToolName: opts.preApproveToolName,
      preApproveToolArgs: opts.preApproveToolArgs,
      preApproveToolNames: opts.preApproveToolNames,
      contextPins: opts.contextPins,
      onEvent,
      skipSessionTurnGate: opts.skipSessionTurnGate,
    });
    this.sessionId = result.sessionId;
    return { ...result, events };
  }

  async resume(input: ResumeRequiresActionInput, opts: ResumeTurnOpts = {}) {
    const result = await resumeTurn(this.config, this.registry, input, {
      ...opts,
      onEvent: opts.onEvent
        ? (event) => {
            this.events.push(event);
            opts.onEvent?.(event);
          }
        : undefined,
    });
    this.sessionId = result.sessionId;
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.server.close();
    for (let i = 0; i < 5; i += 1) {
      try {
        fs.rmSync(this.workspaceDir, { recursive: true, force: true });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 30 * (i + 1)));
      }
    }
  }
}

export async function withTestLawMind(
  configure: (builder: TestLawMindBuilder) => TestLawMindBuilder,
  fn: (harness: TestLawMind) => Promise<void>,
): Promise<void> {
  const harness = await configure(TestLawMind.builder()).build();
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
}
