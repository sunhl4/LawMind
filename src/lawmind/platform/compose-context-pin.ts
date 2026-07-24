/**
 * Typed `@` compose context pins — shared between desktop client and local API.
 */
import { z } from "zod";
import { isValidMatterId } from "../cases/matter-id.js";

const relPathString = z.string().trim().min(1).max(512);
const matterIdString = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine(isValidMatterId, "invalid_matter_id");

export const composeContextPinKindSchema = z.enum([
  "file",
  "evidence",
  "clause",
  "playbook",
  "theory",
]);

export type ComposeContextPinKind = z.infer<typeof composeContextPinKindSchema>;

export const fileContextPinSchema = z.object({
  pinKind: z.literal("file"),
  root: z.enum(["workspace", "project"]),
  relPath: relPathString,
  kind: z.enum(["file", "directory"]),
});

export type FileContextPin = z.infer<typeof fileContextPinSchema>;

/** Legacy wire shape (file pins sent before L2). */
export const legacyFileContextPinSchema = z.object({
  root: z.enum(["workspace", "project"]),
  relPath: relPathString,
  kind: z.enum(["file", "directory"]),
});

export const evidenceContextPinSchema = z.object({
  pinKind: z.literal("evidence"),
  matterId: matterIdString,
  relPath: relPathString,
});

export type EvidenceContextPin = z.infer<typeof evidenceContextPinSchema>;

export const clauseContextPinSchema = z
  .object({
    pinKind: z.literal("clause"),
    scope: z.enum(["full", "section"]),
    sectionHeading: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scope === "section" && !val.sectionHeading?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sectionHeading required when scope is section",
        path: ["sectionHeading"],
      });
    }
  });

export type ClauseContextPin = z.infer<typeof clauseContextPinSchema>;

export const playbookContextPinSchema = z.object({
  pinKind: z.literal("playbook"),
  playbookId: z.string().trim().min(1).max(128),
});

export type PlaybookContextPin = z.infer<typeof playbookContextPinSchema>;

export const theoryContextPinSchema = z.object({
  pinKind: z.literal("theory"),
  matterId: matterIdString,
});

export type TheoryContextPin = z.infer<typeof theoryContextPinSchema>;

export const composeContextPinSchema = z.discriminatedUnion("pinKind", [
  fileContextPinSchema,
  evidenceContextPinSchema,
  clauseContextPinSchema,
  playbookContextPinSchema,
  theoryContextPinSchema,
]);

export type ComposeContextPin = z.infer<typeof composeContextPinSchema>;

export type TruthSourceContextPin = Exclude<ComposeContextPin, FileContextPin>;

export const contextPinsRequestSchema = z
  .array(z.union([composeContextPinSchema, legacyFileContextPinSchema]))
  .max(16)
  .optional();

export type ContextPinsRequest = z.infer<typeof contextPinsRequestSchema>;

export function normalizeContextPin(raw: unknown): ComposeContextPin | null {
  const typed = composeContextPinSchema.safeParse(raw);
  if (typed.success) {
    return typed.data;
  }
  const legacy = legacyFileContextPinSchema.safeParse(raw);
  if (legacy.success) {
    return { pinKind: "file", ...legacy.data };
  }
  return null;
}

export function parseContextPins(raw: unknown): ComposeContextPin[] | { error: string } {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return { error: "contextPins must be an array" };
  }
  if (raw.length > 16) {
    return { error: "contextPins exceeds max length (16)" };
  }
  const out: ComposeContextPin[] = [];
  for (const entry of raw) {
    const pin = normalizeContextPin(entry);
    if (!pin) {
      return { error: "invalid context pin entry" };
    }
    out.push(pin);
  }
  return out;
}

export function encodeFileContextPin(payload: {
  root: "workspace" | "project";
  relPath: string;
  kind: "file" | "directory";
}): FileContextPin {
  return {
    pinKind: "file",
    root: payload.root,
    relPath: payload.relPath.trim(),
    kind: payload.kind,
  };
}

export function makeContextPinId(pin: ComposeContextPin): string {
  switch (pin.pinKind) {
    case "file":
      return `file:${pin.root}|${pin.kind}|${pin.relPath}`;
    case "evidence":
      return `evidence:${pin.matterId}|${pin.relPath}`;
    case "clause":
      return `clause:${pin.scope}|${pin.sectionHeading ?? "full"}`;
    case "playbook":
      return `playbook:${pin.playbookId}`;
    case "theory":
      return `theory:${pin.matterId}`;
    default: {
      const _exhaustive: never = pin;
      return String(_exhaustive);
    }
  }
}

export function buildContextPinsPayload(opts: {
  filePins: Array<{ root: "workspace" | "project"; relPath: string; kind: "file" | "directory" }>;
  truthPins: TruthSourceContextPin[];
}): ComposeContextPin[] {
  const seen = new Set<string>();
  const out: ComposeContextPin[] = [];
  for (const file of opts.filePins) {
    const pin = encodeFileContextPin(file);
    const id = makeContextPinId(pin);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(pin);
  }
  for (const pin of opts.truthPins) {
    const id = makeContextPinId(pin);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(pin);
  }
  return out;
}
