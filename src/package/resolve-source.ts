import { access, cp, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cacheDir } from "../paths.js";
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
    const pkg = await loadLocalSkill(entry.package.localPath);
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

    let skillRoot = tmp;
    if (opts.subpath) {
      skillRoot = join(tmp, opts.subpath);
    } else if (opts.skillPath) {
      // skillPath is path to SKILL.md
      const md = opts.skillPath.endsWith("SKILL.md")
        ? opts.skillPath
        : join(opts.skillPath, "SKILL.md");
      skillRoot = join(tmp, md, "..");
    } else {
      // find SKILL.md
      const found = await findSkillMd(tmp);
      if (!found) {
        throw new Error(`no SKILL.md found in cloned repo ${url}`);
      }
      skillRoot = join(found, "..");
    }

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

async function findSkillMd(root: string, depth = 0): Promise<string | null> {
  if (depth > 5) return null;
  const { readdir } = await import("node:fs/promises");
  const ents = await readdir(root, { withFileTypes: true });
  for (const ent of ents) {
    if (ent.isFile() && ent.name === "SKILL.md") {
      return join(root, ent.name);
    }
  }
  for (const ent of ents) {
    if (!ent.isDirectory()) continue;
    if (ent.name === ".git" || ent.name === "node_modules") continue;
    const found = await findSkillMd(join(root, ent.name), depth + 1);
    if (found) return found;
  }
  return null;
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
