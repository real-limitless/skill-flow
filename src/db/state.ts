import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { statePath } from "../paths.js";
import type { InstalledSkill } from "../types.js";

export interface SkillFlowState {
  version: 1;
  installed: InstalledSkill[];
}

const EMPTY: SkillFlowState = { version: 1, installed: [] };

export async function loadState(path = statePath()): Promise<SkillFlowState> {
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw) as SkillFlowState;
    if (!data || data.version !== 1 || !Array.isArray(data.installed)) {
      return { ...EMPTY, installed: [] };
    }
    return data;
  } catch {
    return { ...EMPTY, installed: [] };
  }
}

export async function saveState(
  state: SkillFlowState,
  path = statePath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function recordInstall(
  entry: InstalledSkill,
  path = statePath(),
): Promise<void> {
  const state = await loadState(path);
  state.installed = state.installed.filter(
    (i) => !(i.name === entry.name && i.path === entry.path),
  );
  state.installed.push(entry);
  await saveState(state, path);
}

export async function recordUninstall(
  name: string,
  installPath?: string,
  path = statePath(),
): Promise<number> {
  const state = await loadState(path);
  const before = state.installed.length;
  state.installed = state.installed.filter((i) => {
    if (i.name !== name) return true;
    if (installPath && i.path !== installPath) return true;
    return false;
  });
  await saveState(state, path);
  return before - state.installed.length;
}
