/**
 * 托管案件云的目录层：租户、账号（令牌）、服务器侧成员名册、邀请。
 *
 * ## 安全姿态
 *
 * - **明文令牌从不落盘**：只在创建账号/邀请时返回一次，之后只存 `sha256`。
 *   比对用常量时间，避免用比对耗时反推 token。
 * - **租户隔离是结构性的**：数据面目录是 `<root>/tenants/<tenantId>/matters`，
 *   跨租户读取在路径层面就不可能发生（不靠每处 if 判断）。
 * - **id 一律白名单校验**：tenantId / matterId / accountId 都过同一条 `safeId`，
 *   避免 `../` 之类的路径穿越。
 *
 * ## 刻意不做（本增量）
 *
 * - 令牌不做过期与轮换（生产要有）；账号不存密码（令牌即凭据，适合设备绑定）。
 * - `authenticate` 是线性扫描账号表。单租户/小所够用；量级上去要建 tokenFp 索引。
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../adapters/matter-storage/io.js";
import { MATTER_REPLICA_ROLES, type MatterReplicaRole } from "../matter-replica/types.js";
import type {
  CloudAccount,
  CloudAccountRole,
  CloudInvite,
  CloudMember,
  CloudMembership,
  CloudTenant,
} from "./types.js";

const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function safeCloudId(value: string, label: string): string {
  const trimmed = (value ?? "").trim();
  if (!SAFE_ID.test(trimmed)) {
    throw new Error(`unsafe ${label}: ${value}`);
  }
  return trimmed;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

export function tokenFingerprint(token: string): string {
  return hashToken(token).slice(0, 16);
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function isRole(value: unknown): value is MatterReplicaRole {
  return typeof value === "string" && (MATTER_REPLICA_ROLES as readonly string[]).includes(value);
}

function isAccountRole(value: unknown): value is CloudAccountRole {
  return value === "admin" || value === "member";
}

type AccountsFile = { version: 1; accounts: CloudAccount[] };
type TenantsFile = { version: 1; tenants: CloudTenant[] };
type InvitesFile = { version: 1; invites: CloudInvite[] };

export class MatterCloudDirectory {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  // ── 路径 ────────────────────────────────────────────────────────────────
  private tenantsPath(): string {
    return path.join(this.rootDir, "tenants.json");
  }

  private accountsPath(): string {
    return path.join(this.rootDir, "accounts.json");
  }

  private tenantDir(tenantId: string): string {
    return path.join(this.rootDir, "tenants", safeCloudId(tenantId, "tenantId"));
  }

  /** 数据面根：交给 `MatterCloudStore`，跨租户隔离在路径层面完成。 */
  cloudMattersDir(tenantId: string): string {
    return path.join(this.tenantDir(tenantId), "matters");
  }

  private membershipPath(tenantId: string, matterId: string): string {
    return path.join(
      this.cloudMattersDir(tenantId),
      safeCloudId(matterId, "matterId"),
      "cloud-membership.json",
    );
  }

  private invitesPath(tenantId: string): string {
    return path.join(this.tenantDir(tenantId), "invites.json");
  }

  private readJson(file: string): unknown {
    try {
      if (!fs.existsSync(file)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }

  private writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJsonAtomic(file, value);
  }

  // ── 租户 ────────────────────────────────────────────────────────────────
  createTenant(input: { name: string; tenantId?: string }): CloudTenant {
    const name = input.name.trim();
    if (!name) {
      throw new Error("租户名不能为空");
    }
    const tenant: CloudTenant = {
      version: 1,
      tenantId: input.tenantId
        ? safeCloudId(input.tenantId, "tenantId")
        : `t_${randomBytes(6).toString("hex")}`,
      name: name.slice(0, 120),
      createdAt: new Date().toISOString(),
    };
    const file = (this.readJson(this.tenantsPath()) as TenantsFile | null) ?? {
      version: 1,
      tenants: [],
    };
    if (file.tenants.some((t) => t.tenantId === tenant.tenantId)) {
      throw new Error("租户已存在");
    }
    file.tenants.push(tenant);
    this.writeJson(this.tenantsPath(), file);
    fs.mkdirSync(this.cloudMattersDir(tenant.tenantId), { recursive: true });
    return tenant;
  }

  listTenants(): CloudTenant[] {
    return (this.readJson(this.tenantsPath()) as TenantsFile | null)?.tenants ?? [];
  }

  getTenant(tenantId: string): CloudTenant | null {
    return this.listTenants().find((t) => t.tenantId === tenantId) ?? null;
  }

  // ── 账号 ────────────────────────────────────────────────────────────────
  private readAccounts(): CloudAccount[] {
    const file = this.readJson(this.accountsPath()) as AccountsFile | null;
    return (file?.accounts ?? []).filter(
      (a): a is CloudAccount =>
        !!a && typeof a.accountId === "string" && typeof a.tokenHash === "string",
    );
  }

  private writeAccounts(accounts: CloudAccount[]): void {
    this.writeJson(this.accountsPath(), { version: 1, accounts });
  }

  /** 没有租户时建一个默认租户，供桌面端自行注册。已有多个租户时不猜。 */
  ensureSoloTenant(): CloudTenant {
    const tenants = this.listTenants();
    if (tenants.length === 1) {
      return tenants[0];
    }
    if (tenants.length > 1) {
      throw new Error("这台案件云有多个租户，请由管理员发放账号");
    }
    return this.createTenant({ name: "LawMind" });
  }

  /** 律师第一次连接案件云：建成员账号，令牌只返回这一次。 */
  enroll(input: { displayName: string; email?: string; lawyerId: string }): {
    token: string;
    account: CloudAccount;
  } {
    const tenant = this.ensureSoloTenant();
    const created = this.createAccount({
      tenantId: tenant.tenantId,
      lawyerId: input.lawyerId,
      displayName: input.displayName,
      email: input.email,
      role: "member",
    });
    return created;
  }

  /** 凭邀请码加入：尚未有账号的同事用邀请码换到自己的令牌。 */
  joinByInvite(input: { token: string; displayName: string; email?: string; lawyerId: string }): {
    token: string;
    membership: CloudMembership;
    invite: CloudInvite;
  } {
    const normalized = input.token.trim().toUpperCase();
    if (!normalized) {
      throw new Error("请粘贴邀请码");
    }
    for (const tenant of this.listTenants()) {
      const invite = this.readInvites(tenant.tenantId).find(
        (item) => item.token.toUpperCase() === normalized && item.status === "pending",
      );
      if (!invite) {
        continue;
      }
      const { token } = this.createAccount({
        tenantId: tenant.tenantId,
        lawyerId: input.lawyerId,
        displayName: input.displayName,
        email: input.email ?? invite.email,
        role: "member",
      });
      const redeemed = this.redeemInvite({
        tenantId: tenant.tenantId,
        token: normalized,
        account: {
          lawyerId: input.lawyerId,
          displayName: input.displayName.trim(),
          email: input.email ?? invite.email,
        },
      });
      return { token, membership: redeemed.membership, invite: redeemed.invite };
    }
    throw new Error("邀请码无效或已过期");
  }

  /** 创建账号并返回**一次**明文令牌（之后无法再取回）。 */
  createAccount(input: {
    tenantId: string;
    lawyerId: string;
    displayName: string;
    email?: string;
    role?: CloudAccountRole;
  }): { account: CloudAccount; token: string } {
    const tenantId = safeCloudId(input.tenantId, "tenantId");
    if (!this.getTenant(tenantId)) {
      throw new Error("租户不存在");
    }
    const displayName = input.displayName.trim();
    if (!displayName) {
      throw new Error("显示名不能为空");
    }
    const token = randomBytes(32).toString("base64url");
    const account: CloudAccount = {
      version: 1,
      accountId: `acc_${randomBytes(6).toString("hex")}`,
      tenantId,
      lawyerId: safeCloudId(input.lawyerId, "lawyerId"),
      displayName: displayName.slice(0, 80),
      email: input.email?.trim() || undefined,
      role: input.role && isAccountRole(input.role) ? input.role : "member",
      tokenHash: hashToken(token),
      tokenFp: tokenFingerprint(token),
      createdAt: new Date().toISOString(),
    };
    const accounts = this.readAccounts();
    if (accounts.some((a) => a.tenantId === tenantId && a.lawyerId === account.lawyerId)) {
      throw new Error("该租户下此 lawyerId 已有账号");
    }
    accounts.push(account);
    this.writeAccounts(accounts);
    return { account, token };
  }

  listAccounts(tenantId: string): CloudAccount[] {
    return this.readAccounts().filter((a) => a.tenantId === tenantId);
  }

  revokeAccount(accountId: string): void {
    const accounts = this.readAccounts();
    const idx = accounts.findIndex((a) => a.accountId === accountId);
    if (idx < 0) {
      throw new Error("账号不存在");
    }
    accounts[idx] = { ...accounts[idx], revokedAt: new Date().toISOString() };
    this.writeAccounts(accounts);
  }

  /** 常量时间比对令牌哈希；被撤销的账号直接不认。 */
  authenticate(token: string | null | undefined): CloudAccount | null {
    const provided = (token ?? "").trim();
    if (!provided) {
      return null;
    }
    const providedHash = hashToken(provided);
    let hit: CloudAccount | null = null;
    for (const account of this.readAccounts()) {
      if (constantTimeEquals(account.tokenHash, providedHash)) {
        hit = account;
        break;
      }
    }
    if (!hit || hit.revokedAt) {
      return null;
    }
    return hit;
  }

  // ── 成员名册（服务器侧） ────────────────────────────────────────────────
  readMembership(tenantId: string, matterId: string): CloudMembership | null {
    const raw = this.readJson(this.membershipPath(tenantId, matterId)) as CloudMembership | null;
    if (!raw || raw.version !== 1 || !Array.isArray(raw.members)) {
      return null;
    }
    return {
      version: 1,
      tenantId: raw.tenantId,
      matterId: raw.matterId,
      matterTitle: typeof raw.matterTitle === "string" ? raw.matterTitle : raw.matterId,
      members: raw.members.filter(
        (m): m is CloudMember =>
          !!m &&
          typeof m.lawyerId === "string" &&
          typeof m.displayName === "string" &&
          isRole(m.role) &&
          (m.status === "active" || m.status === "revoked"),
      ),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
      updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : "system",
    };
  }

  writeMembership(membership: CloudMembership): CloudMembership {
    const next: CloudMembership = {
      ...membership,
      version: 1,
      tenantId: safeCloudId(membership.tenantId, "tenantId"),
      matterId: safeCloudId(membership.matterId, "matterId"),
      updatedAt: new Date().toISOString(),
    };
    this.writeJson(this.membershipPath(next.tenantId, next.matterId), next);
    return next;
  }

  ensureMembership(input: {
    tenantId: string;
    matterId: string;
    matterTitle: string;
    owner: { lawyerId: string; displayName: string; email?: string };
  }): CloudMembership {
    const existing = this.readMembership(input.tenantId, input.matterId);
    if (existing) {
      return existing;
    }
    const owner: CloudMember = {
      lawyerId: safeCloudId(input.owner.lawyerId, "lawyerId"),
      displayName: input.owner.displayName.slice(0, 80),
      email: input.owner.email,
      role: "owner",
      status: "active",
      joinedAt: new Date().toISOString(),
    };
    return this.writeMembership({
      version: 1,
      tenantId: input.tenantId,
      matterId: safeCloudId(input.matterId, "matterId"),
      matterTitle: input.matterTitle.trim() || input.matterId,
      members: [owner],
      updatedAt: new Date().toISOString(),
      updatedBy: owner.lawyerId,
    });
  }

  upsertMember(
    tenantId: string,
    matterId: string,
    member: CloudMember,
    updatedBy: string,
  ): CloudMembership {
    const current = this.readMembership(tenantId, matterId);
    if (!current) {
      throw new Error("该案件在该租户下尚无成员名册");
    }
    const others = current.members.filter((m) => m.lawyerId !== member.lawyerId);
    return this.writeMembership({ ...current, members: [...others, member], updatedBy });
  }

  /** 该账号在此案件上的成员记录（未加入则 null）。 */
  findMember(tenantId: string, matterId: string, lawyerId: string): CloudMember | null {
    const membership = this.readMembership(tenantId, matterId);
    return membership?.members.find((m) => m.lawyerId === lawyerId) ?? null;
  }

  // ── 邀请（服务器侧） ────────────────────────────────────────────────────
  private readInvites(tenantId: string): CloudInvite[] {
    return (this.readJson(this.invitesPath(tenantId)) as InvitesFile | null)?.invites ?? [];
  }

  private writeInvites(tenantId: string, invites: CloudInvite[]): void {
    this.writeJson(this.invitesPath(tenantId), { version: 1, invites });
  }

  listInvites(tenantId: string, matterId?: string): CloudInvite[] {
    const all = this.readInvites(tenantId);
    return matterId ? all.filter((i) => i.matterId === matterId) : all;
  }

  createInvite(input: {
    tenantId: string;
    matterId: string;
    matterTitle: string;
    email: string;
    role: MatterReplicaRole;
    invitedBy: string;
    invitedByName: string;
  }): CloudInvite {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("请填写有效的同事邮箱");
    }
    if (!isRole(input.role)) {
      throw new Error("角色无效");
    }
    const now = Date.now();
    const invite: CloudInvite = {
      inviteId: `inv_${randomBytes(6).toString("hex")}`,
      matterId: safeCloudId(input.matterId, "matterId"),
      matterTitle: input.matterTitle.trim() || input.matterId,
      token: `LMC-${randomBytes(10).toString("hex").toUpperCase()}`,
      email,
      role: input.role,
      invitedBy: input.invitedBy,
      invitedByName: input.invitedByName,
      status: "pending",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    };
    const invites = this.readInvites(input.tenantId);
    invites.push(invite);
    this.writeInvites(input.tenantId, invites);
    return invite;
  }

  revokeInvite(tenantId: string, inviteId: string): CloudInvite {
    const invites = this.readInvites(tenantId);
    const idx = invites.findIndex((i) => i.inviteId === inviteId);
    if (idx < 0) {
      throw new Error("邀请不存在");
    }
    if (invites[idx].status !== "pending") {
      throw new Error("只能撤销待接受的邀请");
    }
    invites[idx] = { ...invites[idx], status: "revoked" };
    this.writeInvites(tenantId, invites);
    return invites[idx];
  }

  /**
   * 用邀请码加入。返回更新后的成员记录。
   * 邀请码在**本租户内**查找：跨租户兑换在结构上不可能。
   */
  redeemInvite(input: {
    tenantId: string;
    token: string;
    account: { lawyerId: string; displayName: string; email?: string };
  }): { membership: CloudMembership; invite: CloudInvite } {
    const normalized = input.token.trim().toUpperCase();
    const invites = this.readInvites(input.tenantId);
    const idx = invites.findIndex((i) => i.token.toUpperCase() === normalized);
    if (idx < 0) {
      throw new Error("邀请码无效或已过期");
    }
    const invite = invites[idx];
    if (invite.status === "revoked") {
      throw new Error("该邀请已被撤销");
    }
    if (invite.status === "accepted") {
      throw new Error("该邀请已被使用");
    }
    if (Date.parse(invite.expiresAt) < Date.now()) {
      invites[idx] = { ...invite, status: "expired" };
      this.writeInvites(input.tenantId, invites);
      throw new Error("邀请已过期，请让主办重新发送");
    }

    let membership = this.ensureMembership({
      tenantId: input.tenantId,
      matterId: invite.matterId,
      matterTitle: invite.matterTitle,
      owner: {
        lawyerId: invite.invitedBy,
        displayName: invite.invitedByName,
      },
    });
    membership = this.upsertMember(
      input.tenantId,
      invite.matterId,
      {
        lawyerId: input.account.lawyerId,
        displayName: input.account.displayName,
        email: input.account.email ?? invite.email,
        role: invite.role,
        status: "active",
        joinedAt: new Date().toISOString(),
      },
      input.account.lawyerId,
    );

    invites[idx] = {
      ...invite,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      acceptedBy: input.account.lawyerId,
    };
    this.writeInvites(input.tenantId, invites);
    return { membership, invite: invites[idx] };
  }
}
