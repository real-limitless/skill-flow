import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function packageRoot(): string {
  return PKG_ROOT;
}

export function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

export function skillFlowHome(): string {
  if (process.env.SKILL_FLOW_HOME?.trim()) {
    return resolve(process.env.SKILL_FLOW_HOME.trim());
  }
  return join(homeDir(), ".skill-flow");
}

export function projectRoot(override?: string): string {
  if (override?.trim()) return resolve(override.trim());
  if (process.env.SKILL_FLOW_PROJECT_ROOT?.trim()) {
    return resolve(process.env.SKILL_FLOW_PROJECT_ROOT.trim());
  }
  return resolve(process.cwd());
}

export function defaultCatalogDir(): string {
  if (process.env.SKILL_FLOW_CATALOG_DIR?.trim()) {
    return resolve(process.env.SKILL_FLOW_CATALOG_DIR.trim());
  }
  const inPkg = join(packageRoot(), "catalog");
  return inPkg;
}

export function statePath(): string {
  return join(skillFlowHome(), "state.json");
}

export function cacheDir(): string {
  return join(skillFlowHome(), "cache");
}

export function expandHome(p: string): string {
  if (p === "~") return homeDir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return join(homeDir(), p.slice(2));
  }
  return p;
}

/** Prefer repo-relative POSIX paths in catalog JSON (no CI absolute leaks). */
export function toRepoRelativePath(absPath: string): string {
  const abs = resolve(absPath);
  const rel = relative(packageRoot(), abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return abs;
  return rel.split("\\").join("/");
}

export function resolveStoredPath(stored: string): string {
  if (!stored.trim()) return stored;
  if (isAbsolute(stored) || stored.startsWith("~")) return expandHome(stored);
  return resolve(packageRoot(), stored);
}
