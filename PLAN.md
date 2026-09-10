# [PLAN] skill-flow: Agent Skills catalog + install plane

## Summary

**skill-flow** catalogs Agent Skills (`SKILL.md` packages), audits them, and installs them into harness-specific filesystem paths via CLI and MCP. Ready for a static gallery site and factory enrichment (mcp-flow patterns).

## Locked decisions

| Concern | Choice |
| --- | --- |
| Name | skill-flow |
| Stack | TypeScript / Node ≥ 22 |
| v1 | Catalog + MCP install plane first |
| Default target | portable (`.agents/skills`) |
| Catalog SoT | Seeds + public git (factory); no marketplace HTML scrape |

## Phases

| Phase | Status |
| --- | --- |
| P0 scaffold | done |
| P1 install plane + MCP/CLI | done |
| P1b catalog schema + seed | done |
| P2 factory scrape/enrich | todo |
| P3 static site + campaign | done |
| P4 HTTP `/mcp` + browser `/admin` | done (TUI deferred) |

## Architecture

See README. Control plane writes skill trees; harnesses discover natively.

### P4 control plane

`skill-flow serve --http` serves `/health`, browser `/admin` (email/password operators), `/v1/*`, and Streamable HTTP `/mcp`. Accounts are **local to this instance** (not shared with mcp-flow or other Flow products). Env `SKILL_FLOW_ADMIN_TOKEN` remains break-glass Bearer for `/v1` and `/mcp`. Stdio `serve` (no `--http`) is unchanged. A curses TUI is **not** in this phase.

## Non-goals (v1)

- SaaS marketplace / payments
- Executing skill scripts inside skill-flow
- Replacing harness skill loaders
