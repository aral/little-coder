import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Mid-run context watchdog (issue #59).
//
// pi only evaluates auto-compaction at a *user-turn boundary* — its
// `_checkCompaction` runs inside `_handlePostAgentRun`, which fires only after
// `agent.prompt()` has fully returned (i.e. once the model stops requesting
// tools and goes idle). During one long autonomous run this boundary is never
// reached: little-coder's small models routinely chain dozens of tool-call
// turns before yielding, so context grows unchecked and can blow straight past
// the window — pi then only reacts to the *overflow error* after the fact.
// charly1r reproduced exactly this: context climbing 34k → 40k → … → 64k across
// many `slot release` turns with no compaction until the request overflowed.
//
// pi does expose the levers to fix this from an extension: `ctx.getContextUsage()`
// reports live token usage against the active model's window, and `ctx.compact()`
// triggers pi's own compaction without awaiting it. This extension watches usage
// at every turn boundary and, once it crosses a threshold, proactively kicks off
// compaction — so a long single run compacts *before* it overflows, at roughly
// the same point pi would have if the model had yielded.
//
// Tuning / opt-out:
//   LITTLE_CODER_COMPACT_AT_PERCENT   trigger threshold, percent of the context
//                                     window (default 80). <=0 or >=100 disables.
//   LITTLE_CODER_NO_COMPACT_WATCHDOG=1  hard off.
//
// This is complementary to pi's end-of-run compaction, not a replacement — the
// `compacting` guard below keeps us from re-firing while a compaction is already
// in flight, and pi's own threshold/overflow paths still run at run boundaries.

export interface ContextUsageLike {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

const DEFAULT_PERCENT = 80;

// Resolve the trigger threshold (percent of context window). Non-numeric or
// missing → default. Returns 0 to mean "disabled" for out-of-band values
// (<=0 disables outright; >=100 leaves it to pi's own overflow recovery).
export function thresholdPercent(env: NodeJS.ProcessEnv = process.env): number {
  if (env.LITTLE_CODER_NO_COMPACT_WATCHDOG === "1") return 0;
  const raw = env.LITTLE_CODER_COMPACT_AT_PERCENT;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PERCENT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PERCENT;
  if (n <= 0 || n >= 100) return 0;
  return n;
}

// Pure decision: should we kick off compaction on this turn? True only when the
// watchdog is enabled, no compaction is already in flight, and we have a real
// usage reading at or above the threshold. `tokens == null` (e.g. right after a
// compaction, before the next LLM response) is treated as "unknown" → no-op.
export function shouldCompactNow(
  usage: ContextUsageLike | undefined,
  pct: number,
  compacting: boolean,
): boolean {
  if (pct <= 0) return false;
  if (compacting) return false;
  if (!usage) return false;
  if (usage.contextWindow <= 0) return false;
  if (usage.tokens === null || usage.percent === null) return false;
  return usage.percent >= pct;
}

export default function (pi: ExtensionAPI) {
  const pct = thresholdPercent();
  if (pct <= 0) return; // disabled — register nothing

  // In flight until the matching `session_compact` (or the next user prompt)
  // clears it, so a burst of turn_start events can't stack compaction calls.
  let compacting = false;

  pi.on("before_agent_start", async () => {
    // A fresh user prompt is a clean boundary; drop any stale in-flight flag so
    // a cancelled/failed compaction can't wedge the watchdog off permanently.
    compacting = false;
  });

  pi.on("turn_start", async (_event, ctx) => {
    const usage = ctx.getContextUsage?.();
    if (!shouldCompactNow(usage, pct, compacting)) return;
    compacting = true;
    const windowK = Math.round((usage!.contextWindow / 1000) * 10) / 10;
    ctx.ui.notify(
      `context at ${Math.round(usage!.percent!)}% of ${windowK}k — compacting mid-run to stay under the window`,
      "info",
    );
    // Fire-and-forget: pi runs compaction and the run continues on the compacted
    // transcript. We do NOT await (the API is explicitly non-awaiting).
    ctx.compact();
  });

  pi.on("session_compact", async () => {
    compacting = false;
  });
}
