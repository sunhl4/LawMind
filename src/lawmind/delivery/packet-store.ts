/**
 * DeliveryPacket 落盘：`<workspace>/matters/<matterId>/packets/<packetId>.json`。
 *
 * 只存包定义（分节、受众、文件路径与启用条件），不存清单快照：
 * 每次打开/导出都重新求值并重算 `packetHash`，这样文件被改过会立刻被发现。
 */

import fs from "node:fs";
import path from "node:path";
import {
  matterDir,
  readJsonValidated,
  withExclusiveFileLock,
  writeJsonAtomic,
} from "../adapters/matter-storage/io.js";
import { DeliveryPacketSchema, type DeliveryPacket } from "./packet.js";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function assertSafeId(raw: string): string {
  const trimmed = raw.trim();
  if (!SAFE_ID.test(trimmed) || trimmed.includes("..")) {
    throw new Error(`unsafe packet id: ${raw}`);
  }
  return trimmed;
}

export function packetsDir(workspaceDir: string, matterId: string): string {
  return path.join(matterDir(workspaceDir, matterId), "packets");
}

export function packetJsonPath(workspaceDir: string, matterId: string, packetId: string): string {
  return path.join(packetsDir(workspaceDir, matterId), `${assertSafeId(packetId)}.json`);
}

export function packetLockPath(workspaceDir: string, matterId: string, packetId: string): string {
  return path.join(packetsDir(workspaceDir, matterId), `${assertSafeId(packetId)}.lock`);
}

/** 校验 + 原子写。调用方负责维护 `updatedAt`。 */
export function saveDeliveryPacket(workspaceDir: string, packet: DeliveryPacket): DeliveryPacket {
  const parsed = DeliveryPacketSchema.parse(packet);
  writeJsonAtomic(packetJsonPath(workspaceDir, parsed.matterId, parsed.packetId), parsed);
  return parsed;
}

export function loadDeliveryPacket(
  workspaceDir: string,
  matterId: string,
  packetId: string,
): DeliveryPacket | undefined {
  return readJsonValidated(packetJsonPath(workspaceDir, matterId, packetId), DeliveryPacketSchema);
}

export function listDeliveryPackets(workspaceDir: string, matterId: string): DeliveryPacket[] {
  let names: string[];
  try {
    names = fs.readdirSync(packetsDir(workspaceDir, matterId));
  } catch {
    return [];
  }
  const out: DeliveryPacket[] = [];
  for (const name of names.toSorted()) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const packet = readJsonValidated(
        path.join(packetsDir(workspaceDir, matterId), name),
        DeliveryPacketSchema,
      );
      if (packet) {
        out.push(packet);
      }
    } catch {
      // 一个坏包不能挡住其它包；真相源仍保留在磁盘上等人工处理。
      continue;
    }
  }
  return out;
}

export function deleteDeliveryPacket(
  workspaceDir: string,
  matterId: string,
  packetId: string,
): boolean {
  const file = packetJsonPath(workspaceDir, matterId, packetId);
  if (!fs.existsSync(file)) {
    return false;
  }
  fs.rmSync(file, { force: true });
  return true;
}

/** 同一案件的包写操作串行化；锁不可重入，回调里不要再调本文件的加锁函数。 */
export function withDeliveryPacketLock<T>(
  workspaceDir: string,
  matterId: string,
  packetId: string,
  fn: () => T,
): T {
  return withExclusiveFileLock(packetLockPath(workspaceDir, matterId, packetId), fn);
}
