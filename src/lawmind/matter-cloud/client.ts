/**
 * 托管案件云的桌面端 HTTP 客户端。
 *
 * 只负责「把请求发出去、把错误说清楚」，不含任何本地状态变更 ——
 * 本地投影与密钥分发在 `desktop-bridge.ts`，这样客户端可以单独用假服务端测。
 */

import type { CloudInvite, CloudMembership } from "./types.js";

export type CloudIdentity = {
  accountId: string;
  tenantId: string;
  lawyerId: string;
  displayName: string;
  email: string | null;
  role: string;
};

export type CloudClientOptions = {
  endpoint: string;
  token: string;
  fetchImpl?: typeof fetch;
};

export class MatterCloudError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "MatterCloudError";
  }
}

export class MatterCloudClient {
  private readonly root: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CloudClientOptions) {
    this.root = opts.endpoint.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(
    path: string,
    init: { method?: string; json?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    let body: string | undefined;
    if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(init.json);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.root}${path}`, {
        method: init.method ?? (body ? "POST" : "GET"),
        headers,
        body,
      });
    } catch (err) {
      throw new MatterCloudError(
        `无法连接案件云（${this.root}）：${err instanceof Error ? err.message : String(err)}`,
        0,
        "unreachable",
      );
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const payload = (parsed ?? {}) as { error?: string; capability?: string };
      const detail = payload.capability
        ? `${payload.error}（需要能力：${payload.capability}）`
        : payload.error;
      throw new MatterCloudError(
        `案件云请求失败：HTTP ${res.status}${detail ? ` · ${detail}` : ""}`,
        res.status,
        payload.error,
      );
    }
    return parsed as T;
  }

  async whoami(): Promise<CloudIdentity> {
    const r = await this.request<{ ok: boolean; account: CloudIdentity }>("/v1/me");
    return r.account;
  }

  async health(): Promise<{ ok: boolean; service: string; tenants: number }> {
    // health 免鉴权，但用同一个 root 便于排障
    const res = await this.fetchImpl(`${this.root}/v1/health`);
    if (!res.ok) {
      throw new MatterCloudError(`案件云健康检查失败：HTTP ${res.status}`, res.status);
    }
    return (await res.json()) as { ok: boolean; service: string; tenants: number };
  }

  async createInvite(input: {
    matterId: string;
    email: string;
    role: string;
  }): Promise<{ invite: CloudInvite; shareText?: string }> {
    return this.request(`/v1/matters/${encodeURIComponent(input.matterId)}/invites`, {
      method: "POST",
      json: { email: input.email, role: input.role },
    });
  }

  async revokeInvite(input: {
    matterId: string;
    inviteId: string;
  }): Promise<{ invite: CloudInvite }> {
    return this.request(`/v1/matters/${encodeURIComponent(input.matterId)}/invites/revoke`, {
      method: "POST",
      json: { inviteId: input.inviteId },
    });
  }

  async redeemInvite(token: string): Promise<{ membership: CloudMembership; invite: CloudInvite }> {
    return this.request("/v1/invites/redeem", { method: "POST", json: { token } });
  }

  async fetchMembership(matterId: string): Promise<CloudMembership | null> {
    try {
      const r = await this.request<{ ok: boolean; membership: CloudMembership }>(
        `/v1/matters/${encodeURIComponent(matterId)}/membership`,
      );
      return r.membership;
    } catch (err) {
      if (err instanceof MatterCloudError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /** 把云侧名册推上去（云为权威来源时由主办端调用）。 */
  async pushMembership(matterId: string, membership: CloudMembership): Promise<CloudMembership> {
    const r = await this.request<{ ok: boolean; membership: CloudMembership }>(
      `/v1/matters/${encodeURIComponent(matterId)}/membership`,
      { method: "PUT", json: { members: membership.members } },
    );
    return r.membership;
  }
}
