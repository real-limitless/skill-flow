import { access, cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cacheDir, resolveStoredPath } from "../paths.js";
import type { SkillGalleryEntry, SkillPackageInfo } from "../types.js";
import { loadLocalSkill } from "./load-local.js";

const execFileAsync = promisify(execFile);

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^git@/i.test(s);
}

function isGitUrl(s: string): boolean {
  if (/^git@/i.test(s)) return true;
  if (/^https?:\/\/(github\.com|gitlab\.com)\//i.test(s)) return true;
  if (s.endsWith(".git")) return true;
  return false;
}

/**
 * Resolve a source string or gallery entry into a local SkillPackageInfo.
 */
export async function resolveSkillSource(
  source: string,
  opts: {
    catalogLookup?: (id: string) => Promise<SkillGalleryEntry | null>;
    subpath?: string;
    ref?: string;
  } = {},
): Promise<{ pkg: SkillPackageInfo; resolvedFrom: string }> {
  const src = source.trim();

  // local path
  try {
    const abs = resolve(src);
    await access(abs);
    const st = await stat(abs);
    if (st.isDirectory() || st.isFile()) {
      const pkg = await loadLocalSkill(abs);
      return { pkg, resolvedFrom: `local:${abs}` };
    }
  } catch {
    // not local
  }

  // catalog id (before treating slashy strings as paths we already tried)
  if (opts.catalogLookup && !isUrl(src)) {
    const entry = await opts.catalogLookup(src);
    if (entry) {
      return resolveGalleryEntry(entry);
    }
  }

  // git / url
  if (isGitUrl(src) || isUrl(src)) {
    const pkg = await fetchGitSkill(src, {
      subpath: opts.subpath,
      ref: opts.ref,
    });
    return { pkg, resolvedFrom: src };
  }

  // final catalog attempt
  if (opts.catalogLookup) {
    const entry = await opts.catalogLookup(src);
    if (entry) return resolveGalleryEntry(entry);
  }

  throw new Error(
    `cannot resolve skill source: ${src} (not a local path, catalog id, or git URL)`,
  );
}

export async function resolveGalleryEntry(
  entry: SkillGalleryEntry,
): Promise<{ pkg: SkillPackageInfo; resolvedFrom: string }> {
  if (entry.package.kind === "local-path" && entry.package.localPath) {
    const pkg = await loadLocalSkill(resolveStoredPath(entry.package.localPath));
    return { pkg, resolvedFrom: entry.id };
  }

  const url = entry.package.url ?? entry.source.url;
  const subpath = entry.source.subpath;
  const ref = entry.source.ref;
  if (!url) throw new Error(`gallery entry ${entry.id} has no package URL`);

  if (entry.package.kind === "local-path") {
    throw new Error(`entry ${entry.id}: local-path missing localPath`);
  }

  const pkg = await fetchGitSkill(url, { subpath, ref, skillPath: entry.source.skillPath });
  return { pkg, resolvedFrom: entry.id };
}

async function fetchGitSkill(
  url: string,
  opts: { subpath?: string; ref?: string; skillPath?: string } = {},
): Promise<SkillPackageInfo> {
  await mkdir(cacheDir(), { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), "skill-flow-"));
  try {
    const args = ["clone", "--depth", "1"];
    if (opts.ref) {
      args.push("--branch", opts.ref);
    }
    args.push(url, tmp);
    try {
      await execFileAsync("git", args, { timeout: 120_000 });
    } catch (err) {
      throw new Error(
        `git clone failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const skillRoot = await resolveCloneSkillRoot(tmp, {
      subpath: opts.subpath,
      skillPath: opts.skillPath,
      url,
    });

    // copy out of tmp so caller owns stable path under cache
    const nameGuess = basename(skillRoot);
    const dest = join(cacheDir(), "pkgs", `${Date.now()}-${nameGuess}`);
    await mkdir(join(cacheDir(), "pkgs"), { recursive: true });
    await cp(skillRoot, dest, { recursive: true });
    return loadLocalSkill(dest);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".skill-flow-test",
]);

/** Collect SKILL.md paths under a clone (for tests and git install). */
export async function findSkillMdFiles(
  root: string,
  depth = 0,
): Promise<string[]> {
  if (depth > 5) return [];
  const { readdir } = await import("node:fs/promises");
  const ents = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const ent of ents) {
    if (ent.isFile() && ent.name === "SKILL.md") {
      files.push(join(root, ent.name));
    }
  }
  for (const ent of ents) {
    if (!ent.isDirectory()) continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    files.push(...(await findSkillMdFiles(join(root, ent.name), depth + 1)));
  }
  return files;
}

export async function resolveCloneSkillRoot(
  cloneRoot: string,
  opts: { subpath?: string; skillPath?: string; url?: string } = {},
): Promise<string> {
  const label = opts.url ?? cloneRoot;
  if (opts.subpath) {
    return join(cloneRoot, opts.subpath);
  }
  if (opts.skillPath) {
    const md = opts.skillPath.endsWith("SKILL.md")
      ? opts.skillPath
      : join(opts.skillPath, "SKILL.md");
    return join(cloneRoot, md, "..");
  }
  const found = await findSkillMdFiles(cloneRoot);
  if (found.length === 0) {
    throw new Error(`no SKILL.md found in cloned repo ${label}`);
  }
  if (found.length > 1) {
    const rels = found
      .map((f) => relative(cloneRoot, dirname(f)).split("\\").join("/") || ".")
      .sort();
    throw new Error(
      `cloned repo ${label} contains ${found.length} SKILL.md packages (${rels.join(", ")}). Pass --subpath to pick one skill package (a git URL must be a skill tree, not a product monorepo).`,
    );
  }
  return dirname(found[0]);
}

/** Write a minimal skill for tests / seed */
export async function writeMinimalSkill(
  dir: string,
  name: string,
  description: string,
  body = "# Skill\n\nDo the thing.\n",
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const md = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`;
  const path = join(dir, "SKILL.md");
  await writeFile(path, md, "utf8");
  return dir;
}
