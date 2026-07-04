import { describe, it, expect, beforeEach, afterEach } from "vitest";
import setupUpdateNotice, { upgradeArgs } from "./index.ts";

describe("upgradeArgs", () => {
  it("pins to the known latest version when provided", () => {
    expect(upgradeArgs("1.9.12")).toEqual([
      "install",
      "-g",
      "--ignore-scripts",
      "little-coder@1.9.12",
    ]);
  });

  it("falls back to @latest with no version, and always keeps --ignore-scripts", () => {
    const args = upgradeArgs();
    expect(args).toContain("--ignore-scripts");
    expect(args[args.length - 1]).toBe("little-coder@latest");
  });
});

describe("update-notice extension wiring", () => {
  const prev = process.env.LITTLE_CODER_UPDATE_AVAILABLE;
  afterEach(() => {
    if (prev === undefined) delete process.env.LITTLE_CODER_UPDATE_AVAILABLE;
    else process.env.LITTLE_CODER_UPDATE_AVAILABLE = prev;
  });

  function harness() {
    const handlers: Record<string, Function> = {};
    let command: { name: string; opts: any } | undefined;
    const pi = {
      on(event: string, handler: Function) {
        handlers[event] = handler;
      },
      registerCommand(name: string, opts: any) {
        command = { name, opts };
      },
    };
    setupUpdateNotice(pi as any);
    return { handlers, command };
  }

  it("always registers a /update command with a handler", () => {
    delete process.env.LITTLE_CODER_UPDATE_AVAILABLE;
    const { command } = harness();
    expect(command?.name).toBe("update");
    expect(typeof command?.opts.handler).toBe("function");
  });

  it("shows a session_start notice only when an update is available", () => {
    delete process.env.LITTLE_CODER_UPDATE_AVAILABLE;
    expect(harness().handlers.session_start).toBeUndefined();

    process.env.LITTLE_CODER_UPDATE_AVAILABLE = "1.9.12";
    expect(typeof harness().handlers.session_start).toBe("function");
  });

  it("session_start notice names the available version", async () => {
    process.env.LITTLE_CODER_UPDATE_AVAILABLE = "1.9.12";
    const { handlers } = harness();
    const notes: string[] = [];
    const ctx = { ui: { notify: (m: string) => notes.push(m) } };
    await handlers.session_start({}, ctx);
    expect(notes.join("\n")).toContain("1.9.12");
    expect(notes.join("\n")).toContain("/update");
  });

  it("/update aborts cleanly when the user declines the confirm", async () => {
    process.env.LITTLE_CODER_UPDATE_AVAILABLE = "1.9.12";
    const { command } = harness();
    let shutdownCalls = 0;
    const ctx = {
      ui: { confirm: async () => false, notify: () => {} },
      shutdown: () => shutdownCalls++,
    };
    await command!.opts.handler("", ctx);
    expect(shutdownCalls).toBe(0);
  });
});
