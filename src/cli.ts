#!/usr/bin/env node
import { Command } from "commander";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { auditPackage } from "./audit/scan.js";
import {
  loadIndex,
  listEntries,
  readEntry,
  rebuildIndex,
  searchIndex,
  writeEntry,
} from "./catalog/shard.js";
import { entryFromLocalPackage } from "./catalog/from-package.js";
import {
  installSkill,
  listInstalled,
  uninstallSkill,
} from "./harness/install.js";
import { detectHarnesses, HARNESS_REGISTRY } from "./harness/registry.js";
import { loadLocalSkill } from "./package/load-local.js";
import { resolveSkillSource } from "./package/resolve-source.js";
import { runStdioServer } from "./mcp/server.js";
import {
  defaultCatalogDir,
  packageRoot,
  projectRoot,
  skillFlowHome,
} from "./paths.js";
import type { InstallScope } from "./types.js";

const VERSION = "0.1.0";

function catalogLookup(dir: string) {
  return async (id: string) => readEntry(dir, id);
}

function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

async function main() {
  const program = new Command();
  program
    .name("skill-flow")
    .description(
      "Agent Skills catalog + install plane — search, audit, install SKILL.md into any harness",
    )
    .version(VERSION);

  program
    .command("serve")
    .description("Run MCP server (stdio)")
    .option("--catalog <dir>", "catalog directory", defaultCatalogDir())
    .action(async (opts: { catalog: string }) => {
      await runStdioServer({ catalogDir: opts.catalog });
    });

  program
    .command("doctor")
    .description("Environment + catalog health")
    .action(async () => {
      const catalogDir = defaultCatalogDir();
      let meta: unknown = null;
      try {
        meta = JSON.parse(await readFile(join(catalogDir, "meta.json"), "utf8"));
      } catch {
        meta = null;
      }
      const harnesses = await detectHarnesses();
      printJson({
        ok: true,
        version: VERSION,
        packageRoot: packageRoot(),
        skillFlowHome: skillFlowHome(),
        catalogDir,
        catalogMeta: meta,
        projectRoot: projectRoot(),
        harnessesPresent: harnesses.filter((h) => h.present).map((h) => h.id),
        node: process.version,
      });
    });

  program
    .command("harness")
    .description("Harness adapters")
    .addCommand(
      new Command("list")
        .description("List registry")
        .action(() => {
          printJson(
            HARNESS_REGISTRY.map((h) => ({
              id: h.id,
              displayName: h.displayName,
              paths: h.paths,
              installMode: h.installMode,
              notes: h.notes,
            })),
          );
        }),
    )
    .addCommand(
      new Command("detect")
        .description("Detect present harnesses")
        .option("--project <dir>", "project root")
        .action(async (opts: { project?: string }) => {
          printJson(
            await detectHarnesses({ projectRoot: opts.project }),
          );
        }),
    );

  const catalog = program.command("catalog").description("Catalog ops");

  catalog
    .command("search")
    .argument("<query>")
    .option("--limit <n>", "limit", "20")
    .option("--catalog <dir>", "catalog dir", defaultCatalogDir())
    .action(async (query: string, opts: { limit: string; catalog: string }) => {
      const index = await loadIndex(opts.catalog);
      printJson(searchIndex(index, query, Number(opts.limit) || 20));
    });

  catalog
    .command("show")
    .argument("<id>")
    .option("--catalog <dir>", "catalog dir", defaultCatalogDir())
    .action(async (id: string, opts: { catalog: string }) => {
      const entry = await readEntry(opts.catalog, id);
      if (!entry) {
        console.error(`not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      printJson(entry);
    });

  catalog
    .command("reindex")
    .option("--catalog <dir>", "catalog dir", defaultCatalogDir())
    .action(async (opts: { catalog: string }) => {
      const index = await rebuildIndex(opts.catalog);
      printJson({ count: index.entries.length, generatedAt: index.generatedAt });
    });

  catalog
    .command("add")
    .description("Add a local skill directory to the catalog")
    .argument("<path>")
    .option("--catalog <dir>", "catalog dir", defaultCatalogDir())
    .option("--id <id>", "stable id override")
    .option("--tag <tag>", "tag (repeatable)", (v, acc: string[]) => {
      acc.push(v);
      return acc;
    }, [] as string[])
    .action(
      async (
        path: string,
        opts: { catalog: string; id?: string; tag: string[] },
      ) => {
        const pkg = await loadLocalSkill(path);
        const entry = await entryFromLocalPackage(pkg, {
          id: opts.id,
          provenance: "manual",
          tags: opts.tag,
        });
        await writeEntry(opts.catalog, entry);
        await rebuildIndex(opts.catalog);
        printJson({ wrote: entry.id, name: entry.name });
      },
    );

  catalog
    .command("list")
    .option("--catalog <dir>", "catalog dir", defaultCatalogDir())
    .action(async (opts: { catalog: string }) => {
      const entries = await listEntries(opts.catalog);
      printJson(
        entries.map((e) => ({
          id: e.id,
          name: e.name,
          summary: e.summary,
          status: e.status,
        })),
      );
    });

  program
    .command("install")
    .description("Install a skill (local path, catalog id, or git URL)")
    .argument("<source>")
    .option("-t, --target <target>", "portable|detected|harness:<id>|generic", "portable")
    .option("-s, --scope <scope>", "user|project", "user")
    .option("-m, --mode <mode>", "copy|symlink", "copy")
    .option("--force", "overwrite existing", false)
    .option("-y, --yes", "confirm install", false)
    .option("--project <dir>", "project root for project scope")
    .option("--path <dir>", "generic install parent directory")
    .option("--catalog <dir>", "catalog dir", defaultCatalogDir())
    .action(
      async (
        source: string,
        opts: {
          target: string;
          scope: string;
          mode: string;
          force?: boolean;
          yes?: boolean;
          project?: string;
          path?: string;
          catalog: string;
        },
      ) => {
        const result = await installSkill(
          {
            source,
            target: opts.target as never,
            scope: opts.scope as InstallScope,
            mode: opts.mode as "copy" | "symlink",
            force: Boolean(opts.force),
            confirm: Boolean(opts.yes),
            projectRoot: opts.project,
            genericPath: opts.path,
          },
          { catalogLookup: catalogLookup(opts.catalog) },
        );
        printJson(result);
      },
    );

  program
    .command("uninstall")
    .argument("<name>")
    .option("-t, --target <target>", "portable|detected|harness:<id>", "portable")
    .option("-s, --scope <scope>", "user|project", "user")
    .option("--project <dir>")
    .option("--path <dir>", "generic path")
    .action(
      async (
        name: string,
        opts: {
          target: string;
          scope: string;
          project?: string;
          path?: string;
        },
      ) => {
        const result = await uninstallSkill({
          name,
          target: opts.target,
          scope: opts.scope as InstallScope,
          projectRoot: opts.project,
          genericPath: opts.path,
        });
        printJson(result);
      },
    );

  program
    .command("list")
    .description("List installed skills on disk")
    .option("--all", "scan all harness roots", false)
    .option("--project <dir>")
    .action(async (opts: { all?: boolean; project?: string }) => {
      printJson(
        await listInstalled({
          projectRoot: opts.project,
          scanAll: Boolean(opts.all),
        }),
      );
    });

  program
    .command("audit")
    .argument("<source>")
    .option("--catalog <dir>", "catalog dir", defaultCatalogDir())
    .action(async (source: string, opts: { catalog: string }) => {
      const { pkg, resolvedFrom } = await resolveSkillSource(source, {
        catalogLookup: catalogLookup(opts.catalog),
      });
      const audit = await auditPackage(pkg);
      printJson({
        name: pkg.name,
        resolvedFrom,
        files: pkg.files,
        warnings: pkg.parsed.warnings,
        audit,
      });
    });

  // ensure home exists for state
  await mkdir(skillFlowHome(), { recursive: true }).catch(() => undefined);

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
