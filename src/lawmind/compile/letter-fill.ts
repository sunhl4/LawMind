/**
 * Letter address slots from the instruction. Never invent 收函/委托人.
 */

import type { CompileFillIR } from "./compile-fill.js";
import { collectGaps } from "./compile-fill.js";

export type LetterAddressFill = {
  to?: string;
  client?: string;
  gaps: string[];
};

function firstNamedSlot(instruction: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const hit = instruction.match(re)?.[1]?.trim();
    if (hit) {
      return hit.slice(0, 40);
    }
  }
  return undefined;
}

export function extractLetterAddressFill(instruction: string): LetterAddressFill {
  const to = firstNamedSlot(instruction, [
    /致[：:]\s*([^\n，。;；]{1,40})/,
    /发给\s*([^\n，。;；]{1,40}?)(?:的)?(?:催告函|律师函)/,
  ]);
  const client = firstNamedSlot(instruction, [/(?:委托人|我方当事人)[：:]\s*([^\n，。;；]{1,40})/]);
  const gaps: string[] = [];
  if (!to) {
    gaps.push("收函对象");
  }
  if (!client) {
    gaps.push("委托人名称");
  }
  return { to, client, gaps };
}

export function letterAddressToFill(fill: LetterAddressFill): CompileFillIR {
  const slots = [
    {
      key: "to",
      label: "收函对象",
      value: fill.to,
      gap: fill.to ? undefined : "收函对象",
    },
    {
      key: "client",
      label: "委托人名称",
      value: fill.client,
      gap: fill.client ? undefined : "委托人名称",
    },
  ];
  return {
    kind: "letter.address",
    slots,
    gaps: collectGaps(slots),
    computed: fill,
  };
}

export function letterAddressSlots(instruction: string): { to: string; client: string } {
  const ir = extractLetterAddressCompileFill(instruction);
  const fill = ir.computed as LetterAddressFill;
  return {
    to: fill.to ?? "【收函对象】",
    client: fill.client ?? "【委托人名称】",
  };
}

export function extractLetterAddressCompileFill(instruction: string): CompileFillIR {
  return letterAddressToFill(extractLetterAddressFill(instruction));
}
