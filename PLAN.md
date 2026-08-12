# [PLAN] skill-flow — Agent Skills catalog + install plane

## Summary

**skill-flow** catalogs Agent Skills (`SKILL.md` packages), audits them, and installs them into harness-specific filesystem paths via CLI and MCP. Dual-track ready for a static gallery site and factory enrichment (mcp-flow patterns).

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
| P4 TUI + HTTP `/mcp` + update | todo |

## Architecture

See README. Control plane writes skill trees; harnesses discover natively.

## Non-goals (v1)

- SaaS marketplace / payments
- Executing skill scripts inside skill-flow
- Replacing harness skill loaders
