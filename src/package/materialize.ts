import {
  cp,
  lstat,
  mkdir,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import type { InstallMode, SkillPackageInfo } from "../types.js";

export async function hashDirectory(root: string, files: string[]): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const hash = createHash("sha256");
  const sorted = [...files].sort();
  for (const rel of sorted) {
    hash.update(rel);
    hash.update("\0");
    hash.update(await readFile(join(root, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function materializeSkill(
  pkg: SkillPackageInfo,
  destSkillDir: string,
  opts: { mode?: InstallMode; force?: boolean } = {},
): Promise<{ path: string; mode: InstallMode }> {
  const mode = opts.mode ?? "copy";
  const dest = resolve(destSkillDir);
  const parent = dirname(dest);

  await mkdir(parent, { recursive: true });

  let exists = false;
  try {
    await lstat(dest);
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    if (!opts.force) {
      throw new Error(
        `skill already installed at ${dest} (use --force to overwrite)`,
      );
    }
    await rm(dest, { recursive: true, force: true });
  }

  if (mode === "symlink") {
    await symlink(pkg.root, dest, "dir");
    return { path: dest, mode };
  }

  await cp(pkg.root, dest, {
    recursive: true,
    filter: (src) => {
      const base = src.split(/[/\\]/).pop() ?? "";
      if (base === ".git" || base === "node_modules") return false;
      return true;
    },
  });
  return { path: dest, mode: "copy" };
}

export async function removeSkillDir(path: string): Promise<void> {
  await rm(resolve(path), { recursive: true, force: true });
}

export async function listSkillDirs(root: string): Promise<string[]> {
  try {
    const ents = await readdir(root, { withFileTypes: true });
    const names: string[] = [];
    for (const ent of ents) {
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
      const skillMd = join(root, ent.name, "SKILL.md");
      try {
        await lstat(skillMd);
        names.push(ent.name);
      } catch {
        // skip
      }
    }
    return names.sort();
  } catch {
    return [];
  }
}

export async function writeZipExport(
  pkg: SkillPackageInfo,
  zipPath: string,
): Promise<string> {
  // Minimal zip via system zip if available; otherwise write a marker + copy tree note
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  await mkdir(dirname(zipPath), { recursive: true });
  try {
    await execFileAsync(
      "zip",
      ["-r", "-q", zipPath, "."],
      { cwd: pkg.root },
    );
    return zipPath;
  } catch {
    // fallback: write tar-like instruction file
    const note = join(dirname(zipPath), `${pkg.name}.export.txt`);
    await writeFile(
      note,
      `zip CLI unavailable. Manually zip the skill directory:\n${pkg.root}\n`,
      "utf8",
    );
    throw new Error(
      `zip not available; wrote instructions to ${note}. Install zip or use directory harnesses.`,
    );
  }
}

export async function readSymlinkTarget(path: string): Promise<string | null> {
  try {
    const st = await lstat(path);
    if (!st.isSymbolicLink()) return null;
    return await readlink(path);
  } catch {
    return null;
  }
}
