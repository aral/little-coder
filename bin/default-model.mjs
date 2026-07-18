// Default-model resolution for the launcher (issue #65).
//
// Goal: `little-coder` with no `--model` should "just work" by launching a
// configured default, and print that model's friendly name — without ever
// overriding a selection the user has already made. pi persists the user's
// pick as top-level `defaultProvider` + `defaultModel` in <agentDir>/settings.json,
// so we inject our default ONLY on first run (neither key set) and never when
// the user passed their own `--model` or this is a headless/sub-coder run.
//
// These helpers are pure and dependency-free so the launcher's disk/argv reads
// stay thin and the logic is unit-testable without a filesystem or pi runtime.

/** Split a "provider/id" model ref. Returns null unless it's a non-empty
 *  provider and id separated by a single "/". */
export function parseModelRef(ref) {
  if (typeof ref !== "string") return null;
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return null;
  const provider = ref.slice(0, slash);
  const id = ref.slice(slash + 1);
  if (!provider || !id) return null;
  return { provider, id };
}

/** Find a model's human name in a parsed models.json object. Falls back to the
 *  id when the model exists but declares no name; null when it doesn't resolve. */
export function lookupModelName(modelsObj, provider, id) {
  const p = modelsObj?.providers?.[provider];
  if (!p || !Array.isArray(p.models)) return null;
  const m = p.models.find((x) => x && x.id === id);
  if (!m) return null;
  return typeof m.name === "string" && m.name.length > 0 ? m.name : id;
}

/** Resolve the configured default from the shipped + user models objects. The
 *  user override's top-level `default` wins when present. Returns
 *  { ref, provider, id, name } or null when no valid default is configured. */
export function resolveConfiguredDefault(shippedObj, userObj) {
  const rawRef =
    (userObj && typeof userObj.default === "string" && userObj.default) ||
    (shippedObj && typeof shippedObj.default === "string" && shippedObj.default) ||
    null;
  if (!rawRef) return null;
  const parsed = parseModelRef(rawRef);
  if (!parsed) return null;
  const name =
    lookupModelName(userObj, parsed.provider, parsed.id) ??
    lookupModelName(shippedObj, parsed.provider, parsed.id) ??
    parsed.id;
  return { ref: rawRef, provider: parsed.provider, id: parsed.id, name };
}

/** Has pi already persisted a usable model selection? pi treats it as usable
 *  only when BOTH defaultProvider and defaultModel are truthy strings. */
export function piHasPersistedModel(settingsObj) {
  return Boolean(
    settingsObj &&
      typeof settingsObj.defaultProvider === "string" &&
      settingsObj.defaultProvider.length > 0 &&
      typeof settingsObj.defaultModel === "string" &&
      settingsObj.defaultModel.length > 0,
  );
}

/** Did the user pass their own --model on the CLI? If so we never inject. */
export function userPassedModel(argv) {
  return Array.isArray(argv) && argv.includes("--model");
}

/** Decide whether to inject the configured default, and what. Pure: the caller
 *  passes in what it read from disk/argv. Returns { ref, name } to inject, or
 *  null to leave pi's own selection untouched. */
export function decideDefaultModel({ configuredDefault, argv, piSettings, headless }) {
  if (headless) return null; // sub-coders / --mode runs control their own model
  if (!configuredDefault) return null; // no default configured → unchanged behavior
  if (userPassedModel(argv)) return null; // explicit --model wins
  if (piHasPersistedModel(piSettings)) return null; // respect the user's last-used pick
  return { ref: configuredDefault.ref, name: configuredDefault.name };
}
