import { shouldRaiseToolDecisionOutput } from "./tool-decision-sampling.js";

/** The bounded policy driver shared by parent turns and read-only workers. */
export async function runSamplingLoop<T>(opts: {
  maxRounds: number;
  step: (round: number) => Promise<"continue" | "stop" | T>;
}): Promise<T | undefined> {
  for (let round = 0; round < opts.maxRounds; round += 1) {
    const outcome = await opts.step(round);
    if (outcome === "stop") {
      return undefined;
    }
    if (outcome !== "continue") {
      return outcome;
    }
  }
  return undefined;
}

/** Shared model decision semantics, not a second HTTP retry loop. */
export async function sampleModelDecision<
  T extends { choices?: Array<{ finish_reason?: string | null }> },
>(opts: {
  sample: (mode: "decision" | "deliverable") => Promise<T>;
  toolsAdvertised: boolean;
  configuredMaxTokens?: number;
  flags: { emptyChoiceRetryUsed: boolean };
  onResponse?: (response: T) => void;
  onRaiseOutput?: () => void;
}): Promise<{ response: T; outputRaised: boolean }> {
  const sample = async (mode: "decision" | "deliverable") => {
    const response = await opts.sample(mode);
    opts.onResponse?.(response);
    return response;
  };
  let response = await sample("decision");
  if (!response.choices?.[0] && !opts.flags.emptyChoiceRetryUsed) {
    opts.flags.emptyChoiceRetryUsed = true;
    response = await sample("decision");
  }
  const choice = response.choices?.[0];
  if (!choice) {
    throw new Error("Empty response from model");
  }
  const outputRaised = shouldRaiseToolDecisionOutput({
    toolsAdvertised: opts.toolsAdvertised,
    configuredMaxTokens: opts.configuredMaxTokens,
    finishReason: choice.finish_reason,
  });
  if (outputRaised) {
    opts.onRaiseOutput?.();
    response = await sample("deliverable");
    if (!response.choices?.[0]) {
      throw new Error("Empty response from model");
    }
  }
  return { response, outputRaised };
}
