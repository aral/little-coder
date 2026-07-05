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

// The instruction sent to the model to pick the task back up after a mid-run
// compaction. pi's threshold compaction is deliberately "compact, then let the
// user continue manually" — so an autonomous run left mid-task would otherwise
// just sit at the prompt (charly1r's v1.9.12 follow-up on #59). This user
// message resumes it automatically; the compaction summary immediately above it
// preserves what was already done.
export const RESUME_MESSAGE =
  "Your context was automatically compacted mid-task to stay within the model's window. " +
  "Continue the task from where you left off — the summary above preserves the work done so far. " +
  "Do not restart from scratch or re-ask the user; just carry on.";

export default function (pi: ExtensionAPI) {
  const pct = thresholdPercent();
  if (pct <= 0) return; // disabled — register nothing

  // In flight from the turn_start that fires compaction until compaction
  // resolves (onComplete/onError), so a burst of turn_start events can't stack
  // multiple compaction calls on top of each other.
  let compacting = false;

  pi.on("before_agent_start", async () => {
    // Each fresh user turn (including the auto-resume below) is a clean boundary;
    // drop any stale flag so a cancelled/failed compaction can't wedge the
    // watchdog off permanently.
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
    // pi's public compact() is the *manual* path: it aborts the in-flight run,
    // summarizes, then reconnects the agent and leaves it idle (no auto-retry).
    // On its own that strands an autonomous task at the prompt — so we resume it
    // from onComplete once the agent is back and idle. sendUserMessage always
    // triggers a turn, driving the run forward on the freshly-compacted context.
    ctx.compact({
      onComplete: () => {
        pi.sendUserMessage(RESUME_MESSAGE);
        compacting = false;
      },
      // "Nothing to compact" / cancelled etc.: clear the flag so a later turn
      // can try again rather than the watchdog going silent for the session.
      onError: () => {
        compacting = false;
      },
    });
  });
}
