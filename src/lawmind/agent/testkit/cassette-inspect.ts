/**
 * Inspect a captured chat.completions request body.
 * This is the cassette assertion surface: tools advertised, history text,
 * whether compact/steer rewrote the next round — not prompt copy.
 */

export type ChatCompletionsMessage = {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
  tool_call_id?: string;
};

export type ChatCompletionsRequestBody = {
  model?: string;
  stream?: boolean;
  messages?: ChatCompletionsMessage[];
  tools?: Array<{ type?: string; function?: { name?: string; description?: string } }>;
  tool_choice?: unknown;
  temperature?: number;
  max_tokens?: number;
};

export class ModelRequestSnapshot {
  constructor(
    readonly index: number,
    readonly rawBody: string,
    readonly body: ChatCompletionsRequestBody,
    readonly streamed: boolean,
  ) {}

  advertisedToolNames(): string[] {
    return (this.body.tools ?? [])
      .map((t) => t.function?.name ?? "")
      .filter((name) => name.length > 0);
  }

  hasAdvertisedTool(name: string): boolean {
    return this.advertisedToolNames().includes(name);
  }

  messages(): ChatCompletionsMessage[] {
    return this.body.messages ?? [];
  }

  messageCount(): number {
    return this.messages().length;
  }

  roles(): string[] {
    return this.messages().map((m) => m.role ?? "");
  }

  systemText(): string {
    return this.messages()
      .filter((m) => m.role === "system")
      .map((m) => m.content ?? "")
      .join("\n");
  }

  userTexts(): string[] {
    return this.messages()
      .filter((m) => m.role === "user")
      .map((m) => m.content ?? "")
      .filter((t) => t.length > 0);
  }

  allText(): string {
    const parts: string[] = [];
    for (const m of this.messages()) {
      if (typeof m.content === "string" && m.content) {
        parts.push(m.content);
      }
      for (const tc of m.tool_calls ?? []) {
        parts.push(tc.function?.name ?? "", tc.function?.arguments ?? "");
      }
    }
    return parts.join("\n");
  }

  contains(needle: string): boolean {
    return this.allText().includes(needle) || this.advertisedToolNames().includes(needle);
  }

  historyToolCallNames(): string[] {
    const names: string[] = [];
    for (const m of this.messages()) {
      for (const tc of m.tool_calls ?? []) {
        const name = tc.function?.name?.trim();
        if (name) {
          names.push(name);
        }
      }
    }
    return names;
  }
}

export function parseChatCompletionsBody(raw: string): ChatCompletionsRequestBody {
  try {
    return JSON.parse(raw) as ChatCompletionsRequestBody;
  } catch {
    return {};
  }
}

export function snapshotFromRawBody(index: number, rawBody: string): ModelRequestSnapshot {
  const body = parseChatCompletionsBody(rawBody);
  return new ModelRequestSnapshot(index, rawBody, body, body.stream === true);
}
