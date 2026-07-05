import { describe, it, expect, vi } from "vitest";
import setupWatchdog, {
  thresholdPercent,
  shouldCompactNow,
  RESUME_MESSAGE,
  type ContextUsageLike,
} from "./index.ts";

describe("thresholdPercent", () => {
  it("defaults to 80 when unset", () => {
    expect(thresholdPercent({})).toBe(80);
    expect(thresholdPercent({ LITTLE_CODER_COMPACT_AT_PERCENT: "  " })).toBe(80);
  });

  it("honors a valid override", () => {
    expect(thresholdPercent({ LITTLE_CODER_COMPACT_AT_PERCENT: "70" })).toBe(70);
    expect(thresholdPercent({ LITTLE_CODER_COMPACT_AT_PERCENT: "92.5" })).toBe(92.5);
  });

  it("treats non-numeric as the default", () => {
    expect(thresholdPercent({ LITTLE_CODER_COMPACT_AT_PERCENT: "soon" })).toBe(80);
  });

  it("disables for out-of-band values (<=0 or >=100)", () => {
    expect(thresholdPercent({ LITTLE_CODER_COMPACT_AT_PERCENT: "0" })).toBe(0);
    expect(thresholdPercent({ LITTLE_CODER_COMPACT_AT_PERCENT: "-5" })).toBe(0);
    expect(thresholdPercent({ LITTLE_CODER_COMPACT_AT_PERCENT: "100" })).toBe(0);
    expect(thresholdPercent({ LITTLE_CODER_COMPACT_AT_PERCENT: "150" })).toBe(0);
  });

  it("hard-off via LITTLE_CODER_NO_COMPACT_WATCHDOG=1 overrides a percent", () => {
    expect(
      thresholdPercent({
        LITTLE_CODER_NO_COMPACT_WATCHDOG: "1",
        LITTLE_CODER_COMPACT_AT_PERCENT: "70",
      }),
    ).toBe(0);
  });
});

describe("shouldCompactNow", () => {
  const usage = (over: Partial<ContextUsageLike>): ContextUsageLike => ({
    tokens: 50000,
    contextWindow: 64000,
    percent: 78,
    ...over,
  });

  it("fires once usage is at/above the threshold", () => {
    expect(shouldCompactNow(usage({ percent: 80 }), 80, false)).toBe(true);
    expect(shouldCompactNow(usage({ percent: 95 }), 80, false)).toBe(true);
  });

  it("does not fire below the threshold", () => {
    expect(shouldCompactNow(usage({ percent: 79 }), 80, false)).toBe(false);
  });

  it("never fires while a compaction is already in flight", () => {
    expect(shouldCompactNow(usage({ percent: 99 }), 80, true)).toBe(false);
  });

  it("no-ops on unknown token usage (null right after compaction)", () => {
    expect(shouldCompactNow(usage({ tokens: null, percent: null }), 80, false)).toBe(false);
  });

  it("no-ops when disabled (pct<=0) or usage missing / window unknown", () => {
    expect(shouldCompactNow(usage({ percent: 99 }), 0, false)).toBe(false);
    expect(shouldCompactNow(undefined, 80, false)).toBe(false);
    expect(shouldCompactNow(usage({ contextWindow: 0 }), 80, false)).toBe(false);
  });

  it("reproduces #59 followup: after compaction, the run is resumed (not stranded at the prompt)", async () => {
    // Wire up the real extension against a mock pi/ctx and drive one turn_start
    // over the threshold. The key regression: pi's threshold compaction aborts
    // the run and does NOT auto-continue, so without a resume the task stalls.
    const env = process.env.LITTLE_CODER_COMPACT_AT_PERCENT;
    process.env.LITTLE_CODER_COMPACT_AT_PERCENT = "80";
    try {
      const handlers: Record<string, Function> = {};
      const sendUserMessage = vi.fn();
      const pi = {
        on: (evt: string, h: Function) => { handlers[evt] = h; },
        sendUserMessage,
      };
      setupWatchdog(pi as any);

      let capturedOpts: any;
      const ctx = {
        getContextUsage: () => ({ tokens: 52000, contextWindow: 64000, percent: 81 }),
        ui: { notify: vi.fn() },
        compact: (opts: any) => { capturedOpts = opts; },
      };

      await handlers.turn_start({}, ctx);
      // Compaction was requested with completion callbacks…
      expect(capturedOpts).toBeTruthy();
      expect(typeof capturedOpts.onComplete).toBe("function");
      // …and nothing is sent until compaction actually finishes.
      expect(sendUserMessage).not.toHaveBeenCalled();

      // Simulate pi finishing the compaction (agent reconnected + idle).
      capturedOpts.onComplete();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(sendUserMessage).toHaveBeenCalledWith(RESUME_MESSAGE);
    } finally {
      if (env === undefined) delete process.env.LITTLE_CODER_COMPACT_AT_PERCENT;
      else process.env.LITTLE_CODER_COMPACT_AT_PERCENT = env;
    }
  });

  it("does not re-fire while a compaction is mid-flight, then re-arms after it completes", async () => {
    const env = process.env.LITTLE_CODER_COMPACT_AT_PERCENT;
    process.env.LITTLE_CODER_COMPACT_AT_PERCENT = "80";
    try {
      const handlers: Record<string, Function> = {};
      const sendUserMessage = vi.fn();
      const pi = { on: (e: string, h: Function) => { handlers[e] = h; }, sendUserMessage };
      setupWatchdog(pi as any);

      const compact = vi.fn();
      const ctx = {
        getContextUsage: () => ({ tokens: 52000, contextWindow: 64000, percent: 81 }),
        ui: { notify: vi.fn() },
        compact,
      };

      await handlers.turn_start({}, ctx);       // fires
      await handlers.turn_start({}, ctx);       // guarded — still mid-flight
      expect(compact).toHaveBeenCalledTimes(1);

      compact.mock.calls[0][0].onComplete();    // compaction done, re-armed
      await handlers.turn_start({}, ctx);       // fires again
      expect(compact).toHaveBeenCalledTimes(2);
    } finally {
      if (env === undefined) delete process.env.LITTLE_CODER_COMPACT_AT_PERCENT;
      else process.env.LITTLE_CODER_COMPACT_AT_PERCENT = env;
    }
  });

  it("reproduces #59: a run climbing 34k→64k on a 64k window compacts before overflow", () => {
    const window = 64000;
    const pct = 80; // fires at 51.2k, ~13k of headroom before the 64k overflow
    let compacting = false;
    let firstCompactAt: number | null = null;
    for (const tokens of [34472, 40829, 46990, 52048, 55461, 58076, 62572]) {
      const u = usage({ tokens, contextWindow: window, percent: (tokens / window) * 100 });
      if (shouldCompactNow(u, pct, compacting)) {
        compacting = true; // pi compaction now in flight for the rest of the run
        if (firstCompactAt === null) firstCompactAt = tokens;
      }
    }
    expect(firstCompactAt).toBe(52048); // first turn past 80% — well before 64k
  });
});
