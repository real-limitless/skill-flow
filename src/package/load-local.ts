import { readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import type { SkillPackageInfo } from "../types.js";
import { parseSkillMdFile } from "./parse-skill-md.js";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".venv",
  "__pycache__",
  "dist",
  ".skill-flow-test",
]);

async function walkFiles(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith(".") && ent.name !== ".gitkeep") {
      if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;
      if (ent.isDirectory() && ent.name === ".git") continue;
    }
    if (ent.isDirectory() && SKIP_DIRS.has(ent.name)) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkFiles(root, full, out);
    } else if (ent.isFile()) {
      out.push(relative(root, full).split(sep).join("/"));
    }
  }
}

/**
 * Resolve a local skill directory. Accepts:
 * - path to skill root (contains SKILL.md)
 * - path to SKILL.md itself
 */
export async function loadLocalSkill(path: string): Promise<SkillPackageInfo> {
  const abs = resolve(path);
  const st = await stat(abs);
  let root: string;
  let skillMdPath: string;

  if (st.isFile()) {
    if (basename(abs) !== "SKILL.md") {
      throw new Error(`expected SKILL.md file, got ${basename(abs)}`);
    }
    root = resolve(abs, "..");
    skillMdPath = abs;
  } else if (st.isDirectory()) {
    root = abs;
    skillMdPath = join(root, "SKILL.md");
    await stat(skillMdPath);
  } else {
    throw new Error(`not a file or directory: ${abs}`);
  }

  const parsed = await parseSkillMdFile(skillMdPath);
  const files: string[] = [];
  await walkFiles(root, root, files);
  files.sort();

  const dirName = basename(root);
  if (dirName !== parsed.frontmatter.name) {
    parsed.warnings.push(
      `directory name "${dirName}" does not match frontmatter name "${parsed.frontmatter.name}"`,
    );
  }

  return {
    root,
    name: parsed.frontmatter.name,
    skillMdPath,
    files,
    parsed,
  };
}
