# skill-flow: agent guide

Self-hosted **Agent Skills catalog + install plane**. TypeScript / Node ≥ 22. MCP stdio + CLI + HTTP `/mcp` + browser `/admin`.

## What this is

| Surface | Role |
| --- | --- |
| **MCP stdio** | `sf_search_skills` → `sf_show_skill` → `sf_audit_skill` → `sf_install_skill` |
| **HTTP** | `serve --http` → `/health` + `/admin` + `/v1` + `/mcp` (port 8788) |
| **CLI** | doctor, harness, catalog, install, uninstall, list, audit, operator |
| **Catalog** | Sharded `SkillGalleryEntry` under `catalog/entries/` |
| **Harness adapters** | Path matrix for agentskills.io clients |

Sibling: mcp-flow (MCP servers), ansible-flow-mcp (Ansible). Operator logins are **per product** — not shared SSO.

## Hard rules

1. Never commit secrets or `.env`.
2. Catalog never stores secret values.
3. Schema bumps → `catalog/schema.json` + `CATALOG_SCHEMA_VERSION` in `src/catalog/constants.ts`.
4. Do not scrape competitor marketplaces (e.g. mcpmarket) as catalog SoT: public git + seeds only.
5. Do not commit `catalog/entries/`, `index.json`, `meta.json` (gitignored) unless explicitly asked.
6. Install must require confirm; never execute skill scripts on install.
7. No force-push `main`; commit only when user asks.
8. `/mcp` is never unauthenticated. Human `/admin` uses email/password sessions; `SKILL_FLOW_ADMIN_TOKEN` is break-glass Bearer. Agent HTTP MCP uses the same token (stdio MCP stays process-trust).

## Layout

```text
src/
  cli.ts
  mcp/server.ts
  http/                 # Hono app + listen
  admin/                # /admin HTML (teal/vault campaign)
  auth/http.ts          # sf_op cookie + CSRF
  crypto.ts             # scrypt + tokens
  catalog/              # shard, from-package, constants
  package/              # parse SKILL.md, load local, resolve source, materialize
  harness/              # registry + install
  audit/scan.ts
  db/state.ts           # install records
  db/control.ts         # operators, sessions, audit_events
  paths.ts
  types.ts
catalog/
  schema.json
  seed/                 # created by catalog:seed
  entries/              # gitignored shards
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
npx @real-limitless/skill-flow doctor
npx @real-limitless/skill-flow serve --http   # /admin on :8788
npx @real-limitless/skill-flow operator add --email ops@example.com --password '********'
```

First operator: open `/admin/` (setup when empty). After that, login only — no open signup.

## Ritual

`search → show → audit → install(confirm=true) → list_installed`

Default install target: **portable** (`.agents/skills`).
