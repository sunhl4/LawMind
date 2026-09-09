/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LawmindApprovalRequestHost } from "./LawmindApprovalRequestHost";
import type { ApprovalItem } from "./stores/approval-request-store";

const mockUseApprovalRequests = vi.fn();

vi.mock("./useApprovalRequests", () => ({
  useApprovalRequests: (...args: unknown[]) => mockUseApprovalRequests(...args),
}));

vi.mock("./lawmind-confirm-dialog", () => ({
  confirmDialog: vi.fn(async () => true),
}));

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    id: "approval-1",
    kind: "tool_approval",
    title: "待批准：发送邮件",
    summary: "拟发送邮件给客户，请确认。",
    matterId: "matter-1",
    sessionId: "session-1",
    toolName: "send_email",
    toolArgs: {
      to: "client@example.com",
      subject: "审阅稿",
      body: "这是一封很长的邮件正文，包含大量工作内容，供律师审阅后发送，并请特别注意落款格式与附件清单。敏感内容不应出现在摘要里，仅用于测试截断逻辑。",
    },
    riskLevel: "high",
    createdAt: "2026-09-03T10:00:00.000Z",
    expiresAt: "2026-09-04T10:00:00.000Z",
    decisions: ["approve", "reject", "more_info"],
    ...overrides,
  };
}

describe("LawmindApprovalRequestHost", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it("renders nothing when apiBase is missing", () => {
    mockUseApprovalRequests.mockReturnValue({
      items: [],
      loading: false,
      error: null,
      open: false,
      setOpen: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      requestMoreInfo: vi.fn(),
      count: 0,
    });
    act(() => {
      root.render(<LawmindApprovalRequestHost apiBase={undefined} />);
    });
    expect(host.firstChild).toBeNull();
  });

  it("renders nothing when there are no pending approvals", () => {
    mockUseApprovalRequests.mockReturnValue({
      items: [],
      loading: false,
      error: null,
      open: false,
      setOpen: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      requestMoreInfo: vi.fn(),
      count: 0,
    });
    act(() => {
      root.render(<LawmindApprovalRequestHost apiBase="http://localhost" />);
    });
    expect(host.firstChild).toBeNull();
  });

  it("shows the floating button with pending count", () => {
    mockUseApprovalRequests.mockReturnValue({
      items: [makeItem()],
      loading: false,
      error: null,
      open: false,
      setOpen: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      requestMoreInfo: vi.fn(),
      count: 1,
    });
    act(() => {
      root.render(<LawmindApprovalRequestHost apiBase="http://localhost" />);
    });
    expect(host.textContent).toContain("待确认 (1)");
  });

  it("opens the panel and lists pending approvals", () => {
    mockUseApprovalRequests.mockReturnValue({
      items: [makeItem()],
      loading: false,
      error: null,
      open: true,
      setOpen: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      requestMoreInfo: vi.fn(),
      count: 1,
    });
    act(() => {
      root.render(<LawmindApprovalRequestHost apiBase="http://localhost" />);
    });
    expect(host.querySelector('[role="dialog"]')).toBeTruthy();
    expect(host.textContent).toContain("待批准：发送邮件");
    expect(host.textContent).toContain("高风险");
  });

  it("calls approve and reject when buttons are clicked", async () => {
    const approve = vi.fn();
    const reject = vi.fn();
    const item = makeItem();
    mockUseApprovalRequests.mockReturnValue({
      items: [item],
      loading: false,
      error: null,
      open: true,
      setOpen: vi.fn(),
      approve,
      reject,
      requestMoreInfo: vi.fn(),
      count: 1,
    });
    act(() => {
      root.render(<LawmindApprovalRequestHost apiBase="http://localhost" />);
    });
    const buttons = host.querySelectorAll("button");
    const approveButton = [...buttons].find((b) => b.textContent === "批准");
    const rejectButton = [...buttons].find((b) => b.textContent === "拒绝");
    expect(approveButton).toBeDefined();
    expect(rejectButton).toBeDefined();
    await act(async () => {
      approveButton?.click();
    });
    expect(approve).toHaveBeenCalledWith(item);
    await act(async () => {
      rejectButton?.click();
    });
    expect(reject).toHaveBeenCalledWith(item);
  });

  it("hides sensitive email body in the args summary", () => {
    mockUseApprovalRequests.mockReturnValue({
      items: [makeItem()],
      loading: false,
      error: null,
      open: true,
      setOpen: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      requestMoreInfo: vi.fn(),
      count: 1,
    });
    act(() => {
      root.render(<LawmindApprovalRequestHost apiBase="http://localhost" />);
    });
    const args = host.querySelector('[data-testid="lm-approval-args"]')?.textContent ?? "";
    expect(args).toContain("client@example.com");
    expect(args).toContain("审阅稿");
    expect(args).toMatch(/正文：.{1,50}…/);
    expect(args).not.toContain("敏感内容不应出现在摘要里");
  });

  it("closes the panel when more info is requested", () => {
    const requestMoreInfo = vi.fn();
    mockUseApprovalRequests.mockReturnValue({
      items: [makeItem()],
      loading: false,
      error: null,
      open: true,
      setOpen: vi.fn(),
      approve: vi.fn(),
      reject: vi.fn(),
      requestMoreInfo,
      count: 1,
    });
    act(() => {
      root.render(<LawmindApprovalRequestHost apiBase="http://localhost" />);
    });
    const buttons = host.querySelectorAll("button");
    const moreInfoButton = [...buttons].find((b) => b.textContent === "需要更多信息");
    expect(moreInfoButton).toBeDefined();
    act(() => {
      moreInfoButton?.click();
    });
    expect(requestMoreInfo).toHaveBeenCalled();
  });
});
