# skill-flow: agent guide

Self-hosted **Agent Skills catalog + install plane**. TypeScript / Node ≥ 22. MCP stdio + CLI.

## What this is

| Surface | Role |
| --- | --- |
| **MCP** | `sf_search_skills` → `sf_show_skill` → `sf_audit_skill` → `sf_install_skill` |
| **CLI** | doctor, harness, catalog, install, uninstall, list, audit |
| **Catalog** | Sharded `SkillGalleryEntry` under `catalog/entries/` |
| **Harness adapters** | Path matrix for agentskills.io clients |

Sibling: mcp-flow (MCP servers), ansible-flow-mcp (Ansible).

## Hard rules

1. Never commit secrets or `.env`.
2. Catalog never stores secret values.
3. Schema bumps → `catalog/schema.json` + `CATALOG_SCHEMA_VERSION` in `src/catalog/constants.ts`.
4. Do not scrape competitor marketplaces (e.g. mcpmarket) as catalog SoT: public git + seeds only.
5. Do not commit `catalog/entries/`, `index.json`, `meta.json` (gitignored) unless explicitly asked.
6. Install must require confirm; never execute skill scripts on install.
7. No force-push `main`; commit only when user asks.

## Layout

```text
src/
  cli.ts
  mcp/server.ts
  catalog/          # shard, from-package, constants
  package/          # parse SKILL.md, load local, resolve source, materialize
  harness/          # registry + install
  audit/scan.ts
  db/state.ts
  paths.ts
  types.ts
catalog/
  schema.json
  seed/             # created by catalog:seed
  entries/          # gitignored shards
scripts/catalog/seed.ts
scripts/site/build-pages.ts
docs/campaign/          # storyboard frames + capture.sh
docs/images/campaign-*.png
site/                   # marketing + catalog browser
tests/
```

## Dev

```bash
npm install
npm run typecheck
npm test
npm run build
npm run catalog:seed
npm run catalog:validate
npm run campaign:capture   # playwright → docs/images
npm run site:build
npx skill-flow doctor
```

## Ritual

`search → show → audit → install(confirm=true) → list_installed`

Default install target: **portable** (`.agents/skills`).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
