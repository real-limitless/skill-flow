# Competitive feature gap: skill-flow vs Agent Skills catalogs and install planes

**Status:** open tracking issue [#16](https://github.com/real-limitless/skill-flow/issues/16)  
**Date:** 2026-09-10  
**Baseline:** `CORE` (this branch) plus runnable product on `DEVELOPMENT` / `main` @ P4 HTTP `/mcp` + `/admin`. Factory (PLAN P2) is still todo.  
**Related:** #10 (QA viability), PLAN.md P2 factory.

This is the product comparison, not a QA bug list. Use it to decide what skill-flow should ship next and what it should refuse to become.

## 1. Positioning

skill-flow is a **self-hosted control plane** for Agent Skills (`SKILL.md`):

```text
search → show → audit → install(confirm) → list_installed
```

It writes ordinary skill trees onto disk. Harnesses discover them natively. It does not run skill scripts. It is not a SaaS marketplace. Catalog source of truth is seeds plus public git (factory), not scraped competitor HTML.

That is a different job from:

| Job | Who owns it |
| --- | --- |
| Spec | [agentskills.io](https://agentskills.io) |
| Mass public index | skills.sh, SkillsMP, Skills Directory |
| One-shot installer / path matrix | `npx skills`, agent-install |
| Workflow sync + TUI | VintLin/skill-flow (npm name collision) |
| Skill **runtime** over MCP | SkillPort, skills-mcp |
| Registry + publish + versions | ClawHub |
| MCP **servers** (not skills) | mcp-flow (sibling), Smithery, mcpmarket |

The failure mode we refuse: expertise trapped in zip files and tribal paths, installed without an audit, lost across OpenCode / Cursor / Codex.

## 2. What we actually ship today

Measured from this repo (CORE docs + DEVELOPMENT CLI/MCP + `main` after #13).

| Surface | Today |
| --- | --- |
| Catalog | Schema `SkillGalleryEntry` 1.0.0. Five seed skills. Sharded JSON. Blocklist. `catalog add` for local dirs. No factory crawl. |
| CLI | `doctor`, `harness list\|detect`, `catalog search\|show\|list\|add\|reindex`, `install`, `uninstall`, `list`, `audit`, `serve` |
| MCP (stdio) | `sf_search_skills`, `sf_show_skill`, `sf_get_skill_file`, `sf_audit_skill`, `sf_install_skill` (confirm required), `sf_uninstall_skill`, `sf_list_installed`, `sf_list_harnesses`, `sf_status` |
| HTTP (`main`) | `serve --http`: `/health`, `/admin`, `/v1`, Streamable HTTP `/mcp`. Operator login. Instance-local SQLite. |
| Install sources | Catalog id, local path, git URL |
| Targets | `portable` (`.agents/skills`), `detected`, `harness:<id>`, `generic --path`. Scope `user\|project`. Mode `copy\|symlink`. |
| Harness matrix | 11 dir harnesses + zip (claude.ai) + generic. Claude Code, OpenCode, Cursor, Codex, Gemini CLI, Copilot, OpenClaw, Goose, Roo, Amp. |
| Audit | Regex heuristics: curl\|sh, wget\|sh, eval, base64, exfil wording, secret paths, has-scripts, external URLs, name mismatch. Does not execute scripts. |
| Site | Static gallery, search, risk filter. GitHub Pages. |
| Identity | Apache-2.0. Unscoped npm name `skill-flow` is **already taken** (#10 P0). |

Non-goals that still look like gaps to users: payments, executing skills inside the plane, replacing harness loaders.

## 3. Competitor map

Compared 2026-09-10 from public READMEs, npm, and directory homepages. Directory sizes cited from [AgenticSkills directory comparison](https://agenticskills.io/ai-skills-directories) (read 2026-09-04).

### A. Public directories (discovery, not install planes)

| Project | Operator | Indexed | Vetting | Install path |
| --- | --- | --- | --- | --- |
| [skills.sh](https://skills.sh) | Vercel | 1,367,794 | None published. Rank by install count / 8-week activity. | `npx skills add owner/repo` |
| [SkillsMP](https://skillsmp.com) | Community marketplace | 2,000,000+ | None published. GitHub crawl. | Marketplace browse |
| [Skills Directory](https://www.skillsdirectory.com) | Skills Directory | ~104k–194k | Automated scan: 120 patterns, 10 threat categories. Claims 36% of wild skills have flaws. | `npx -y skills find` |
| [Awesome Skills](https://awesomeskill.ai) | Marketplace UI | Unpublished | None published | Browse |
| [AgenticSkills](https://agenticskills.io) | Curated | 192 skills + 200 MCP servers | Selected, not crawled | Editorial |

**skill-flow:** 5 seeds. Schema-ready for factory. No public index at this scale. Honest about not scraping those sites.

### B. Install CLIs (path matrix + git add)

| Project | Stars / reach | Agents | Catalog | Audit | Update / lock | MCP | Extra |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) (`npx skills`) | 22k+ stars. De facto ecosystem CLI. | **67+** agents. Auto-detect. Symlink canonical copy or `--copy`. | `skills find` against skills.sh. Discovers many repo layouts + Claude `marketplace.json` / `plugin.json`. | No static risk scan | `skills update`, `skills-lock.json` / `.skills.json`, `experimental_install` restore | No (installs files only) | `skills use` without install. `skills init`. Global vs project. GitHub, GitLab, any git, local. |
| [millionco/agent-install](https://github.com/millionco/agent-install) | npm library + CLI | 50+ skill agents, 14 MCP hosts | No gallery. Source in, files out. | No | No lockfile of the skills.sh kind | **Yes:** writes MCP JSON/JSONC/YAML/TOML | **AGENTS.md** section API. `.well-known/agent-skills` client. Claude plugin manifests. Node API. |
| [VintLin/skill-flow](https://github.com/VintLin/skill-flow) | **npm `skill-flow` 1.5.9**. 262 stars. Ink TUI + macOS SwiftUI app. | Claude, Codex, Cursor, Grok, Gemini, OpenCode, OpenClaw, Hermes, MiniMax, Kimi, Trae, Windsurf, Copilot, … | Search skills.sh + GitHub + local. Grouped **sources** (one repo stays one unit). | Repair/doctor, not a threat DB | `manifest.json` intent + `lock.json` inventory. `update`, `repair-*` | Bridge `--json` for desktop | **This is the name collision.** Same bin. Different product. |
| [iheanyi/agentctl](https://github.com/iheanyi/agentctl) | Go CLI + TUI | Claude, Cursor, Codex, Gemini native import | No public gallery | No | Profiles, project-local override | MCP add/sync across tools | Commands, rules, skills, subagents, **hooks**. Broader than skills. |
| **this skill-flow** | Unpublished on npm. 5 seeds. | 11 dir + zip + generic | Self-hosted gallery + schema | Yes (shallow) | No update command. No lockfile. | Yes: **control-plane** MCP (stdio + HTTP on `main`) | Confirm-required install. Admin console. Family with mcp-flow. |

### C. MCP skill runtimes (serve skills, do not materialize to harness dirs)

| Project | Model | Why it matters |
| --- | --- | --- |
| [gotalab/skillport](https://github.com/gotalab/skillport) | SkillOps: validate spec, `add` from GitHub, `update`, MCP `search_skills` + `load_skill` (search-first, ~100 tokens/skill). `skillport doc` writes AGENTS.md. Category/tag filters per client. Python. | Agents without native `SKILL.md` still get skills. We only help agents that already load files. |
| [skills-mcp/skills-mcp](https://github.com/skills-mcp/skills-mcp) | MCP `list_skills` / init prompt over a skills directory | Same: runtime, not install plane. Tiny catalog (user supplies dir). |

### D. Registries with publish, versions, and security product

| Project | Model | Why it matters |
| --- | --- | --- |
| [ClawHub](https://clawhub.ai) | OpenClaw registry. Semver, tags, changelogs, downloads, stars, scan summaries. CLI: search, install, pin, update, publish, lock.json. HTTP API. `nonSuspiciousOnly`. Clawdex / Koi malicious-skill DB. | Closest to “npm for skills” for one harness family. We have no publish, pin, or versioned registry. |
| Claude Code plugin marketplaces | `.claude-plugin/marketplace.json` + `plugin.json` | vercel-labs/skills and agent-install already ingest these. We clone git and pick a `SKILL.md`; we do not speak plugin manifests. |
| [`.well-known/agent-skills`](https://github.com/cloudflare/agent-skills-discovery-rfc) | Draft discovery index + SHA-256 digests | agent-install already fetches it. We do not. |

### E. Name collision (P0 identity)

[npm `skill-flow`](https://www.npmjs.com/package/skill-flow) is VintLin’s workflow manager (`npx skill-flow` → 1.5.9). Our README, site, and MCP snippets tell people to run `npx skill-flow serve`. That attaches the **wrong** CLI unless cwd is this repo after `npm install`. Filed in #10. Still open as a product decision.

## 4. Feature matrix

Legend: **Y** = shipped, **P** = partial / shallow, **N** = missing, **—** = not their job.

| Capability | This repo | vercel `npx skills` | agent-install | VintLin skill-flow | SkillPort | ClawHub | Skills Directory |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Self-hosted catalog schema | **Y** | N | N | P (local state) | P (dir + meta) | Y (hosted) | Y (hosted) |
| Search → audit → install ritual (MCP) | **Y** | N | N | N | P (search/load, no disk install to 11 harnesses) | N | N |
| Confirm-required install | **Y** | Optional `-y` | `-y` | Guided TUI | N/A | Pin/scan | N |
| Never execute skill scripts on install | **Y** | Y | Y | Y | Y | Sandbox flags elsewhere | — |
| Static risk audit before install | **P** (6 regex families) | N | N | N | Spec validate, not malware | Scan API + threat DB | **Y** (120 patterns) |
| Public discovery at scale | N (5 seeds) | **Y** (skills.sh) | N | Y (skills.sh search) | Curated lists in README | Registry search | **Y** |
| Factory / git SoT (no HTML scrape) | Planned P2 | GitHub index | Git clone | Git + skills.sh | Git add | Publish API | Crawl |
| Harness path adapters | 11 + zip | **67+** | **50+** | 15+ incl. Trae/Windsurf/Hermes | Serve via MCP instead | OpenClaw paths | — |
| `detected` / auto-detect agents | **P** | **Y** | **Y** | Y | N | N | — |
| Symlink canonical + per-agent links | P (`--mode symlink`) | **Y** (default) | Copy-oriented | Project/lock | Own dir | Zip extract | — |
| Update from origin | **N** | **Y** | N | **Y** | **Y** | **Y** (`update --all`) | — |
| Lockfile / pin / restore (npm ci analog) | **N** | **Y** (experimental) | N | **Y** | N | **Y** | N |
| Multi-skill repo (pick one / all) | **P** (git URL can grab the wrong SKILL.md, #10 P2.4) | **Y** (`-s`, `--list`) | **Y** (`@skill`, discover all) | **Y** (grouped source) | add path | Slug | — |
| Claude plugin marketplace.json | N | **Y** | **Y** | ? | N | Plugins separately | — |
| `.well-known/agent-skills` | N | N | **Y** | N | N | Own API | — |
| `skills use` / load without install | N | **Y** | N | N | **Y** (`load_skill`) | Inspect API | — |
| `skills init` / authoring | N | **Y** | **Y** (`skill init`) | N | Docs | `skill publish` | Submit form |
| Spec validator (CI JSON) | P (parse + schema on catalog) | N | N | N | **Y** | Package validate | Security scan |
| AGENTS.md generation | N | N | **Y** | N | **Y** (`doc`) | N | — |
| Install MCP servers | N (sibling mcp-flow) | N | **Y** | N | N | Plugins | MCP list on AgenticSkills |
| HTTP MCP + operator admin | **Y** (`main`) | N | N | Desktop app | MCP stdio | Hosted site | — |
| TUI | N (deferred) | fzf-style `find` | N | **Y** (Ink) | N | N | Web |
| Publish / ratings / stars | N (non-goal) | Telemetry installs | N | N | N | **Y** | Sponsor badges |
| npm-publishable unique bin | **N** (collision) | `skills` | `agent-install` | `skill-flow` | `skillport` | `clawhub` | — |

## 5. Gaps that matter

Ordered by how much they block the job we already claim: **one plane to catalog, audit, and install into every harness**.

### P0. Identity: we do not own `npx skill-flow`

VintLin’s package is not a distant cousin. It is the same problem statement (multi-agent skill deploy) with a TUI, lockfiles, skills.sh search, and a desktop app. Our docs invoke their binary.

**Close this before growing the catalog.** Scoped name (`@real-limitless/skill-flow`) or a unique bin. Change every `npx skill-flow` example. See #10.

### P1. Catalog is a schema with five rows

Competitors win on **find**. skills.sh is the default “is there a skill for X?” surface (`find-skills` skill, 3.3M installs on the leaderboard page). We cannot be that index. We should not scrape it.

Factory (PLAN P2) is the real gap: ingest **public git + seed lists**, enrich `SkillGalleryEntry` (stars, default branch, security flags, readme preview), shard, reindex. Until that ships, `sf_search_skills` is a demo.

Do not HTML-scrape skills.sh / SkillsMP / mcpmarket. Optional later: **federate** a search query to a public git list or a documented API, then still audit + install locally.

### P1. No update, pin, or lockfile

`npx skills update`, ClawHub `update --all` + pin, VintLin `lock.json`, SkillPort `update` are table stakes for teams. We install once and forget. `InstalledSkill` already has optional `sha256` / `sourceId` in types. Nothing persists a restoreable inventory.

Gap: `skill-flow update`, `list` that knows origin refs, a lockfile under skill-flow home / project, uninstall that drops the lock row.

### P1. Git / multi-skill sources are weaker than the ecosystem CLI

vercel-labs/skills and agent-install:

- GitHub shorthand `owner/repo`
- Subpath and `@skill` filter
- `--list` before install
- Walk `skills/`, `.claude/skills/`, `.agents/skills/`, and 40+ other container dirs
- Read Claude `marketplace.json`

We: clone a URL, find a `SKILL.md`, can pick the wrong tree (#10 P2.4). No `owner/repo` shorthand documented as first-class. No “install these three from that repo.”

### P1. Audit is a regex toy next to Skills Directory / Clawdex

We flag curl\|sh, eval, `.env`, and “has scripts.” Skills Directory publishes 120 patterns across prompt injection, credential theft, exfiltration. ClawHub exposes scan endpoints and a malicious-skill database. Snyk reported 36% of sampled skills flawed.

Keep the rule: **never run scripts on install**. Still grow audit:

- Spec validate (SkillPort already does this; we parse frontmatter but do not ship `skill-flow validate --json` for CI)
- More threat families (prompt-injection boilerplate, obfuscation, unexpected network)
- Optional hash / lock check against a **local** blocklist (we already have `catalog/blocklist.txt`)
- Do not claim “security-tested” until the scanner is in the same league as Skills Directory

### P1. Harness matrix is an order of magnitude behind

`npx skills` lists 67 agents. We have 11 dir adapters. Missing from our registry that show up in the ecosystem CLI: Windsurf, Continue, Cline, Trae, Hermes, Kiro, Kilo, Crush, Droid/Factory, Antigravity, Warp, Zed, Qwen, Junie, and the rest.

Our Cursor **project** path is `.cursor/skills`. vercel-labs/skills uses `.agents/skills/` for Cursor project and `~/.cursor/skills` globally. Copilot project: we use `.github/skills`, they use `.agents/skills`. Those mismatches mean “installed with skill-flow” can be invisible to an agent that only reads the other path.

**Gap:** expand `HARNESS_REGISTRY` toward the agentskills.io client list. Align default Cursor/Copilot project paths with the ecosystem CLI or document why we differ. Keep `portable` as default.

### P2. Discovery protocols we ignore

- Claude plugin marketplace manifests
- `/.well-known/agent-skills/index.json` (digest-verified)
- GitLab URLs (schema allows `gitlab`; CLI UX is git-URL shaped)

agent-install already speaks well-known + plugins. If we want “install anywhere,” we should accept the same sources.

### P2. No authoring loop

`npx skills init`, `agent-install skill init`, ClawHub publish. We only **consume**. A `skill-flow init` that writes a valid `SKILL.md` + optional catalog add would close the loop for operators who use the plane as a library.

### P2. Agents without native skills get nothing

SkillPort’s MCP `load_skill` is the right answer for clients that cannot read `.agents/skills`. Our MCP is an **operator** ritual (search/audit/install), not a skill runner. That is a locked decision (do not replace harness loaders). Still a gap for “bring skills to any MCP client.”

Possible cheap overlap: `sf_show_skill` / `sf_get_skill_file` already return text. Document that as “inspect,” not “execute.” Do not become SkillPort.

### P2. No AGENTS.md / MCP-server install

agent-install and agentctl cover MCP config and AGENTS.md. That is **mcp-flow’s** lane plus docs. Do not duplicate MCP-server install here. Maybe a single “enroll this skill-flow server” helper (we already have `scripts/enroll-mcp-flow.sh`). AGENTS.md skill tables are SkillPort/agent-install. Low priority unless roster-flow needs it.

### P2. UX: TUI, `find`, desktop

VintLin has Ink + SwiftUI. vercel has fzf-style `skills find`. PLAN deferred TUI. HTTP `/admin` on `main` is our operator UI. That is enough if the gallery is real. Do not build a macOS app to copy VintLin.

### P3. Marketplace features we should keep refusing

Stars, trending, payments, anonymous install telemetry as ranking, HTML scrape of mcpmarket/skills.sh. Those fight our locked decisions and our security story. ClawHub-style **publish** is a different product (SaaS). Out of v1.

## 6. What we already win (do not throw away)

1. **Ritual as MCP tools** so an agent can search, audit, and install with `confirm: true`. The ecosystem CLI is for humans. We are for agents operating the plane.
2. **Confirm + no script execution.** Most installers skip audit entirely.
3. **Normalized gallery entry** (provenance, package sha256, security flags, skillMd preview). Directories either crawl everything or curate by hand. We have a contract.
4. **Self-hosted** catalog + admin + HTTP MCP. skills.sh is a public website. ClawHub is a hosted registry. We fit TheFLOW / air-gapped / Compose on 8788.
5. **Family split:** mcp-flow = MCP servers and keys. skill-flow = SKILL.md trees. agent-install blends both; we stay sharp.
6. **Portable `.agents/skills` default.** Correct for the spec. Keep it.

## 7. Recommended sequencing

Not a calendar. Order of unblocking.

1. **P0 name.** Pick a scoped npm package / unique bin. Stop telling the world `npx skill-flow`.
2. **P1 factory.** Public git + seed lists → shards. Search that is not five rows. Still no marketplace scrape.
3. **P1 source resolver.** `owner/repo`, subpath, multi-skill `--list` / `--skill`, Claude plugin manifests, refuse installing this product repo as a skill.
4. **P1 update + lockfile.** Origin ref, sha256, restore, uninstall syncs lock.
5. **P1 harness parity.** Add high-traffic missing adapters (Windsurf, Continue, Cline, Trae, Hermes, Kiro). Revisit Cursor/Copilot project paths vs `npx skills`.
6. **P1 audit depth.** Spec validate JSON for CI. Expand heuristics. Wire blocklist into install. Optional: consume a published malicious-skill hash list (not HTML scrape).
7. **P2 well-known + GitLab UX.** Same install function, more sources.
8. **P2 `init`.** Write SKILL.md, optionally `catalog add`.
9. Leave SkillPort-style skill **runtime**, ClawHub publish, and TUI until the plane is the best installer, not a fifth marketplace.

## 8. Explicit non-copies

- Do not scrape skills.sh, SkillsMP, mcpmarket, or ClawHub HTML as catalog SoT.
- Do not rank by unverifiable install telemetry.
- Do not execute skill scripts to “verify” them.
- Do not merge MCP-server install into this repo (mcp-flow).
- Do not become a paid skill store.

## 9. Sources

- This repo: README, PLAN.md, `catalog/schema.json`, DEVELOPMENT `src/cli.ts` / `src/mcp/server.ts` / `src/audit/scan.ts` / `src/harness/registry.ts`, `main` PLAN P4 (#13).
- [vercel-labs/skills](https://github.com/vercel-labs/skills) README (67+ agents, find/update/lock, 2026-09-10).
- [agent-install](https://github.com/millionco/agent-install) README (skills + MCP + AGENTS.md, well-known).
- [VintLin/skill-flow](https://github.com/VintLin/skill-flow) + [npm skill-flow](https://www.npmjs.com/package/skill-flow) 1.5.9.
- [SkillPort](https://github.com/gotalab/skillport), [skills-mcp](https://github.com/skills-mcp/skills-mcp), [agentctl](https://github.com/iheanyi/agentctl).
- [ClawHub docs](https://docs2.openclaw.ai/clawhub), [Skills Directory](https://www.skillsdirectory.com), [AgenticSkills directories](https://agenticskills.io/ai-skills-directories) (figures 2026-09-04).
- [Agent Skills spec](https://agentskills.io/specification), [well-known RFC](https://github.com/cloudflare/agent-skills-discovery-rfc).

## 10. Acceptance for this issue

This issue is the map. Closing it means the P0/P1 items above are either shipped or explicitly rejected in PLAN.md with a reason. Child issues should be filed per P1 bullet, not as another essay.
