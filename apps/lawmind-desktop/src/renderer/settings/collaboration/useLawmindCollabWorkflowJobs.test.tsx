/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGetJson: vi.fn(),
  apiSendJson: vi.fn(),
  apiPost: vi.fn(),
  openJobEventStream: vi.fn(),
}));

vi.mock("../../api-client.js", () => ({
  apiGetJson: (...args: unknown[]) => mocks.apiGetJson(...args),
  apiSendJson: (...args: unknown[]) => mocks.apiSendJson(...args),
  errorMessage: (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback),
}));
vi.mock("../../lawmind-api-routes.ts", () => ({
  apiPost: (...args: unknown[]) => mocks.apiPost(...args),
}));
vi.mock("../../lawmind-job-stream.ts", () => ({
  openJobEventStream: (...args: unknown[]) => mocks.openJobEventStream(...args),
}));

import { useLawmindCollabWorkflowJobs } from "./useLawmindCollabWorkflowJobs";

type HookReturn = ReturnType<typeof useLawmindCollabWorkflowJobs>;

function Harness(props: { onReady: (api: HookReturn) => void }) {
  const api = useLawmindCollabWorkflowJobs({
    apiBase: "http://localhost:1234",
    collaborationEnabled: true,
    matterId: "",
    selectedTemplateId: "",
    selectedAssistantId: "",
    workflowAgentModelId: "",
  });
  props.onReady(api);
  return null;
}

describe("useLawmindCollabWorkflowJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiGetJson.mockImplementation(async (_base: string, url: string) => {
      if (url.startsWith("/api/jobs?")) {
        return { ok: true, jobs: [] };
      }
      if (url === "/api/jobs/job-running") {
        return {
          ok: true,
          job: {
            jobId: "job-running",
            status: "running",
            createdAt: "2026-08-01T00:00:00.000Z",
            progress: { totalSteps: 3, completedSteps: 1, failedSteps: 0, runningStepIds: ["s2"] },
          },
        };
      }
      return { ok: false };
    });
    mocks.openJobEventStream.mockReturnValue(() => undefined);
  });

  it("focusExistingJob on a running job attaches the progress stream and clears busy at terminal", async () => {
    const streamHandlers: {
      onMessage?: (data: { job?: unknown }) => void;
      onOpen?: () => void;
      onError?: () => void;
    } = {};
    mocks.openJobEventStream.mockImplementation((opts: typeof streamHandlers) => {
      Object.assign(streamHandlers, opts);
      return () => undefined;
    });

    let hook!: HookReturn;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Harness onReady={(api) => (hook = api)} />);
    });

    await act(async () => {
      await hook.focusExistingJob("job-running");
    });

    // 深链后必须接上该 job 的进度流（修复前只标 busy 不接流，进度冻结）。
    expect(mocks.openJobEventStream).toHaveBeenCalledTimes(1);
    expect(mocks.openJobEventStream.mock.calls[0]?.[0]).toMatchObject({
      apiBase: "http://localhost:1234",
      jobId: "job-running",
    });
    expect(hook.runBusy).toBe(true);
    expect(hook.activeJobId).toBe("job-running");
    expect(hook.activeProgress?.total).toBe(3);

    await act(async () => {
      streamHandlers.onMessage?.({
        job: { status: "completed", result: { status: "completed", report: "全部完成" } },
      });
    });

    expect(hook.runBusy).toBe(false);
    expect(hook.activeJobId).toBeNull();
    expect(hook.runResult).toContain("全部完成");

    root.unmount();
    host.remove();
  });

  it("focusExistingJob on a terminal job does not attach a stream or set busy", async () => {
    mocks.apiGetJson.mockImplementation(async (_base: string, url: string) => {
      if (url.startsWith("/api/jobs?")) {
        return { ok: true, jobs: [] };
      }
      if (url === "/api/jobs/job-done") {
        return {
          ok: true,
          job: { jobId: "job-done", status: "completed", createdAt: "2026-08-01T00:00:00.000Z" },
        };
      }
      return { ok: false };
    });

    let hook!: HookReturn;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Harness onReady={(api) => (hook = api)} />);
    });

    await act(async () => {
      await hook.focusExistingJob("job-done");
    });

    expect(mocks.openJobEventStream).not.toHaveBeenCalled();
    expect(hook.runBusy).toBe(false);
    expect(hook.recentJobs?.[0]?.jobId).toBe("job-done");

    root.unmount();
    host.remove();
  });
});
