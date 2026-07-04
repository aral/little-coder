import { describe, it, expect } from "vitest";
import { thresholdPercent, shouldCompactNow, type ContextUsageLike } from "./index.ts";

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
