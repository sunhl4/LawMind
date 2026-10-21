import fs from "node:fs";
import { fileVersionOf } from "./file-version.js";

/** Unknown/unreadable is distinct from an absent destination. */
export function inspectFileVersion(
  abs: string,
):
  | { state: "file"; version: string }
  | { state: "missing"; version: "" }
  | { state: "unverifiable" } {
  const version = fileVersionOf(abs);
  if (version !== undefined) {
    return { state: "file", version };
  }
  try {
    fs.lstatSync(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { state: "missing", version: "" };
    }
  }
  return { state: "unverifiable" };
}
