/**
 * HTTP matter-cloud relay client (SaaS contract).
 * Same JSON shapes as FileReplicaRelay; endpoint from policy.matterReplica.endpoint.
 */

import type { MatterMaterialsRelay, MaterialsRelayManifest } from "./materials-relay.js";
import type { MatterReplicaRelay, ReplicaRelayEnvelope } from "./relay.js";
import type { MatterMaterialEntry, MatterRecordOp } from "./types.js";

function safeMatterId(matterId: string): string {
  return matterId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

export class HttpReplicaRelay implements MatterReplicaRelay {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly opts: { authorization?: string } = {},
  ) {}

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { accept: json ? "application/json" : "*/*" };
    if (json) {
      h["content-type"] = "application/json";
    }
    if (this.opts.authorization) {
      h.authorization = this.opts.authorization;
    }
    return h;
  }

  private base(matterId: string): string {
    const root = this.endpoint.replace(/\/+$/, "");
    return `${root}/v1/matters/${encodeURIComponent(safeMatterId(matterId))}`;
  }

  async publishOps(matterId: string, ops: MatterRecordOp[]): Promise<void> {
    const existing = await this.fetchOps(matterId);
    const byId = new Map<string, MatterRecordOp>();
    for (const op of existing) {
      byId.set(op.opId, op);
    }
    for (const op of ops) {
      byId.set(op.opId, op);
    }
    const merged = [...byId.values()].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
    const envelope: ReplicaRelayEnvelope = {
      version: 1,
      matterId,
      publishedAt: new Date().toISOString(),
      ops: merged,
    };
    const res = await this.fetchImpl(`${this.base(matterId)}/ops`, {
      method: "PUT",
      headers: this.headers(true),
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      throw new Error(`matter cloud ops publish failed: HTTP ${res.status}`);
    }
  }

  async fetchOps(matterId: string, afterOpId?: string): Promise<MatterRecordOp[]> {
    const res = await this.fetchImpl(`${this.base(matterId)}/ops`, {
      method: "GET",
      headers: this.headers(true),
    });
    if (res.status === 404) {
      return [];
    }
    if (!res.ok) {
      throw new Error(`matter cloud ops fetch failed: HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Partial<ReplicaRelayEnvelope>;
    const all = Array.isArray(raw.ops)
      ? raw.ops.filter((o) => o && typeof o.opId === "string")
      : [];
    if (!afterOpId) {
      return all;
    }
    const idx = all.findIndex((o) => o.opId === afterOpId);
    return idx < 0 ? all : all.slice(idx + 1);
  }
}

export class HttpMaterialsRelay implements MatterMaterialsRelay {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly opts: { authorization?: string } = {},
  ) {}

  private headers(contentType?: string): Record<string, string> {
    const h: Record<string, string> = { accept: "*/*" };
    if (contentType) {
      h["content-type"] = contentType;
    }
    if (this.opts.authorization) {
      h.authorization = this.opts.authorization;
    }
    return h;
  }

  private base(matterId: string): string {
    const root = this.endpoint.replace(/\/+$/, "");
    return `${root}/v1/matters/${encodeURIComponent(safeMatterId(matterId))}`;
  }

  async putBlob(matterId: string, sha256: string, bytes: Buffer): Promise<void> {
    const safe = sha256.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
    if (safe.length !== 64) {
      throw new Error("invalid blob hash");
    }
    const res = await this.fetchImpl(`${this.base(matterId)}/blobs/${safe}`, {
      method: "PUT",
      headers: this.headers("application/octet-stream"),
      body: new Uint8Array(bytes),
    });
    if (!res.ok && res.status !== 409) {
      throw new Error(`matter cloud blob put failed: HTTP ${res.status}`);
    }
  }

  async getBlob(matterId: string, sha256: string): Promise<Buffer | null> {
    const safe = sha256.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
    if (safe.length !== 64) {
      return null;
    }
    const res = await this.fetchImpl(`${this.base(matterId)}/blobs/${safe}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`matter cloud blob get failed: HTTP ${res.status}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  async publishManifest(
    matterId: string,
    files: MatterMaterialEntry[],
    removedRelPaths: string[] = [],
  ): Promise<void> {
    const existing = await this.fetchManifest(matterId);
    const byPath = new Map<string, MatterMaterialEntry>();
    for (const f of existing) {
      byPath.set(f.relPath, f);
    }
    for (const f of files) {
      byPath.set(f.relPath, f);
    }
    for (const rel of removedRelPaths) {
      byPath.delete(rel);
    }
    const envelope: MaterialsRelayManifest & { removed?: string[] } = {
      version: 1,
      matterId,
      publishedAt: new Date().toISOString(),
      files: [...byPath.values()].toSorted((a, b) => a.relPath.localeCompare(b.relPath)),
    };
    if (removedRelPaths.length > 0) {
      envelope.removed = removedRelPaths;
    }
    const res = await this.fetchImpl(`${this.base(matterId)}/materials/manifest`, {
      method: "PUT",
      headers: this.headers("application/json"),
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      throw new Error(`matter cloud manifest publish failed: HTTP ${res.status}`);
    }
  }

  async fetchManifest(matterId: string): Promise<MatterMaterialEntry[]> {
    const res = await this.fetchImpl(`${this.base(matterId)}/materials/manifest`, {
      method: "GET",
      headers: this.headers("application/json"),
    });
    if (res.status === 404) {
      return [];
    }
    if (!res.ok) {
      throw new Error(`matter cloud manifest fetch failed: HTTP ${res.status}`);
    }
    const raw = (await res.json()) as Partial<MaterialsRelayManifest>;
    if (raw?.version !== 1 || !Array.isArray(raw.files)) {
      return [];
    }
    return raw.files.filter(
      (f): f is MatterMaterialEntry =>
        !!f &&
        typeof f.relPath === "string" &&
        typeof f.sha256 === "string" &&
        typeof f.size === "number",
    );
  }
}
