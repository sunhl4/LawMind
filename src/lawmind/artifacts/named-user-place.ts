/**
 * Lawyer-named well-known folders (桌面 / 下载 / 文稿).
 *
 * Not a host-mount write grant and not full-disk write. Only these three
 * directories under the home folder may receive a deliverable when the
 * compiled delivery intent named them.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeliveryOutputPlace } from "../intent/delivery-intent.js";

export type NamedUserPlace = Exclude<DeliveryOutputPlace, "unspecified">;

const PLACE_LEAF: Record<NamedUserPlace, string> = {
  desktop: "Desktop",
  downloads: "Downloads",
  documents: "Documents",
};

export function resolveNamedUserPlaceDir(
  place: NamedUserPlace,
  opts?: { homeDir?: string },
): string {
  const home = path.resolve(opts?.homeDir?.trim() || os.homedir());
  return path.join(home, PLACE_LEAF[place]);
}

function realOrResolve(abs: string): string {
  try {
    return fs.realpathSync(abs);
  } catch {
    return path.resolve(abs);
  }
}

export function isAllowedNamedUserPlaceDir(abs: string, opts?: { homeDir?: string }): boolean {
  const resolved = realOrResolve(abs);
  const home = opts?.homeDir?.trim() || os.homedir();
  for (const place of Object.keys(PLACE_LEAF) as NamedUserPlace[]) {
    if (realOrResolve(resolveNamedUserPlaceDir(place, { homeDir: home })) === resolved) {
      return true;
    }
  }
  return false;
}

export function namedPlaceDirFromDelivery(
  outputPlace: DeliveryOutputPlace | undefined,
  opts?: { homeDir?: string },
): string | undefined {
  if (!outputPlace || outputPlace === "unspecified") {
    return undefined;
  }
  return resolveNamedUserPlaceDir(outputPlace, opts);
}
