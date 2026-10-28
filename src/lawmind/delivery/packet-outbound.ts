/**
 * 交付包 → 外发拟稿的桥。
 *
 * 律师签批的是「这一版整包」，不是邮件里碰巧带上的附件：
 * - 拟稿时按包内顺序生成附件清单，并把 `packetId + packetHash` 写进 OutboundBinding。
 * - 签批发送前重新读包、重新求值；文件/顺序/封面/受众任一变化都返回问题清单，拒绝发送。
 */

import { loadDeliveryPacket } from "./packet-store.js";
import { buildPacketManifest, type PacketAudience } from "./packet.js";

export type OutboundPacketBinding = {
  packetId: string;
  packetHash: string;
};

export type OutboundPacketResolution =
  | {
      ok: true;
      packetId: string;
      packetHash: string;
      title: string;
      audience: PacketAudience;
      /** 按包内顺序排列的工作区相对路径。 */
      attachmentRelativePaths: string[];
      binding: OutboundPacketBinding;
    }
  | { ok: false; error: string; blockers?: string[] };

function normalizeRel(raw: string): string {
  return raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * 把交付包解析成外发附件清单。
 *
 * 显式附件只允许是包内文件（防止「签批的是包，实际多发一份」）；
 * 包被 blocker 拦住时直接拒绝，不生成待发信。
 */
export function resolveOutboundPacket(
  workspaceDir: string,
  matterId: string,
  packetId: string,
  explicitAttachmentPaths: string[] = [],
): OutboundPacketResolution {
  const id = packetId.trim();
  if (!id) {
    return { ok: false, error: "packet_id 为空。" };
  }
  const packet = (() => {
    try {
      return loadDeliveryPacket(workspaceDir, matterId, id);
    } catch {
      return undefined;
    }
  })();
  if (!packet) {
    return { ok: false, error: `未找到交付包 ${id}（或文件无法读取）。` };
  }
  if (packet.matterId !== matterId) {
    return { ok: false, error: `交付包 ${id} 不属于本案。` };
  }
  const manifest = buildPacketManifest(workspaceDir, packet, { audience: packet.audience });
  if (manifest.blockers.length > 0) {
    return {
      ok: false,
      error: `交付包当前不可交付：${manifest.blockers.join("；")}`,
      blockers: manifest.blockers,
    };
  }
  const packetPaths = manifest.files.map((file) => file.path);
  const packetPathSet = new Set(packetPaths);
  for (const raw of explicitAttachmentPaths) {
    const rel = normalizeRel(raw);
    if (rel && !packetPathSet.has(rel)) {
      return {
        ok: false,
        error: `附件「${rel}」不在交付包 ${id} 内。签批整包时不能夹带包外文件。`,
      };
    }
  }
  return {
    ok: true,
    packetId: packet.packetId,
    packetHash: manifest.packetHash,
    title: packet.title,
    audience: packet.audience,
    attachmentRelativePaths: packetPaths,
    binding: { packetId: packet.packetId, packetHash: manifest.packetHash },
  };
}

/**
 * 签批发送前复核：重新读包、重新求值，返回律师可读的问题清单。
 * 空数组表示仍可发送。
 */
export function packetApprovalProblems(
  workspaceDir: string,
  matterId: string,
  approved: OutboundPacketBinding,
): string[] {
  const id = approved.packetId.trim();
  if (!id) {
    return ["签批的交付包 ID 为空。"];
  }
  const packet = (() => {
    try {
      return loadDeliveryPacket(workspaceDir, matterId, id);
    } catch {
      return undefined;
    }
  })();
  if (!packet) {
    return [`交付包 ${id} 已不存在或无法读取，不能按原签批发送。`];
  }
  if (packet.matterId !== matterId) {
    return [`交付包 ${id} 不属于本案。`];
  }
  const manifest = buildPacketManifest(workspaceDir, packet, { audience: packet.audience });
  const problems: string[] = [];
  if (manifest.blockers.length > 0) {
    problems.push(...manifest.blockers.map((blocker) => `交付包当前不可交付：${blocker}`));
  }
  if (manifest.packetHash !== approved.packetHash) {
    problems.push("交付包的文件、顺序、封面或受众在签批后变了。");
  }
  return problems;
}
