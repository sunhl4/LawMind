/**
 * Concurrent conversations share one process.
 * Fake model servers, real runTurn. Two chats sample together; a third waits.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resetTurnAdmissionForTests } from "../runtime/turn-admission.js";
import { cassetteAssistant } from "./testkit/index.js";
import { TestLawMind } from "./testkit/test-lawmind.js";
import type { RunTurnEvent } from "./turn-orchestrator-events.js";

describe("concurrent conversations", () => {
  const previous = process.env.LAWMIND_MAX_MODEL_CONCURRENCY;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.LAWMIND_MAX_MODEL_CONCURRENCY;
    } else {
      process.env.LAWMIND_MAX_MODEL_CONCURRENCY = previous;
    }
    resetTurnAdmissionForTests();
  });

  it("samples two chats together and queues the third for a model slot", async () => {
    process.env.LAWMIND_MAX_MODEL_CONCURRENCY = "2";
    resetTurnAdmissionForTests();
    const release: Array<() => void> = [];
    let entered = 0;
    const waits: RunTurnEvent[] = [];
    const harnesses: TestLawMind[] = [];

    const hold = () =>
      new Promise<void>((resolve) => {
        entered += 1;
        release.push(resolve);
      });

    const open = async (label: string) => {
      const harness = await TestLawMind.builder().build();
      harnesses.push(harness);
      harness.onModelRequest(async () => {
        await hold();
      });
      harness.enqueue(cassetteAssistant(label));
      return harness;
    };

    const runs: Array<Promise<unknown>> = [];
    try {
      const [first, second, third] = await Promise.all([open("甲"), open("乙"), open("丙")]);
      runs.push(
        first.runTurn("甲"),
        second.runTurn("乙"),
        third.runTurn("丙", {
          onEvent: (event) => {
            if (event.type === "turn_wait") {
              waits.push(event);
            }
          },
        }),
      );
      const started = Date.now();
      while (entered < 2 || waits.length < 1) {
        if (Date.now() - started > 20_000) {
          throw new Error(`timed out entered=${entered} waits=${waits.length}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(entered).toBe(2);
      expect(waits[0]).toMatchObject({ type: "turn_wait", reason: "model_slot" });
      release.shift()?.();
      release.shift()?.();
      while (entered < 3) {
        if (Date.now() - started > 20_000) {
          throw new Error(`third chat did not start entered=${entered}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      release.shift()?.();
      await Promise.all(runs);
      expect(first.requests).toHaveLength(1);
      expect(second.requests).toHaveLength(1);
      expect(third.requests).toHaveLength(1);
    } finally {
      while (release.length > 0) {
        release.shift()?.();
      }
      await Promise.allSettled(runs);
      await Promise.all(harnesses.map((harness) => harness.close()));
    }
  }, 30_000);
});
