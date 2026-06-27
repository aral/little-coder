import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Extend the bash whitelist with Kitten-specific commands so that
// `kitten`, `kitten update`, `kitten db`, etc. pass the permission-gate
// without requiring LITTLE_CODER_BASH_ALLOW.
//
// permission-gate reads LITTLE_CODER_BASH_ALLOW at runtime via
// getSafePrefixes(). This extension sets that env var during
// before_agent_start, merging kitten prefixes with any user-provided
// value.

const KITTEN_PREFIXES = "kitten ,kitten";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (_event) => {
    const existing = process.env.LITTLE_CODER_BASH_ALLOW ?? "";
    // Merge: existing prefixes + kitten prefixes, deduplicated.
    const merged = existing
      ? [...existing.split(","), ...KITTEN_PREFIXES.split(",")]
      : KITTEN_PREFIXES.split(",");
    process.env.LITTLE_CODER_BASH_ALLOW = Array.from(new Set(merged.map((s) => s.trim()).filter(Boolean))).join(",");
  });
}
