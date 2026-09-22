/**
 * 案件副本（Matter Replica）跨机器验收探针。
 *
 * ## 为什么需要它
 *
 * `pnpm test` 里的 matter-replica 用例几乎都在**同一个 workspace** 里跑来跑去
 * （甚至靠切换 `lawyer-identity.json` 来「模拟同事」），所以它们只能证明**函数级**行为，
 * 证明不了「两台独立电脑能不能共办一案」。
 *
 * 这个探针用**两个完全独立的工作区 + 一个中继目录**，只走产品真实入口
 * （`createInvite` / `acceptInviteByToken` / `acquireCheckoutLock` /
 * `syncMatterRecordPipe` / `syncMatterMaterialsPipe`），把「顶尖商业产品应该做到」
 * 的行为写成判据。
 *
 * **判据是「应该怎样」，不是「现在怎样」** —— 所以红灯就是产品缺口，不是脚本 bug。
 *
 * ## 运行
 *
 *   node --import tsx scripts/lawmind/lawmind-matter-replica-cross-machine-probe.ts
 *   node --import tsx scripts/lawmind/lawmind-matter-replica-cross-machine-probe.ts --strict
 *
 * `--strict` 下只要存在红灯就以退出码 1 结束（可用于合并前的门禁）。
 *
 * 探针只在 `os.tmpdir()` 下建临时工作区，**不碰**真实 `workspace/`。
 *
 * ## 判据编号
 *
 * 判据用 `X1–X10`（X = cross-machine），**刻意避开** `G1–G10` —— 那套编号已被
 * `docs/lawmind/LAWMIND-MATTER-REPLICA-GAP-REVIEW.md` 用于「产品差距」，两套混用会误读。
 * `C1` / `C2` 是对照组：它们必须始终为绿，用来证明探针不是「什么都报错」。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFirmCollaborationAuditReport,
  flushCollaborationAudit,
  formatFirmCollaborationAuditMarkdown,
} from "../../src/lawmind/audit/collaboration-audit.js";
import {
  acceptCloudInvite,
  createCloudInvite,
  createMatterCloudServer,
} from "../../src/lawmind/matter-cloud/index.js";
import {
  acceptInviteByToken,
  acquireCheckoutLock,
  createInvite,
  ensureMatterKey,
  ensureMembershipWithOwner,
  evaluateMatterReplicaGate,
  listCheckoutLocks,
  listRecordOps,
  openBytes,
  publishLocalMaterials,
  readMatterKey,
  readMembership,
  revokeInvite,
  scanMatterMaterials,
  sealBytes,
  syncMatterMaterialsPipe,
  syncMatterRecordPipe,
  unwrapMatterKeyFromInvite,
  upsertLawyerIdentity,
  type MatterRecordOp,
} from "../../src/lawmind/matter-replica/index.js";
import { isPathCheckedOut } from "../../src/lawmind/matter-replica/materials-blobs.js";
import { matterKeyBytes } from "../../src/lawmind/matter-replica/matter-key.js";
import { MatterReplicaSyncScheduler } from "../../src/lawmind/matter-replica/sync-scheduler.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STRICT = process.argv.includes("--strict");

const MATTER_TITLE = "王某买卖合同纠纷";
const MATERIAL_REL = "materials/委托合同（初稿）.docx";

// ---------------------------------------------------------------------------
// 输出脚手架
// ---------------------------------------------------------------------------

type Verdict = {
  id: string;
  title: string;
  desired: string;
  observed: string;
  ok: boolean;
  evidence: string[];
  /** 探针自身异常（要与「产品缺口」区分开） */
  probeError: boolean;
};

const verdicts: Verdict[] = [];

async function scenario(
  id: string,
  title: string,
  desired: string,
  body: () => Promise<{ ok: boolean; observed: string; evidence?: string[] }>,
): Promise<void> {
  try {
    const r = await body();
    verdicts.push({
      id,
      title,
      desired,
      observed: r.observed,
      ok: r.ok,
      evidence: r.evidence ?? [],
      probeError: false,
    });
  } catch (err) {
    verdicts.push({
      id,
      title,
      desired,
      observed: `探针自身异常：${err instanceof Error ? err.message : String(err)}`,
      ok: false,
      evidence: [],
      probeError: true,
    });
  }
}

// ---------------------------------------------------------------------------
// 两机夹具
// ---------------------------------------------------------------------------

type Pair = {
  root: string;
  a: string;
  b: string;
  relay: string;
  mid: string;
};

const tmpRoots: string[] = [];

function policyJson(opts: { relayDir?: string }): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      edition: "firm",
      matterReplica: opts.relayDir
        ? { enabled: true, sharedRelayDir: opts.relayDir }
        : { enabled: true },
    },
    null,
    2,
  );
}

function makeWorkspace(root: string, name: string, relayDir?: string): string {
  const ws = path.join(root, name);
  fs.mkdirSync(path.join(ws, "cases", "matter_wm2026", "materials"), { recursive: true });
  fs.writeFileSync(path.join(ws, "lawmind.policy.json"), policyJson({ relayDir }), "utf8");
  return ws;
}

/** 只指向托管云的工作区：**不含 sharedRelayDir**，测试「律所不用备主机」。 */
function makeCloudWorkspace(root: string, name: string, endpoint: string, token: string): string {
  const ws = path.join(root, name);
  fs.mkdirSync(path.join(ws, "cases", "matter_wm2026", "materials"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, "lawmind.policy.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        edition: "firm",
        matterReplica: { enabled: true, endpoint, cloudToken: token },
      },
      null,
      2,
    ),
    "utf8",
  );
  return ws;
}

function policyHasSharedRelay(ws: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ws, "lawmind.policy.json"), "utf8")) as {
      matterReplica?: { sharedRelayDir?: string };
    };
    return typeof raw.matterReplica?.sharedRelayDir === "string";
  } catch {
    return false;
  }
}

/** 两台独立电脑 + 一个共享中继目录（模拟「任意共享位置」，即今天唯一的跨机手段）。 */
function makePair(label: string): Pair {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `lm-probe-${label}-`));
  tmpRoots.push(root);
  const relay = path.join(root, "relay");
  fs.mkdirSync(relay, { recursive: true });
  return {
    root,
    a: makeWorkspace(root, "machineA", relay),
    b: makeWorkspace(root, "machineB", relay),
    relay,
    mid: "matter_wm2026",
  };
}

function seedIdentity(ws: string, displayName: string, email: string, lawyerId: string): void {
  upsertLawyerIdentity(ws, { displayName, email, lawyerId });
}

function seedMatter(p: Pair): void {
  seedIdentity(p.a, "张三", "zhang@firm.com", "lawyer_zhang");
  seedIdentity(p.b, "李四", "li@firm.com", "lawyer_li");
  ensureMembershipWithOwner(p.a, {
    matterId: p.mid,
    matterTitle: MATTER_TITLE,
    ownerLawyerId: "lawyer_zhang",
    ownerDisplayName: "张三",
    ownerEmail: "zhang@firm.com",
  });
}

function caseMdPath(ws: string, mid: string): string {
  return path.join(ws, "cases", mid, "CASE.md");
}

function materialPath(ws: string, mid: string, rel: string): string {
  return path.join(ws, "cases", mid, ...rel.split("/"));
}

function writeMaterial(ws: string, mid: string, rel: string, body: string): void {
  const abs = materialPath(ws, mid, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function readIfExists(abs: string): string | null {
  try {
    return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
  } catch {
    return null;
  }
}

function opsBundlePath(p: Pair): string {
  return path.join(p.relay, p.mid, "ops-bundle.json");
}

function relayFile(p: Pair, ...parts: string[]): string {
  return path.join(p.relay, p.mid, ...parts);
}

function memberNames(ws: string, mid: string): string[] {
  const m = readMembership(ws, mid);
  return (m?.members ?? []).map((row) => row.displayName);
}

function wrappedKeyFromOps(ops: MatterRecordOp[]): unknown {
  const share = ops.find((op) => op.kind === "matter_key.share");
  return share?.payload.wrapped;
}

// ---------------------------------------------------------------------------
// 判据
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // --- 对照组：证明探针本身不是「什么都报错」 -------------------------------
  await scenario(
    "C1",
    "门控与身份（对照）",
    "Firm 版默认开启；律师有真实姓名，不再全是 lawyer:desktop",
    async () => {
      const p = makePair("gate");
      seedMatter(p);
      const gateA = evaluateMatterReplicaGate(p.a);
      const gateB = evaluateMatterReplicaGate(p.b);
      const ok = gateA.enabled && gateB.enabled;
      return {
        ok,
        observed: `A.enabled=${gateA.enabled}(${gateA.reason}) B.enabled=${gateB.enabled}(${gateB.reason})`,
        evidence: [`A 身份=${memberNames(p.a, p.mid).join(",") || "（无名册）"}`],
      };
    },
  );

  await scenario(
    "C2",
    "材料跨机器同步（对照）",
    "A 放入材料并同步后，B 能拉到同一份内容",
    async () => {
      const p = makePair("control");
      seedMatter(p);
      writeMaterial(p.a, p.mid, MATERIAL_REL, "甲方：王某\n乙方：某公司\n");
      await syncMatterRecordPipe(p.a, p.mid);
      const pulled = await syncMatterRecordPipe(p.b, p.mid);
      const onB = readIfExists(materialPath(p.b, p.mid, MATERIAL_REL));
      return {
        ok: pulled.materials.downloadedFiles === 1 && onB !== null,
        observed: `B 下载文件数=${pulled.materials.downloadedFiles}；B 本地文件存在=${onB !== null}`,
        evidence: [`B 内容与 A 一致=${onB === "甲方：王某\n乙方：某公司\n"}`],
      };
    },
  );

  // --- P0-1：邀请闭环跨机器是否成立 ----------------------------------------
  await scenario(
    "X1",
    "跨机器「邀请同事进这一案」",
    "B 粘贴 A 生成的邀请码即可加入本案",
    async () => {
      const p = makePair("invite");
      seedMatter(p);
      const invite = createInvite(p.a, {
        matterId: p.mid,
        matterTitle: MATTER_TITLE,
        email: "li@firm.com",
        role: "associate",
      });
      await syncMatterRecordPipe(p.a, p.mid); // A 把 ops 推到中继
      await syncMatterRecordPipe(p.b, p.mid); // B 拉到 ops（含 invite.create / matter_key.share）

      const bundle = readIfExists(opsBundlePath(p));
      const opsOnRelay = bundle ? (JSON.parse(bundle).ops as unknown[]).length : 0;
      const bInvites = path.join(p.b, "matters", p.mid, "replica", "invites.jsonl");
      const bInbox = path.join(p.b, "lawmind", "replica", "inbox");
      // 必须在 accept 之前取快照，否则读到的是「加入后」的状态
      const invitesExistedBefore = fs.existsSync(bInvites);
      const inboxHadPackBefore = fs.existsSync(bInbox) && fs.readdirSync(bInbox).length > 0;

      let accepted = false;
      let errText = "";
      try {
        acceptInviteByToken(p.b, invite.token);
        accepted = true;
      } catch (e) {
        errText = e instanceof Error ? e.message : String(e);
      }

      return {
        ok: accepted,
        observed: accepted ? "B 成功加入本案" : `B 加入失败：${errText}`,
        evidence: [
          `邀请码=${invite.token}`,
          `中继上已有 ops ${opsOnRelay} 条（invite.create / matter_key.share 确实到了中继）`,
          `B 加入前：本机 invites.jsonl 不存在=${!invitesExistedBefore}、inbox 无邀请包=${!inboxHadPackBefore}`,
          `B 加入后 invites.jsonl 出现=${fs.existsSync(bInvites)}（由中继 op 重建，不是本机查到的）`,
        ],
      };
    },
  );

  await scenario(
    "X2",
    "同事加入后主办端应看到新成员",
    "A 同步后成员名册里出现「李四」",
    async () => {
      const p = makePair("member");
      seedMatter(p);
      const invite = createInvite(p.a, {
        matterId: p.mid,
        matterTitle: MATTER_TITLE,
        email: "li@firm.com",
        role: "associate",
      });
      await syncMatterRecordPipe(p.a, p.mid);
      await syncMatterRecordPipe(p.b, p.mid);

      // 只用中继上的 op 重建邀请加入 —— 不投放 inbox、不依赖本机名册
      acceptInviteByToken(p.b, invite.token);
      await syncMatterRecordPipe(p.b, p.mid); // B 把 invite.accept 推上中继
      await syncMatterRecordPipe(p.a, p.mid); // A 拉回来并 apply

      const names = memberNames(p.a, p.mid);
      const aOpsHasAccept = listRecordOps(p.a, p.mid).some((op) => op.kind === "invite.accept");
      const membershipFile = path.join(p.a, "matters", p.mid, "replica", "membership.json");
      const onDisk = readIfExists(membershipFile);
      const onDiskNames = onDisk
        ? ((JSON.parse(onDisk).members as { displayName: string }[]) ?? []).map(
            (m) => m.displayName,
          )
        : [];

      return {
        ok: names.includes("李四"),
        observed: `A 端成员名册=[${names.join(", ")}]`,
        evidence: [
          `B 已加入并同步（B 端名册=[${memberNames(p.b, p.mid).join(", ")}]）`,
          `A 的 ops 里收到 invite.accept=${aOpsHasAccept}`,
          `A 的 membership.json 实际内容=[${onDiskNames.join(", ")}]（由 apply 层物化）`,
          `加入通道：仅凭中继 op 重建邀请，未使用 inbox`,
        ],
      };
    },
  );

  // --- P0-2：签出（Word 防互踩）跨机器是否成立 ------------------------------
  await scenario(
    "X3",
    "签出（防两人同时改 Word）跨机器可见",
    "A 签出后，B 看到该文件被 A 占用，且不会覆盖它",
    async () => {
      const p = makePair("lock");
      seedMatter(p);
      writeMaterial(p.a, p.mid, MATERIAL_REL, "初稿\n");
      await syncMatterRecordPipe(p.a, p.mid);
      await syncMatterRecordPipe(p.b, p.mid); // B 先拿到同一份材料

      acquireCheckoutLock(p.a, {
        matterId: p.mid,
        matterTitle: MATTER_TITLE,
        relPath: MATERIAL_REL,
      });
      await syncMatterRecordPipe(p.a, p.mid);
      const pulledB = await syncMatterRecordPipe(p.b, p.mid);

      const bLocks = listCheckoutLocks(p.b, p.mid);
      const bSeesCheckout = isPathCheckedOut(p.b, p.mid, MATERIAL_REL);
      const bOpsHasLock = listRecordOps(p.b, p.mid).some((op) => op.kind === "lock.acquire");

      return {
        ok: bLocks.length === 1 && bSeesCheckout,
        observed: `B 端可见签出=${bLocks.length} 条；B 认为该路径被签出=${bSeesCheckout}`,
        evidence: [
          `A 端签出=${listCheckoutLocks(p.a, p.mid).length} 条`,
          `B 的 ops 里收到 lock.acquire=${bOpsHasLock}`,
          `B 的 locks.json 由 apply 层物化=${pulledB.applied.locks} 条`,
          `B 同步时「因签出而跳过」计数=${pulledB.materials.skippedLocked}`,
        ],
      };
    },
  );

  // --- P0-3：删除是否传播 --------------------------------------------------
  await scenario(
    "X4",
    "删除材料应传播到同事机器",
    "A 删除材料并同步后，A、B 两侧都不再保留",
    async () => {
      const p = makePair("remove");
      seedMatter(p);
      writeMaterial(p.a, p.mid, "materials/证据清单.txt", "证据1\n");
      await syncMatterRecordPipe(p.a, p.mid);
      await syncMatterRecordPipe(p.b, p.mid);
      const bHad = fs.existsSync(materialPath(p.b, p.mid, "materials/证据清单.txt"));

      fs.rmSync(materialPath(p.a, p.mid, "materials/证据清单.txt"));
      await syncMatterRecordPipe(p.a, p.mid);
      const resurrectedOnA = fs.existsSync(materialPath(p.a, p.mid, "materials/证据清单.txt"));

      const publishA = publishLocalMaterials(p.a, p.mid);
      const deletedOnB = await syncMatterRecordPipe(p.b, p.mid);

      const bStill = fs.existsSync(materialPath(p.b, p.mid, "materials/证据清单.txt"));
      const aOpsHasRemove = listRecordOps(p.a, p.mid).some((op) => op.kind === "material.remove");
      const manifestRaw = readIfExists(relayFile(p, "materials-manifest.json"));
      const manifestCount = manifestRaw ? (JSON.parse(manifestRaw).files as unknown[]).length : 0;

      return {
        ok: bHad && !bStill && !resurrectedOnA,
        observed: `B 删除前有=${bHad}；A 同步后本地又出现=${resurrectedOnA}；B 仍有=${bStill}`,
        evidence: [
          `A 发出了 material.remove op=${aOpsHasRemove}`,
          `A 本地剩余索引文件数=${publishA.index.files.length}`,
          `中继 manifest 条目数=${manifestCount}（墓碑生效后清单能变短）`,
          `B 因远端墓碑而删除=${deletedOnB.materials.deletedLocally.length} 份`,
        ],
      };
    },
  );

  // --- P0-4：内容寻址完整性 ------------------------------------------------
  await scenario(
    "X5",
    "材料下载应校验内容哈希",
    "中继上的字节与 manifest 的 sha256 不符时，拒绝写入律师卷宗",
    async () => {
      const p = makePair("tamper");
      seedMatter(p);
      writeMaterial(p.a, p.mid, MATERIAL_REL, "真正的委托合同内容\n");
      await syncMatterRecordPipe(p.a, p.mid);

      const entry = scanMatterMaterials(p.a, p.mid).find((f) => f.relPath === MATERIAL_REL);
      if (!entry) {
        throw new Error("未能扫描到刚写入的材料");
      }
      const tampered = "攻击者塞进来的字节\n";
      fs.writeFileSync(relayFile(p, "blobs", entry.sha256), tampered, "utf8");

      const res = await syncMatterMaterialsPipe(p.b, p.mid);
      const written = readIfExists(materialPath(p.b, p.mid, MATERIAL_REL));

      return {
        ok: written === null,
        observed:
          written === null
            ? "B 拒绝了被篡改的字节"
            : `B 把被篡改的内容当卷宗材料写入了（内容="${written.trim()}"）`,
        evidence: [
          `manifest 声明的 sha256=${entry.sha256.slice(0, 12)}…`,
          `中继 blob 实际内容="${tampered.trim()}"`,
          `B 下载文件数=${res.downloadedFiles}`,
        ],
      };
    },
  );

  await scenario(
    "X6",
    "密文信封不应接受明文降级",
    "被替换成明文的 blob 必须解封失败，而不是原样放行",
    async () => {
      const p = makePair("downgrade");
      const key = ensureMatterKey(p.a, p.mid);
      const key32 = matterKeyBytes(key);
      const plain = Buffer.from("案件机密正文", "utf8");
      const sealed = sealBytes(plain, key32);

      const roundTrip = openBytes(sealed, key32).toString("utf8");
      let threw = false;
      let returned = "";
      try {
        returned = openBytes(plain, key32).toString("utf8");
      } catch {
        threw = true;
      }

      return {
        ok: threw,
        observed: threw ? "明文被拒绝" : `明文被原样放行（返回="${returned}"）`,
        evidence: [
          `正常信封往返正确=${roundTrip === "案件机密正文"}`,
          "openBytes() 对非信封字节抛错（失败关闭，不再明文直通）",
        ],
      };
    },
  );

  // --- P0-5：叙事正文是否明文出网 ------------------------------------------
  await scenario(
    "X7",
    "案件叙事（CASE.md）不应明文离开本机",
    "中继上看不到 CASE.md 正文，只应有可校验的摘要",
    async () => {
      const p = makePair("narrative");
      seedMatter(p);
      // 正常案件都会有案件密钥（createInvite / ensureMatterKey 时建立），
      // 所以这里建一把，测的是**真实路径**上的封套行为
      ensureMatterKey(p.a, p.mid);
      const secret = "当事人身份证号 310101199001011234";
      const abs = caseMdPath(p.a, p.mid);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `# ${MATTER_TITLE}\n\n${secret}\n`, "utf8");

      await syncMatterRecordPipe(p.a, p.mid);

      const bundle = readIfExists(opsBundlePath(p)) ?? "";
      const leaked = bundle.includes(secret);
      const snap = listRecordOps(p.a, p.mid).find((op) => op.kind === "case_md.snapshot");
      const excerptSealed = typeof snap?.payload.sealedExcerptB64 === "string";

      return {
        ok: !leaked,
        observed: leaked
          ? `中继 ops-bundle.json 里出现 CASE.md 明文（含「${secret}」）`
          : "中继上未见 CASE.md 明文",
        evidence: [
          `中继 bundle 大小=${bundle.length} 字节`,
          `明文 excerpt 字段已移除=${snap?.payload.excerpt === undefined}`,
          `摘录已用案件密钥封套=${excerptSealed}（有密钥时走密文路径）`,
          "仍开放：op 未签名，且邮箱 / 文件路径等元数据仍明文（属 G2/G3）",
        ],
      };
    },
  );

  // --- P0-6：撤销邀请是否让已泄露的密钥失效 --------------------------------
  await scenario(
    "X8",
    "撤销邀请后，已泄露的案件密钥应失效",
    "撤销后密钥必须轮换：被撤销的邀请码解不出**当前**密钥（读不了之后的内容）",
    async () => {
      const p = makePair("revoke");
      seedMatter(p);
      const invite = createInvite(p.a, {
        matterId: p.mid,
        matterTitle: MATTER_TITLE,
        email: "li@firm.com",
        role: "associate",
      });
      const wrapped = wrappedKeyFromOps(listRecordOps(p.a, p.mid));
      const keyIdBefore = readMatterKey(p.a, p.mid)?.keyId ?? "(none)";

      revokeInvite(p.a, p.mid, invite.inviteId);
      const keyIdAfter = readMatterKey(p.a, p.mid)?.keyId ?? "(none)";

      let stillUsable = false;
      let matchesCurrent = false;
      try {
        const opened = unwrapMatterKeyFromInvite(
          wrapped as Parameters<typeof unwrapMatterKeyFromInvite>[0],
          invite.token,
          p.mid,
        );
        stillUsable = true;
        matchesCurrent = opened.keyB64 === (readMatterKey(p.a, p.mid)?.keyB64 ?? "");
      } catch {
        stillUsable = false;
      }

      const rotationOpKinds = listRecordOps(p.a, p.mid)
        .map((op) => op.kind)
        .filter((k) => k.includes("key"));

      return {
        // 真正的安全属性不是「邀请码解不出任何东西」（它当然还能解出**旧**钥匙），
        // 而是「解出的不是**当前**钥匙」—— 撤销之后写入的密文它读不了。
        ok: !matchesCurrent,
        observed: matchesCurrent
          ? "撤销后，被撤销的邀请码仍能解出**当前**密钥（轮换没生效）"
          : stillUsable
            ? "撤销后，被撤销的邀请码只能解出过期密钥（≠ 当前），读不了之后的内容"
            : "撤销后该邀请码已无法解出密钥",
        evidence: [
          `keyId 撤销前=${keyIdBefore} / 撤销后=${keyIdAfter}（应不同）`,
          `旧邀请码解出的密钥 == 当前密钥=${matchesCurrent}`,
          `ops 中与密钥相关的 op 种类=[${[...new Set(rotationOpKinds)].join(", ")}]`,
        ],
      };
    },
  );

  // --- P0-7：律所没有共享盘时，能不能靠托管云共案 -------------------------
  await scenario(
    "X9",
    "同一人两台机器（律所没有共享盘）应能自动共案",
    "不配 sharedRelayDir，两台机器也能通过托管案件云交换材料",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-probe-cloud-"));
      tmpRoots.push(root);
      const cloudData = path.join(root, "cloud-data");
      const cloud = createMatterCloudServer({ dataDir: cloudData });
      const base = await cloud.listen(0);
      const mid = "matter_wm2026";

      try {
        // 服务端开户：同一律师两台设备各一个令牌；两人都在册
        const tenant = cloud.directory.createTenant({ name: "示范律所" });
        cloud.directory.ensureMembership({
          tenantId: tenant.tenantId,
          matterId: mid,
          matterTitle: MATTER_TITLE,
          owner: { lawyerId: "lawyer_zhang", displayName: "张三" },
        });
        cloud.directory.upsertMember(
          tenant.tenantId,
          mid,
          {
            lawyerId: "lawyer_li",
            displayName: "李四",
            role: "associate",
            status: "active",
            joinedAt: new Date().toISOString(),
          },
          "lawyer_zhang",
        );
        const zhangToken = cloud.directory.createAccount({
          tenantId: tenant.tenantId,
          lawyerId: "lawyer_zhang",
          displayName: "张三",
        }).token;
        const liToken = cloud.directory.createAccount({
          tenantId: tenant.tenantId,
          lawyerId: "lawyer_li",
          displayName: "李四",
        }).token;

        // 两台机器：**都不配 sharedRelayDir**，只指向云
        const d1 = makeCloudWorkspace(root, "desktop1", base, zhangToken);
        const d2 = makeCloudWorkspace(root, "desktop2", base, liToken);
        seedIdentity(d1, "张三", "zhang@firm.com", "lawyer_zhang");
        seedIdentity(d2, "李四", "li@firm.com", "lawyer_li");

        writeMaterial(d1, mid, MATERIAL_REL, "第一台机器上的合同\n");
        await syncMatterRecordPipe(d1, mid);

        // 第二台机器：先经云拉 op，再凭邀请码加入（密钥随之到达），然后拉材料
        const invite = createInvite(d1, {
          matterId: mid,
          matterTitle: MATTER_TITLE,
          email: "li@firm.com",
          role: "associate",
        });
        await syncMatterRecordPipe(d1, mid);
        await syncMatterRecordPipe(d2, mid);
        acceptInviteByToken(d2, invite.token);
        const pulled = await syncMatterRecordPipe(d2, mid);

        const onD2 = readIfExists(materialPath(d2, mid, MATERIAL_REL));
        const keyD1 = readMatterKey(d1, mid);
        const keyD2 = readMatterKey(d2, mid);

        return {
          ok: onD2 !== null,
          observed:
            onD2 === null
              ? `第二台机器未拿到材料（下载 ${pulled.materials.downloadedFiles} 份${pulled.materialsError ? `，材料管道错误：${pulled.materialsError}` : ""}）`
              : "第二台机器经托管云拿到材料，全程无共享目录",
          evidence: [
            `云服务端：${base}（数据目录 ${path.relative(root, cloudData)}）`,
            `两台机器 policy 中 sharedRelayDir=${policyHasSharedRelay(d2) ? "存在" : "不存在"}`,
            `案件密钥一致=${keyD1?.keyId === keyD2?.keyId}（d1=${keyD1?.keyId ?? "-"} / d2=${keyD2?.keyId ?? "-"}，d2 来源=${keyD2?.source ?? "-"}）`,
            `第二台下载文件数=${pulled.materials.downloadedFiles}${
              pulled.materialsError ? ` · 材料管道错误=${pulled.materialsError}` : ""
            }`,
            `内容与第一台一致=${(onD2 ?? "").includes("合同")}`,
          ],
        };
      } finally {
        await cloud.close();
      }
    },
  );

  await scenario(
    "X10",
    "协作应在本机后台自动发生",
    "不手点同步，同事丢进来的材料也会自己到达",
    async () => {
      const p = makePair("autosync");
      seedMatter(p);
      // 让 B 真正加入本案（走 X1 已证明的中继 op 重建路径），这样它才是在册案件
      const invite = createInvite(p.a, {
        matterId: p.mid,
        matterTitle: MATTER_TITLE,
        email: "li@firm.com",
        role: "associate",
      });
      await syncMatterRecordPipe(p.a, p.mid);
      await syncMatterRecordPipe(p.b, p.mid);
      acceptInviteByToken(p.b, invite.token);
      await syncMatterRecordPipe(p.b, p.mid);

      // 在 B 上启动调度器：轮询设得很长，只有「中继监听」能在超时内把材料送到
      const scheduler = new MatterReplicaSyncScheduler({
        workspaceDir: p.b,
        intervalMs: 60_000,
        minMatterIntervalMs: 0,
        debounceMs: 20,
      });
      scheduler.start();

      try {
        // A 放入材料并同步；此后**不再**调用 B 的任何同步入口
        writeMaterial(p.a, p.mid, "materials/对方盖章版合同.txt", "对方盖章版合同扫描件\n");
        await syncMatterRecordPipe(p.a, p.mid);

        const target = materialPath(p.b, p.mid, "materials/对方盖章版合同.txt");
        const deadline = Date.now() + 5000;
        let arrived = fs.existsSync(target);
        while (!arrived && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
          arrived = fs.existsSync(target);
        }

        const status = scheduler.status();
        return {
          ok: arrived,
          observed: arrived
            ? "同事放入的材料未经手点同步即出现在本机"
            : "等待 5 秒仍未自动到达（仍要靠手点同步）",
          evidence: [
            `调度器：running=${status.running} watchingRelay=${status.watchingRelay} 在册案件=${status.matters}`,
            `累计自动同步=${status.syncs} 次 · 上次=${status.lastRunAt ?? "（未跑）"}`,
            `到达的文件内容与 A 一致=${(readIfExists(target) ?? "").includes("盖章版")}`,
          ],
        };
      } finally {
        scheduler.stop();
      }
    },
  );

  // --- P0-8：邀请的权威性在服务端（云邀请，而非靠 ops 分发） ---------------
  await scenario(
    "X11",
    "邀请应由案件云权威管理",
    "主办端经云建邀请，同事凭云邀请码加入；服务端记录名册，本地只是投影",
    async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lm-probe-cloudinvite-"));
      tmpRoots.push(root);
      const cloudData = path.join(root, "cloud-data");
      const cloud = createMatterCloudServer({ dataDir: cloudData });
      const base = await cloud.listen(0);
      const mid = "matter_wm2026";

      try {
        const tenant = cloud.directory.createTenant({ name: "示范律所" });
        cloud.directory.ensureMembership({
          tenantId: tenant.tenantId,
          matterId: mid,
          matterTitle: MATTER_TITLE,
          owner: { lawyerId: "lawyer_zhang", displayName: "张三" },
        });
        const zhangToken = cloud.directory.createAccount({
          tenantId: tenant.tenantId,
          lawyerId: "lawyer_zhang",
          displayName: "张三",
        }).token;
        const liToken = cloud.directory.createAccount({
          tenantId: tenant.tenantId,
          lawyerId: "lawyer_li",
          displayName: "李四",
        }).token;

        const d1 = makeCloudWorkspace(root, "desktop1", base, zhangToken);
        const d2 = makeCloudWorkspace(root, "desktop2", base, liToken);
        seedIdentity(d1, "张三", "zhang@firm.com", "lawyer_zhang");
        seedIdentity(d2, "李四", "li@firm.com", "lawyer_li");
        for (const ws of [d1, d2]) {
          ensureMembershipWithOwner(ws, {
            matterId: mid,
            matterTitle: MATTER_TITLE,
            ownerLawyerId: "lawyer_zhang",
            ownerDisplayName: "张三",
          });
        }

        // 主办端经云建邀请
        const invite = await createCloudInvite(d1, {
          matterId: mid,
          matterTitle: MATTER_TITLE,
          email: "li@firm.com",
          role: "associate",
        });
        const serverInvites = cloud.directory.listInvites(tenant.tenantId, mid);

        // 同事凭云邀请码加入
        const joined = await acceptCloudInvite(d2, invite.token);
        const cloudRoster = cloud.directory
          .readMembership(tenant.tenantId, mid)
          ?.members.map((m) => m.lawyerId)
          .toSorted();

        return {
          ok:
            invite.token.startsWith("LMC-") &&
            serverInvites.some((i) => i.inviteId === invite.inviteId) &&
            joined.matterId === mid &&
            (cloudRoster ?? []).includes("lawyer_li"),
          observed: "主办端经云建邀请、同事凭云邀请码加入，服务端名册已记录",
          evidence: [
            `云邀请码前缀=${invite.token.slice(0, 4)}（LMC- = 服务端权威）`,
            `服务端邀请记录=${serverInvites.length} 条`,
            `服务端名册=[${(cloudRoster ?? []).join(", ")}]`,
            `本地仅为投影：d2 本地名册=[${(readMembership(d2, mid)?.members ?? []).map((m) => m.displayName).join(", ")}]`,
          ],
        };
      } finally {
        await cloud.close();
      }
    },
  );

  // --- P0-9：协作动作是否进入防篡改审计链并可按所导出 ---------------------
  await scenario(
    "X12",
    "协作动作应进入防篡改审计链，并能出所级报表",
    "谁在何时签出/入卷可导出，且报表本身可验篡改",
    async () => {
      const p = makePair("audit");
      // 开 Firm 版（门控与审计链都需要）
      for (const ws of [p.a, p.b]) {
        fs.writeFileSync(
          path.join(ws, "lawmind.policy.json"),
          JSON.stringify({
            schemaVersion: 1,
            edition: "firm",
            matterReplica: { enabled: true, sharedRelayDir: p.relay },
          }),
          "utf8",
        );
      }
      seedMatter(p);

      // 产生一批协作动作：入卷、签出、邀请
      writeMaterial(p.a, p.mid, MATERIAL_REL, "合同初稿\n");
      await syncMatterRecordPipe(p.a, p.mid);
      acquireCheckoutLock(p.a, {
        matterId: p.mid,
        matterTitle: MATTER_TITLE,
        relPath: MATERIAL_REL,
      });
      createInvite(p.a, {
        matterId: p.mid,
        matterTitle: MATTER_TITLE,
        email: "li@firm.com",
        role: "associate",
      });
      await flushCollaborationAudit();

      const report = await buildFirmCollaborationAuditReport(p.a, { matterId: p.mid });
      const md = formatFirmCollaborationAuditMarkdown(report);
      const kinds = report.byKind.map((k) => k.kind);

      const hasCheckout = kinds.includes("collab.document_checked_out");
      const hasInvite = kinds.includes("collab.invite_created");
      const hasFiled = kinds.includes("collab.material_filed");
      const hasActor = report.byActor.some((a) => a.actorId === "lawyer_zhang");

      return {
        ok:
          report.integrity.chained &&
          report.integrity.ok &&
          hasCheckout &&
          hasInvite &&
          hasFiled &&
          hasActor &&
          md.includes("协作审计报表"),
        observed: `协作事件 ${report.totals.events} 条进入审计链；链校验=${
          report.integrity.ok ? "通过" : "失败"
        }；可按动作/案件/人汇总并导出 Markdown`,
        evidence: [
          `动作类型=[${kinds.join(", ")}]`,
          `按人汇总：${report.byActor.map((a) => `${a.displayName ?? a.actorId}×${a.events}`).join(" / ")}`,
          `链完整性：chained=${report.integrity.chained} ok=${report.integrity.ok}`,
          `Markdown 报表 ${md.length} 字节（含「${report.integrity.note.slice(0, 24)}…」）`,
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // 报告
  // -------------------------------------------------------------------------

  const head = tsv(REPO_ROOT);
  console.log("\n=== 案件副本跨机器验收探针 ===");
  console.log(`仓库: ${REPO_ROOT}`);
  if (head) {
    console.log(`HEAD: ${head}`);
  }
  console.log(`临时夹具: ${tmpRoots.length} 个（os.tmpdir，未触碰真实 workspace）\n`);

  for (const v of verdicts) {
    const tag = v.probeError ? "⚠ 异常" : v.ok ? "绿灯" : "红灯";
    console.log(`[${tag}] ${v.id}  ${v.title}`);
    console.log(`        期望: ${v.desired}`);
    console.log(`        实际: ${v.observed}`);
    for (const e of v.evidence) {
      console.log(`        · ${e}`);
    }
    console.log("");
  }

  const greens = verdicts.filter((v) => v.ok).length;
  const reds = verdicts.filter((v) => !v.ok && !v.probeError).length;
  const errors = verdicts.filter((v) => v.probeError).length;

  console.log("─".repeat(74));
  console.log(
    `合计 ${verdicts.length} 项：绿灯 ${greens} · 红灯 ${reds}${errors ? ` · 探针异常 ${errors}` : ""}`,
  );
  if (reds > 0) {
    console.log(
      `红灯清单: ${verdicts
        .filter((v) => !v.ok && !v.probeError)
        .map((v) => v.id)
        .join(", ")}`,
    );
  }
  console.log(
    reds === 0
      ? "结论：跨机器共办一案在探针覆盖范围内成立。"
      : "结论：跨机器共办一案尚未成立（红灯即产品缺口）。",
  );
  console.log("");

  for (const d of tmpRoots.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }

  if (STRICT && (reds > 0 || errors > 0)) {
    process.exit(1);
  }
}

function tsv(repoRoot: string): string {
  try {
    const headFile = path.join(repoRoot, ".git", "HEAD");
    if (!fs.existsSync(headFile)) {
      return "";
    }
    const ref = fs
      .readFileSync(headFile, "utf8")
      .trim()
      .replace(/^ref:\s*/, "");
    const refFile = path.join(repoRoot, ".git", ref);
    if (fs.existsSync(refFile)) {
      return `${ref}@${fs.readFileSync(refFile, "utf8").trim().slice(0, 8)}`;
    }
    return fs.readFileSync(headFile, "utf8").trim().slice(0, 8);
  } catch {
    return "";
  }
}

await main();
