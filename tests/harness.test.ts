import { describe, expect, it } from "vitest";
import {
  getHarness,
  resolveInstallTargets,
  portableHarness,
  detectHarnesses,
} from "../src/harness/registry.js";

describe("harness registry", () => {
  it("has portable agents adapter", () => {
    const p = portableHarness();
    expect(p.id).toBe("agents");
    expect(p.paths.user).toContain(".agents/skills");
  });

  it("resolves harness:opencode", () => {
    const t = resolveInstallTargets("harness:opencode", []);
    expect(t).toHaveLength(1);
    expect(t[0].id).toBe("opencode");
  });

  it("resolves bare id", () => {
    expect(resolveInstallTargets("claude-code", [])[0].id).toBe("claude-code");
  });

  it("lists known clients", () => {
    for (const id of [
      "agents",
      "claude-code",
      "opencode",
      "cursor",
      "codex",
      "gemini-cli",
      "copilot",
      "openclaw",
    ]) {
      expect(getHarness(id), id).toBeTruthy();
    }
  });

  it("does not treat zip harnesses as present", async () => {
    const detected = await detectHarnesses({ projectRoot: "/tmp" });
    const zip = detected.find((d) => d.id === "claude-ai-zip");
    expect(zip).toBeTruthy();
    expect(zip?.present).toBe(false);
    expect(zip?.installMode).toBe("zip");
  });
});
