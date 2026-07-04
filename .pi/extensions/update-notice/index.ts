import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";

// In-app update surfacing (issue #64, items 2 & 3).
//
// The launcher's pre-flight update check (bin/update-check.mjs) runs before pi
// starts and, when a newer little-coder is published, exports the version via
// LITTLE_CODER_UPDATE_AVAILABLE. This extension consumes that:
//   2. shows a one-line "update available" notice inside the running TUI, so a
//      user who dismissed / timed out of the launcher prompt still knows; and
//   3. registers `/update` to install the latest and cleanly end the session
//      for a restart — no need to quit, remember the npm incantation, and relaunch.
//
// Registering `/update` unconditionally (even with no pending update) is
// deliberate: it doubles as a manual "pull the latest" command. When a version
// is known from the launcher we pin to it; otherwise we install `@latest`.

// Exported for unit tests: build the npm argv used to upgrade in place. Mirrors
// the launcher's --ignore-scripts posture (issue #50 — block postinstall as a
// supply-chain landing spot on upgrade).
export function upgradeArgs(latest?: string) {
  const spec = latest ? `little-coder@${latest}` : "little-coder@latest";
  return ["install", "-g", "--ignore-scripts", spec];
}

export default function (pi: ExtensionAPI) {
  const available = process.env.LITTLE_CODER_UPDATE_AVAILABLE;

  if (available) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify(
        `little-coder v${available} is available — run /update to install it (then restart)`,
        "info",
      );
    });
  }

  pi.registerCommand("update", {
    description: "Install the latest little-coder and end this session so you can restart into it",
    handler: async (_args, ctx) => {
      const latest = process.env.LITTLE_CODER_UPDATE_AVAILABLE;
      const ok = await ctx.ui.confirm(
        `Update little-coder${latest ? ` to v${latest}` : " to the latest version"}?`,
        "This ends the current session — you'll relaunch little-coder to use the new version.",
      );
      if (!ok) return;

      ctx.ui.notify("updating little-coder… (this can take a moment)", "info");
      const args = upgradeArgs(latest);
      // On Windows `npm` is a .cmd shim spawnSync can't exec directly; go via
      // COMSPEC (same rationale as the launcher). Capture output rather than
      // inherit so npm's noise doesn't fight pi's TUI; we surface a summary.
      const result =
        process.platform === "win32"
          ? spawnSync(process.env.COMSPEC || "cmd.exe", ["/c", "npm", ...args], { encoding: "utf-8" })
          : spawnSync("npm", args, { encoding: "utf-8" });

      if (result.status === 0) {
        ctx.ui.notify(
          `✓ updated${latest ? ` to v${latest}` : ""} — relaunch little-coder to use it. Ending session…`,
          "info",
        );
        ctx.shutdown();
        return;
      }
      const why = result.error
        ? ((result.error as NodeJS.ErrnoException).code ?? result.error.message)
        : `npm exit ${result.status}`;
      ctx.ui.notify(
        `✗ update failed (${why}). Run manually: npm install -g --ignore-scripts little-coder@latest`,
        "error",
      );
    },
  });
}
