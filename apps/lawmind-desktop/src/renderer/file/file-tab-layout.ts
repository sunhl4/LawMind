/**
 * Tab labels keep the front of the filename and fold the tail.
 * Cap is about 9 Chinese characters so a long name does not take the whole column.
 * ASCII counts as half a character.
 */
export const WPS_TAB_NAME_UNITS = 9;

function unitOf(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return code > 0xff ? 1 : 0.5;
}

function unitsOf(text: string): number {
  let total = 0;
  for (const char of text) {
    total += unitOf(char);
  }
  return total;
}

function takeStart(text: string, maxUnits: number): string {
  let total = 0;
  let out = "";
  for (const char of text) {
    const next = total + unitOf(char);
    if (next > maxUnits + 1e-6) {
      break;
    }
    out += char;
    total = next;
  }
  return out;
}

/** Keep the front of the filename and fold the tail, the way a WPS tab does. */
export function wpsTabLabel(name: string, maxUnits = WPS_TAB_NAME_UNITS): string {
  if (unitsOf(name) <= maxUnits) {
    return name;
  }
  const head = takeStart(name, maxUnits - 1);
  if (!head || head.length >= name.length) {
    return name;
  }
  return `${head}…`;
}

/** Local path shown on the tab hover card, as folder segments. */
export function fileTabAddress(
  root: "workspace" | "project",
  relPath: string,
  workspaceDir: string,
  projectDir: string | null | undefined,
): string {
  const base = (root === "project" ? projectDir : workspaceDir)?.trim() ?? "";
  const rel = relPath.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const joined = base
    ? `${base.replace(/[\\/]+$/, "")}${rel ? `/${rel}` : ""}`
    : rel;
  const segments = joined.split(/[/\\]+/).filter((part) => part && part !== ".");
  return segments.join(" › ");
}
