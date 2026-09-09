import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactSection, AuditEvent } from "../../../../src/lawmind/types.ts";

export type ApiRequestInit = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

export type CreateMatterInput = {
  matterId: string;
  displayName?: string;
  conflictCheckConfirmed?: boolean;
  engagementAccepted?: boolean;
};

export type CreateDraftInput = {
  taskId?: string;
  matterId: string;
  title: string;
  summary?: string;
  sections?: ArtifactSection[];
  output?: "docx" | "pptx";
  deliverableType?: string;
};

export type DraftDetail = {
  ok: boolean;
  draft?: {
    taskId: string;
    matterId?: string;
    title: string;
    reviewStatus?: "pending" | "approved" | "rejected" | "modified";
    outputPath?: string;
  };
};

export type RenderResponse = {
  ok: boolean;
  outputPath?: string;
  error?: string;
};

export type ApprovalResponse = {
  ok: boolean;
  draft?: { reviewStatus?: string; outputPath?: string };
};

async function apiFetch<T>(
  apiBase: string,
  apiAuthToken: string,
  pathname: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const url = new URL(pathname, apiBase.replace(/\/$/, "")).toString();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(apiAuthToken ? { authorization: `Bearer ${apiAuthToken}` } : {}),
    ...init.headers,
  };
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.trim() ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = { ok: false, error: text };
  }
  if (!res.ok) {
    throw new Error(
      `API ${init.method ?? "GET"} ${pathname} failed: HTTP ${res.status} ${
        (body as { error?: string }).error ?? text
      }`,
    );
  }
  return body as T;
}

/**
 * 创建案件。
 */
export async function createMatter(
  apiBase: string,
  apiAuthToken: string,
  input: CreateMatterInput,
): Promise<{ matterId: string }> {
  return apiFetch<{ matterId: string }>(apiBase, apiAuthToken, "/api/matters/create", {
    method: "POST",
    body: {
      matterId: input.matterId,
      displayName: input.displayName,
      conflictCheckConfirmed: input.conflictCheckConfirmed ?? true,
      engagementAccepted: input.engagementAccepted ?? true,
    },
  });
}

/**
 * 通过测试路由直接创建草稿（mock 加速，避免等待真模型）。
 */
export async function createDraft(
  apiBase: string,
  apiAuthToken: string,
  input: CreateDraftInput,
): Promise<{ taskId: string; matterId: string; title: string }> {
  return apiFetch<{ taskId: string; matterId: string; title: string }>(
    apiBase,
    apiAuthToken,
    "/api/e2e/create-draft",
    {
      method: "POST",
      body: {
        taskId: input.taskId,
        matterId: input.matterId,
        title: input.title,
        summary: input.summary,
        sections: input.sections,
        output: input.output,
        deliverableType: input.deliverableType,
      },
    },
  );
}

/**
 * 签批草稿通过。
 */
export async function approveDraft(
  apiBase: string,
  apiAuthToken: string,
  taskId: string,
): Promise<ApprovalResponse> {
  return apiFetch<ApprovalResponse>(apiBase, apiAuthToken, `/api/drafts/${encodeURIComponent(taskId)}/review`, {
    method: "POST",
    body: { status: "approved", bypassChecklist: true },
  });
}

/**
 * 渲染草稿为 Word 交付物。
 * 使用 ?strict=false 绕过验收/推理门禁（E2E 测试路由，需 LAWMIND_ALLOW_RENDER_GATE_BYPASS=1）。
 */
export async function renderDraft(
  apiBase: string,
  apiAuthToken: string,
  taskId: string,
): Promise<RenderResponse> {
  const pathname = `/api/drafts/${encodeURIComponent(taskId)}/render?strict=false`;
  return apiFetch<RenderResponse>(apiBase, apiAuthToken, pathname, {
    method: "POST",
    body: {},
  });
}

/**
 * 获取草稿详情。
 */
export async function getDraftDetail(
  apiBase: string,
  apiAuthToken: string,
  taskId: string,
): Promise<DraftDetail> {
  return apiFetch<DraftDetail>(apiBase, apiAuthToken, `/api/drafts/${encodeURIComponent(taskId)}`);
}

/**
 * 触发本地服务崩溃（测试路由，需 LAWMIND_ENABLE_E2E_TEST_ROUTES=1）。
 * 调用后服务会干净退出，由 Electron 监督层自动重启。
 */
export async function crashServer(apiBase: string, apiAuthToken: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    await fetch(`${apiBase.replace(/\/$/, "")}/api/e2e/crash`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiAuthToken}`, "content-type": "application/json" },
      body: JSON.stringify({ reason: "e2e-crash-test" }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {
    // 服务退出会导致连接中断，属于预期行为
  }
}

/**
 * 读取工作区审计目录中所有事件。
 */
export async function readAuditEvents(workspaceDir: string): Promise<AuditEvent[]> {
  const auditDir = path.join(workspaceDir, "audit");
  let files: string[];
  try {
    files = (await fs.readdir(auditDir)).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const events: AuditEvent[] = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(auditDir, file), "utf8").catch(() => "");
    for (const line of content.split("\n").filter(Boolean)) {
      try {
        events.push(JSON.parse(line) as AuditEvent);
      } catch {
        // ignore malformed line
      }
    }
  }
  return events.toSorted((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * 等待直到审计目录中出现满足 predicate 的事件。
 */
export async function waitForAuditEvent(
  workspaceDir: string,
  predicate: (event: AuditEvent) => boolean,
  timeoutMs = 10_000,
): Promise<AuditEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await readAuditEvents(workspaceDir);
    const found = events.find(predicate);
    if (found) {
      return found;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Timeout waiting for audit event");
}

/**
 * 等待本地服务健康检查通过。
 */
export async function waitForHealth(
  apiBase: string,
  apiAuthToken: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/health`, {
        headers: apiAuthToken ? { authorization: `Bearer ${apiAuthToken}` } : {},
      });
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean };
        if (body.ok === true) {
          return;
        }
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server health check failed: ${lastError?.message ?? "timeout"}`);
}
