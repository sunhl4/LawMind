/**
 * Matter Cloud HTTP routes mounted on the local desktop API (`/v1/matters/...`).
 * Firm-gated; store defaults to workspace/lawmind/replica-cloud.
 */

import {
  defaultMatterCloudDataDir,
  evaluateMatterReplicaGate,
  handleMatterCloudRequest,
  MatterCloudStore,
  sendMatterCloudResult,
} from "../../../src/lawmind/matter-replica/index.js";
import type { LawmindRouteContext } from "./lawmind-server-route-types.js";

const stores = new Map<string, MatterCloudStore>();

function storeFor(workspaceDir: string): MatterCloudStore {
  const gate = evaluateMatterReplicaGate(workspaceDir);
  const root =
    gate.sharedRelayDir || gate.cloudDataDir || defaultMatterCloudDataDir(workspaceDir);
  const key = `${workspaceDir}::${root}`;
  let store = stores.get(key);
  if (!store) {
    store = new MatterCloudStore(root);
    stores.set(key, store);
  }
  return store;
}

export async function handleMatterCloudRoutes({
  ctx,
  req,
  res,
  pathname,
}: LawmindRouteContext): Promise<boolean> {
  if (!pathname.startsWith("/v1/matters")) {
    return false;
  }
  const gate = evaluateMatterReplicaGate(ctx.workspaceDir);
  if (!gate.enabled) {
    sendMatterCloudResult(res, {
      status: 403,
      json: { ok: false, error: "matter cloud disabled" },
    });
    return true;
  }
  const result = await handleMatterCloudRequest(storeFor(ctx.workspaceDir), req, pathname);
  if (!result) {
    return false;
  }
  sendMatterCloudResult(res, result);
  return true;
}
