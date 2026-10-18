import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { auditPackage } from "../audit/scan.js";
import { defaultCatalogDir, packageRoot, projectRoot } from "../paths.js";
import { loadIndex, readEntry, searchIndex } from "../catalog/shard.js";
import {
  installSkill,
  listInstalled,
  uninstallSkill,
} from "../harness/install.js";
import { detectHarnesses, HARNESS_REGISTRY } from "../harness/registry.js";
import { resolveSkillSource } from "../package/resolve-source.js";
import type { InstallScope, InstallTarget } from "../types.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const VERSION = "0.1.0";

function text(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function catalogLookup(catalogDir: string) {
  return async (id: string) => readEntry(catalogDir, id);
}

export function createSkillFlowServer(opts: {
  catalogDir?: string;
  projectRoot?: string;
} = {}): Server {
  const catalogDir = opts.catalogDir ?? defaultCatalogDir();
  const proj = () => projectRoot(opts.projectRoot);

  const server = new Server(
    { name: "skill-flow", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "sf_status",
        description:
          "skill-flow status: version, catalog meta, detected harnesses, defaults",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "sf_list_harnesses",
        description:
          "List harness adapters and whether they appear present on this machine",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" },
          },
        },
      },
      {
        name: "sf_search_skills",
        description:
          "Search the skill-flow catalog by name, description, tags. Ritual step 1.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
      {
        name: "sf_show_skill",
        description:
          "Show full catalog entry for a skill id or name. Ritual step 2.",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Catalog id or skill name" },
          },
          required: ["id"],
        },
      },
      {
        name: "sf_get_skill_file",
        description:
          "Read a file inside a local skill path or resolved source (preview, no install)",
        inputSchema: {
          type: "object",
          properties: {
            source: {
              type: "string",
            },
            path: {
              type: "string",
              description: "Relative path within skill (default SKILL.md)",
            },
            subpath: {
              type: "string",
              description: "Subdirectory in a git clone that contains SKILL.md",
            },
          },
          required: ["source"],
        },
      },
      {
        name: "sf_audit_skill",
        description:
          "Static risk audit of a skill package. Ritual step 3 before install.",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string" },
            subpath: {
              type: "string",
              description: "Subdirectory in a git clone that contains SKILL.md",
            },
          },
          required: ["source"],
        },
      },
      {
        name: "sf_install_skill",
        description:
          "Install a skill into harness path(s). Requires confirm=true. Ritual step 4. target: portable|detected|harness:<id>|generic",
        inputSchema: {
          type: "object",
          properties: {
            source: { type: "string" },
            target: { type: "string" },
            scope: { type: "string", enum: ["user", "project"] },
            mode: { type: "string", enum: ["copy", "symlink"] },
            force: { type: "boolean" },
            confirm: {
              type: "boolean",
              description: "Must be true to proceed",
            },
            projectRoot: { type: "string" },
            genericPath: { type: "string" },
            subpath: {
              type: "string",
              description: "Subdirectory in a git clone that contains SKILL.md",
            },
          },
          required: ["source", "confirm"],
        },
      },
      {
        name: "sf_uninstall_skill",
        description: "Remove an installed skill by name from target harness paths",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            target: { type: "string" },
            scope: { type: "string", enum: ["user", "project"] },
            projectRoot: { type: "string" },
            genericPath: { type: "string" },
          },
          required: ["name"],
        },
      },
      {
        name: "sf_list_installed",
        description: "Scan known harness roots for installed skills",
        inputSchema: {
          type: "object",
          properties: {
            projectRoot: { type: "string" },
            scanAll: { type: "boolean" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    try {
      switch (name) {
        case "sf_status": {
          let meta: unknown = null;
          try {
            meta = JSON.parse(
              await readFile(join(catalogDir, "meta.json"), "utf8"),
            );
          } catch {
            meta = { count: 0, note: "no catalog meta yet — run catalog:seed" };
          }
          const harnesses = await detectHarnesses({ projectRoot: proj() });
          return text({
            name: "skill-flow",
            version: VERSION,
            packageRoot: packageRoot(),
            catalogDir,
            projectRoot: proj(),
            catalog: meta,
            harnesses: harnesses.filter((h) => h.present),
            ritual: "search → show → audit → install(confirm=true)",
          });
        }
        case "sf_list_harnesses": {
          const pr =
            typeof args.projectRoot === "string"
              ? args.projectRoot
              : proj();
          const detected = await detectHarnesses({ projectRoot: pr });
          return text({
            registry: HARNESS_REGISTRY.map((h) => ({
              id: h.id,
              displayName: h.displayName,
              installMode: h.installMode,
              paths: h.paths,
              notes: h.notes,
            })),
            detected,
          });
        }
        case "sf_search_skills": {
          const query = String(args.query ?? "");
          const limit =
            typeof args.limit === "number" ? args.limit : 20;
          const index = await loadIndex(catalogDir);
          return text({
            query,
            results: searchIndex(index, query, limit),
            total: index.entries.length,
          });
        }
        case "sf_show_skill": {
          const id = String(args.id ?? "");
          const entry = await readEntry(catalogDir, id);
          if (!entry) {
            return text({ error: `skill not found: ${id}` });
          }
          return text(entry);
        }
        case "sf_get_skill_file": {
          const source = String(args.source ?? "");
          const rel = String(args.path ?? "SKILL.md").replace(
            /^[/\\]+/,
            "",
          );
          if (rel.includes("..")) {
            return text({ error: "path traversal denied" });
          }
          const { pkg } = await resolveSkillSource(source, {
            catalogLookup: catalogLookup(catalogDir),
            subpath:
              typeof args.subpath === "string" ? args.subpath : undefined,
          });
          if (!pkg.files.includes(rel) && rel !== "SKILL.md") {
            return text({
              error: `file not in package: ${rel}`,
              files: pkg.files,
            });
          }
          const content = await readFile(join(pkg.root, rel), "utf8");
          return text({ source, path: rel, content });
        }
        case "sf_audit_skill": {
          const source = String(args.source ?? "");
          const { pkg, resolvedFrom } = await resolveSkillSource(source, {
            catalogLookup: catalogLookup(catalogDir),
            subpath:
              typeof args.subpath === "string" ? args.subpath : undefined,
          });
          const audit = await auditPackage(pkg);
          return text({
            name: pkg.name,
            resolvedFrom,
            files: pkg.files,
            warnings: pkg.parsed.warnings,
            audit,
          });
        }
        case "sf_install_skill": {
          const result = await installSkill(
            {
              source: String(args.source ?? ""),
              target: args.target as InstallTarget | undefined,
              scope: args.scope as InstallScope | undefined,
              mode: args.mode as "copy" | "symlink" | undefined,
              force: Boolean(args.force),
              confirm: Boolean(args.confirm),
              projectRoot:
                typeof args.projectRoot === "string"
                  ? args.projectRoot
                  : proj(),
              genericPath:
                typeof args.genericPath === "string"
                  ? args.genericPath
                  : undefined,
              subpath:
                typeof args.subpath === "string" ? args.subpath : undefined,
            },
            { catalogLookup: catalogLookup(catalogDir) },
          );
          return text(result);
        }
        case "sf_uninstall_skill": {
          const result = await uninstallSkill({
            name: String(args.name ?? ""),
            target:
              typeof args.target === "string" ? args.target : undefined,
            scope: args.scope as InstallScope | undefined,
            projectRoot:
              typeof args.projectRoot === "string"
                ? args.projectRoot
                : proj(),
            genericPath:
              typeof args.genericPath === "string"
                ? args.genericPath
                : undefined,
          });
          return text(result);
        }
        case "sf_list_installed": {
          const result = await listInstalled({
            projectRoot:
              typeof args.projectRoot === "string"
                ? args.projectRoot
                : proj(),
            scanAll: Boolean(args.scanAll),
          });
          return text({ installed: result });
        }
        default:
          return text({ error: `unknown tool: ${name}` });
      }
    } catch (err) {
      return text({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return server;
}

export async function runStdioServer(opts?: {
  catalogDir?: string;
  projectRoot?: string;
}): Promise<void> {
  const server = createSkillFlowServer(opts);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
