import { access } from "node:fs/promises";
import { join } from "node:path";
import { expandHome, homeDir, projectRoot } from "../paths.js";
import type { DetectedHarness, HarnessAdapter, InstallScope } from "../types.js";

/** Data-driven harness path matrix (agentskills.io clients). */
export const HARNESS_REGISTRY: HarnessAdapter[] = [
  {
    id: "agents",
    displayName: "Portable (.agents)",
    paths: {
      user: "~/.agents/skills",
      project: ".agents/skills",
    },
    projectRel: ".agents/skills",
    installMode: "dir",
    notes: "Cross-client default (agentskills convention)",
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    paths: {
      user: "~/.claude/skills",
      project: ".claude/skills",
    },
    projectRel: ".claude/skills",
    installMode: "dir",
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    paths: {
      user: "~/.config/opencode/skills",
      project: ".opencode/skills",
    },
    projectRel: ".opencode/skills",
    installMode: "dir",
    notes: "Also discovers .claude and .agents skills",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    paths: {
      user: "~/.cursor/skills",
      project: ".cursor/skills",
    },
    projectRel: ".cursor/skills",
    installMode: "dir",
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    paths: {
      user: "~/.codex/skills",
      project: ".agents/skills",
    },
    projectRel: ".agents/skills",
    installMode: "dir",
    notes: "Project scope uses portable .agents/skills",
  },
  {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    paths: {
      user: "~/.gemini/skills",
      project: ".agents/skills",
    },
    projectRel: ".agents/skills",
    installMode: "dir",
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot / VS Code",
    paths: {
      user: "~/.copilot/skills",
      project: ".github/skills",
    },
    projectRel: ".github/skills",
    installMode: "dir",
  },
  {
    id: "openclaw",
    displayName: "OpenClaw",
    paths: {
      user: "~/.openclaw/skills",
      project: ".agents/skills",
    },
    projectRel: ".agents/skills",
    installMode: "dir",
  },
  {
    id: "goose",
    displayName: "Goose",
    paths: {
      user: "~/.config/goose/skills",
      project: ".agents/skills",
    },
    projectRel: ".agents/skills",
    installMode: "dir",
  },
  {
    id: "roo",
    displayName: "Roo Code",
    paths: {
      user: "~/.roo/skills",
      project: ".agents/skills",
    },
    projectRel: ".agents/skills",
    installMode: "dir",
  },
  {
    id: "amp",
    displayName: "Amp",
    paths: {
      user: "~/.config/amp/skills",
      project: ".agents/skills",
    },
    projectRel: ".agents/skills",
    installMode: "dir",
  },
  {
    id: "claude-ai-zip",
    displayName: "claude.ai (ZIP upload)",
    paths: {},
    installMode: "zip",
    notes: "Export zip for manual upload — no filesystem install",
  },
  {
    id: "generic",
    displayName: "Generic directory",
    paths: {},
    installMode: "dir",
    notes: "Requires --path / genericPath",
  },
];

export function getHarness(id: string): HarnessAdapter | undefined {
  return HARNESS_REGISTRY.find((h) => h.id === id);
}

export function portableHarness(): HarnessAdapter {
  return getHarness("agents")!;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export function resolveHarnessSkillRoot(
  adapter: HarnessAdapter,
  scope: InstallScope,
  opts: { projectRoot?: string; genericPath?: string } = {},
): string {
  if (adapter.id === "generic") {
    if (!opts.genericPath?.trim()) {
      throw new Error("generic harness requires --path / genericPath");
    }
    return expandHome(opts.genericPath.trim());
  }
  if (adapter.installMode === "zip" || adapter.installMode === "unsupported") {
    throw new Error(
      `harness ${adapter.id} does not support directory install (${adapter.installMode})`,
    );
  }
  if (scope === "user") {
    const p = adapter.paths.user;
    if (!p) throw new Error(`harness ${adapter.id} has no user path`);
    return expandHome(p);
  }
  const rel = adapter.projectRel ?? adapter.paths.project;
  if (!rel) throw new Error(`harness ${adapter.id} has no project path`);
  const root = projectRoot(opts.projectRoot);
  return join(root, rel);
}

export async function detectHarnesses(opts: {
  projectRoot?: string;
} = {}): Promise<DetectedHarness[]> {
  const proj = projectRoot(opts.projectRoot);
  const out: DetectedHarness[] = [];

  for (const h of HARNESS_REGISTRY) {
    if (h.id === "generic" || h.installMode === "zip") {
      out.push({
        id: h.id,
        displayName: h.displayName,
        present: h.installMode === "zip",
        installMode: h.installMode,
        notes: h.notes,
      });
      continue;
    }

    const userRoot = h.paths.user ? expandHome(h.paths.user) : undefined;
    const projectSkillRoot = h.projectRel
      ? join(proj, h.projectRel)
      : h.paths.project
        ? join(proj, h.paths.project)
        : undefined;

    // "present" if config dir or parent tool dir exists
    let present = false;
    if (userRoot) {
      const parent = join(userRoot, "..");
      present = (await exists(userRoot)) || (await exists(parent));
    }
    // Always treat portable agents as available
    if (h.id === "agents") present = true;

    // Heuristics for known tools
    if (h.id === "opencode") {
      present =
        (await exists(expandHome("~/.config/opencode"))) ||
        (await exists(expandHome("~/.opencode")));
    }
    if (h.id === "claude-code") {
      present = await exists(expandHome("~/.claude"));
    }
    if (h.id === "cursor") {
      present = await exists(expandHome("~/.cursor"));
    }

    out.push({
      id: h.id,
      displayName: h.displayName,
      present,
      userRoot,
      projectRoot: projectSkillRoot,
      installMode: h.installMode,
      notes: h.notes,
    });
  }

  // silence unused homeDir if tree-shaken concerns — keep for future
  void homeDir;
  return out;
}

export function resolveInstallTargets(
  target: string | undefined,
  detected: DetectedHarness[],
): HarnessAdapter[] {
  const t = (target ?? "portable").trim();
  if (t === "portable") return [portableHarness()];
  if (t === "detected") {
    const ids = detected
      .filter((d) => d.present && d.installMode === "dir" && d.id !== "generic")
      .map((d) => d.id);
    // Always include portable
    if (!ids.includes("agents")) ids.unshift("agents");
    return ids.map((id) => getHarness(id)!).filter(Boolean);
  }
  if (t === "generic" || t.startsWith("generic:")) {
    return [getHarness("generic")!];
  }
  if (t.startsWith("harness:")) {
    const id = t.slice("harness:".length);
    const h = getHarness(id);
    if (!h) throw new Error(`unknown harness: ${id}`);
    return [h];
  }
  // bare harness id
  const h = getHarness(t);
  if (h) return [h];
  throw new Error(
    `unknown install target "${t}" (use portable|detected|harness:<id>|generic)`,
  );
}
