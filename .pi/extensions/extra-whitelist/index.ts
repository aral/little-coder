import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Extend the bash whitelist with tools that are not included in little-coder by default but which are both useful and not dangerous.
const EXTRA_WHITELIST = "sleep,nohup,curl";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (_event) => {
    const existing = process.env.LITTLE_CODER_BASH_ALLOW ?? "";
    // Merge: existing whitelist + extra prefixes, deduplicated.
    const merged = existing
      ? [...existing.split(","), ...EXTRA_WHITELIST.split(",")]
      : EXTRA_WHITELIST.split(",");
    process.env.LITTLE_CODER_BASH_ALLOW = Array.from(new Set(merged.map((s) => s.trim()).filter(Boolean))).join(",");
  });
}
