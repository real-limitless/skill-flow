import { join } from "node:path";
import { auditPackage } from "../audit/scan.js";
import { recordInstall, recordUninstall } from "../db/state.js";
import {
  hashDirectory,
  listSkillDirs,
  materializeSkill,
  removeSkillDir,
  writeZipExport,
} from "../package/materialize.js";
import { resolveSkillSource } from "../package/resolve-source.js";
import type {
  InstallRequest,
  InstallResult,
  InstallScope,
  SkillGalleryEntry,
} from "../types.js";
import {
  detectHarnesses,
  getHarness,
  resolveHarnessSkillRoot,
  resolveInstallTargets,
} from "./registry.js";
import { skillFlowHome } from "../paths.js";
import { mkdir } from "node:fs/promises";

export async function installSkill(
  req: InstallRequest,
  opts: {
    catalogLookup?: (id: string) => Promise<SkillGalleryEntry | null>;
  } = {},
): Promise<InstallResult> {
  if (!req.confirm) {
    throw new Error(
      "install requires confirm=true (CLI: pass --yes / MCP: confirm: true)",
    );
  }

  const { pkg, resolvedFrom } = await resolveSkillSource(req.source, {
    catalogLookup: opts.catalogLookup,
    subpath: req.subpath,
    ref: req.ref,
  });
  const audit = await auditPackage(pkg);
  const warnings = [...pkg.parsed.warnings];

  if (audit.risk === "high") {
    warnings.push(
      "HIGH risk audit flags present — review sf_audit_skill / audit output before trusting this skill",
    );
  }

  const detected = await detectHarnesses({ projectRoot: req.projectRoot });
  const targetStr =
    req.harnessId && !req.target
      ? `harness:${req.harnessId}`
      : (req.target ?? "portable");
  const adapters = resolveInstallTargets(targetStr, detected);
  const scope: InstallScope = req.scope ?? "user";
  const mode = req.mode ?? "copy";
  const paths: string[] = [];

  for (const adapter of adapters) {
    if (adapter.installMode === "zip") {
      const zipDir = join(skillFlowHome(), "exports");
      await mkdir(zipDir, { recursive: true });
      const zipPath = join(zipDir, `${pkg.name}.zip`);
      try {
        await writeZipExport(pkg, zipPath);
        paths.push(zipPath);
        warnings.push(
          `claude.ai zip export written to ${zipPath} — upload manually in Settings → Features`,
        );
      } catch (err) {
        warnings.push(
          err instanceof Error ? err.message : String(err),
        );
      }
      continue;
    }

    const root = resolveHarnessSkillRoot(adapter, scope, {
      projectRoot: req.projectRoot,
      genericPath: req.genericPath,
    });
    const dest = join(root, pkg.name);
    const result = await materializeSkill(pkg, dest, {
      mode,
      force: req.force,
    });
    paths.push(result.path);

    let sha256: string | undefined;
    try {
      sha256 = await hashDirectory(pkg.root, pkg.files);
    } catch {
      // optional
    }

    await recordInstall({
      name: pkg.name,
      path: result.path,
      harnessId: adapter.id,
      scope,
      sourceId: resolvedFrom,
      sha256,
      installedAt: new Date().toISOString(),
    });
  }

  if (!paths.length) {
    throw new Error("no install paths written");
  }

  return {
    name: pkg.name,
    source: resolvedFrom,
    paths,
    mode,
    warnings,
    audit,
  };
}

export async function uninstallSkill(opts: {
  name: string;
  target?: string;
  scope?: InstallScope;
  projectRoot?: string;
  genericPath?: string;
  harnessId?: string;
}): Promise<{ removed: string[] }> {
  const detected = await detectHarnesses({ projectRoot: opts.projectRoot });
  const targetStr =
    opts.harnessId && !opts.target
      ? `harness:${opts.harnessId}`
      : (opts.target ?? "portable");
  const adapters = resolveInstallTargets(targetStr, detected);
  const scope: InstallScope = opts.scope ?? "user";
  const removed: string[] = [];

  for (const adapter of adapters) {
    if (adapter.installMode !== "dir") continue;
    try {
      const root = resolveHarnessSkillRoot(adapter, scope, {
        projectRoot: opts.projectRoot,
        genericPath: opts.genericPath,
      });
      const dest = join(root, opts.name);
      await removeSkillDir(dest);
      removed.push(dest);
      await recordUninstall(opts.name, dest);
    } catch {
      // skip missing
    }
  }

  if (!removed.length) {
    throw new Error(`skill "${opts.name}" not found in target paths`);
  }
  return { removed };
}

export async function listInstalled(opts: {
  projectRoot?: string;
  scanAll?: boolean;
} = {}): Promise<
  Array<{
    name: string;
    path: string;
    harnessId: string;
    scope: InstallScope;
  }>
> {
  const detected = await detectHarnesses({ projectRoot: opts.projectRoot });
  const out: Array<{
    name: string;
    path: string;
    harnessId: string;
    scope: InstallScope;
  }> = [];
  const seen = new Set<string>();

  const adapters = opts.scanAll
    ? detected.filter((d) => d.installMode === "dir").map((d) => getHarness(d.id)!)
    : [getHarness("agents")!, getHarness("claude-code")!, getHarness("opencode")!];

  for (const adapter of adapters.filter(Boolean)) {
    for (const scope of ["user", "project"] as InstallScope[]) {
      try {
        const root = resolveHarnessSkillRoot(adapter, scope, {
          projectRoot: opts.projectRoot,
        });
        const names = await listSkillDirs(root);
        for (const name of names) {
          const path = join(root, name);
          const key = `${path}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ name, path, harnessId: adapter.id, scope });
        }
      } catch {
        // no path
      }
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return out;
}
