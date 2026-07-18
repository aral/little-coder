import { describe, it, expect } from "vitest";
import {
  parseModelRef,
  lookupModelName,
  resolveConfiguredDefault,
  piHasPersistedModel,
  userPassedModel,
  decideDefaultModel,
} from "./default-model.mjs";

const shipped = {
  default: "llamacpp/qwen3.6-35b-a3b",
  providers: {
    llamacpp: {
      models: [
        { id: "qwen3.6-27b", name: "Qwen3.6-27B (dense, local llama.cpp)" },
        { id: "qwen3.6-35b-a3b", name: "Qwen3.6-35B-A3B (MoE, local llama.cpp)" },
      ],
    },
  },
};

describe("parseModelRef", () => {
  it("splits provider/id", () => {
    expect(parseModelRef("llamacpp/qwen3.6-35b-a3b")).toEqual({
      provider: "llamacpp",
      id: "qwen3.6-35b-a3b",
    });
  });
  it("rejects malformed refs", () => {
    for (const bad of ["", "noslash", "/id", "provider/", "  ", null, undefined, 3]) {
      expect(parseModelRef(bad)).toBeNull();
    }
  });
  it("keeps only the first slash as the separator (ids may contain slashes)", () => {
    expect(parseModelRef("hf/org/model")).toEqual({ provider: "hf", id: "org/model" });
  });
});

describe("lookupModelName", () => {
  it("returns the human name", () => {
    expect(lookupModelName(shipped, "llamacpp", "qwen3.6-35b-a3b")).toBe(
      "Qwen3.6-35B-A3B (MoE, local llama.cpp)",
    );
  });
  it("falls back to the id when the model has no name", () => {
    const obj = { providers: { p: { models: [{ id: "bare" }] } } };
    expect(lookupModelName(obj, "p", "bare")).toBe("bare");
  });
  it("returns null when the ref does not resolve", () => {
    expect(lookupModelName(shipped, "llamacpp", "nope")).toBeNull();
    expect(lookupModelName(shipped, "ollama", "x")).toBeNull();
    expect(lookupModelName(undefined, "p", "x")).toBeNull();
  });
});

describe("resolveConfiguredDefault", () => {
  it("resolves the shipped default with its name", () => {
    expect(resolveConfiguredDefault(shipped, undefined)).toEqual({
      ref: "llamacpp/qwen3.6-35b-a3b",
      provider: "llamacpp",
      id: "qwen3.6-35b-a3b",
      name: "Qwen3.6-35B-A3B (MoE, local llama.cpp)",
    });
  });
  it("lets the user override's default win", () => {
    const user = {
      default: "llamacpp/qwen3.6-27b",
      providers: { llamacpp: { models: [{ id: "qwen3.6-27b", name: "My 27B" }] } },
    };
    expect(resolveConfiguredDefault(shipped, user)).toMatchObject({
      ref: "llamacpp/qwen3.6-27b",
      name: "My 27B",
    });
  });
  it("names an override default from the shipped file when the user omits the model entry", () => {
    const user = { default: "llamacpp/qwen3.6-27b" };
    expect(resolveConfiguredDefault(shipped, user)).toMatchObject({
      ref: "llamacpp/qwen3.6-27b",
      name: "Qwen3.6-27B (dense, local llama.cpp)",
    });
  });
  it("returns null with no default and for malformed defaults", () => {
    expect(resolveConfiguredDefault({ providers: {} }, undefined)).toBeNull();
    expect(resolveConfiguredDefault({ default: "garbage" }, undefined)).toBeNull();
  });
});

describe("piHasPersistedModel", () => {
  it("true only when both keys are present", () => {
    expect(piHasPersistedModel({ defaultProvider: "llamacpp", defaultModel: "x" })).toBe(true);
    expect(piHasPersistedModel({ defaultProvider: "llamacpp" })).toBe(false);
    expect(piHasPersistedModel({ defaultModel: "x" })).toBe(false);
    expect(piHasPersistedModel({})).toBe(false);
    expect(piHasPersistedModel(undefined)).toBe(false);
  });
});

describe("userPassedModel", () => {
  it("detects --model", () => {
    expect(userPassedModel(["--model", "p/id"])).toBe(true);
    expect(userPassedModel(["--thinking", "medium"])).toBe(false);
    expect(userPassedModel(undefined)).toBe(false);
  });
});

describe("decideDefaultModel", () => {
  const configuredDefault = resolveConfiguredDefault(shipped, undefined);

  it("injects on a first run (no --model, no persisted pi selection)", () => {
    expect(
      decideDefaultModel({ configuredDefault, argv: [], piSettings: {}, headless: false }),
    ).toEqual({ ref: "llamacpp/qwen3.6-35b-a3b", name: "Qwen3.6-35B-A3B (MoE, local llama.cpp)" });
  });

  it("does not override a user's persisted selection", () => {
    expect(
      decideDefaultModel({
        configuredDefault,
        argv: [],
        piSettings: { defaultProvider: "llamacpp", defaultModel: "qwen3.6-27b" },
        headless: false,
      }),
    ).toBeNull();
  });

  it("never injects when the user passed --model, when headless, or with no default", () => {
    expect(
      decideDefaultModel({ configuredDefault, argv: ["--model", "p/id"], piSettings: {}, headless: false }),
    ).toBeNull();
    expect(
      decideDefaultModel({ configuredDefault, argv: [], piSettings: {}, headless: true }),
    ).toBeNull();
    expect(
      decideDefaultModel({ configuredDefault: null, argv: [], piSettings: {}, headless: false }),
    ).toBeNull();
  });
});
